import pkg from '@slack/bolt';
const { App } = pkg;
import { runAgentLoop, AGENTS, TOOLS } from './agent.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const CHAT_FILE = path.join(DATA_DIR, 'chat_history.json');

let slackApp = null;

export async function stopSlackApp() {
    if (slackApp) {
        try {
            await slackApp.stop();
            slackApp = null;
            console.log("Stopped Slack App via Socket Mode.");
        } catch (e) {
            console.error("Error stopping Slack app:", e);
        }
    }
}

export async function startSlackApp(settings, getSettingsFn, baseUrl, internalToken) {
    if (!settings.slackBotToken || !settings.slackAppToken || !settings.slackEnabled) {
        console.log("Slack integration is disabled or missing tokens.");
        return;
    }

    try {
        await stopSlackApp();

        console.log(`[Slack] Starting app with Bot Token: ${settings.slackBotToken ? (settings.slackBotToken.substring(0, 10) + '...') : 'MISSING'}`);
        console.log(`[Slack] App Token: ${settings.slackAppToken ? (settings.slackAppToken.substring(0, 10) + '...') : 'MISSING'}`);

        slackApp = new App({
            token: settings.slackBotToken,
            appToken: settings.slackAppToken,
            socketMode: true,
            // Disable default ExpressReceiver since we already have an express app
            // However, bolt defaults to its own internal HTTP server if not provided.
            // Since we use SocketMode, the HTTP server is mostly unused.
        });

        // Listen for mentions
        slackApp.event('app_mention', async ({ event, context, client, say }) => {
            await handleSlackEvent({ event, client, say }, getSettingsFn, baseUrl, internalToken);
        });

        // Listen for direct messages 
        slackApp.message(async ({ event, client, say }) => {
            // Only respond to DMs (channel_type === 'im') that aren't bot messages
            if (event.channel_type === 'im' && !event.bot_id) {
                await handleSlackEvent({ event, client, say }, getSettingsFn, baseUrl, internalToken);
            }
        });

        await slackApp.start();
        console.log("⚡️ Slack Bolt app is running in Socket Mode!");

    } catch (e) {
        console.error("Failed to start Slack App:", e);
        slackApp = null;
    }
}

async function handleSlackEvent({ event, client, say }, getSettingsFn, baseUrl, internalToken) {
    try {
        const text = event.text.replace(/<@[^>]+>/g, '').trim(); // Remove mention
        const threadTs = event.thread_ts || event.ts;
        const sessionId = `slack_${event.channel}_${threadTs}`;

        // Determine agent ID from text (e.g., "nav, status" or just default)
        let agentId = 'comms'; // default
        for (const agent of AGENTS) {
            if (text.toLowerCase().startsWith(agent.id.toLowerCase())) {
                agentId = agent.id;
                // remove the prefix
                break;
            }
        }
        
        // Let user know we are thinking
        const thinkingMsg = await say({ text: `_AetherOS ${agentId.toUpperCase()} is processing..._`, thread_ts: threadTs });

        // Load history 
        let chatData = fs.existsSync(CHAT_FILE) ? JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')) : {};
        const history = chatData[sessionId] || [];

        const settings = getSettingsFn();
        const agentDef = AGENTS.find(a => a.id === agentId) || AGENTS[1];
        const systemInstruction = settings.agentOverrides?.[agentId]?.systemPrompt || agentDef.systemPrompt;
        
        // Add context to the prompt
        const fullPrompt = `${text}\n\n[CONTEXT: User reached out via Slack. Keep response formatted nicely for Slack Markdown (*bold*, _italic_, \`code\`).]`;

        // Run Loop
        const newHistory = await runAgentLoop(agentId, fullPrompt, systemInstruction, history, settings, TOOLS, baseUrl, internalToken);
        
        // Save history
        chatData[sessionId] = newHistory;
        fs.writeFileSync(CHAT_FILE, JSON.stringify(chatData, null, 2));

        // Get the latest agent response text
        const responseMsgs = newHistory.filter(m => m.role === 'agent');
        let finalResponse = "Task completed without text output.";
        if (responseMsgs.length > 0) {
            // grab the last message that isn't a tool marker
            const nonToolMsgs = responseMsgs.filter(m => !m.content.startsWith('TOOL_'));
            if (nonToolMsgs.length > 0) {
                finalResponse = nonToolMsgs[nonToolMsgs.length - 1].content;
            }
        }

        // Post back using Slack client to update the placeholder message
        if (thinkingMsg.ts && thinkingMsg.channel) {
            await client.chat.update({
                channel: thinkingMsg.channel,
                ts: thinkingMsg.ts,
                text: finalResponse
            });
        } else {
            await say({ text: finalResponse, thread_ts: threadTs });
        }

    } catch (e) {
        console.error("Slack event execution error:", e);
        await say({ text: `⚠ Encountered system error processing Slack request: ${e.message}`, thread_ts: event.thread_ts || event.ts });
    }
}
