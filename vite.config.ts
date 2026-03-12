import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { spawn } from 'child_process';

const execPromise = util.promisify(exec);

// Track ongoing docker-compose deployments
const activeDeployments: Array<{ id: string; name: string; status: string }> = [];
let terminalCwd = process.cwd();

// --- Tactical Monitoring ---
const statsHistory: Map<string, Array<{ cpu: number; mem: number; timestamp: number }>> = new Map();
let tacticalInsights: any[] = []; // Matches TacticalInsight interface

// --- Security Constants ---
const COMMAND_DENYLIST = ['rm -rf /', 'mkfs', 'dd', 'shutdown', 'reboot', 'format'];
const WORKSPACE_ROOT = path.resolve(process.cwd(), 'aetheros', 'workspace');
const AUDIT_LOG_PATH = path.resolve(process.cwd(), 'logs', 'subspace_comms.log');

// Ensure directories exist
if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
if (!fs.existsSync(path.dirname(AUDIT_LOG_PATH))) fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });

function auditLog(agent: string, action: string, params: any, success: boolean) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] AGENT: ${agent} | ACTION: ${action} | PARAMS: ${JSON.stringify(params)} | SUCCESS: ${success}\n`;
    fs.appendFileSync(AUDIT_LOG_PATH, logEntry);
}

function isPathSafe(targetPath: string) {
    const resolved = path.resolve(targetPath);
    return resolved.startsWith(WORKSPACE_ROOT);
}

const apiPlugin = () => {
  let previousCpus = os.cpus();
  let cachedStorage = 50;

  // Tactical Monitoring Loop
  const runTacticalMonitor = async () => {
    try {
      const { stdout } = await execPromise('docker stats --no-stream --format "{{json .}}"');
      const lines = stdout.trim().split('\n').filter(Boolean);
      const newInsights: any[] = [];
      const now = Date.now();

      for (const line of lines) {
        const stats = JSON.parse(line);
        const id = stats.ID;
        const name = stats.Name;
        // Parse "Percent" strings like "0.50%"
        const cpu = parseFloat(stats.CPUPerc.replace('%', ''));
        const mem = parseFloat(stats.MemPerc.replace('%', ''));

        if (!statsHistory.has(id)) statsHistory.set(id, []);
        const history = statsHistory.get(id)!;
        history.push({ cpu, mem, timestamp: now });
        if (history.length > 5) history.shift(); // Keep last 5 readings

        // Logic: Resource Saturation
        if (cpu > 85) {
          const highCpuCount = history.filter(h => h.cpu > 85).length;
          if (highCpuCount >= 3) {
            newInsights.push({
              id: `cpu-${id}-${now}`,
              type: 'resource',
              severity: 'high',
              message: `Tactical Alert: Container '${name}' showing critical CPU saturation (${cpu.toFixed(1)}%).`,
              suggestion: `Recommend throttling container resources or investigating logs for infinite loops.`,
              containerId: id,
              timestamp: new Date()
            });
          }
        }

        // Logic: Memory Leak detection
        if (mem > 90) {
          newInsights.push({
            id: `mem-${id}-${now}`,
            type: 'resource',
            severity: 'medium',
            message: `Warning: Container '${name}' memory usage at ${mem.toFixed(1)}%.`,
            suggestion: `Consider purging the isolinear chip (Restart) to clear cached memory.`,
            containerId: id,
            timestamp: new Date()
          });
        }
      }

      // Check for containers that disappeared but were in history
      // (Simplified for now, could be expanded)

      tacticalInsights = newInsights;
    } catch (e) {
      // Docker might not be running
    }
  };

  setInterval(runTacticalMonitor, 10000); // Pulse every 10 seconds
  runTacticalMonitor();

  // Poll storage occasionally to not block
  const updateStorage = async () => {
    try {
      const { stdout } = await execPromise('wmic logicaldisk get size,freespace,caption');
      const lines = stdout.split('\n');
      let total = 0;
      let free = 0;
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 3 && parts[0] === 'C:') {
          free += parseInt(parts[1], 10);
          total += parseInt(parts[2], 10);
        }
      }
      if (total > 0) {
        cachedStorage = ((total - free) / total) * 100;
      }
    } catch (e) {
      // Ignore or default
    }
  };

  // Update storage initially
  updateStorage();
  setInterval(updateStorage, 60000); // Once a minute

  const getBody = (req: any): Promise<any> => {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk.toString(); });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({}); }
      });
    });
  };

  return {
    name: 'api-plugin',
    configureServer(server: any) {
      server.middlewares.use('/api/docker/action', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const body = await getBody(req);
          const { id, action } = body;
          if (!['start', 'stop', 'restart', 'rm'].includes(action)) throw new Error('Invalid action');

          let cmd = `docker ${action} ${id}`;
          if (action === 'rm') cmd = `docker rm -f ${id}`;

          await execPromise(cmd);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/docker/inspect', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const body = await getBody(req);
          const { id } = body;
          if (!id) throw new Error('ID is required');

          const { stdout } = await execPromise(`docker inspect ${id}`);
          const configs = JSON.parse(stdout);
          if (!configs || configs.length === 0) throw new Error('Container not found');

          const c = configs[0];

          // Parse mounts (volumes)
          const volumes = c.Mounts?.map((m: any) => ({
            host: m.Source,
            container: m.Destination
          })) || [];

          // Parse ports
          const portsData = c.HostConfig?.PortBindings || {};
          const ports = Object.keys(portsData).map(internalPort => {
            const externalMappings = portsData[internalPort];
            if (!externalMappings || externalMappings.length === 0) return null;
            return {
              host: externalMappings[0].HostPort,
              container: internalPort.split('/')[0] // removing /tcp or /udp
            };
          }).filter(Boolean);

          // Parse env (often KEY=VALUE pairs)
          const env = c.Config?.Env?.map((e: string) => {
            const parts = e.split('=');
            return {
              key: parts[0],
              value: parts.slice(1).join('=')
            };
          }) || [];

          // Parse Resources
          const resources = {
            cpus: c.HostConfig?.NanoCpus ? String(c.HostConfig.NanoCpus / 1e9) : '',
            memory: c.HostConfig?.Memory ? Math.floor(c.HostConfig.Memory / (1024 * 1024)) + 'm' : ''
          };

          const spec = {
            image: c.Config?.Image || '',
            name: c.Name ? c.Name.replace(/^\//, '') : '',
            ports,
            volumes,
            env,
            resources
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(spec));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/docker/logs', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const body = await getBody(req);
          const { id } = body;
          if (!id) throw new Error('ID is required');

          const { stdout, stderr } = await execPromise(`docker logs --tail 50 ${id}`);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ logs: stdout + '\n' + stderr }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/docker/start-service', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          // Attempt to start Docker Desktop on Windows. This path may vary but is the default.
          await execPromise('powershell -Command "Start-Process \'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe\'"');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/store/apps', async (req: any, res: any) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const storeRoot = path.join(process.cwd(), 'Example Store');
          const apps: any[] = [];

          if (!fs.existsSync(storeRoot)) {
            fs.mkdirSync(storeRoot, { recursive: true });
          }

          function findComposeFiles(dir: string, depth: number): string[] {
            if (depth > 5) return [];
            let results: string[] = [];
            try {
              const list = fs.readdirSync(dir, { withFileTypes: true });
              for (const dirent of list) {
                const fullPath = path.join(dir, dirent.name);
                if (dirent.isDirectory()) {
                  results = results.concat(findComposeFiles(fullPath, depth + 1));
                } else if (dirent.name === 'docker-compose.yml' || dirent.name === 'docker-compose.yaml') {
                  results.push(fullPath);
                }
              }
            } catch (e) { }
            return results;
          }

          const composeFiles = findComposeFiles(storeRoot, 0);

          for (const composePath of composeFiles) {
            try {
              const content = fs.readFileSync(composePath, 'utf8');
              const parsed = YAML.parse(content);
              const casaos = parsed['x-casaos'];
              if (casaos) {
                const appDir = path.dirname(composePath);
                const dir = path.basename(appDir);
                // Also capture store provider name from path (e.g. 2 levels up from Apps folder)
                const relativePath = path.relative(storeRoot, appDir);
                const rawProvider = relativePath.split(path.sep)[0] || 'Unknown Store';

                // Format provider name to be pretty (e.g. store_linuxserver -> Linuxserver)
                let providerName = rawProvider;
                if (providerName.startsWith('store_')) {
                  providerName = providerName.substring(6);
                  providerName = providerName.charAt(0).toUpperCase() + providerName.slice(1);
                } else if (providerName === 'Apps' || providerName === '.') {
                  providerName = 'CasaOS Official';
                }

                apps.push({
                  id: dir + '-' + apps.length,
                  title: casaos.title?.en_us || dir,
                  tagline: casaos.tagline?.en_us || '',
                  description: casaos.description?.en_us || '',
                  icon: casaos.icon || '',
                  category: casaos.category || '',
                  developer: casaos.developer || providerName,
                  port_map: casaos.port_map || '',
                  path: appDir,
                  store: providerName
                });
              }
            } catch (e) { /* skip */ }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ apps }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/store/provider', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const body = await getBody(req);
          const { url } = body;
          if (!url || !url.startsWith('https://')) throw new Error('Valid secure URL is required');

          const storeRoot = path.join(process.cwd(), 'Example Store');
          if (!fs.existsSync(storeRoot)) fs.mkdirSync(storeRoot, { recursive: true });

          // Extract a pretty name from the URL filename
          const urlParts = url.split('/');
          let filename = urlParts[urlParts.length - 1] || 'custom_store';
          filename = filename.replace(/\.zip$/i, ''); // remove .zip
          filename = filename.replace(/[^a-zA-Z0-9_-]/g, ''); // sanitize

          const providerId = 'store_' + filename + '_' + Date.now();
          const targetDir = path.join(storeRoot, providerId);
          const zipPath = path.join(os.tmpdir(), providerId + '.zip');

          // Download and extract zip via powershell
          const cmd = `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'; Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force; Remove-Item -Path '${zipPath}'"`;

          await execPromise(cmd);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, provider: filename }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/store/compose/read', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const body = await getBody(req);
          const { appPath } = body;
          if (!appPath) throw new Error('appPath is required');
          if (!appPath.includes('Example Store')) throw new Error('Invalid path');

          const composePath = path.join(appPath, 'docker-compose.yml');
          if (!fs.existsSync(composePath)) throw new Error('docker-compose.yml not found');

          const composeData = fs.readFileSync(composePath, 'utf8');

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ composeData }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/store/deploy', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const body = await getBody(req);
          const { appPath, composeData } = body;
          if (!appPath) throw new Error('appPath is required');

          // Simple safety check
          if (!appPath.includes('Example Store')) throw new Error('Invalid path');

          if (composeData) {
            const composeFile = path.join(appPath, 'docker-compose.yml');
            fs.writeFileSync(composeFile, composeData, 'utf8');
          }

          const appName = path.basename(appPath);
          const deployId = `deploy-${Date.now()}`;

          activeDeployments.push({
            id: deployId,
            name: appName,
            status: 'Initializing deployment...'
          });

          // Run asynchronously so we don't block the UI while pulling large images
          const child = spawn('docker', ['compose', 'up', '-d'], {
            cwd: appPath,
            detached: true
          });

          let lastStatus = 'Starting containers...';

          child.stdout.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n').map((l: string) => l.trim()).filter(Boolean);
            if (lines.length > 0) {
              lastStatus = lines[lines.length - 1];
              const d = activeDeployments.find(d => d.id === deployId);
              if (d) d.status = lastStatus;
            }
          });

          child.stderr.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n').map((l: string) => l.trim()).filter(Boolean);
            if (lines.length > 0) {
              lastStatus = lines[lines.length - 1];
              const d = activeDeployments.find(d => d.id === deployId);
              if (d) d.status = lastStatus;
            }
          });

          child.on('close', () => {
            const idx = activeDeployments.findIndex(d => d.id === deployId);
            if (idx !== -1) activeDeployments.splice(idx, 1);
          });

          child.unref();

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, deployId }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/terminal/exec', async (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        try {
          const { command, agent = 'USER' } = await getBody(req);
          if (!command) return res.end(JSON.stringify({ output: '', cwd: terminalCwd }));

          // 1. Command Denylist Check
          const normalizedCmd = command.trim().toLowerCase();
          if (COMMAND_DENYLIST.some(blocked => normalizedCmd.includes(blocked))) {
              auditLog(agent, 'EXEC_BLOCKED', { command }, false);
              return res.end(JSON.stringify({ output: 'Error: Command violates Prime Directive. Self-Destruct blocked.', cwd: terminalCwd }));
          }

          if (command.trim().startsWith('cd ')) {
            const newPath = path.resolve(terminalCwd, command.trim().substring(3).trim());
            if (fs.existsSync(newPath) && fs.statSync(newPath).isDirectory()) {
              terminalCwd = newPath;
              return res.end(JSON.stringify({ output: `Directory changed to ${terminalCwd}`, cwd: terminalCwd }));
            } else {
              return res.end(JSON.stringify({ output: `Error: Directory not found: ${newPath}`, cwd: terminalCwd }));
            }
          }

          const { stdout, stderr } = await execPromise(command, {
            cwd: terminalCwd,
            shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash'
          }).catch(err => ({ stdout: err.stdout || '', stderr: err.stderr || err.message }));

          const output = (stdout + '\n' + stderr).trim();
          auditLog(agent, 'EXEC', { command }, true);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ output, cwd: terminalCwd }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message, cwd: terminalCwd }));
        }
      });

      // --- File System APIs ---
      server.middlewares.use('/api/fs/ls', async (req: any, res: any) => {
        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const targetPath = url.searchParams.get('path') || WORKSPACE_ROOT;

          if (!isPathSafe(targetPath)) throw new Error('Shields Offline: Sandbox violation detected.');
          if (!fs.existsSync(targetPath)) throw new Error('Path does not exist');
          const stats = fs.statSync(targetPath);
          if (!stats.isDirectory()) throw new Error('Path is not a directory');

          const files = fs.readdirSync(targetPath, { withFileTypes: true }).map(f => ({
            name: f.name,
            isDirectory: f.isDirectory(),
            size: f.isFile() ? fs.statSync(path.join(targetPath, f.name)).size : 0
          }));

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ files, currentPath: targetPath || process.cwd() }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/fs/read', async (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        try {
          const { path: targetPath } = await getBody(req);
          if (!targetPath) throw new Error('Path is required');
          const fullPath = path.resolve(targetPath);
          if (!fs.existsSync(fullPath)) throw new Error('File not found');

          const content = fs.readFileSync(fullPath, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ content }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/fs/write', async (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        try {
          const { path: targetPath, content } = await getBody(req);
          if (!targetPath) throw new Error('Path is required');
          const fullPath = path.resolve(targetPath);

          fs.writeFileSync(fullPath, content, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // --- Chat Persistence APIs ---
      const CHAT_HISTORY_FILE = path.join(process.cwd(), 'chat_history.json');

      server.middlewares.use('/api/chat/load', async (_req: any, res: any) => {
        try {
          let history = {};
          if (fs.existsSync(CHAT_HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(history));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/chat/save', async (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        try {
          const body = await getBody(req);
          fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(body, null, 2), 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/docker/create', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const body = await getBody(req);
          const { image, name, ports, volumes, env, resources } = body;
          if (!image) throw new Error('Image is required');

          let cmd = `docker run -d`;
          if (name) cmd += ` --name ${name}`;

          if (ports && Array.isArray(ports)) {
            ports.forEach((p: any) => cmd += ` -p ${p.host}:${p.container}`);
          }

          if (volumes && Array.isArray(volumes)) {
            volumes.forEach((v: any) => cmd += ` -v "${v.host}:${v.container}"`);
          }

          if (env && Array.isArray(env)) {
            env.forEach((e: any) => cmd += ` -e "${e.key}=${e.value}"`);
          }

          if (resources) {
            if (resources.cpus) cmd += ` --cpus="${resources.cpus}"`;
            if (resources.memory) cmd += ` -m "${resources.memory}"`;
          }

          cmd += ` ${image}`;

          const { stdout } = await execPromise(cmd);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, id: stdout.trim() }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/stats', async (_req: any, res: any) => {
        try {
          const currentCpus = os.cpus();
          let totalIdle = 0, totalTick = 0;
          let prevTotalIdle = 0, prevTotalTick = 0;

          currentCpus.forEach((cpu, i) => {
            for (const type in cpu.times) {
              totalTick += (cpu.times as any)[type];
            }
            totalIdle += cpu.times.idle;

            if (previousCpus[i]) {
              for (const type in previousCpus[i].times) {
                prevTotalTick += (previousCpus[i].times as any)[type];
              }
              prevTotalIdle += previousCpus[i].times.idle;
            }
          });

          const idle = totalIdle - prevTotalIdle;
          const total = totalTick - prevTotalTick;
          let cpuLoad = total > 0 ? 100 - (100 * idle / total) : 0;
          previousCpus = currentCpus;

          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const ramUsed = ((totalMem - freeMem) / totalMem) * 100;

          // Network Tracking
          let networkInbound = 0;
          let networkOutbound = 0;
          try {
            const { stdout } = await execPromise('netstat -e');
            const lines = stdout.trim().split('\n');
            if (lines.length >= 3) {
              const byteLine = lines[2].trim().split(/\s+/);
              if (byteLine.length >= 3) {
                // netstat -e values are cumulative bytes
                // For a true Gbps/Mbps we'd need a delta over time, but for the scope 
                // of this update, we will simply pass the raw byte differential 
                // compared to the server's start, or pass raw bytes and let UI handle it.
                // Let's pass the raw bytes for now and we will calculate Mbps in the UI 
                // using a React ref to track the delta between 1-second polls.
                networkInbound = parseInt(byteLine[1], 10);
                networkOutbound = parseInt(byteLine[2], 10);
              }
            }
          } catch (e) { /* ignore netstat errors */ }

          // IP Address Extraction
          const interfaces = os.networkInterfaces();
          let ipAddress = '127.0.0.1';
          for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
              // Skip internal and non-ipv4 addresses
              if (!iface.internal && iface.family === 'IPv4') {
                ipAddress = iface.address;
                break;
              }
            }
            if (ipAddress !== '127.0.0.1') break;
          }

          let containers: any[] = [];
          let dockerRunning = false;
          try {
            const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
            dockerRunning = true;
            const lines = stdout.trim().split('\n').filter(l => l);
            containers = lines.map(line => {
              const c = JSON.parse(line);
              let status = 'failed';
              if (c.State === 'running') status = 'running';
              else if (c.State === 'restarting') status = 'restarting';
              else if (c.State === 'exited' || c.State === 'dead') status = 'stopped';

              return {
                id: c.ID,
                name: c.Names,
                status: status,
                uptime: c.Status
              };
            });
          } catch (e) { /* ignores missing docker, sets dockerRunning false */ }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            cpuLoad,
            ramUsed,
            storageUsed: cachedStorage,
            containers,
            deployments: activeDeployments,
            hostname: os.hostname(),
            osInfo: `${os.type()} ${os.release()}`,
            ipAddress,
            dockerRunning,
            networkInbound,
            networkOutbound,
            insights: tacticalInsights
          }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
  };
};

export default defineConfig({
  plugins: [react(), apiPlugin()],
});
