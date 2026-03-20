import express from 'express';
import cors from 'cors';
import os from 'os';
import { exec, spawn } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { runAgentLoop, AGENTS, TOOLS } from './agent.js';
import { startSlackApp, stopSlackApp } from './slack.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);

const app = express();
const port = process.env.PORT || 5175;

app.use(cors());
app.use(express.json());

// Path to static files (frontend build)
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
}

const activeDeployments = [];
const tacticalInsights = [];
const DATA_DIR = path.join(process.cwd(), 'data');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat_history.json');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'logs', 'subspace_comms.log');

// Ensure data directory structure exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'logs'))) fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });

let cachedStorage = 50;
let previousCpus = os.cpus();
const IS_WIN = os.platform() === 'win32';

// --- Terminal State ---
let terminalCwd = process.cwd();
let isYoloMode = false;

// --- Security Constants ---
const COMMAND_DENYLIST = ['rm -rf /', 'mkfs', 'dd', 'shutdown', 'reboot', 'format'];

async function isGitAvailable() {
    try {
        await execPromise('git --version');
        return true;
    } catch { return false; }
}
const WORKSPACE_ROOT = path.resolve(process.cwd(), 'aetheros', 'workspace');

// Ensure directories exist
if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

function auditLog(agent, action, params, success) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] AGENT: ${agent} | ACTION: ${action} | PARAMS: ${JSON.stringify(params)} | SUCCESS: ${success}\n`;
    fs.appendFileSync(AUDIT_LOG_PATH, logEntry);
}

function isPathSafe(targetPath) {
    const resolved = path.resolve(targetPath);
    return resolved.startsWith(WORKSPACE_ROOT);
}

// --- System Metrics Loop ---
const updateStorage = async () => {
    try {
        if (IS_WIN) {
            const { stdout } = await execPromise('wmic logicaldisk get size,freespace,caption');
            const lines = stdout.split('\n');
            let total = 0, free = 0;
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].trim().split(/\s+/);
                if (parts.length >= 3 && parts[0] === 'C:') {
                    free += parseInt(parts[1], 10);
                    total += parseInt(parts[2], 10);
                }
            }
            if (total > 0) cachedStorage = ((total - free) / total) * 100;
        } else {
            const { stdout } = await execPromise("df / | tail -1 | awk '{print $5}' | sed 's/%//'");
            cachedStorage = parseInt(stdout.trim(), 10);
        }
    } catch (e) { /* ignore */ }
};
updateStorage();
setInterval(updateStorage, 60000);

// --- Settings Management ---
function getSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return { 
            apiKey: '', 
            model: 'gemini-2.0-flash', 
            temperature: 0.7, 
            isSandboxNetworkEnabled: false, 
            isYoloMode: false, 
            registries: [],
            agentOverrides: {},
            bgProvider: 'gemini',
            bgBaseUrl: '',
            bgApiKey: '',
            bgModelName: '',
            bgIterationLimit: 5,
            slackEnabled: false,
            slackBotToken: '',
            slackAppToken: ''
        };
    }
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (settings.isYoloMode === undefined) settings.isYoloMode = false;
    if (settings.registries === undefined) settings.registries = [];
    if (settings.agentOverrides === undefined) settings.agentOverrides = {};
    if (settings.bgProvider === undefined) settings.bgProvider = 'gemini';
    if (settings.bgIterationLimit === undefined) settings.bgIterationLimit = 5;
    if (settings.slackEnabled === undefined) settings.slackEnabled = false;
    return settings;
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// --- API Endpoints ---

const activeTokens = new Set();
const INTERNAL_TOKEN = crypto.randomUUID();
activeTokens.add(INTERNAL_TOKEN);

// Start Slack Integration
startSlackApp(getSettings(), getSettings, `http://localhost:${port}`, INTERNAL_TOKEN);

const CHAT_HISTORY_FILE = CHAT_FILE;
const PENDING_TASKS_FILE = path.join(DATA_DIR, 'pending_tasks.json');
let pendingTasks = fs.existsSync(PENDING_TASKS_FILE) ? JSON.parse(fs.readFileSync(PENDING_TASKS_FILE, 'utf8')) : [];

app.post('/api/auth/setup', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password required' });
        
        const data = fs.existsSync(CHAT_HISTORY_FILE) ? JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8')) : {};
        if (data.passwordHash) return res.status(400).json({ error: 'Already setup' });
        
        data.passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(data, null, 2));
        
        const token = crypto.randomUUID();
        activeTokens.add(token);
        res.json({ success: true, token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password required' });
        
        const data = fs.existsSync(CHAT_HISTORY_FILE) ? JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8')) : {};
        if (!data.passwordHash) return res.status(400).json({ error: 'Not setup yet' });
        
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        if (hash !== data.passwordHash) return res.status(401).json({ error: 'Invalid password' });
        
        const token = crypto.randomUUID();
        activeTokens.add(token);
        res.json({ success: true, token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/status', (req, res) => {
    try {
        const data = fs.existsSync(CHAT_HISTORY_FILE) ? JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8')) : {};
        res.json({ needsSetup: !data.passwordHash });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    
    const token = authHeader.split(' ')[1];
    if (!activeTokens.has(token)) return res.status(401).json({ error: 'Invalid token' });
    
    next();
});

app.get('/api/config/get', (req, res) => {
    const settings = getSettings();
    const safeSettings = { ...settings };
    if (safeSettings.apiKey) safeSettings.hasKey = true;
    if (safeSettings.bgApiKey) safeSettings.hasBgKey = true;
    if (safeSettings.slackBotToken) safeSettings.hasSlackBotToken = true;
    if (safeSettings.slackAppToken) safeSettings.hasSlackAppToken = true;
    delete safeSettings.apiKey;
    delete safeSettings.bgApiKey;
    delete safeSettings.slackBotToken;
    delete safeSettings.slackAppToken;
    res.json(safeSettings);
});

app.post('/api/config/save', (req, res) => {
    const newSettings = req.body;
    const currentSettings = getSettings();
    
    // If apiKey is provided as '********', keep current one
    if (newSettings.apiKey === '********' || !newSettings.apiKey) {
        newSettings.apiKey = currentSettings.apiKey;
    }
    if (newSettings.bgApiKey === '********' || !newSettings.bgApiKey) {
        newSettings.bgApiKey = currentSettings.bgApiKey;
    }
    if (newSettings.slackBotToken === '********' || !newSettings.slackBotToken) {
        newSettings.slackBotToken = currentSettings.slackBotToken;
    }
    if (newSettings.slackAppToken === '********' || !newSettings.slackAppToken) {
        newSettings.slackAppToken = currentSettings.slackAppToken;
    }

    // Preserve registries if not provided or empty in manual save
    if (!newSettings.registries || newSettings.registries.length === 0) {
        newSettings.registries = currentSettings.registries;
    }

    // Sync YOLO mode if provided
    if (newSettings.isYoloMode !== undefined) {
        isYoloMode = newSettings.isYoloMode;
    }
    
    saveSettings(newSettings);
    startSlackApp(newSettings, getSettings, `http://localhost:${port}`, INTERNAL_TOKEN);
    res.json({ success: true });
});

let cachedModels = [];
let lastModelFetch = 0;

app.get('/api/models', async (req, res) => {
    try {
        const settings = getSettings();
        if (!settings.apiKey) return res.json({ models: [] });
        
        if (cachedModels.length > 0 && Date.now() - lastModelFetch < 24 * 60 * 60 * 1000) {
            return res.json({ models: cachedModels });
        }
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${settings.apiKey}`);
        if (!response.ok) throw new Error('Failed to fetch models from Google');
        
        const data = await response.json();
        cachedModels = (data.models || [])
            .filter(m => {
                const name = m.name.toLowerCase();
                const displayName = (m.displayName || '').toLowerCase();
                const hasGen = m.supportedGenerationMethods?.includes('generateContent');
                const isExcluded = ['nano', 'banana', 'robotics', 'computer'].some(w => name.includes(w) || displayName.includes(w));
                return hasGen && !isExcluded;
            })
            .map(m => ({
                id: m.name.replace('models/', ''),
                label: m.displayName || m.name.replace('models/', ''),
                maxTokens: m.inputTokenLimit
            }));
        lastModelFetch = Date.now();
        
        res.json({ models: cachedModels });
    } catch (err) {
        if (cachedModels.length > 0) return res.json({ models: cachedModels });
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tasks', (req, res) => {
    const { agentId, prompt, delayMinutes } = req.body;
    pendingTasks.push({
        id: crypto.randomUUID(),
        agentId,
        prompt,
        executeAt: Date.now() + (delayMinutes * 60000)
    });
    fs.writeFileSync(PENDING_TASKS_FILE, JSON.stringify(pendingTasks, null, 2));
    res.json({ success: true, message: `Scheduled task in ${delayMinutes} minutes.` });
});

setInterval(async () => {
    const now = Date.now();
    const readyTasks = pendingTasks.filter(t => t.executeAt <= now);
    if (readyTasks.length === 0) return;
    
    pendingTasks = pendingTasks.filter(t => t.executeAt > now);
    fs.writeFileSync(PENDING_TASKS_FILE, JSON.stringify(pendingTasks, null, 2));
    
    let chatData = fs.existsSync(CHAT_HISTORY_FILE) ? JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8')) : {};
    const settings = getSettings();
    const baseUrl = `http://localhost:${port}`;
    
    for (const task of readyTasks) {
        try {
            const history = chatData[task.agentId] || [];
            const agentDef = AGENTS.find(a => a.id === task.agentId) || AGENTS[0];
            const systemInstruction = settings.agentOverrides?.[task.agentId]?.systemPrompt || agentDef.systemPrompt;
            
            const newHistory = await runAgentLoop(task.agentId, task.prompt, systemInstruction, history, settings, TOOLS, baseUrl, INTERNAL_TOKEN);
            
            chatData[task.agentId] = newHistory;
            fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(chatData, null, 2));
        } catch (e) {
            console.error("Background Agent Error:", e);
        }
    }
}, 30000);

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { messages, agentId, systemInstruction, tools } = req.body;
        const settings = getSettings();
        
        if (!settings.apiKey) {
            return res.status(400).json({ error: 'System Error: No Gemini API key configured on server.' });
        }

        const client = new GoogleGenAI({ apiKey: settings.apiKey });
        
        // Helper to convert frontend messages to Gemini Content objects
        const convertToGeminiHistory = (msgs) => {
            const history = [];
            for (const msg of msgs) {
                if (msg.role === 'user') {
                    history.push({ role: 'user', parts: [{ text: msg.content }] });
                } else if (msg.role === 'agent') {
                    const isToolMarker = msg.content.startsWith('TOOL_RESPONSE:') || msg.content.startsWith('TOOL_ERROR:');
                    
                    if (isToolMarker) {
                        // Tool results are attributed to 'user' role in Gemini API
                        const isError = msg.content.startsWith('TOOL_ERROR:');
                        const prefix = isError ? 'TOOL_ERROR:' : 'TOOL_RESPONSE:';
                        const remaining = msg.content.slice(prefix.length);
                        const colonIdx = remaining.indexOf(':');
                        const name = remaining.slice(0, colonIdx);
                        const responseStr = remaining.slice(colonIdx + 1);
                        
                        let response;
                        try { response = JSON.parse(responseStr); } catch (e) { response = { error: responseStr }; }
                        if (isError) response = { error: response };

                        const lastTurn = history[history.length - 1];
                        if (lastTurn && lastTurn.role === 'user' && lastTurn.parts.some(p => p.hasOwnProperty('functionResponse'))) {
                            lastTurn.parts.push({ functionResponse: { name, response } });
                        } else {
                            history.push({
                                role: 'user',
                                parts: [{ functionResponse: { name, response } }]
                            });
                        }
                    } else {
                        const parts = [];
                        if (msg.toolCalls && msg.toolCalls.length > 0) {
                            for (const fc of msg.toolCalls) {
                                parts.push({ functionCall: { name: fc.name, args: fc.args } });
                            }
                        }
                        if (msg.content) {
                            parts.push({ text: msg.content });
                        }
                        
                        if (parts.length > 0) {
                            history.push({ role: 'model', parts });
                        }
                    }
                }
            }
            return history;
        };

        const history = convertToGeminiHistory(messages);

        const result = await client.models.generateContentStream({
            model: settings.model,
            contents: history,
            config: {
                temperature: settings.temperature,
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools
            }
        });
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        for await (const chunk of result) {
            const chunkText = chunk.text;
            const functionCalls = chunk.functionCalls;
            
            const responseData = {
                text: chunkText,
                functionCalls: functionCalls
            };
            
            res.write(`data: ${JSON.stringify(responseData)}\n\n`);
        }
        
        res.write('event: end\ndata: {}\n\n');
        res.end();

    } catch (err) {
        console.error('AI Proxy Error:', err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/stats', async (req, res) => {
    try {
        const currentCpus = os.cpus();
        let totalIdle = 0, totalTick = 0;
        let prevTotalIdle = 0, prevTotalTick = 0;

        currentCpus.forEach((cpu, i) => {
            for (const type in cpu.times) totalTick += cpu.times[type];
            totalIdle += cpu.times.idle;
            if (previousCpus[i]) {
                for (const type in previousCpus[i].times) prevTotalTick += previousCpus[i].times[type];
                prevTotalIdle += previousCpus[i].times.idle;
            }
        });

        const idle = totalIdle - prevTotalIdle;
        const total = totalTick - prevTotalTick;
        let cpuLoad = total > 0 ? 100 - (100 * idle / total) : 0;
        previousCpus = currentCpus;

        const ramUsed = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;

        // Network
        let networkInbound = 0, networkOutbound = 0;
        try {
            if (IS_WIN) {
                const { stdout } = await execPromise('netstat -e');
                const byteLine = stdout.trim().split('\n')[2]?.trim().split(/\s+/);
                if (byteLine && byteLine.length >= 3) {
                    networkInbound = parseInt(byteLine[1], 10);
                    networkOutbound = parseInt(byteLine[2], 10);
                }
            } else {
                const { stdout } = await execPromise("cat /proc/net/dev | grep -v '|' | tail -n +3 | awk '{in+=$2; out+=$10} END {print in, out}'");
                const [inn, out] = stdout.trim().split(' ');
                networkInbound = parseInt(inn, 10);
                networkOutbound = parseInt(out, 10);
            }
        } catch (e) { }

        // IP
        let ipAddress = req.headers.host ? req.headers.host.split(':')[0] : '127.0.0.1';
        if (ipAddress === 'localhost' || ipAddress === '127.0.0.1') {
            const interfaces = os.networkInterfaces();
            const ipv4Interfaces = [];
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name] || []) {
                    if (!iface.internal && iface.family === 'IPv4') {
                        ipv4Interfaces.push({ name, address: iface.address });
                    }
                }
            }

            if (ipv4Interfaces.length > 0) {
                // Priority: physical > virtual
                ipv4Interfaces.sort((a, b) => {
                    const isVirtual = (n) => /docker|veth|br-|utun|bridge|vbox|vmnet/i.test(n);
                    const aV = isVirtual(a.name);
                    const bV = isVirtual(b.name);
                    if (aV && !bV) return 1;
                    if (!aV && bV) return -1;
                    return 0;
                });
                ipAddress = ipv4Interfaces[0].address;
            }
        }

        let hostName = os.hostname();
        let osInfo = `${os.type()} ${os.release()}`;

        // Docker
        let containers = [], dockerRunning = false;
        try {
            const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
            dockerRunning = true;
            containers = stdout.trim().split('\n').filter(l => l).map(line => {
                const c = JSON.parse(line);
                let status = 'failed';
                if (c.State === 'running') status = 'running';
                else if (c.State === 'restarting') status = 'restarting';
                else if (c.State === 'exited' || c.State === 'dead') status = 'stopped';
                return { id: c.ID, name: c.Names, status, uptime: c.Status };
            });

            // Re-fetch accurate host OS and hostname via Docker Info
            const infoStdout = await execPromise('docker info --format "{{json .}}"');
            const info = JSON.parse(infoStdout.stdout);
            if (info.Name) hostName = info.Name;
            if (info.OperatingSystem) osInfo = info.OperatingSystem.replace(' Docker Desktop', ''); // Clean windows strings
        } catch (e) { }

        // Version
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

        res.json({
            cpuLoad, ramUsed, storageUsed: cachedStorage, containers,
            deployments: activeDeployments, ipAddress, dockerRunning,
            hostname: hostName, osInfo: osInfo,
            networkInbound, networkOutbound,
            insights: tacticalInsights,
            projectVersion: pkg.version
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


app.post('/api/docker/logs', async (req, res) => {
    try {
        const { stdout, stderr } = await execPromise(`docker logs --tail 50 "${req.body.id}"`);
        res.json({ logs: stdout + '\n' + stderr });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Background Update Orchestrator ---
const runBackgroundUpdates = async () => {
    try {
        const stores = fs.existsSync(STORES_FILE) ? JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')) : [];
        if (stores.length === 0) return;

        auditLog('SYSTEM', 'BACKGROUND_UPDATE_START', { storesCount: stores.length }, true);

        for (const storeUrl of stores) {
            try {
                const filename = (storeUrl.split('/').pop() || 'store').replace('.zip', '').replace(/[^a-z0-9]/gi, '');
                const targetDir = path.join(process.cwd(), 'example-store', `store_${filename}_auto`);
                const zipPath = path.join(os.tmpdir(), `${filename}_auto.zip`);

                if (IS_WIN) {
                    await execPromise(`powershell -Command "Invoke-WebRequest -Uri '${storeUrl}' -OutFile '${zipPath}'; Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force; Remove-Item '${zipPath}'"`);
                } else {
                    await execPromise(`curl -kL '${storeUrl}' -o '${zipPath}' && mkdir -p '${targetDir}' && unzip -o '${zipPath}' -d '${targetDir}' && rm '${zipPath}'`);
                }
            } catch (e) {
                auditLog('SYSTEM', 'STORE_REFRESH_FAILED', { storeUrl, error: e.message }, false);
            }
        }

        // Image Pulling Logic
        try {
            const { stdout } = await execPromise('docker ps --format "{{.Image}} {{.Names}}"');
            const lines = stdout.trim().split('\n').filter(Boolean);
            for (const line of lines) {
                const [image, name] = line.split(' ');
                if (image.includes(':latest') || image.includes(':nightly')) {
                    await execPromise(`docker pull ${image}`);
                    tacticalInsights.push({
                        id: `update-${name}-${Date.now()}`,
                        type: 'system',
                        severity: 'medium',
                        message: `Automated Update: Pulled new image for '${name}' (${image}).`,
                        suggestion: `Redeploy stack to apply the new image layers.`,
                        timestamp: new Date()
                    });
                }
            }
        } catch (e) { }

        // Cleanup old tactical alerts (keep last 10)
        if (tacticalInsights.length > 10) tacticalInsights.splice(0, tacticalInsights.length - 10);

        auditLog('SYSTEM', 'BACKGROUND_UPDATE_FINISH', {}, true);
    } catch (err) {
        auditLog('SYSTEM', 'BACKGROUND_UPDATE_FATAL', { error: err.message }, false);
    }
};

// Run updates every 6 hours
setInterval(runBackgroundUpdates, 6 * 60 * 60 * 1000);
// Run initial update after 10 seconds
setTimeout(runBackgroundUpdates, 10000);

app.get('/api/store/apps', async (req, res) => {
    try {
        const storeRoot = path.join(process.cwd(), 'example-store');
        if (!fs.existsSync(storeRoot)) fs.mkdirSync(storeRoot, { recursive: true });
        const apps = [];
        const findCompose = (dir, depth = 0) => {
            if (depth > 5) return;
            fs.readdirSync(dir, { withFileTypes: true }).forEach(ent => {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) findCompose(full, depth + 1);
                else if (ent.name === 'docker-compose.yml' || ent.name === 'docker-compose.yaml') {
                    const parsed = YAML.parse(fs.readFileSync(full, 'utf8'));
                    const casa = parsed['x-casaos'];
                    if (casa) {
                        const provider = path.relative(storeRoot, path.dirname(full)).split(path.sep)[0] || 'Official';
                        apps.push({
                            id: `${ent.name}-${apps.length}`,
                            title: casa.title?.en_us || path.basename(path.dirname(full)),
                            tagline: casa.tagline?.en_us || '',
                            description: casa.description?.en_us || '',
                            icon: casa.icon || '',
                            category: casa.category || '',
                            developer: casa.developer || provider,
                            path: path.dirname(full),
                            store: provider.replace('store_', '').replace(/^\w/, c => c.toUpperCase())
                        });
                    }
                }
            });
        };
        findCompose(storeRoot);
        res.json({ apps });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/provider', async (req, res) => {
    try {
        const { url } = req.body;
        const filename = (url.split('/').pop() || 'store').replace('.zip', '').replace(/[^a-z0-9]/gi, '');
        const targetDir = path.join(process.cwd(), 'example-store', `store_${filename}_${Date.now()}`);
        const zipPath = path.join(os.tmpdir(), `${filename}.zip`);

        if (IS_WIN) {
            await execPromise(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'; Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force; Remove-Item '${zipPath}'"`);
        } else {
            // Append the -k (insecure) flag so curl completely ignores certificate verification issues on CasaOS mirrors
            await execPromise(`curl -kL '${url}' -o '${zipPath}' && mkdir -p '${targetDir}' && unzip -o '${zipPath}' -d '${targetDir}' && rm '${zipPath}'`);
        }

        // Persist Store URL
        const stores = fs.existsSync(STORES_FILE) ? JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')) : [];
        if (!stores.includes(url)) {
            stores.push(url);
            fs.writeFileSync(STORES_FILE, JSON.stringify(stores, null, 2));
        }

        res.json({ success: true, provider: filename });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/deploy', async (req, res) => {
    try {
        const { appPath, composeData } = req.body;
        if (composeData) fs.writeFileSync(path.join(appPath, 'docker-compose.yml'), composeData);
        
        const deployId = `deploy-${Date.now()}`;
        activeDeployments.push({ id: deployId, name: path.basename(appPath), status: 'Starting...' });

        const child = spawn('docker', ['compose', 'up', '-d'], { cwd: appPath });
        child.stdout.on('data', data => { 
            const d = activeDeployments.find(x => x.id === deployId);
            if (d) d.status = data.toString().split('\n').filter(Boolean).pop() || d.status;
        });
        child.on('close', () => {
            const idx = activeDeployments.findIndex(x => x.id === deployId);
            if (idx !== -1) activeDeployments.splice(idx, 1);
        });
        res.json({ success: true, deployId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/terminal/exec', async (req, res) => {
    try {
        const { command, agent = 'USER' } = req.body;
        if (!command) return res.json({ output: '', cwd: terminalCwd });

        // 1. Command Denylist Check
        const normalizedCmd = command.trim().toLowerCase();
        if (COMMAND_DENYLIST.some(blocked => normalizedCmd.includes(blocked))) {
            auditLog(agent, 'EXEC_BLOCKED', { command }, false);
            return res.json({ output: 'Error: Command violates Prime Directive. Self-Destruct blocked.', cwd: terminalCwd });
        }

        const shell = IS_WIN ? 'cmd.exe' : '/bin/bash';
        
        // Append a command to print the working directory so we can track state changes
        const wrappedCommand = IS_WIN 
            ? `${command} & echo --AETHEROS_CWD-- & cd` 
            : `${command} ; echo "--AETHEROS_CWD--" ; pwd`;

        const { stdout, stderr } = await execPromise(wrappedCommand, {
            cwd: terminalCwd,
            shell: shell
        }).catch(err => ({ stdout: err.stdout || '', stderr: err.stderr || err.message }));

        let finalOutput = stdout;
        
        // Extract the trailing CWD
        const parts = stdout.split('--AETHEROS_CWD--');
        if (parts.length > 1) {
            const cwdPart = parts.pop().trim();
            finalOutput = parts.join('--AETHEROS_CWD--').trim();
            
            // Validate the parsed directory before assigning
            if (cwdPart && fs.existsSync(cwdPart)) {
                terminalCwd = cwdPart;
            }
        }

        const output = (finalOutput + '\n' + stderr).trim();
        auditLog(agent, 'EXEC', { command }, true);
        res.json({ output, cwd: terminalCwd });
    } catch (err) {
        res.status(500).json({ error: err.message, cwd: terminalCwd });
    }
});

// C# Script Sandboxing
app.post('/api/docker/run-csx', async (req, res) => {
    try {
        const { code, allowNetwork } = req.body;
        if (!code) return res.status(400).json({ error: 'No code provided' });

        // Ensure docker image exists for isolated dotnet
        try {
            await execPromise('docker image inspect aetheros/dotnet-sandbox');
        } catch {
            // Include a basic runtime config template
            const dockerfile = `
FROM mcr.microsoft.com/dotnet/sdk:8.0
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
WORKDIR /app
`;
            const buildDir = path.join(os.tmpdir(), `aetheros-dotnet-build-${Date.now()}`);
            fs.mkdirSync(buildDir, { recursive: true });
            fs.writeFileSync(path.join(buildDir, 'Dockerfile'), dockerfile);
            await execPromise('docker build -t aetheros/dotnet-sandbox .', { cwd: buildDir });
            fs.rmSync(buildDir, { recursive: true, force: true });
        }

        const scriptId = `script_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const scriptDir = path.join(WORKSPACE_ROOT, '.tmp', scriptId);
        fs.mkdirSync(scriptDir, { recursive: true });
        
        // Wrap the raw code in a basic Program structure if it doesn't have one
        const hasNamespace = code.includes('namespace ') || code.includes('class Program');
        const finalCode = hasNamespace ? code : `
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

${code}
`;
        
        const scriptPath = path.join(scriptDir, 'Program.cs');
        fs.writeFileSync(scriptPath, finalCode);

        // Create a self-contained csproj for execution
        const csprojContent = `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <!-- Disable telemetry and package restores completely -->
    <RestorePackagesWithLockFile>false</RestorePackagesWithLockFile>
    <DisableImplicitNuGetFallbackFolder>true</DisableImplicitNuGetFallbackFolder>
  </PropertyGroup>
</Project>`;
        fs.writeFileSync(path.join(scriptDir, 'Sandbox.csproj'), csprojContent);

        // Mount the source directory and run `dotnet run` directly on the csproj.
        // It's a standard console app with no dependencies so it doesn't need external NuGet packages.
        const networkFlag = allowNetwork || isYoloMode ? '' : '--network none ';
        const resourceFlags = isYoloMode ? '--privileged -v "/:/host_root"' : '--memory="512m" --cpus="1.0"';
        const dockerCmd = `docker run --rm ${networkFlag}${resourceFlags} -v "${scriptDir}:/app/src" aetheros/dotnet-sandbox /bin/sh -c "dotnet run --project /app/src/Sandbox.csproj"`;

        let result;
        try {
            const { stdout, stderr } = await execPromise(dockerCmd, { timeout: 15000 });
            result = { stdout: stdout.trim(), stderr: stderr.trim() };
        } catch (execError) {
            result = { 
                stdout: execError.stdout?.trim() || '', 
                stderr: execError.stderr?.trim() || execError.message 
            };
        } finally {
            // Cleanup script files
            fs.rmSync(scriptDir, { recursive: true, force: true });
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// FS APIs
app.get('/api/fs/ls', (req, res) => {
    try {
        const targetPath = req.query.path || WORKSPACE_ROOT;
        if (!isPathSafe(targetPath)) return res.status(403).json({ error: 'Shields Offline: Sandbox violation detected.' });
        if (!fs.existsSync(targetPath)) throw new Error('Path does not exist');

        const files = fs.readdirSync(targetPath, { withFileTypes: true }).map(f => ({
            name: f.name, isDirectory: f.isDirectory(), size: f.isFile() ? fs.statSync(path.join(targetPath, f.name)).size : 0
        }));
        res.json({ files, currentPath: targetPath });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fs/read', (req, res) => {
    try { res.json({ content: fs.readFileSync(req.body.path, 'utf8') }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fs/write', (req, res) => {
    try { fs.writeFileSync(req.body.path, req.body.content); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Chat Persistence
app.get('/api/chat/load', (req, res) => {
    try { res.json(fs.existsSync(CHAT_FILE) ? JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')) : {}); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/chat/save', (req, res) => {
    try { fs.writeFileSync(CHAT_FILE, JSON.stringify(req.body, null, 2)); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docker/compose-deploy', async (req, res) => {
    try {
        const { projectName, composeData } = req.body;
        if (!projectName) throw new Error('Project name is required');
        if (!composeData) throw new Error('Compose YAML is required');

        const safeProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const workspaceDir = path.join(process.cwd(), 'composed-apps', safeProjectName);
        
        if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
        }

        const composeFile = path.join(workspaceDir, 'docker-compose.yml');
        fs.writeFileSync(composeFile, composeData, 'utf8');

        const deployId = `compose-${safeProjectName}-${Date.now()}`;
        activeDeployments.push({
            id: deployId,
            name: `Project: ${projectName}`,
            status: 'Pulling and starting...'
        });

        const child = spawn('docker', ['compose', 'up', '-d'], {
            cwd: workspaceDir,
            detached: true
        });

        child.on('error', (err) => {
            const d = activeDeployments.find(d => d.id === deployId);
            if (d) d.status = `FATAL: ${err.message}`;
        });

        child.stdout.on('data', (data) => {
             const output = data.toString();
             const d = activeDeployments.find(d => d.id === deployId);
             if (d) d.status = output.split('\n').filter(Boolean).pop() || d.status;
        });

        child.stderr.on('data', (data) => {
             const output = data.toString();
             const d = activeDeployments.find(d => d.id === deployId);
             if (d) d.status = output.split('\n').filter(Boolean).pop() || d.status;
        });

        child.on('close', () => {
            const idx = activeDeployments.findIndex(d => d.id === deployId);
            if (idx !== -1) activeDeployments.splice(idx, 1);
        });

        res.json({ success: true, deployId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

async function getPublicIP() {
    try {
        const response = await fetch('https://icanhazip.com');
        const text = await response.text();
        return text.trim();
    } catch (e) { return 'Unknown'; }
}

app.post('/api/docker/registry/login', async (req, res) => {
    try {
        const { server, username, password } = req.body;
        if (!server || !username || !password) return res.status(400).json({ error: 'Server, username, and password required' });

        // Execute docker login using spawn to pass password securely
        const child = spawn('docker', ['login', server, '-u', username, '--password-stdin']);
        child.stdin.write(password);
        child.stdin.end();

        let stdout = '', stderr = '';
        child.stdout.on('data', data => stdout += data.toString());
        child.stderr.on('data', data => stderr += data.toString());

        child.on('close', async (code) => {
            if (code === 0) {
                // Persist registry info (without password)
                const settings = getSettings();
                if (!settings.registries) settings.registries = [];
                const existingIdx = settings.registries.findIndex(r => r.server === server);
                if (existingIdx !== -1) {
                    settings.registries[existingIdx] = { server, username };
                } else {
                    settings.registries.push({ server, username });
                }
                saveSettings(settings);
                
                auditLog('SYSTEM', 'REGISTRY_LOGIN_SUCCESS', { server, username }, true);
                res.json({ success: true });
            } else {
                let errorMsg = stderr || stdout;
                if (errorMsg.includes('403 Forbidden')) {
                    const publicIP = await getPublicIP();
                    errorMsg = `Login Failed (403 Forbidden): Your server's public IP [${publicIP}] is likely blocked by Azure Firewall. Please whitelist this IP in the Azure Portal Networking settings for ${server}.`;
                }
                auditLog('SYSTEM', 'REGISTRY_LOGIN_FAILED', { server, username, error: errorMsg }, false);
                res.status(500).json({ error: errorMsg });
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docker/create', async (req, res) => {
    try {
        const { image, name, ports, volumes, env, resources, replaceId } = req.body;

        if (replaceId) {
            try {
                // Force remove old container if it exists
                await execPromise(`docker rm -f ${replaceId}`);
                auditLog('SYSTEM', 'CONTAINER_REPLACEMENT_CLEANUP', { replaceId }, true);
            } catch (e) {
                console.warn(`Failed to remove old container ${replaceId}:`, e.message);
            }
        }

        let cmd = `docker run -d`;
        if (name) cmd += ` --name ${name}`;
        ports?.forEach(p => cmd += ` -p ${p.host}:${p.container}`);
        volumes?.forEach(v => cmd += ` -v "${v.host}:${v.container}"`);
        env?.forEach(e => cmd += ` -e "${e.key}=${e.value}"`);
        if (resources?.cpus) cmd += ` --cpus="${resources.cpus}"`;
        if (resources?.memory) cmd += ` -m "${resources.memory}"`;
        cmd += ` ${image}`;
        
        const { stdout } = await execPromise(cmd);
        res.json({ success: true, id: stdout.trim() });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docker/action', async (req, res) => {
    try {
        const { id, action } = req.body;
        if (!id || !action) throw new Error('Container ID and action required');

        let cmd = '';
        switch (action) {
            case 'start': cmd = `docker start "${id}"`; break;
            case 'stop': cmd = `docker stop "${id}"`; break;
            case 'restart': cmd = `docker restart "${id}"`; break;
            case 'rm': cmd = `docker rm -f "${id}"`; break;
            default: throw new Error(`Unsupported action: ${action}`);
        }

        await execPromise(cmd);
        auditLog('SYSTEM', 'DOCKER_ACTION', { id, action }, true);
        res.json({ success: true, action });
    } catch (err) { 
        auditLog('SYSTEM', 'DOCKER_ACTION_FAILED', { id: req.body.id, action: req.body.action, error: err.message }, false);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/docker/inspect', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) throw new Error('Container ID required');

        const { stdout } = await execPromise(`docker inspect "${id}" --format "{{json .}}"`);
        const raw = JSON.parse(stdout);
        
        // Map back to our internal DockerCreateSpec format
        const spec = {
            image: raw.Config.Image,
            name: raw.Name.replace(/^\//, ''),
            ports: Object.entries(raw.HostConfig.PortBindings || {}).map(([c, h]) => ({
                container: c.split('/')[0],
                host: h[0]?.HostPort || ''
            })),
            volumes: (raw.Mounts || []).map((m) => ({
                host: m.Source,
                container: m.Destination
            })),
            env: (raw.Config.Env || []).map((e) => {
                const [key, value] = e.split('=');
                return { key, value };
            }),
            resources: {
                cpus: (raw.HostConfig.NanoCpus / 1e9).toString(),
                memory: (raw.HostConfig.Memory / (1024 * 1024)).toString() + 'm'
            }
        };

        res.json(spec);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get('/api/system/check-updates', async (req, res) => {
    try {
        if (!(await isGitAvailable())) {
            return res.json({ success: false, output: "System check failed: 'git' core missing from environment.", updateAvailable: false });
        }
        await execPromise('git fetch origin main');
        const { stdout } = await execPromise('git rev-list HEAD...origin/main --count');
        const count = parseInt(stdout.trim(), 10);
        res.json({ success: true, updateAvailable: count > 0, behindCount: count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/system/update', async (req, res) => {
    try {
        if (!(await isGitAvailable())) {
             return res.status(503).json({ error: "System update impossible: 'git' environment required." });
        }
        const updaterResponse = await fetch('http://aetheros-updater:8080/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await updaterResponse.json();
        res.json({ success: true, message: data.status || 'Update initiated.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/system/host-update', async (req, res) => {
    try {
        const { action } = req.body;
        console.log(`[System] Executing host update action: ${action || 'check'}`);

        if (action === 'start') {
            if (!(await isGitAvailable())) {
                return res.status(503).json({ error: "System update impossible: 'git' environment required." });
            }
            console.log('Initiating AetherOS update sequence...');
            // In production (Docker), we notify the updater service
            try {
                const updaterResponse = await fetch('http://aetheros-updater:8080/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });
                const data = await updaterResponse.json();
                res.json({ success: true, output: data.status || 'Update initiated. System core will rebuild.' });
            } catch (e) {
                console.error('Updater service unreachable:', e.message);
                res.status(503).json({ error: 'System updater service is currently offline or unreachable.' });
            }
        } else {
            // Check for updates
            await execPromise('git fetch origin main');
            const { stdout } = await execPromise('git rev-list HEAD...origin/main --count');
            const count = parseInt(stdout.trim(), 10);
            
            const output = count > 0 
                ? `Update identified: ${count} delta segments behind origin/main. Recommendation: Initiate system update.`
                : "System status: Nominal. All core modules are at latest version.";

            res.json({ 
                success: true, 
                output,
                updateAvailable: count > 0,
                behindCount: count
            });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docker/list', async (req, res) => {
    try {
        const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
        const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
             try { return JSON.parse(line); } catch(e) { return null; }
        }).filter(Boolean);
        res.json({ containers });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docker/stats', async (req, res) => {
    try {
        const { stdout } = await execPromise('docker stats --no-stream --format "{{json .}}"');
        const stats = stdout.trim().split('\n').filter(Boolean).map(line => {
             try { return JSON.parse(line); } catch(e) { return null; }
        }).filter(Boolean);
        res.json({ stats });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tools/scrape', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) throw new Error('URL is required');
        const response = await fetch(url);
        const html = await response.text();
        // Super simple tag stripping
        const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                         .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                         .replace(/<[^>]+>/g, ' ')
                         .replace(/\s+/g, ' ')
                         .trim()
                         .substring(0, 10000); // Limit to 10k chars
        res.json({ url, content: text });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tools/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) throw new Error('Query is required');
        // Mock search results for now
        const results = [
            { title: `${query} - Search Results`, snippet: `Information about ${query} found on several subspace nodes. Overall sentiment is positive.`, url: `https://google.com/search?q=${encodeURIComponent(query)}` },
            { title: "Aether Galactic Archives", snippet: "Historical and technical data regarding the requested subject. Verified by LCARS.", url: "https://aether-galactic.net/archives" }
        ];
        res.json({ query, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// SPA fallback for frontend
app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).send('Frontend not built. Run npm run build.');
});

console.log(`[SYS] Initializing AetherOS Legacy Server...`);
console.log(`[SYS] Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`[SYS] Port: ${port}`);
console.log(`[SYS] Workspace: ${WORKSPACE_ROOT}`);

app.listen(port, () => {
    console.log(`\n================================================`);
    console.log(`  AETHEROS BACKEND ONLINE - PORT: ${port}        `);
    console.log(`  VERSION: 0.2.3                                `);
    console.log(`================================================\n`);
});
