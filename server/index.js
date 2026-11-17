import express from 'express';
import cors from 'cors';
import os from 'os';
import { exec, execFile, spawn } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import crypto from 'crypto';
import cron from 'node-cron';
import { GoogleGenAI } from '@google/genai';
import { runAgentLoop, AGENTS, TOOLS } from './agent.js';
import { startSlackApp } from './slack.js';
import { CronManager } from './cron.js';
import {
    ContainerUpdater,
    CONTAINER_NAME_RE,
    isProtectedContainer,
    validateContainerRef,
} from './containerUpdater.js';
import { Client } from 'ssh2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

const app = express();
const port = process.env.PORT || 5175;

app.use(cors());
app.use(express.json());

// Path to static files (frontend build)
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat_history.json');
const CHAT_HISTORY_FILE = CHAT_FILE;
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const INSIGHTS_FILE = path.join(DATA_DIR, 'tactical_insights.json');
const PENDING_TASKS_FILE = path.join(DATA_DIR, 'pending_tasks.json');
const CONTAINER_UPDATES_FILE = path.join(DATA_DIR, 'container_updates.json');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'logs', 'subspace_comms.log');
const WORKSPACE_ROOT = path.resolve(process.cwd(), 'aetheros', 'workspace');
const EXAMPLE_STORE_ROOT = path.resolve(process.cwd(), 'example-store');

// Ensure directory structure exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'logs'))) fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
if (!fs.existsSync(EXAMPLE_STORE_ROOT)) fs.mkdirSync(EXAMPLE_STORE_ROOT, { recursive: true });

const IS_WIN = os.platform() === 'win32';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NETWORK_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const IMAGE_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/;
const RESTART_POLICY_RE = /^(no|always|unless-stopped|on-failure(?::\d+)?)$/;

let projectVersion = '0.0.0';
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    projectVersion = pkg.version || '0.0.0';
} catch { /* fallback to default */ }

function writeJsonAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(data, null, 2);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmpPath, serialized, 'utf8');
        fs.renameSync(tmpPath, filePath);
    } catch {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch { /* ignore cleanup error */ }
        fs.writeFileSync(filePath, serialized, 'utf8');
    }
}

function auditLog(agent, action, params, success) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] AGENT: ${agent} | ACTION: ${action} | PARAMS: ${JSON.stringify(params)} | SUCCESS: ${success}\n`;
    try {
        fs.appendFileSync(AUDIT_LOG_PATH, logEntry);
    } catch { /* ignore audit write errors */ }
}

function isPathWithin(targetPath, rootDir) {
    if (!targetPath || typeof targetPath !== 'string') return false;
    const resolvedRoot = path.resolve(rootDir);
    const resolved = path.resolve(targetPath);
    const normRoot = IS_WIN ? resolvedRoot.toLowerCase() : resolvedRoot;
    const normResolved = IS_WIN ? resolved.toLowerCase() : resolved;
    if (normResolved !== normRoot && !normResolved.startsWith(normRoot + path.sep)) {
        return false;
    }
    try {
        const realRoot = fs.existsSync(resolvedRoot) ? fs.realpathSync(resolvedRoot) : resolvedRoot;
        const checkTarget = fs.existsSync(resolved) ? resolved : path.dirname(resolved);
        if (fs.existsSync(checkTarget)) {
            const realTarget = fs.realpathSync(checkTarget);
            const normRealRoot = IS_WIN ? realRoot.toLowerCase() : realRoot;
            const normRealTarget = IS_WIN ? realTarget.toLowerCase() : realTarget;
            return normRealTarget === normRealRoot || normRealTarget.startsWith(normRealRoot + path.sep);
        }
    } catch {
        return false;
    }
    return true;
}

function isPathSafe(targetPath) {
    return isPathWithin(targetPath, WORKSPACE_ROOT);
}

function isStorePathSafe(targetPath) {
    return isPathWithin(targetPath, EXAMPLE_STORE_ROOT);
}

function validateNetworkName(name) {
    const clean = String(name || '').trim();
    if (!clean || !NETWORK_NAME_RE.test(clean)) {
        const err = new Error(`Invalid network name: '${name || ''}'`);
        err.statusCode = 400;
        throw err;
    }
    return clean;
}

function validateImageRef(image) {
    const clean = String(image || '').trim();
    if (!clean || !IMAGE_REF_RE.test(clean)) {
        const err = new Error(`Invalid image reference: '${image || ''}'`);
        err.statusCode = 400;
        throw err;
    }
    return clean;
}

async function isGitAvailable() {
    try {
        await execFileAsync('git', ['--version']);
        return true;
    } catch { return false; }
}

// --- Persistent Auth State ---
let authState = { passwordHash: null, tokens: [] };

function saveAuthState() {
    writeJsonAtomic(AUTH_FILE, authState);
}

function pruneExpiredTokens() {
    const now = Date.now();
    const before = authState.tokens.length;
    authState.tokens = authState.tokens.filter(t => t && typeof t.token === 'string' && Date.parse(t.expiresAt) > now);
    return authState.tokens.length !== before;
}

function loadAuthState() {
    if (fs.existsSync(AUTH_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
            authState = {
                passwordHash: parsed.passwordHash || null,
                tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
            };
            if (pruneExpiredTokens()) saveAuthState();
            return;
        } catch (err) {
            console.error('[AUTH] Failed to parse auth.json:', err.message);
        }
    }

    // One-time migration from legacy data/chat_history.json
    if (fs.existsSync(CHAT_FILE)) {
        try {
            const chatData = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
            if (chatData && typeof chatData === 'object' && chatData.passwordHash) {
                authState = { passwordHash: chatData.passwordHash, tokens: [] };
                saveAuthState();
                const { passwordHash: _removed, ...cleanChat } = chatData;
                writeJsonAtomic(CHAT_FILE, cleanChat);
                console.log('[AUTH] Migrated passwordHash from chat_history.json to data/auth.json.');
                return;
            }
        } catch (err) {
            console.error('[AUTH] Migration from chat_history.json failed:', err.message);
        }
    }

    authState = { passwordHash: null, tokens: [] };
    saveAuthState();
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== 'string') return false;
    const candidate = hashPassword(password);
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(storedHash, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function createPersistedToken() {
    pruneExpiredTokens();
    const now = Date.now();
    const token = crypto.randomUUID();
    authState.tokens.push({
        token,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
    });
    saveAuthState();
    return token;
}

const INTERNAL_TOKEN = crypto.randomUUID();

function extractBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    return authHeader.slice(7).trim();
}

function isTokenValid(token) {
    if (!token) return false;
    if (token === INTERNAL_TOKEN) return true;
    const now = Date.now();
    const entry = authState.tokens.find(t => t.token === token);
    if (!entry) return false;
    if (Date.parse(entry.expiresAt) <= now) {
        if (pruneExpiredTokens()) saveAuthState();
        return false;
    }
    return true;
}

loadAuthState();

// --- Persistent Tactical Insights ---
const activeDeployments = [];
const tacticalInsights = [];
const dismissedInsightKeys = new Set();
const dismissedInsightDigests = new Map();

function saveInsightsState() {
    writeJsonAtomic(INSIGHTS_FILE, {
        insights: tacticalInsights,
        dismissedKeys: [...dismissedInsightKeys],
        dismissedDigests: Object.fromEntries(dismissedInsightDigests),
    });
}

function loadInsightsState() {
    if (!fs.existsSync(INSIGHTS_FILE)) {
        saveInsightsState();
        return;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(INSIGHTS_FILE, 'utf8'));
        if (Array.isArray(parsed.insights)) {
            tacticalInsights.splice(0, tacticalInsights.length, ...parsed.insights);
        }
        if (Array.isArray(parsed.dismissedKeys)) {
            dismissedInsightKeys.clear();
            for (const k of parsed.dismissedKeys) dismissedInsightKeys.add(k);
        }
        if (parsed.dismissedDigests && typeof parsed.dismissedDigests === 'object') {
            dismissedInsightDigests.clear();
            for (const [k, v] of Object.entries(parsed.dismissedDigests)) {
                dismissedInsightDigests.set(k, v);
            }
        }
    } catch (err) {
        console.error('[INSIGHTS] Failed to load tactical_insights.json:', err.message);
    }
}

loadInsightsState();

const addInsight = (key, insight, { persist = true } = {}) => {
    if (dismissedInsightKeys.has(key)) return null;
    const existing = tacticalInsights.find(i => i.key === key);
    if (existing) {
        const changed =
            existing.message !== insight.message ||
            existing.suggestion !== insight.suggestion ||
            existing.severity !== insight.severity ||
            existing.imageId !== insight.imageId;
        Object.assign(existing, insight, { id: existing.id, key });
        if (persist && changed) saveInsightsState();
        return existing;
    }
    const entry = { ...insight, key, id: insight.id || key };
    tacticalInsights.push(entry);
    if (persist) saveInsightsState();
    return entry;
};

const removeInsight = (id, { persist = true } = {}) => {
    const idx = tacticalInsights.findIndex(i => i.id === id || i.key === id);
    if (idx === -1) return null;
    const [removed] = tacticalInsights.splice(idx, 1);
    if (persist) saveInsightsState();
    return removed;
};

const clearDismissedInsight = (key, { persist = true } = {}) => {
    const hadKey = dismissedInsightKeys.delete(key);
    const hadDigest = dismissedInsightDigests.delete(key);
    if (persist && (hadKey || hadDigest)) saveInsightsState();
    return hadKey || hadDigest;
};

// --- System & Docker Cached Metrics ---
let cachedStorage = { aggregatePercent: 50, disks: [] };
let cachedNetwork = { inbound: 0, outbound: 0 };
let previousCpus = os.cpus();

// --- Terminal State ---
let terminalCwd = process.cwd();
let isYoloMode = false;

// --- Security Constants ---
const COMMAND_DENYLIST = ['rm -rf /', 'mkfs', 'dd', 'shutdown', 'reboot', 'format'];

// --- Container Auto-Updater ---
const containerUpdater = new ContainerUpdater({
    stateFile: CONTAINER_UPDATES_FILE,
    activeDeployments,
    auditLog,
    onUpdated: ({ containerName }) => {
        let changed = false;
        const matching = tacticalInsights.filter(
            i => i.containerId === containerName && (i.key?.startsWith('update-') || i.key?.startsWith('auto-update-fail-'))
        );
        for (const insight of matching) {
            if (removeInsight(insight.id, { persist: false })) changed = true;
            if (clearDismissedInsight(insight.key || insight.id, { persist: false })) changed = true;
        }
        // Clear any dismissed update keys for this container even if not currently queued
        for (const key of [...dismissedInsightKeys]) {
            if (key.startsWith(`update-${containerName}-`) || key === `auto-update-fail-${containerName}`) {
                if (clearDismissedInsight(key, { persist: false })) changed = true;
            }
        }
        if (changed) saveInsightsState();
        refreshDockerCache();
    },
    onFailed: ({ containerName, image, error, trigger }) => {
        if (trigger === 'scheduled') {
            const failKey = `auto-update-fail-${containerName}`;
            clearDismissedInsight(failKey, { persist: false });
            addInsight(failKey, {
                type: 'system',
                severity: 'high',
                message: `Scheduled auto-update failed for '${containerName}' (${image}): ${error}`,
                suggestion: 'Inspect container logs or update history and redeploy manually.',
                containerId: containerName,
                image,
                timestamp: new Date(),
            });
        }
        refreshDockerCache();
    },
});
containerUpdater.init();

// --- Background Docker Cache Loop (every 4s) ---
let dockerCache = {
    dockerRunning: false,
    containers: [],
    hostname: os.hostname(),
    osInfo: `${os.type()} ${os.release()}`,
    lastUpdated: 0,
};
let isRefreshingDockerCache = false;

async function refreshDockerCache() {
    if (isRefreshingDockerCache) return;
    isRefreshingDockerCache = true;
    try {
        const { stdout: psOut } = await execFileAsync('docker', ['ps', '-a', '--format', '{{json .}}'], {
            timeout: 5000,
        });

        const [statsRes, infoRes] = await Promise.allSettled([
            execFileAsync('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeout: 5000 }),
            execFileAsync('docker', ['info', '--format', '{{json .}}'], { timeout: 5000 }),
        ]);

        const statsByKey = new Map();
        if (statsRes.status === 'fulfilled') {
            const lines = statsRes.value.stdout.trim().split('\n').filter(Boolean);
            for (const line of lines) {
                try {
                    const s = JSON.parse(line);
                    if (s.ID) statsByKey.set(s.ID, s);
                    if (s.Name) statsByKey.set(String(s.Name).replace(/^\//, ''), s);
                } catch { /* ignore malformed line */ }
            }
        }

        let hostName = os.hostname();
        let osInfo = `${os.type()} ${os.release()}`;
        if (infoRes.status === 'fulfilled') {
            try {
                const info = JSON.parse(infoRes.value.stdout);
                if (info.Name) hostName = info.Name;
                if (info.OperatingSystem) osInfo = info.OperatingSystem.replace(' Docker Desktop', '');
            } catch { /* ignore malformed docker info */ }
        }

        const policies = containerUpdater.getState().policies;
        const containers = psOut
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                try {
                    const c = JSON.parse(line);
                    const cleanName = String(c.Names || '').replace(/^\//, '');
                    let status = 'failed';
                    if (c.State === 'running') status = 'running';
                    else if (c.State === 'restarting') status = 'restarting';
                    else if (c.State === 'exited' || c.State === 'dead' || c.State === 'created' || c.State === 'paused') {
                        status = 'stopped';
                    }

                    const st = statsByKey.get(c.ID) || statsByKey.get(cleanName);
                    const isProtected = isProtectedContainer(cleanName, c.Labels);
                    return {
                        id: c.ID,
                        name: cleanName,
                        image: c.Image || '',
                        status,
                        uptime: c.Status || '',
                        cpuPerc: st?.CPUPerc || '0.00%',
                        memPerc: st?.MemPerc || '0.00%',
                        memUsage: st?.MemUsage || '0B / 0B',
                        protected: isProtected,
                        autoUpdate: policies[cleanName] || {
                            enabled: false,
                            scheduleMode: 'global',
                            cronExpression: '',
                        },
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        dockerCache = {
            dockerRunning: true,
            containers,
            hostname: hostName,
            osInfo,
            lastUpdated: Date.now(),
        };
    } catch {
        dockerCache = {
            ...dockerCache,
            dockerRunning: false,
            containers: [],
            lastUpdated: Date.now(),
        };
    } finally {
        isRefreshingDockerCache = false;
    }
}

refreshDockerCache();
setInterval(refreshDockerCache, 4000);

// --- Network & Storage Polling Loops ---
const updateNetworkStats = async () => {
    try {
        if (IS_WIN) {
            const { stdout } = await execFileAsync('netstat', ['-e'], { timeout: 3000 });
            const byteLine = stdout.trim().split('\n')[2]?.trim().split(/\s+/);
            if (byteLine && byteLine.length >= 3) {
                cachedNetwork = {
                    inbound: parseInt(byteLine[1], 10) || 0,
                    outbound: parseInt(byteLine[2], 10) || 0,
                };
            }
        } else {
            const raw = fs.readFileSync('/proc/net/dev', 'utf8');
            const lines = raw.trim().split('\n').slice(2);
            let totalIn = 0;
            let totalOut = 0;
            for (const line of lines) {
                const colonIdx = line.indexOf(':');
                if (colonIdx === -1) continue;
                const fields = line.slice(colonIdx + 1).trim().split(/\s+/);
                if (fields.length >= 9) {
                    totalIn += parseInt(fields[0], 10) || 0;
                    totalOut += parseInt(fields[8], 10) || 0;
                }
            }
            cachedNetwork = { inbound: totalIn, outbound: totalOut };
        }
    } catch { /* ignore transient network read errors */ }
};
updateNetworkStats();
setInterval(updateNetworkStats, 2000);

const updateStorage = async () => {
    try {
        const disks = [];
        let totalUsed = 0;
        let totalSize = 0;

        if (IS_WIN) {
            const { stdout } = await execPromise('wmic logicaldisk get size,freespace,caption');
            const lines = stdout.trim().split('\n');
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].trim().split(/\s+/);
                if (parts.length >= 3) {
                    const caption = parts[0];
                    const free = parseInt(parts[1], 10);
                    const size = parseInt(parts[2], 10);
                    if (!isNaN(size) && size > 0) {
                        const used = size - free;
                        const percent = Math.round((used / size) * 100);
                        disks.push({ device: caption, mount: caption, total: size, used, percent });
                        totalUsed += used;
                        totalSize += size;
                    }
                }
            }
        } else {
            const { stdout } = await execPromise("df -BK | grep '^/dev/' || true");
            if (stdout.trim()) {
                const lines = stdout.trim().split('\n');
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 6) {
                        const device = parts[0];
                        if (device.startsWith('/dev/loop')) continue;
                        const size = parseInt(parts[1].replace('K', ''), 10) * 1024;
                        const used = parseInt(parts[2].replace('K', ''), 10) * 1024;
                        const percent = parseInt(parts[4].replace('%', ''), 10);
                        let mount = parts[5];
                        if (mount === '/host_root') mount = '/ (Host OS)';

                        disks.push({ device, mount, total: size, used, percent });
                        totalUsed += used;
                        totalSize += size;
                    }
                }
            }
        }

        if (totalSize > 0) {
            cachedStorage = {
                aggregatePercent: Math.round((totalUsed / totalSize) * 100),
                disks: disks.sort((a, b) => b.total - a.total),
            };
        }
    } catch (e) { console.error('Storage poll error:', e); }
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
            slackAppToken: '',
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
    writeJsonAtomic(SETTINGS_FILE, settings);
}

// Start Slack Integration
startSlackApp(getSettings(), getSettings, `http://localhost:${port}`, INTERNAL_TOKEN);

const cronManager = new CronManager({
    runAgentLoop,
    agents: () => {
        const settings = getSettings();
        return AGENTS.map(defaultAgent => {
            const override = settings.agentOverrides?.[defaultAgent.id] || {};
            return { ...defaultAgent, ...override };
        });
    },
    tools: TOOLS,
    getSettings,
    baseUrl: `http://localhost:${port}`,
    internalToken: INTERNAL_TOKEN,
    jobsFile: path.join(DATA_DIR, 'cron_jobs.json'),
});
cronManager.init();

let pendingTasks = fs.existsSync(PENDING_TASKS_FILE) ? JSON.parse(fs.readFileSync(PENDING_TASKS_FILE, 'utf8')) : [];

// --- Auth Endpoints ---
app.post('/api/auth/setup', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password required' });
        if (authState.passwordHash) return res.status(400).json({ error: 'Already setup' });

        authState.passwordHash = hashPassword(password);
        const token = createPersistedToken();
        res.json({ success: true, token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password required' });
        if (!authState.passwordHash) return res.status(400).json({ error: 'Not setup yet' });

        if (!verifyPassword(password, authState.passwordHash)) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        const token = createPersistedToken();
        res.json({ success: true, token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/status', (req, res) => {
    try {
        res.json({ needsSetup: !authState.passwordHash });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
    try {
        const token = extractBearerToken(req) || req.body?.token;
        if (token && token !== INTERNAL_TOKEN) {
            authState.tokens = authState.tokens.filter(t => t.token !== token);
            saveAuthState();
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use('/api', (req, res, next) => {
    if (
        req.path === '/auth/setup' ||
        req.path === '/auth/login' ||
        req.path === '/auth/status' ||
        req.path === '/auth/logout'
    ) {
        return next();
    }

    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    if (!isTokenValid(token)) return res.status(401).json({ error: 'Invalid token' });

    next();
});

app.post('/api/auth/change-password', (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }
        if (!authState.passwordHash) {
            return res.status(400).json({ error: 'Password not configured yet' });
        }
        if (!verifyPassword(currentPassword, authState.passwordHash)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const currentToken = extractBearerToken(req);
        authState.passwordHash = hashPassword(newPassword);
        authState.tokens = authState.tokens.filter(t => t.token === currentToken);
        saveAuthState();
        auditLog('SYSTEM', 'PASSWORD_CHANGED', {}, true);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Config Endpoints ---
app.get('/api/config/get', (req, res) => {
    const settings = getSettings();
    const safeSettings = { ...settings };
    if (safeSettings.apiKey) safeSettings.hasKey = true;
    if (safeSettings.bgApiKey) safeSettings.hasBgKey = true;
    if (safeSettings.slackBotToken) safeSettings.hasSlackBotToken = true;
    if (safeSettings.slackAppToken) safeSettings.hasSlackAppToken = true;
    safeSettings.hasSshPassword = Boolean(settings.sshPassword);
    delete safeSettings.apiKey;
    delete safeSettings.bgApiKey;
    delete safeSettings.slackBotToken;
    delete safeSettings.slackAppToken;
    delete safeSettings.sshPassword;
    res.json(safeSettings);
});

app.post('/api/config/save', (req, res) => {
    const currentSettings = getSettings();
    const incoming = req.body || {};
    const newSettings = { ...currentSettings, ...incoming };

    if (incoming.apiKey === '********' || incoming.apiKey === undefined || incoming.apiKey === '') {
        newSettings.apiKey = currentSettings.apiKey;
    }
    if (incoming.bgApiKey === '********' || incoming.bgApiKey === undefined || incoming.bgApiKey === '') {
        newSettings.bgApiKey = currentSettings.bgApiKey;
    }
    if (incoming.slackBotToken === '********' || incoming.slackBotToken === undefined || incoming.slackBotToken === '') {
        newSettings.slackBotToken = currentSettings.slackBotToken;
    }
    if (incoming.slackAppToken === '********' || incoming.slackAppToken === undefined || incoming.slackAppToken === '') {
        newSettings.slackAppToken = currentSettings.slackAppToken;
    }
    if (incoming.sshPassword === '********' || incoming.sshPassword === undefined) {
        newSettings.sshPassword = currentSettings.sshPassword;
    }

    if (!incoming.registries || incoming.registries.length === 0) {
        newSettings.registries = currentSettings.registries;
    }

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
                maxTokens: m.inputTokenLimit,
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
        executeAt: Date.now() + (delayMinutes * 60000),
    });
    writeJsonAtomic(PENDING_TASKS_FILE, pendingTasks);
    res.json({ success: true, message: `Scheduled task in ${delayMinutes} minutes.` });
});

setInterval(async () => {
    const now = Date.now();
    const readyTasks = pendingTasks.filter(t => t.executeAt <= now);
    if (readyTasks.length === 0) return;

    pendingTasks = pendingTasks.filter(t => t.executeAt > now);
    writeJsonAtomic(PENDING_TASKS_FILE, pendingTasks);

    const chatData = fs.existsSync(CHAT_HISTORY_FILE) ? JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8')) : {};
    const settings = getSettings();
    const baseUrl = `http://localhost:${port}`;

    for (const task of readyTasks) {
        try {
            const history = chatData[task.agentId] || [];
            const agentDef = AGENTS.find(a => a.id === task.agentId) || AGENTS[0];
            const systemInstruction = settings.agentOverrides?.[task.agentId]?.systemPrompt || agentDef.systemPrompt;

            const newHistory = await runAgentLoop(task.agentId, task.prompt, systemInstruction, history, settings, TOOLS, baseUrl, INTERNAL_TOKEN);

            chatData[task.agentId] = newHistory;
            writeJsonAtomic(CHAT_HISTORY_FILE, chatData);
        } catch (e) {
            console.error('Background Agent Error:', e);
        }
    }
}, 30000);

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { messages, systemInstruction, tools } = req.body;
        const settings = getSettings();

        if (!settings.apiKey) {
            return res.status(400).json({ error: 'System Error: No Gemini API key configured on server.' });
        }

        const client = new GoogleGenAI({ apiKey: settings.apiKey });

        const convertToGeminiHistory = (msgs) => {
            const history = [];
            for (const msg of msgs) {
                if (msg.role === 'user') {
                    history.push({ role: 'user', parts: [{ text: msg.content }] });
                } else if (msg.role === 'agent') {
                    const isToolMarker = msg.content.startsWith('TOOL_RESPONSE:') || msg.content.startsWith('TOOL_ERROR:');

                    if (isToolMarker) {
                        const isError = msg.content.startsWith('TOOL_ERROR:');
                        const prefix = isError ? 'TOOL_ERROR:' : 'TOOL_RESPONSE:';
                        const remaining = msg.content.slice(prefix.length);
                        const colonIdx = remaining.indexOf(':');
                        const name = remaining.slice(0, colonIdx);
                        const responseStr = remaining.slice(colonIdx + 1);

                        let response;
                        try { response = JSON.parse(responseStr); } catch { response = { error: responseStr }; }
                        if (isError) response = { error: response };

                        const lastTurn = history[history.length - 1];
                        if (lastTurn && lastTurn.role === 'user' && lastTurn.parts.some(p => Object.prototype.hasOwnProperty.call(p, 'functionResponse'))) {
                            lastTurn.parts.push({ functionResponse: { name, response } });
                        } else {
                            history.push({
                                role: 'user',
                                parts: [{ functionResponse: { name, response } }],
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
                tools,
            },
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        for await (const chunk of result) {
            const chunkText = chunk.text;
            const functionCalls = chunk.functionCalls;

            const responseData = {
                text: chunkText,
                functionCalls,
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

app.get('/api/stats', (req, res) => {
    try {
        const currentCpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        let prevTotalIdle = 0;
        let prevTotalTick = 0;

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
        const cpuLoad = total > 0 ? 100 - (100 * idle / total) : 0;
        previousCpus = currentCpus;

        const ramUsed = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;

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

        const latestPolicies = containerUpdater.getState().policies;
        const containers = dockerCache.containers.map(c => ({
            ...c,
            autoUpdate: latestPolicies[c.name] || c.autoUpdate || {
                enabled: false,
                scheduleMode: 'global',
                cronExpression: '',
            },
        }));

        res.json({
            cpuLoad,
            ramUsed,
            storageUsed: cachedStorage,
            containers,
            deployments: activeDeployments,
            ipAddress,
            dockerRunning: dockerCache.dockerRunning,
            hostname: dockerCache.hostname,
            osInfo: dockerCache.osInfo,
            networkInbound: cachedNetwork.inbound,
            networkOutbound: cachedNetwork.outbound,
            insights: tacticalInsights,
            projectVersion,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Tactical Insight Lifecycle ---
app.post('/api/insights/dismiss', (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) throw new Error('Insight id required');
        const removed = removeInsight(id, { persist: false });
        if (removed) {
            const key = removed.key || removed.id;
            dismissedInsightKeys.add(key);
            if (removed.imageId) dismissedInsightDigests.set(key, removed.imageId);
            saveInsightsState();
            auditLog('SYSTEM', 'INSIGHT_DISMISSED', { id: key }, true);
        }
        res.json({ success: true, insights: tacticalInsights });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/insights/clear', (req, res) => {
    try {
        for (const insight of tacticalInsights) {
            const key = insight.key || insight.id;
            dismissedInsightKeys.add(key);
            if (insight.imageId) dismissedInsightDigests.set(key, insight.imageId);
        }
        const count = tacticalInsights.length;
        tacticalInsights.length = 0;
        saveInsightsState();
        auditLog('SYSTEM', 'INSIGHTS_CLEARED', { count }, true);
        res.json({ success: true, cleared: count, insights: tacticalInsights });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Tactical Resource Monitor (every 15s) ---
const statsHistory = new Map();
let isMonitorRunning = false;

const runTacticalMonitor = async () => {
    if (isMonitorRunning) return;
    isMonitorRunning = true;
    try {
        let psOut = '';
        try {
            ({ stdout: psOut } = await execFileAsync('docker', ['ps', '-a', '--format', '{{json .}}'], { timeout: 5000 }));
        } catch {
            return;
        }

        let statsOut = '';
        try {
            ({ stdout: statsOut } = await execFileAsync('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeout: 6000 }));
        } catch { /* docker stats might return empty if no containers running */ }

        const now = Date.now();
        let insightsChanged = false;
        const activeNames = new Set();
        const runningStatsNames = new Set();

        const statsLines = statsOut.trim().split('\n').filter(Boolean);
        for (const line of statsLines) {
            let stats;
            try { stats = JSON.parse(line); } catch { continue; }
            const name = String(stats.Name || '').replace(/^\//, '');
            if (!name) continue;
            runningStatsNames.add(name);

            const cpu = parseFloat(String(stats.CPUPerc || '0').replace('%', '')) || 0;
            const mem = parseFloat(String(stats.MemPerc || '0').replace('%', '')) || 0;

            if (!statsHistory.has(name)) statsHistory.set(name, []);
            const history = statsHistory.get(name);
            history.push({ cpu, mem, timestamp: now });
            if (history.length > 5) history.shift();

            const cpuKey = `cpu-${name}`;
            if (history.length >= 3 && history.slice(-3).every(h => h.cpu > 85)) {
                const added = addInsight(cpuKey, {
                    type: 'resource',
                    severity: 'high',
                    message: `Critical CPU saturation on container '${name}' (${cpu.toFixed(1)}%).`,
                    suggestion: 'Inspect container logs or adjust CPU limits.',
                    containerId: name,
                    timestamp: new Date(),
                }, { persist: false });
                if (added) insightsChanged = true;
            } else {
                if (removeInsight(cpuKey, { persist: false })) insightsChanged = true;
                if (clearDismissedInsight(cpuKey, { persist: false })) insightsChanged = true;
            }

            const memKey = `mem-${name}`;
            if (mem > 90) {
                const added = addInsight(memKey, {
                    type: 'resource',
                    severity: 'medium',
                    message: `High memory utilization on container '${name}' (${mem.toFixed(1)}%).`,
                    suggestion: 'Review memory limits or restart container if leaking.',
                    containerId: name,
                    timestamp: new Date(),
                }, { persist: false });
                if (added) insightsChanged = true;
            } else {
                if (removeInsight(memKey, { persist: false })) insightsChanged = true;
                if (clearDismissedInsight(memKey, { persist: false })) insightsChanged = true;
            }
        }

        const psLines = psOut.trim().split('\n').filter(Boolean);
        for (const line of psLines) {
            let c;
            try { c = JSON.parse(line); } catch { continue; }
            const name = String(c.Names || '').replace(/^\//, '');
            if (!name) continue;
            activeNames.add(name);

            const restartKey = `restart-${name}`;
            if (c.State === 'restarting') {
                const added = addInsight(restartKey, {
                    type: 'resource',
                    severity: 'high',
                    message: `Container '${name}' is in a restart loop.`,
                    suggestion: 'Check container logs to diagnose startup failure.',
                    containerId: name,
                    timestamp: new Date(),
                }, { persist: false });
                if (added) insightsChanged = true;
            } else {
                if (removeInsight(restartKey, { persist: false })) insightsChanged = true;
                if (clearDismissedInsight(restartKey, { persist: false })) insightsChanged = true;
            }

            if (!runningStatsNames.has(name)) {
                statsHistory.delete(name);
                if (removeInsight(`cpu-${name}`, { persist: false })) insightsChanged = true;
                if (clearDismissedInsight(`cpu-${name}`, { persist: false })) insightsChanged = true;
                if (removeInsight(`mem-${name}`, { persist: false })) insightsChanged = true;
                if (clearDismissedInsight(`mem-${name}`, { persist: false })) insightsChanged = true;
            }
        }

        // Clean up stats history for removed containers
        for (const trackedName of [...statsHistory.keys()]) {
            if (!activeNames.has(trackedName)) {
                statsHistory.delete(trackedName);
                if (removeInsight(`cpu-${trackedName}`, { persist: false })) insightsChanged = true;
                if (removeInsight(`mem-${trackedName}`, { persist: false })) insightsChanged = true;
                if (removeInsight(`restart-${trackedName}`, { persist: false })) insightsChanged = true;
            }
        }

        if (insightsChanged) saveInsightsState();
    } catch (err) {
        console.error('[MONITOR] Tactical monitor tick failed:', err.message);
    } finally {
        isMonitorRunning = false;
    }
};

setTimeout(runTacticalMonitor, 5000);
setInterval(runTacticalMonitor, 15000);

// --- Container Auto-Update & Redeploy API ---
app.get('/api/docker/auto-update', (req, res) => {
    try {
        res.json(containerUpdater.getState());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/docker/auto-update/global', (req, res) => {
    try {
        const { globalEnabled, defaultSchedule, pruneDanglingImages } = req.body || {};
        const config = containerUpdater.setGlobalConfig({
            globalEnabled,
            defaultSchedule,
            pruneDanglingImages,
        });
        auditLog('SYSTEM', 'AUTO_UPDATE_GLOBAL_SAVED', config, true);
        res.json({ success: true, config, ...containerUpdater.getState() });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.put('/api/docker/auto-update/container/:name', (req, res) => {
    try {
        const { enabled, scheduleMode, cronExpression } = req.body || {};
        const policy = containerUpdater.setContainerPolicy(req.params.name, {
            enabled,
            scheduleMode,
            cronExpression,
        });
        refreshDockerCache();
        auditLog('SYSTEM', 'AUTO_UPDATE_POLICY_SAVED', { name: req.params.name, policy }, true);
        res.json({ success: true, policy, policies: containerUpdater.getState().policies });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/docker/auto-update/run', async (req, res) => {
    try {
        const { containerName, forceRecreate = false } = req.body || {};
        if (containerName) {
            const clean = validateContainerRef(containerName);
            if (isProtectedContainer(clean)) {
                return res.status(403).json({
                    error: `Security Protocol Violation: Auto-update of core module '${clean}' is blocked.`,
                });
            }
        }
        const out = await containerUpdater.runEnabledUpdates({
            containerName,
            forceRecreate: Boolean(forceRecreate),
            trigger: 'manual',
        });
        refreshDockerCache();
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/docker/redeploy', async (req, res) => {
    try {
        const { id, pullFirst = false } = req.body || {};
        if (!id) return res.status(400).json({ error: 'Container ID required' });

        const result = await containerUpdater.redeployContainer(id, {
            pullFirst: Boolean(pullFirst),
            onlyIfNewer: false,
            trigger: 'manual',
            activeDeployments,
        });
        refreshDockerCache();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/docker/logs', async (req, res) => {
    try {
        const { id, tail = 200 } = req.body || {};
        if (!id) return res.status(400).json({ error: 'Container ID required' });
        const targetId = validateContainerRef(id);
        const parsedTail = Math.min(Math.max(parseInt(tail, 10) || 200, 1), 5000);
        const { stdout, stderr } = await execFileAsync('docker', ['logs', '--tail', String(parsedTail), targetId], {
            maxBuffer: 10 * 1024 * 1024,
        });
        const combined = stdout && stderr ? `${stdout}\n${stderr}` : (stdout || stderr || '');
        res.json({ logs: combined });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/docker/prune', async (req, res) => {
    try {
        const { stdout } = await execFileAsync('docker', ['image', 'prune', '-f'], { timeout: 60000 });
        auditLog('SYSTEM', 'DOCKER_IMAGE_PRUNE', {}, true);
        res.json({ success: true, output: stdout.trim() || 'Pruned unused dangling images.' });
    } catch (err) {
        auditLog('SYSTEM', 'DOCKER_IMAGE_PRUNE_FAILED', { error: err.message }, false);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/docker/start-service', async (req, res) => {
    try {
        try {
            await execFileAsync('docker', ['info'], { timeout: 4000 });
            refreshDockerCache();
            return res.json({ success: true, running: true, message: 'Docker Engine is already running.' });
        } catch { /* not running yet */ }

        if (process.env.DOCKER_HOST) {
            return res.json({
                success: true,
                running: false,
                message: `Docker daemon is managed externally (${process.env.DOCKER_HOST}). Start Docker on the host machine.`,
            });
        }

        if (IS_WIN) {
            return res.json({
                success: true,
                running: false,
                message: 'Docker Engine is managed by Docker Desktop on Windows. Please start Docker Desktop.',
            });
        }

        try {
            await execFileAsync('systemctl', ['start', 'docker'], { timeout: 10000 });
        } catch {
            try {
                await execFileAsync('service', ['docker', 'start'], { timeout: 10000 });
            } catch {
                return res.json({
                    success: true,
                    running: false,
                    message: 'Unable to start Docker service automatically. Ensure Docker daemon is running on the host.',
                });
            }
        }

        try {
            await execFileAsync('docker', ['info'], { timeout: 4000 });
            await refreshDockerCache();
            return res.json({ success: true, running: true, message: 'Docker Engine started successfully.' });
        } catch {
            return res.json({
                success: true,
                running: false,
                message: 'Docker service start attempted, but engine is not responding yet.',
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Background Update Orchestrator ---
async function downloadAndExtractStore(storeUrl, targetDir, zipName) {
    if (!/^https?:\/\//i.test(storeUrl)) {
        throw new Error('Only http:// and https:// store URLs are allowed.');
    }
    const zipPath = path.join(os.tmpdir(), zipName);
    if (IS_WIN) {
        await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            "Invoke-WebRequest -Uri $env:STORE_URL -OutFile $env:ZIP_PATH; Expand-Archive -Path $env:ZIP_PATH -DestinationPath $env:TARGET_DIR -Force; Remove-Item $env:ZIP_PATH -ErrorAction SilentlyContinue",
        ], {
            env: { ...process.env, STORE_URL: storeUrl, ZIP_PATH: zipPath, TARGET_DIR: targetDir },
            timeout: 120000,
        });
    } else {
        await execFileAsync('curl', ['-kL', storeUrl, '-o', zipPath], { timeout: 120000 });
        fs.mkdirSync(targetDir, { recursive: true });
        await execFileAsync('unzip', ['-o', zipPath, '-d', targetDir], { timeout: 120000 });
        try { fs.unlinkSync(zipPath); } catch { /* ignore cleanup */ }
    }
}

const runBackgroundUpdates = async () => {
    try {
        const stores = fs.existsSync(STORES_FILE) ? JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')) : [];
        auditLog('SYSTEM', 'BACKGROUND_UPDATE_START', { storesCount: Array.isArray(stores) ? stores.length : 0 }, true);

        if (Array.isArray(stores) && stores.length > 0) {
            for (const storeUrl of stores) {
                try {
                    const filename = (String(storeUrl).split('/').pop() || 'store').replace('.zip', '').replace(/[^a-z0-9]/gi, '') || 'store';
                    const targetDir = path.join(EXAMPLE_STORE_ROOT, `store_${filename}_auto`);
                    await downloadAndExtractStore(storeUrl, targetDir, `${filename}_auto.zip`);
                } catch (e) {
                    auditLog('SYSTEM', 'STORE_REFRESH_FAILED', { storeUrl, error: e.message }, false);
                }
            }
        }

        // Always check running Docker containers for image updates
        try {
            const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Image}}\t{{.Names}}\t{{.ID}}'], { timeout: 10000 });
            const rows = stdout
                .trim()
                .split('\n')
                .filter(Boolean)
                .map(line => {
                    const [image, name, id] = line.split('\t');
                    return { image, name: String(name || '').replace(/^\//, ''), id };
                })
                .filter(r => r.image && r.name);

            const updaterState = containerUpdater.getState();
            const targets = rows.filter(
                r => r.image.includes(':latest') || r.image.includes(':nightly') || updaterState.policies?.[r.name]?.enabled === true
            );

            const uniqueImages = [...new Set(targets.map(r => r.image))];
            for (const image of uniqueImages) {
                if (!IMAGE_REF_RE.test(image)) continue;
                try {
                    await execFileAsync('docker', ['pull', image], { maxBuffer: 10 * 1024 * 1024, timeout: 180000 });
                } catch { /* registry unreachable */ }
            }

            for (const { image, name, id } of targets) {
                const key = `update-${name}-${image}`;
                const policy = updaterState.policies?.[name];
                let latestId = '';
                let runningId = '';
                try {
                    latestId = (await execFileAsync('docker', ['image', 'inspect', '--format', '{{.Id}}', image])).stdout.trim();
                    runningId = (await execFileAsync('docker', ['inspect', '--format', '{{.Image}}', id])).stdout.trim();
                } catch { continue; }

                if (!latestId || !runningId) continue;

                if (latestId === runningId) {
                    removeInsight(key);
                    clearDismissedInsight(key);
                    if (policy?.lastStatus !== 'failed') {
                        removeInsight(`auto-update-fail-${name}`);
                    }
                    continue;
                }

                if (policy?.enabled === true) {
                    // Container is managed by auto-update: do not raise manual update alerts
                    removeInsight(key);
                    if (policy.lastStatus === 'failed') {
                        addInsight(`auto-update-fail-${name}`, {
                            type: 'system',
                            severity: 'high',
                            message: `Auto-update failed for '${name}' (${image}): ${policy.lastMessage || 'Unknown error'}`,
                            suggestion: 'Inspect container logs or update history and redeploy manually.',
                            containerId: name,
                            image,
                            imageId: latestId,
                            timestamp: new Date(),
                        });
                    }
                    continue;
                }

                if (dismissedInsightKeys.has(key)) {
                    const dismissedAt = dismissedInsightDigests.get(key);
                    if (dismissedAt && dismissedAt !== latestId) {
                        clearDismissedInsight(key);
                    }
                }

                addInsight(key, {
                    type: 'system',
                    severity: 'medium',
                    message: `Update Available: Pulled new image for '${name}' (${image}).`,
                    suggestion: 'Redeploy container to apply the new image layers.',
                    containerId: name,
                    image,
                    imageId: latestId,
                    timestamp: new Date(),
                });
            }
        } catch { /* Docker unavailable */ }

        if (tacticalInsights.length > 10) {
            tacticalInsights.splice(0, tacticalInsights.length - 10);
            saveInsightsState();
        }

        auditLog('SYSTEM', 'BACKGROUND_UPDATE_FINISH', {}, true);
    } catch (err) {
        auditLog('SYSTEM', 'BACKGROUND_UPDATE_FATAL', { error: err.message }, false);
    }
};

setInterval(runBackgroundUpdates, 6 * 60 * 60 * 1000);
setTimeout(runBackgroundUpdates, 10000);

// --- App Store API ---
app.get('/api/store/apps', async (req, res) => {
    try {
        if (!fs.existsSync(EXAMPLE_STORE_ROOT)) fs.mkdirSync(EXAMPLE_STORE_ROOT, { recursive: true });
        const apps = [];
        const findCompose = (dir, depth = 0) => {
            if (depth > 5) return;
            fs.readdirSync(dir, { withFileTypes: true }).forEach(ent => {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) findCompose(full, depth + 1);
                else if (ent.name === 'docker-compose.yml' || ent.name === 'docker-compose.yaml') {
                    const parsed = YAML.parse(fs.readFileSync(full, 'utf8'));
                    const casa = parsed?.['x-casaos'];
                    if (casa) {
                        const provider = path.relative(EXAMPLE_STORE_ROOT, path.dirname(full)).split(path.sep)[0] || 'Official';
                        apps.push({
                            id: `${ent.name}-${apps.length}`,
                            title: casa.title?.en_us || path.basename(path.dirname(full)),
                            tagline: casa.tagline?.en_us || '',
                            description: casa.description?.en_us || '',
                            icon: casa.icon || '',
                            category: casa.category || '',
                            developer: casa.developer || provider,
                            path: path.dirname(full),
                            store: provider.replace('store_', '').replace(/^\w/, c => c.toUpperCase()),
                        });
                    }
                }
            });
        };
        findCompose(EXAMPLE_STORE_ROOT);
        res.json({ apps });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/provider', async (req, res) => {
    try {
        const { url } = req.body || {};
        if (!url) return res.status(400).json({ error: 'Store URL is required' });
        const filename = (String(url).split('/').pop() || 'store').replace('.zip', '').replace(/[^a-z0-9]/gi, '') || 'store';
        const targetDir = path.join(EXAMPLE_STORE_ROOT, `store_${filename}_${Date.now()}`);
        await downloadAndExtractStore(url, targetDir, `${filename}.zip`);

        const stores = fs.existsSync(STORES_FILE) ? JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')) : [];
        if (!stores.includes(url)) {
            stores.push(url);
            writeJsonAtomic(STORES_FILE, stores);
        }

        res.json({ success: true, provider: filename });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/compose/read', (req, res) => {
    try {
        const { appPath } = req.body || {};
        if (!appPath || typeof appPath !== 'string') {
            return res.status(400).json({ error: 'appPath is required' });
        }
        if (!isStorePathSafe(appPath)) {
            return res.status(403).json({ error: 'Access denied: path outside example-store.' });
        }
        const resolvedDir = path.resolve(appPath);
        const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
        const found = candidates.map(c => path.join(resolvedDir, c)).find(p => fs.existsSync(p));
        if (!found) {
            return res.status(404).json({ error: 'Compose manifest not found in app directory.' });
        }
        const composeData = fs.readFileSync(found, 'utf8');
        res.json({ composeData });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/store/deploy', async (req, res) => {
    try {
        const { appPath, composeData } = req.body || {};
        if (!appPath || !isStorePathSafe(appPath)) {
            return res.status(403).json({ error: 'Access denied: path outside example-store.' });
        }
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
            refreshDockerCache();
        });
        res.json({ success: true, deployId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Terminal & C# Sandbox ---
app.post('/api/terminal/exec', async (req, res) => {
    try {
        const { command, agent = 'USER' } = req.body;
        if (!command) return res.json({ output: '', cwd: terminalCwd });

        const normalizedCmd = command.trim().toLowerCase();
        if (COMMAND_DENYLIST.some(blocked => normalizedCmd.includes(blocked))) {
            auditLog(agent, 'EXEC_BLOCKED', { command }, false);
            return res.json({ output: 'Error: Command violates safety denylist and was blocked.', cwd: terminalCwd });
        }

        const settings = getSettings();

        if (settings.sshHost && settings.sshUsername) {
            const wrappedCommand = `${command} ; echo "--AETHEROS_CWD--" ; pwd`;
            const sshClient = new Client();

            sshClient.on('ready', () => {
                sshClient.exec(`cd "${terminalCwd}" && ${wrappedCommand}`, (err, stream) => {
                    if (err) {
                        sshClient.end();
                        return res.status(500).json({ error: err.message, cwd: terminalCwd });
                    }
                    let stdout = '';
                    let stderr = '';
                    stream.on('close', () => {
                        sshClient.end();
                        let finalOutput = stdout;
                        const parts = stdout.split('--AETHEROS_CWD--');
                        if (parts.length > 1) {
                            const cwdPart = parts.pop().trim();
                            if (cwdPart) terminalCwd = cwdPart;
                            finalOutput = parts.join('--AETHEROS_CWD--').trim();
                        }
                        const output = (finalOutput + '\n' + stderr).trim();
                        auditLog(agent, 'EXEC_SSH', { command }, true);
                        if (!res.headersSent) res.json({ output, cwd: terminalCwd });
                    }).on('data', (data) => {
                        stdout += data;
                    }).stderr.on('data', (data) => {
                        stderr += data;
                    });
                });
            }).on('error', (err) => {
                if (!res.headersSent) res.status(500).json({ error: `SSH Connection Error: ${err.message}`, cwd: terminalCwd });
            }).connect({
                host: settings.sshHost,
                port: settings.sshPort || 22,
                username: settings.sshUsername,
                ...(settings.sshPassword && { password: settings.sshPassword }),
            });

            return;
        }

        const shell = IS_WIN ? 'cmd.exe' : '/bin/bash';
        const wrappedCommand = IS_WIN
            ? `${command} & echo --AETHEROS_CWD-- & cd`
            : `${command} ; echo "--AETHEROS_CWD--" ; pwd`;

        const { stdout, stderr } = await execPromise(wrappedCommand, {
            cwd: terminalCwd,
            shell,
        }).catch(err => ({ stdout: err.stdout || '', stderr: err.stderr || err.message }));

        let finalOutput = stdout;
        const parts = stdout.split('--AETHEROS_CWD--');
        if (parts.length > 1) {
            const cwdPart = parts.pop().trim();
            finalOutput = parts.join('--AETHEROS_CWD--').trim();
            if (cwdPart && fs.existsSync(cwdPart)) {
                terminalCwd = cwdPart;
            }
        }

        const output = (finalOutput + '\n' + stderr).trim();
        auditLog(agent, 'EXEC_LOCAL', { command }, true);
        if (!res.headersSent) res.json({ output, cwd: terminalCwd });
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: err.message, cwd: terminalCwd });
    }
});

app.post('/api/docker/run-csx', async (req, res) => {
    try {
        const { code, allowNetwork } = req.body;
        if (!code) return res.status(400).json({ error: 'No code provided' });

        try {
            await execFileAsync('docker', ['image', 'inspect', 'aetheros/dotnet-sandbox']);
        } catch {
            const dockerfile = `
FROM mcr.microsoft.com/dotnet/sdk:8.0
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
WORKDIR /app
`;
            const buildDir = path.join(os.tmpdir(), `aetheros-dotnet-build-${Date.now()}`);
            fs.mkdirSync(buildDir, { recursive: true });
            fs.writeFileSync(path.join(buildDir, 'Dockerfile'), dockerfile);
            await execFileAsync('docker', ['build', '-t', 'aetheros/dotnet-sandbox', '.'], { cwd: buildDir });
            fs.rmSync(buildDir, { recursive: true, force: true });
        }

        const scriptId = `script_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const scriptDir = path.join(WORKSPACE_ROOT, '.tmp', scriptId);
        fs.mkdirSync(scriptDir, { recursive: true });

        const hasNamespace = code.includes('namespace ') || code.includes('class Program');
        const finalCode = hasNamespace ? code : `
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

${code}
`;
        fs.writeFileSync(path.join(scriptDir, 'Program.cs'), finalCode);

        const csprojContent = `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RestorePackagesWithLockFile>false</RestorePackagesWithLockFile>
    <DisableImplicitNuGetFallbackFolder>true</DisableImplicitNuGetFallbackFolder>
  </PropertyGroup>
</Project>`;
        fs.writeFileSync(path.join(scriptDir, 'Sandbox.csproj'), csprojContent);

        const dockerArgs = ['run', '--rm'];
        if (!(allowNetwork || isYoloMode)) {
            dockerArgs.push('--network', 'none');
        }
        if (isYoloMode) {
            dockerArgs.push('--privileged', '-v', '/:/host_root');
        } else {
            dockerArgs.push('--memory', '512m', '--cpus', '1.0');
        }
        dockerArgs.push('-v', `${scriptDir}:/app/src`, 'aetheros/dotnet-sandbox', '/bin/sh', '-c', 'dotnet run --project /app/src/Sandbox.csproj');

        let result;
        try {
            const { stdout, stderr } = await execFileAsync('docker', dockerArgs, { timeout: 15000 });
            result = { stdout: stdout.trim(), stderr: stderr.trim() };
        } catch (execError) {
            result = {
                stdout: execError.stdout?.trim() || '',
                stderr: execError.stderr?.trim() || execError.message,
            };
        } finally {
            fs.rmSync(scriptDir, { recursive: true, force: true });
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Filesystem APIs ---
app.get('/api/fs/ls', (req, res) => {
    try {
        const targetPath = req.query.path || WORKSPACE_ROOT;
        if (!isPathSafe(targetPath)) return res.status(403).json({ error: 'Access denied: path outside workspace sandbox.' });
        if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Path does not exist' });

        const files = fs.readdirSync(targetPath, { withFileTypes: true }).map(f => ({
            name: f.name,
            isDirectory: f.isDirectory(),
            size: f.isFile() ? fs.statSync(path.join(targetPath, f.name)).size : 0,
        }));
        res.json({ files, currentPath: targetPath });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fs/read', (req, res) => {
    try {
        const targetPath = req.body?.path;
        if (!targetPath || typeof targetPath !== 'string') {
            return res.status(400).json({ error: 'File path required' });
        }
        if (!isPathSafe(targetPath)) {
            return res.status(403).json({ error: 'Access denied: path outside workspace sandbox.' });
        }
        const resolved = path.resolve(targetPath);
        if (!fs.existsSync(resolved)) {
            return res.status(404).json({ error: 'File does not exist' });
        }
        res.json({ content: fs.readFileSync(resolved, 'utf8') });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fs/write', (req, res) => {
    try {
        const { path: targetPath, content } = req.body || {};
        if (!targetPath || typeof targetPath !== 'string') {
            return res.status(400).json({ error: 'File path required' });
        }
        if (!isPathSafe(targetPath)) {
            return res.status(403).json({ error: 'Access denied: path outside workspace sandbox.' });
        }
        const resolved = path.resolve(targetPath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content ?? '', 'utf8');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Chat Persistence ---
app.get('/api/chat/load', (req, res) => {
    try {
        if (!fs.existsSync(CHAT_FILE)) return res.json({});
        const parsed = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object' && 'passwordHash' in parsed) {
            const { passwordHash: _ignored, ...clean } = parsed;
            return res.json(clean);
        }
        res.json(parsed);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/save', (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'Invalid chat history payload' });
        }
        const { passwordHash: _ignored, ...cleanBody } = req.body;
        writeJsonAtomic(CHAT_FILE, cleanBody);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Docker Management ---
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
            status: 'Pulling and starting...',
        });

        const child = spawn('docker', ['compose', 'up', '-d'], {
            cwd: workspaceDir,
            detached: true,
        });

        child.on('error', (err) => {
            const d = activeDeployments.find(item => item.id === deployId);
            if (d) d.status = `FATAL: ${err.message}`;
        });

        child.stdout.on('data', (data) => {
            const output = data.toString();
            const d = activeDeployments.find(item => item.id === deployId);
            if (d) d.status = output.split('\n').filter(Boolean).pop() || d.status;
        });

        child.stderr.on('data', (data) => {
            const output = data.toString();
            const d = activeDeployments.find(item => item.id === deployId);
            if (d) d.status = output.split('\n').filter(Boolean).pop() || d.status;
        });

        child.on('close', () => {
            const idx = activeDeployments.findIndex(item => item.id === deployId);
            if (idx !== -1) activeDeployments.splice(idx, 1);
            refreshDockerCache();
        });

        res.json({ success: true, deployId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

async function getPublicIP() {
    try {
        const response = await fetch('https://icanhazip.com');
        const text = await response.text();
        return text.trim();
    } catch { return 'Unknown'; }
}

app.post('/api/docker/registry/login', async (req, res) => {
    try {
        const { server, username, password } = req.body;
        if (!server || !username || !password) return res.status(400).json({ error: 'Server, username, and password required' });
        if (/\s/.test(server) || /\s/.test(username)) {
            return res.status(400).json({ error: 'Server and username must not contain whitespace' });
        }

        const child = spawn('docker', ['login', server, '-u', username, '--password-stdin']);
        child.stdin.write(password);
        child.stdin.end();

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', data => stdout += data.toString());
        child.stderr.on('data', data => stderr += data.toString());

        child.on('close', async (code) => {
            if (code === 0) {
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
        const {
            image,
            name,
            ports,
            volumes,
            env,
            resources,
            networks,
            networkMode,
            replaceId,
            restartPolicy,
            autoUpdate,
        } = req.body || {};

        const validImage = validateImageRef(image);
        const cleanName = name ? validateContainerRef(name) : '';
        if (cleanName && isProtectedContainer(cleanName)) {
            return res.status(403).json({ error: `Protected container '${cleanName}' cannot be overwritten.` });
        }

        const cleanReplaceId = replaceId ? validateContainerRef(replaceId) : '';
        if (cleanReplaceId && isProtectedContainer(cleanReplaceId)) {
            return res.status(403).json({ error: `Protected container '${cleanReplaceId}' cannot be removed.` });
        }

        if (restartPolicy && !RESTART_POLICY_RE.test(String(restartPolicy).trim())) {
            return res.status(400).json({ error: `Invalid restartPolicy: '${restartPolicy}'` });
        }

        if (autoUpdate && autoUpdate.scheduleMode === 'custom') {
            if (!autoUpdate.cronExpression || !cron.validate(String(autoUpdate.cronExpression).trim())) {
                return res.status(400).json({ error: `Invalid custom cron expression: '${autoUpdate.cronExpression || ''}'` });
            }
        }

        const activeNets = Array.isArray(networks) ? networks.filter(Boolean).map(validateNetworkName) : [];
        const validNetMode = networkMode ? validateNetworkName(networkMode) : '';
        const primaryNet = validNetMode && (validNetMode === 'host' || validNetMode === 'none')
            ? validNetMode
            : (activeNets[0] || validNetMode || null);

        if (cleanReplaceId) {
            try {
                await execFileAsync('docker', ['rm', '-f', cleanReplaceId]);
                auditLog('SYSTEM', 'CONTAINER_REPLACEMENT_CLEANUP', { replaceId: cleanReplaceId }, true);
            } catch (e) {
                console.warn(`Failed to remove old container ${cleanReplaceId}:`, e.message);
            }
        }

        const args = ['run', '-d'];
        if (cleanName) args.push('--name', cleanName);
        if (restartPolicy && restartPolicy !== 'no') {
            args.push('--restart', String(restartPolicy).trim());
        }
        if (primaryNet) {
            args.push('--network', primaryNet);
        }

        if (primaryNet !== 'host' && primaryNet !== 'none') {
            for (const p of (ports || [])) {
                if (p?.host && p?.container) {
                    args.push('-p', `${String(p.host).trim()}:${String(p.container).trim()}`);
                } else if (p?.container) {
                    args.push('-p', String(p.container).trim());
                }
            }
        }

        for (const v of (volumes || [])) {
            if (v?.host && v?.container) {
                args.push('-v', `${String(v.host).trim()}:${String(v.container).trim()}`);
            }
        }

        for (const e of (env || [])) {
            if (e?.key) {
                args.push('-e', `${e.key}=${e.value ?? ''}`);
            }
        }

        if (resources?.cpus && parseFloat(resources.cpus) > 0) {
            args.push('--cpus', String(resources.cpus).trim());
        }
        if (resources?.memory && parseFloat(resources.memory) > 0) {
            args.push('-m', String(resources.memory).trim());
        }

        args.push(validImage);

        const { stdout } = await execFileAsync('docker', args);
        const newContainerId = stdout.trim();

        if (primaryNet !== 'host' && primaryNet !== 'none' && activeNets.length > 1) {
            for (let i = 1; i < activeNets.length; i++) {
                const netName = activeNets[i];
                if (netName && netName !== primaryNet) {
                    try {
                        await execFileAsync('docker', ['network', 'connect', netName, newContainerId]);
                    } catch (netErr) {
                        console.warn(`Failed to connect container to network ${netName}:`, netErr.message);
                    }
                }
            }
        }

        if (autoUpdate && typeof autoUpdate === 'object') {
            let policyTargetName = cleanName;
            if (!policyTargetName && newContainerId) {
                try {
                    const { stdout: nameOut } = await execFileAsync('docker', ['inspect', '--format', '{{.Name}}', newContainerId]);
                    policyTargetName = nameOut.trim().replace(/^\//, '');
                } catch { /* ignore */ }
            }
            if (policyTargetName && !isProtectedContainer(policyTargetName)) {
                containerUpdater.setContainerPolicy(policyTargetName, {
                    enabled: Boolean(autoUpdate.enabled),
                    scheduleMode: autoUpdate.scheduleMode || 'global',
                    cronExpression: autoUpdate.cronExpression || '',
                });
            }
        }

        refreshDockerCache();
        res.json({ success: true, id: newContainerId });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/docker/action', async (req, res) => {
    try {
        const { id, action } = req.body || {};
        if (!id || !action) return res.status(400).json({ error: 'Container ID and action required' });

        const targetId = validateContainerRef(id);
        if (isProtectedContainer(targetId) && (action === 'restart' || action === 'stop' || action === 'rm')) {
            const msg = `Security Protocol Violation: Action '${action}' on core module '${targetId}' is blocked to prevent system blackout.`;
            auditLog('SYSTEM', 'DOCKER_ACTION_BLOCKED', { id: targetId, action }, false);
            return res.status(403).json({ error: msg });
        }

        let dockerArgs;
        switch (action) {
            case 'start': dockerArgs = ['start', targetId]; break;
            case 'stop': dockerArgs = ['stop', targetId]; break;
            case 'restart': dockerArgs = ['restart', targetId]; break;
            case 'rm': dockerArgs = ['rm', '-f', targetId]; break;
            default: return res.status(400).json({ error: `Unsupported action: ${action}` });
        }

        await execFileAsync('docker', dockerArgs);
        auditLog('SYSTEM', 'DOCKER_ACTION', { id: targetId, action }, true);
        refreshDockerCache();
        res.json({ success: true, action });
    } catch (err) {
        auditLog('SYSTEM', 'DOCKER_ACTION_FAILED', { id: req.body?.id, action: req.body?.action, error: err.message }, false);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/docker/inspect', async (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'Container ID required' });

        const targetId = validateContainerRef(id);
        const { stdout } = await execFileAsync('docker', ['inspect', targetId, '--format', '{{json .}}']);
        const raw = JSON.parse(stdout);

        const cleanName = (raw.Name || targetId).replace(/^\//, '');
        const networksMap = raw.NetworkSettings?.Networks || {};
        const networks = Object.keys(networksMap);
        const networkMode = raw.HostConfig?.NetworkMode || (networks.length > 0 ? networks[0] : 'bridge');
        const restartName = raw.HostConfig?.RestartPolicy?.Name || 'no';

        const spec = {
            image: raw.Config.Image,
            name: cleanName,
            ports: Object.entries(raw.HostConfig.PortBindings || {}).map(([c, h]) => ({
                container: c.split('/')[0],
                host: h?.[0]?.HostPort || '',
            })),
            volumes: (raw.Mounts || []).map((m) => ({
                host: m.Type === 'volume' ? (m.Name || m.Source) : m.Source,
                container: m.Destination,
            })),
            env: (raw.Config.Env || []).map((e) => {
                const sep = e.indexOf('=');
                return sep === -1
                    ? { key: e, value: '' }
                    : { key: e.slice(0, sep), value: e.slice(sep + 1) };
            }),
            resources: {
                cpus: raw.HostConfig.NanoCpus ? (raw.HostConfig.NanoCpus / 1e9).toString() : '',
                memory: raw.HostConfig.Memory ? (raw.HostConfig.Memory / (1024 * 1024)).toString() + 'm' : '',
            },
            networks,
            networkMode,
            restartPolicy: restartName,
            autoUpdate: containerUpdater.getPolicy(cleanName),
        };

        res.json(spec);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/docker/network/connect', async (req, res) => {
    try {
        const { containerId, networkName } = req.body || {};
        if (!containerId || !networkName) return res.status(400).json({ error: 'Container ID and network name required' });
        const validContainer = validateContainerRef(containerId);
        const validNetwork = validateNetworkName(networkName);
        await execFileAsync('docker', ['network', 'connect', validNetwork, validContainer]);
        auditLog('SYSTEM', 'DOCKER_NETWORK_CONNECT', { containerId: validContainer, networkName: validNetwork }, true);
        refreshDockerCache();
        res.json({ success: true });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

app.post('/api/docker/network/disconnect', async (req, res) => {
    try {
        const { containerId, networkName } = req.body || {};
        if (!containerId || !networkName) return res.status(400).json({ error: 'Container ID and network name required' });
        const validContainer = validateContainerRef(containerId);
        const validNetwork = validateNetworkName(networkName);
        await execFileAsync('docker', ['network', 'disconnect', validNetwork, validContainer]);
        auditLog('SYSTEM', 'DOCKER_NETWORK_DISCONNECT', { containerId: validContainer, networkName: validNetwork }, true);
        refreshDockerCache();
        res.json({ success: true });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// --- System Updates ---
const UPDATER_LOG_FILE = path.join(DATA_DIR, 'logs', 'updater.log');
const localUpdateState = {
    inProgress: false,
    phase: 'idle',
    startedAt: null,
    finishedAt: null,
    error: null,
    targetCommit: null,
};

function appendUpdaterLog(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    try {
        if (!fs.existsSync(path.dirname(UPDATER_LOG_FILE))) {
            fs.mkdirSync(path.dirname(UPDATER_LOG_FILE), { recursive: true });
        }
        fs.appendFileSync(UPDATER_LOG_FILE, entry);
    } catch { /* ignore log write errors */ }
}

function readUpdaterTailLogs(maxLines = 40) {
    try {
        if (!fs.existsSync(UPDATER_LOG_FILE)) return '';
        const lines = fs.readFileSync(UPDATER_LOG_FILE, 'utf8').split(/\r?\n/);
        return lines.slice(-maxLines).join('\n').trim();
    } catch {
        return '';
    }
}

async function gitRefExists(repoRoot, refName) {
    try {
        await execFileAsync('git', ['show-ref', '--verify', '--quiet', refName], { cwd: repoRoot, timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

async function resolveGitTargetBranch(repoRoot) {
    let branch = '';
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, timeout: 5000 });
        branch = stdout.trim();
    } catch {
        branch = '';
    }

    if (!branch || branch === 'HEAD') {
        try {
            const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
                cwd: repoRoot,
                timeout: 5000,
            });
            branch = stdout.trim().replace(/^origin\//, '');
        } catch {
            branch = '';
        }
    }

    if (!branch || !/^[a-zA-Z0-9._/-]+$/.test(branch)) {
        branch = (await gitRefExists(repoRoot, 'refs/remotes/origin/main')) ? 'main' : 'master';
    }

    if (await gitRefExists(repoRoot, `refs/remotes/origin/${branch}`)) {
        return branch;
    }
    if (await gitRefExists(repoRoot, 'refs/remotes/origin/main')) {
        return 'main';
    }
    if (await gitRefExists(repoRoot, 'refs/remotes/origin/master')) {
        return 'master';
    }
    return branch;
}

async function runLocalRepoUpdate() {
    if (localUpdateState.inProgress) return;

    const repoRoot = process.cwd();
    const npmBin = IS_WIN ? 'npm.cmd' : 'npm';
    localUpdateState.inProgress = true;
    localUpdateState.phase = 'fetching';
    localUpdateState.startedAt = new Date().toISOString();
    localUpdateState.finishedAt = null;
    localUpdateState.error = null;
    localUpdateState.targetCommit = null;

    try {
        appendUpdaterLog('--- LOCAL SYSTEM UPDATE SEQUENCE STARTING ---');
        if (!fs.existsSync(path.join(repoRoot, '.git'))) {
            throw new Error('Local .git repository not found.');
        }

        const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoRoot, timeout: 5000 });
        const dirtyLines = statusOut.split(/\r?\n/).filter(Boolean);
        const dirtyFiles = dirtyLines.map(line => line.slice(3).trim());
        const nonLockDirty = dirtyFiles.filter(f => f !== 'package-lock.json');
        if (nonLockDirty.length > 0) {
            throw new Error('Cannot auto-update local working tree with uncommitted changes. Commit or stash changes first.');
        }
        if (dirtyFiles.includes('package-lock.json')) {
            appendUpdaterLog('Resetting pre-commit version lockfile delta in package-lock.json...');
            await execFileAsync('git', ['checkout', '--', 'package-lock.json'], { cwd: repoRoot, timeout: 5000 });
        }

        appendUpdaterLog('Fetching upstream refs...');
        await execFileAsync('git', ['fetch', '--all', '--prune'], { cwd: repoRoot, timeout: 60000 });

        const targetBranch = await resolveGitTargetBranch(repoRoot);
        appendUpdaterLog(`Pulling origin/${targetBranch} (fast-forward)...`);
        await execFileAsync('git', ['pull', '--ff-only', 'origin', targetBranch], { cwd: repoRoot, timeout: 60000 });

        const { stdout: commitOut } = await execFileAsync('git', ['log', '-1', '--format=%h %s'], {
            cwd: repoRoot,
            timeout: 5000,
        });
        localUpdateState.targetCommit = commitOut.trim();
        appendUpdaterLog(`Updated repository to: ${localUpdateState.targetCommit}`);

        localUpdateState.phase = 'building';
        appendUpdaterLog('Installing dependencies (npm install)...');
        await execFileAsync(npmBin, ['install', '--no-audit', '--no-fund'], {
            cwd: repoRoot,
            shell: IS_WIN,
            maxBuffer: 20 * 1024 * 1024,
            timeout: 10 * 60 * 1000,
        });

        appendUpdaterLog('Building production frontend (npm run build)...');
        await execFileAsync(npmBin, ['run', 'build'], {
            cwd: repoRoot,
            shell: IS_WIN,
            maxBuffer: 20 * 1024 * 1024,
            timeout: 10 * 60 * 1000,
        });

        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
            if (pkg.version) projectVersion = pkg.version;
        } catch { /* keep existing projectVersion */ }

        localUpdateState.inProgress = false;
        localUpdateState.phase = 'completed';
        localUpdateState.finishedAt = new Date().toISOString();
        appendUpdaterLog('--- LOCAL SYSTEM UPDATE COMPLETED SUCCESSFULLY ---');
    } catch (err) {
        localUpdateState.inProgress = false;
        localUpdateState.phase = 'failed';
        localUpdateState.error = err.message || 'Local update failed';
        localUpdateState.finishedAt = new Date().toISOString();
        appendUpdaterLog(`!!! LOCAL SYSTEM UPDATE FAILED: ${localUpdateState.error}`);
    }
}

async function checkSystemUpdateStatus() {
    try {
        const updaterRes = await fetch('http://aetheros-updater:8080/status', {
            signal: AbortSignal.timeout(10000),
        });
        if (updaterRes.ok) {
            const status = await updaterRes.json();
            const behindCount = parseInt(status.behindCount, 10) || 0;
            return {
                success: true,
                updateAvailable: Boolean(status.updateAvailable ?? behindCount > 0),
                behindCount,
                branch: status.branch || status.targetBranch || 'unknown',
                lastCommit: status.lastCommit || 'unknown',
            };
        }
    } catch { /* fallback to local git repo */ }

    const repoRoot = process.cwd();
    if (!fs.existsSync(path.join(repoRoot, '.git'))) {
        const err = new Error('Updater service unreachable and local .git repository not found.');
        err.statusCode = 503;
        throw err;
    }

    const { stdout: headBranchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, timeout: 5000 });
    const { stdout: commitOut } = await execFileAsync('git', ['log', '-1', '--format=%h %s'], { cwd: repoRoot, timeout: 5000 });
    const headBranch = headBranchOut.trim();
    const lastCommit = commitOut.trim() || 'unknown';

    try {
        await execFileAsync('git', ['fetch', '--quiet', '--prune', 'origin'], { cwd: repoRoot, timeout: 8000 });
    } catch { /* ignore network failure */ }

    const targetBranch = await resolveGitTargetBranch(repoRoot);
    const branch = (!headBranch || headBranch === 'HEAD') ? targetBranch : headBranch;

    let behindCount = 0;
    if (/^[a-zA-Z0-9._/-]+$/.test(targetBranch)) {
        try {
            const { stdout: countOut } = await execFileAsync(
                'git',
                ['rev-list', '--count', `HEAD..origin/${targetBranch}`],
                { cwd: repoRoot, timeout: 5000 }
            );
            behindCount = parseInt(countOut.trim(), 10) || 0;
        } catch {
            behindCount = 0;
        }
    }

    return {
        success: true,
        updateAvailable: behindCount > 0,
        behindCount,
        branch,
        lastCommit,
    };
}

async function triggerSystemUpdate() {
    try {
        const updaterResponse = await fetch('http://aetheros-updater:8080/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000),
        });
        if (!updaterResponse.ok) {
            const text = await updaterResponse.text().catch(() => '');
            const err = new Error(text || `Updater returned HTTP ${updaterResponse.status}`);
            err.statusCode = 502;
            throw err;
        }
        const data = await updaterResponse.json();
        return {
            success: true,
            mode: 'docker',
            inProgress: true,
            message: data.status || 'Update initiated.',
            ...data,
        };
    } catch (updaterErr) {
        if (updaterErr?.statusCode === 502) throw updaterErr;

        const repoRoot = process.cwd();
        if (!fs.existsSync(path.join(repoRoot, '.git')) || !(await isGitAvailable())) {
            const err = new Error('System updater service unreachable and local git repository is unavailable.');
            err.statusCode = 503;
            throw err;
        }

        if (localUpdateState.inProgress) {
            return {
                success: true,
                mode: 'local',
                inProgress: true,
                phase: localUpdateState.phase,
                message: `Local update already in progress (${localUpdateState.phase}).`,
            };
        }

        setTimeout(() => {
            void runLocalRepoUpdate();
        }, 50);

        return {
            success: true,
            mode: 'local',
            inProgress: true,
            phase: 'fetching',
            message: 'Local repository update and build started.',
        };
    }
}

app.get('/api/system/check-updates', async (req, res) => {
    try {
        const status = await checkSystemUpdateStatus();
        res.json(status);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.get('/api/system/update-status', async (req, res) => {
    try {
        const updaterRes = await fetch('http://aetheros-updater:8080/update-status', {
            signal: AbortSignal.timeout(4000),
        });
        if (updaterRes.ok) {
            const data = await updaterRes.json();
            return res.json({
                success: true,
                mode: 'docker',
                projectVersion,
                ...data,
            });
        }
    } catch { /* fallback to local update state */ }

    res.json({
        success: true,
        mode: 'local',
        projectVersion,
        ...localUpdateState,
        logs: readUpdaterTailLogs(40),
    });
});

app.post('/api/system/update', async (req, res) => {
    try {
        const result = await triggerSystemUpdate();
        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

app.post('/api/system/host-update', async (req, res) => {
    try {
        const { action } = req.body || {};
        console.log(`[System] Executing host update action: ${action || 'check'}`);

        if (action === 'start') {
            const result = await triggerSystemUpdate();
            res.json({ success: true, output: result.message, ...result });
        } else {
            const status = await checkSystemUpdateStatus();
            const output = `Connected to branch: ${status.branch}. Last commit: ${status.lastCommit}. Behind upstream by ${status.behindCount} commit(s).`;
            res.json({ success: true, output, ...status });
        }
    } catch (err) {
        res.status(err.statusCode || 503).json({ error: err.message || 'System updater service unreachable.' });
    }
});

app.get('/api/logs/:source', async (req, res) => {
    try {
        const source = req.params.source;
        let logPath = '';
        if (source === 'updater') {
            logPath = path.join(DATA_DIR, 'logs', 'updater.log');
        } else if (source === 'agent') {
            logPath = path.join(DATA_DIR, 'logs', 'agent.log');
        } else if (source === 'comms') {
            logPath = AUDIT_LOG_PATH;
        } else {
            return res.status(400).json({ error: 'Invalid log source' });
        }

        if (!fs.existsSync(logPath)) {
            return res.json({ logs: '[SYSTEM] Log file not found or currently empty.' });
        }

        if (IS_WIN) {
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.split('\n');
            res.json({ logs: lines.slice(-200).join('\n') });
        } else {
            const { stdout } = await execFileAsync('tail', ['-n', '200', logPath]);
            res.json({ logs: stdout });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Cron Management API ---
app.get('/api/cron/jobs', async (req, res) => {
    try {
        res.json(cronManager.loadJobs());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cron/jobs', async (req, res) => {
    try {
        const job = req.body || {};
        if (!job.schedule || !cron.validate(String(job.schedule).trim())) {
            return res.status(400).json({ error: `Invalid cron expression: '${job.schedule || ''}'` });
        }
        if (!job.id) job.id = crypto.randomUUID();

        const existing = cronManager.loadJobs();
        const index = existing.findIndex(j => j.id === job.id);
        if (index !== -1) {
            cronManager.updateJob(job);
        } else {
            cronManager.addJob(job);
        }
        res.json({ success: true, job });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cron/jobs/:id', async (req, res) => {
    try {
        cronManager.deleteJob(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cron/jobs/:id/toggle', async (req, res) => {
    try {
        const jobs = cronManager.loadJobs();
        const job = jobs.find(j => j.id === req.params.id);
        if (job) {
            job.enabled = !job.enabled;
            cronManager.updateJob(job);
            res.json({ success: true, enabled: job.enabled });
        } else {
            res.status(404).json({ error: 'Job not found' });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cron/jobs/:id/run', async (req, res) => {
    try {
        const result = await cronManager.runJobNow(req.params.id);
        res.json({ success: result.success, ...result });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// --- Docker Listing & Network Inspection ---
app.get('/api/docker/list', async (req, res) => {
    try {
        const { stdout } = await execFileAsync('docker', ['ps', '-a', '--format', '{{json .}}']);
        const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        res.json({ containers });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docker/stats', async (req, res) => {
    try {
        const { stdout } = await execFileAsync('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
        const stats = stdout.trim().split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        res.json({ stats });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docker/networks', async (req, res) => {
    try {
        const { stdout } = await execFileAsync('docker', ['network', 'ls', '--format', '{{json .}}']);
        const networks = stdout.trim().split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);

        const detailed = await Promise.all(networks.map(async (net) => {
            try {
                if (!CONTAINER_NAME_RE.test(String(net.ID || ''))) {
                    return { id: net.ID, name: net.Name, driver: net.Driver, scope: net.Scope, containers: [] };
                }
                const { stdout: inspectOut } = await execFileAsync('docker', ['network', 'inspect', net.ID, '--format', '{{json .}}']);
                const info = JSON.parse(inspectOut);
                const containers = Object.entries(info.Containers || {}).map(([id, c]) => ({
                    id: id.substring(0, 12),
                    name: c.Name,
                    ipv4: c.IPv4Address,
                }));
                return { id: net.ID, name: net.Name, driver: net.Driver, scope: net.Scope, containers };
            } catch {
                return { id: net.ID, name: net.Name, driver: net.Driver, scope: net.Scope, containers: [] };
            }
        }));

        res.json({ networks: detailed });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Web Tools ---
app.post('/api/tools/scrape', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) throw new Error('URL is required');
        const response = await fetch(url);
        const html = await response.text();
        const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 10000);
        res.json({ url, content: text });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tools/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) throw new Error('Query is required');
        const results = [
            { title: `${query} - Search Results`, snippet: `Information about ${query} indexed across external sources.`, url: `https://google.com/search?q=${encodeURIComponent(query)}` },
            { title: 'Operations Knowledge Base', snippet: 'Reference technical documentation and operational runbooks.', url: 'https://docs.docker.com/' },
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

console.log('[SYS] Initializing Kai Ops Backend Server...');
console.log(`[SYS] Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`[SYS] Port: ${port}`);
console.log(`[SYS] Workspace: ${WORKSPACE_ROOT}`);

app.listen(port, () => {
    console.log('\n================================================');
    console.log(`  KAI OPS BACKEND ONLINE - PORT: ${port}`);
    console.log(`  VERSION: ${projectVersion}`);
    console.log('================================================\n');
});
