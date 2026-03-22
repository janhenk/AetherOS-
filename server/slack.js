import pkg from '@slack/bolt';
const { App } = pkg;
import { WebClient } from '@slack/web-api';
import { runAgentLoop, AGENTS, TOOLS } from './agent.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const CHAT_FILE = path.join(DATA_DIR, 'chat_history.json');

let slackApp = null;

// Prevent Slack-related unhandled rejections from killing the process
// This is critical for keeping the dashboard accessible even if Slack auth fails.
if (typeof process !== 'undefined') {
    process.on('unhandledRejection', (reason, promise) => {
        if (reason && reason.toString().includes('slack')) {
            console.error('[Slack] CAUGHT UNHANDLED REJECTION:', reason.message || reason);
        } else {
            // Log other rejections but don't exit if possible (depends on Node version/flags)
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        }
    });
}

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
    if (!settings.slackEnabled) {
        console.log("[Slack] Integration disabled in settings.");
        return;
    }
    if (!settings.slackBotToken || !settings.slackAppToken) {
        console.warn("[Slack] Configuration incomplete: Bot Token or App Token missing.");
        return;
    }

    try {
        await stopSlackApp();

        // Basic Token Validation
        const isBotToken = settings.slackBotToken?.startsWith('xoxb-');
        const isAppToken = settings.slackAppToken?.startsWith('xapp-');

        if (!isBotToken) {
            console.error("[Slack] WARNING: Bot Token should start with 'xoxb-'. Found:", settings.slackBotToken?.substring(0, 5));
        }
        if (!isAppToken) {
            console.error("[Slack] WARNING: App Token should start with 'xapp-'. Found:", settings.slackAppToken?.substring(0, 5));
        }

        console.log(`[Slack] Initializing Socket Mode...`);

        // Defensive: Test the bot token manually first to avoid internal Bolt crashes
        if (isBotToken) {
            try {
                const testClient = new WebClient(settings.slackBotToken);
                await testClient.auth.test();
                console.log("[Slack] Bot Token verified.");
            } catch (authErr) {
                console.error("[Slack] INITIAL AUTH TEST FAILED:", authErr.message);
                if (authErr.message.includes('invalid_auth')) {
                    console.error("[Slack] Aborting startup to prevent crash. Please check your tokens.");
                    return;
                }
            }
        }

        slackApp = new App({
            token: settings.slackBotToken,
            appToken: settings.slackAppToken,
            socketMode: true,
            // Capture errors to prevent process crash
            logLevel: 'error', 
        });

        // Global error handler for the Bolt app
        slackApp.error(async (error) => {
            console.error("[Slack] Bolt App Error:", error.message || error);
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

const CHANNEL_AGENTS_FILE = path.join(DATA_DIR, 'channel_agents.json');

async function handleSlackEvent({ event, client, say }, getSettingsFn, baseUrl, internalToken) {
    try {
        const isDM = event.channel_type === 'im';
        
        // Defensive: Some message events might not have text (e.g. file shares, deletions)
        if (!event.text) {
            console.log(`[Slack] Skipping event without text (type: ${event.type}, subtype: ${event.subtype})`);
            return;
        }

        const rawText = event.text.replace(/<@[^>]+>/g, '').trim(); 
        const threadTs = event.thread_ts || event.ts;
        
        // For DMs, use the channel ID as the session to preserve history across messages.
        // For channels, continue using thread_ts to keep separate conversation threads.
        const sessionId = isDM ? `slack_${event.channel}` : `slack_${event.channel}_${threadTs}`;

        // Handle Help/List commands
        if (['help', 'list', 'agents', 'hi', 'hello'].includes(rawText.toLowerCase())) {
            const agentList = AGENTS.map(a => `*${a.id}* - ${a.name} (${a.shortName})`).join('\n');
            await say({
                text: `*AetherOS Slack Integration Help*\n\nTo interact with an AI agent, prefix your message with its ID (e.g., \`nav status\`). In DMs, I remember which agent you last spoke to!\n\n*Available Agents:*\n${agentList}\n\n_System status: Nominal._`,
                thread_ts: event.ts // Use event.ts to reply to the specific message even in DMs
            });
            return;
        }

        // Determine agent ID
        let agentId = null;
        let cleanText = rawText;

        // 1. Try to match prefix (id, name, or shortName)
        for (const agent of AGENTS) {
            const patterns = [
                agent.id.toLowerCase(),
                agent.name.toLowerCase(),
                agent.shortName.toLowerCase()
            ];
            
            for (const p of patterns) {
                if (rawText.toLowerCase().startsWith(p)) {
                    agentId = agent.id;
                    // Remove the prefix from the text to the LLM
                    if (rawText.toLowerCase().startsWith(p + ' ') || rawText.toLowerCase().startsWith(p + ':') || rawText.toLowerCase() === p) {
                         cleanText = rawText.slice(p.length).replace(/^[:\s,]+/, '');
                    }
                    break;
                }
            }
            if (agentId) break;
        }

        // 2. Sticky Agent Logic: Load last used agent for this channel if in a DM
        let channelAgents = {};
        if (fs.existsSync(CHANNEL_AGENTS_FILE)) {
            try { channelAgents = JSON.parse(fs.readFileSync(CHANNEL_AGENTS_FILE, 'utf8')); } catch (e) {}
        }

        if (!agentId && isDM) {
            agentId = channelAgents[event.channel] || 'comms';
        } else if (!agentId) {
            agentId = 'comms'; // Default for channels if no mention/prefix matched
        }

        // Save current agent as sticky for this channel
        channelAgents[event.channel] = agentId;
        fs.writeFileSync(CHANNEL_AGENTS_FILE, JSON.stringify(channelAgents, null, 2));
        
        // Let user know we are thinking
        const thinkingMsg = await say({ text: `_AetherOS ${agentId.toUpperCase()} is processing..._`, thread_ts: threadTs });

        // Load history 
        let chatData = fs.existsSync(CHAT_FILE) ? JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')) : {};
        const history = chatData[sessionId] || [];

        const settings = getSettingsFn();
        const agentDef = AGENTS.find(a => a.id === agentId) || AGENTS[1];
        const systemInstruction = settings.agentOverrides?.[agentId]?.systemPrompt || agentDef.systemPrompt;
        
        // Add context to the prompt
        const fullPrompt = `${cleanText}\n\n[CONTEXT: User reached out via Slack ${isDM ? 'Direct Message' : 'Channel'}. Keep response formatted nicely for Slack Markdown (*bold*, _italic_, \`code\`).]`;

        // Run Loop
        const newHistory = await runAgentLoop(agentId, fullPrompt, systemInstruction, history, settings, TOOLS, baseUrl, internalToken);
        
        // Save history
        chatData[sessionId] = newHistory;
        fs.writeFileSync(CHAT_FILE, JSON.stringify(chatData, null, 2));

        // Get the latest agent response text
        const responseMsgs = newHistory.filter(m => m.role === 'agent');
        let finalResponse = "Task completed without text output.";
        if (responseMsgs.length > 0) {
            const nonToolMsgs = responseMsgs.filter(m => !m.content.startsWith('TOOL_'));
            if (nonToolMsgs.length > 0) {
                finalResponse = nonToolMsgs[nonToolMsgs.length - 1].content;
            }
        }

        // Post back
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
