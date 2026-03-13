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
let cachedStorage = 50;
let previousCpus = os.cpus();
const IS_WIN = os.platform() === 'win32';

// --- Terminal State ---
let terminalCwd = process.cwd();
let isYoloMode = false;

// --- Security Constants ---
const COMMAND_DENYLIST = ['rm -rf /', 'mkfs', 'dd', 'shutdown', 'reboot', 'format'];
const WORKSPACE_ROOT = path.resolve(process.cwd(), 'aetheros', 'workspace');
const AUDIT_LOG_PATH = path.resolve(process.cwd(), 'logs', 'subspace_comms.log');

// Ensure directories exist
if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
if (!fs.existsSync(path.dirname(AUDIT_LOG_PATH))) fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });

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

// --- API Endpoints ---

const activeTokens = new Set();
const CHAT_HISTORY_FILE = path.join(process.cwd(), 'chat_history.json');

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
        const interfaces = os.networkInterfaces();
        let ipAddress = '127.0.0.1';
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (!iface.internal && iface.family === 'IPv4') { ipAddress = iface.address; break; }
            }
            if (ipAddress !== '127.0.0.1') break;
        }

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
        } catch (e) { }

        res.json({
            cpuLoad, ramUsed, storageUsed: cachedStorage, containers,
            deployments: activeDeployments, ipAddress, dockerRunning,
            hostname: os.hostname(), osInfo: `${os.type()} ${os.release()}`,
            networkInbound, networkOutbound
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docker/action', async (req, res) => {
    try {
        const { id, action } = req.body;
        let cmd = `docker ${action} ${id}`;
        if (action === 'rm') cmd = `docker rm -f ${id}`;
        await execPromise(cmd);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docker/inspect', async (req, res) => {
    try {
        const { id } = req.body;
        const { stdout } = await execPromise(`docker inspect ${id}`);
        const c = JSON.parse(stdout)[0];
        const spec = {
            image: c.Config?.Image || '',
            name: c.Name ? c.Name.replace(/^\//, '') : '',
            ports: Object.keys(c.HostConfig?.PortBindings || {}).map(p => ({ host: c.HostConfig.PortBindings[p][0].HostPort, container: p.split('/')[0] })),
            volumes: c.Mounts?.map(m => ({ host: m.Source, container: m.Destination })) || [],
            env: c.Config?.Env?.map(e => { const [k, ...v] = e.split('='); return { key: k, value: v.join('=') }; }) || [],
            resources: { cpus: c.HostConfig?.NanoCpus ? String(c.HostConfig.NanoCpus / 1e9) : '', memory: c.HostConfig?.Memory ? Math.floor(c.HostConfig.Memory / 1e6) + 'm' : '' }
        };
        res.json(spec);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docker/logs', async (req, res) => {
    try {
        const { stdout, stderr } = await execPromise(`docker logs --tail 50 ${req.body.id}`);
        res.json({ logs: stdout + '\n' + stderr });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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
        const networkFlag = allowNetwork ? '' : '--network none ';
        const dockerCmd = `docker run --rm ${networkFlag}--memory="512m" --cpus="1.0" -v "${scriptDir}:/app/src" aetheros/dotnet-sandbox /bin/sh -c "dotnet run --project /app/src/Sandbox.csproj"`;

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
const CHAT_FILE = path.join(process.cwd(), 'chat_history.json');
app.get('/api/chat/load', (req, res) => {
    try { res.json(fs.existsSync(CHAT_FILE) ? JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')) : {}); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/chat/save', (req, res) => {
    try { fs.writeFileSync(CHAT_FILE, JSON.stringify(req.body, null, 2)); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docker/create', async (req, res) => {
    try {
        const { image, name, ports, volumes, env, resources } = req.body;
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

// SPA fallback for frontend
app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).send('Frontend not built. Run npm run build.');
});

app.listen(port, () => console.log(`AetherOS Backend running on port ${port}`));
