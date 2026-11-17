import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import util from 'util';
import { execFile, spawn } from 'child_process';

const execFileAsync = util.promisify(execFile);

export const PROTECTED_CONTAINERS = [
    'aetheros-dashboard',
    'aetheros-updater',
    'docker-socket-proxy',
];

export const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const COMPOSE_FILES = ['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'];
const MAX_HISTORY_ENTRIES = 100;

const DEFAULT_CONFIG = {
    globalEnabled: true,
    defaultSchedule: '0 3 * * *',
    pruneDanglingImages: true,
};

function createHttpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

export function validateContainerRef(nameOrId) {
    const clean = String(nameOrId || '').trim().replace(/^\//, '');
    if (!clean || !CONTAINER_NAME_RE.test(clean)) {
        throw createHttpError(400, `Invalid container identifier: '${nameOrId || ''}'`);
    }
    return clean;
}

export function isProtectedContainer(name, labels) {
    const clean = String(name || '').trim().replace(/^\//, '');
    if (PROTECTED_CONTAINERS.includes(clean)) return true;

    if (labels && typeof labels === 'object') {
        const project = labels['com.docker.compose.project'];
        const service = labels['com.docker.compose.service'];
        if (project === 'aetheros' && PROTECTED_CONTAINERS.includes(service)) {
            return true;
        }
    } else if (typeof labels === 'string' && labels) {
        const pairs = labels.split(',');
        let project = '';
        let service = '';
        for (const pair of pairs) {
            const idx = pair.indexOf('=');
            if (idx === -1) continue;
            const k = pair.slice(0, idx).trim();
            const v = pair.slice(idx + 1).trim();
            if (k === 'com.docker.compose.project') project = v;
            if (k === 'com.docker.compose.service') service = v;
        }
        if (project === 'aetheros' && PROTECTED_CONTAINERS.includes(service)) {
            return true;
        }
    }
    return false;
}

export function isValidCronExpression(expr) {
    return typeof expr === 'string' && expr.trim().length > 0 && cron.validate(expr.trim());
}

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

export function buildDockerRunArgs(raw, cleanName) {
    const args = ['run', '-d', '--name', cleanName];

    const restartName = raw.HostConfig?.RestartPolicy?.Name;
    const maxRetry = raw.HostConfig?.RestartPolicy?.MaximumRetryCount || 0;
    if (restartName && restartName !== 'no') {
        args.push(
            '--restart',
            restartName === 'on-failure' && maxRetry > 0 ? `${restartName}:${maxRetry}` : restartName
        );
    }

    if (raw.Config?.WorkingDir) {
        args.push('--workdir', raw.Config.WorkingDir);
    }
    if (raw.Config?.User) {
        args.push('--user', raw.Config.User);
    }

    const netMode = raw.HostConfig?.NetworkMode || '';
    const networksObj = raw.NetworkSettings?.Networks || {};
    const networkNames = Object.keys(networksObj);
    const isHostNet = netMode === 'host';
    const isNoneNet = netMode === 'none';
    const isContainerNet = netMode.startsWith('container:');

    if (!isHostNet && !isNoneNet && !isContainerNet) {
        const portBindings = raw.HostConfig?.PortBindings || {};
        for (const [containerPortProto, bindings] of Object.entries(portBindings)) {
            if (!Array.isArray(bindings)) continue;
            for (const binding of bindings) {
                const hostPort = binding?.HostPort ? String(binding.HostPort) : '';
                let hostIp = binding?.HostIp ? String(binding.HostIp) : '';
                if (hostIp && hostIp.includes(':') && !hostIp.startsWith('[')) {
                    hostIp = `[${hostIp}]`;
                }
                if (hostIp && hostPort) {
                    args.push('-p', `${hostIp}:${hostPort}:${containerPortProto}`);
                } else if (hostIp) {
                    args.push('-p', `${hostIp}::${containerPortProto}`);
                } else if (hostPort) {
                    args.push('-p', `${hostPort}:${containerPortProto}`);
                } else {
                    args.push('-p', containerPortProto);
                }
            }
        }
    }

    for (const m of (raw.Mounts || [])) {
        if (m.Type === 'bind' || m.Type === 'volume') {
            const source = m.Type === 'volume' ? (m.Name || m.Source) : m.Source;
            const dest = m.Destination;
            if (!source || !dest) continue;
            const isRo = m.RW === false || (typeof m.Mode === 'string' && m.Mode.split(',').includes('ro'));
            args.push('-v', isRo ? `${source}:${dest}:ro` : `${source}:${dest}`);
        } else if (m.Type === 'tmpfs' && m.Destination) {
            args.push('--tmpfs', m.Destination);
        }
    }

    for (const envEntry of (raw.Config?.Env || [])) {
        if (typeof envEntry === 'string' && envEntry.length > 0) {
            args.push('-e', envEntry);
        }
    }

    const labelsObj = raw.Config?.Labels || {};
    if (Object.keys(labelsObj).length > 0) {
        for (const [k, v] of Object.entries(labelsObj)) {
            if (k) {
                args.push('--label', `${k}=${v ?? ''}`);
            }
        }
    }

    if (raw.HostConfig?.NanoCpus > 0) {
        args.push('--cpus', String(raw.HostConfig.NanoCpus / 1e9));
    }
    if (raw.HostConfig?.Memory > 0) {
        args.push('-m', String(raw.HostConfig.Memory));
    }
    if (raw.HostConfig?.Privileged === true) {
        args.push('--privileged');
    }
    for (const cap of (raw.HostConfig?.CapAdd || [])) {
        if (cap) args.push('--cap-add', cap);
    }
    for (const cap of (raw.HostConfig?.CapDrop || [])) {
        if (cap) args.push('--cap-drop', cap);
    }
    for (const host of (raw.HostConfig?.ExtraHosts || [])) {
        if (host) args.push('--add-host', host);
    }

    let primaryNet = '';
    let secondaryNetworks = [];
    const fullId = raw.Id || '';
    const shortId = fullId.substring(0, 12);

    if (isHostNet || isNoneNet || isContainerNet) {
        primaryNet = netMode;
        args.push('--network', primaryNet);
    } else {
        primaryNet = (netMode && netMode !== 'default' && (networkNames.includes(netMode) || netMode === 'bridge'))
            ? netMode
            : (networkNames[0] || netMode || '');

        if (primaryNet && primaryNet !== 'default') {
            args.push('--network', primaryNet);
            if (primaryNet !== 'bridge' && primaryNet !== 'host' && primaryNet !== 'none') {
                const aliases = networksObj[primaryNet]?.Aliases || [];
                for (const alias of aliases) {
                    if (alias && alias !== fullId && alias !== shortId) {
                        args.push('--network-alias', alias);
                    }
                }
            }
        }

        secondaryNetworks = networkNames
            .filter(n => n !== primaryNet && n !== 'default' && n !== 'host' && n !== 'none')
            .map(n => ({
                name: n,
                aliases: (networksObj[n]?.Aliases || []).filter(a => a && a !== fullId && a !== shortId),
            }));
    }

    const extraEntrypointArgs = [];
    if (Array.isArray(raw.Config?.Entrypoint) && raw.Config.Entrypoint.length > 0) {
        args.push('--entrypoint', raw.Config.Entrypoint[0]);
        if (raw.Config.Entrypoint.length > 1) {
            extraEntrypointArgs.push(...raw.Config.Entrypoint.slice(1));
        }
    } else if (typeof raw.Config?.Entrypoint === 'string' && raw.Config.Entrypoint) {
        args.push('--entrypoint', raw.Config.Entrypoint);
    }

    const image = raw.Config?.Image || '';
    args.push(image);

    if (extraEntrypointArgs.length > 0) {
        args.push(...extraEntrypointArgs);
    }
    if (Array.isArray(raw.Config?.Cmd) && raw.Config.Cmd.length > 0) {
        args.push(...raw.Config.Cmd);
    } else if (typeof raw.Config?.Cmd === 'string' && raw.Config.Cmd) {
        args.push(raw.Config.Cmd);
    }

    return { args, secondaryNetworks };
}

function runComposeRecreate(workingDir, service, activeDeployments, deployId) {
    return new Promise((resolve, reject) => {
        const child = spawn('docker', ['compose', 'up', '-d', '--no-deps', '--force-recreate', service], {
            cwd: workingDir,
        });
        let stderrBuf = '';
        let stdoutBuf = '';

        const updateStatus = (chunk) => {
            const text = chunk.toString();
            const line = text.split('\n').filter(Boolean).pop();
            if (line && Array.isArray(activeDeployments)) {
                const entry = activeDeployments.find(d => d.id === deployId);
                if (entry) entry.status = line;
            }
        };

        child.stdout.on('data', (data) => {
            stdoutBuf += data.toString();
            updateStatus(data);
        });
        child.stderr.on('data', (data) => {
            stderrBuf += data.toString();
            updateStatus(data);
        });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
            if (code === 0) resolve({ stdout: stdoutBuf, stderr: stderrBuf });
            else reject(new Error(stderrBuf.trim() || stdoutBuf.trim() || `docker compose exited with code ${code}`));
        });
    });
}

export class ContainerUpdater {
    constructor(options = {}) {
        this.stateFile = options.stateFile || path.join(process.cwd(), 'data', 'container_updates.json');
        this.activeDeployments = options.activeDeployments || null;
        this.onUpdated = options.onUpdated || null;
        this.onFailed = options.onFailed || null;
        this.auditLog = options.auditLog || null;

        this.state = {
            config: { ...DEFAULT_CONFIG },
            policies: {},
            history: [],
        };
        this.globalTask = null;
        this.customTasks = new Map();
        this.inFlight = new Set();
    }

    init() {
        this.loadState();
        this.rescheduleAll();
    }

    loadState() {
        if (!fs.existsSync(this.stateFile)) {
            this.state = {
                config: { ...DEFAULT_CONFIG },
                policies: {},
                history: [],
            };
            this.saveState();
            return this.state;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            this.state = {
                config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
                policies: parsed.policies && typeof parsed.policies === 'object' ? parsed.policies : {},
                history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_HISTORY_ENTRIES) : [],
            };
        } catch (err) {
            console.error('[ContainerUpdater] Failed to parse state file, using defaults:', err.message);
            this.state = {
                config: { ...DEFAULT_CONFIG },
                policies: {},
                history: [],
            };
        }
        return this.state;
    }

    saveState() {
        writeJsonAtomic(this.stateFile, this.state);
    }

    getState() {
        return {
            config: { ...this.state.config },
            policies: { ...this.state.policies },
            history: [...this.state.history],
        };
    }

    getPolicy(containerName) {
        const clean = String(containerName || '').trim().replace(/^\//, '');
        return this.state.policies[clean] || {
            enabled: false,
            scheduleMode: 'global',
            cronExpression: '',
        };
    }

    rescheduleAll() {
        if (this.globalTask) {
            this.globalTask.stop();
            this.globalTask = null;
        }
        for (const task of this.customTasks.values()) {
            task.stop();
        }
        this.customTasks.clear();

        if (this.state.config.globalEnabled && isValidCronExpression(this.state.config.defaultSchedule)) {
            this.globalTask = cron.schedule(this.state.config.defaultSchedule.trim(), async () => {
                await this.runScheduledGlobal();
            });
        }

        for (const [name, policy] of Object.entries(this.state.policies)) {
            if (
                policy &&
                policy.enabled === true &&
                policy.scheduleMode === 'custom' &&
                isValidCronExpression(policy.cronExpression) &&
                !isProtectedContainer(name)
            ) {
                const task = cron.schedule(policy.cronExpression.trim(), async () => {
                    try {
                        await this.redeployContainer(name, {
                            pullFirst: true,
                            onlyIfNewer: true,
                            trigger: 'scheduled',
                        });
                    } catch (err) {
                        console.error(`[ContainerUpdater] Custom scheduled update failed for ${name}:`, err.message);
                    }
                });
                this.customTasks.set(name, task);
            }
        }
    }

    async runScheduledGlobal() {
        const targets = Object.entries(this.state.policies)
            .filter(([name, p]) => p && p.enabled === true && p.scheduleMode === 'global' && !isProtectedContainer(name))
            .map(([name]) => name);

        if (targets.length === 0) return [];

        const results = [];
        let anyUpdated = false;
        for (const name of targets) {
            try {
                const result = await this.redeployContainer(name, {
                    pullFirst: true,
                    onlyIfNewer: true,
                    trigger: 'scheduled',
                    skipPrune: true,
                });
                if (result.updated) anyUpdated = true;
                results.push(result);
            } catch (err) {
                results.push({ containerName: name, updated: false, status: 'failed', message: err.message });
            }
        }

        if (anyUpdated && this.state.config.pruneDanglingImages) {
            await this.pruneDanglingImagesSafely();
        }

        return results;
    }

    async pruneDanglingImagesSafely() {
        try {
            await execFileAsync('docker', ['image', 'prune', '-f'], { timeout: 60000 });
        } catch (err) {
            console.warn('[ContainerUpdater] Dangling image prune skipped/failed:', err.message);
        }
    }

    setGlobalConfig({ globalEnabled, defaultSchedule, pruneDanglingImages }) {
        if (defaultSchedule !== undefined) {
            if (!isValidCronExpression(defaultSchedule)) {
                throw createHttpError(400, `Invalid cron expression: '${defaultSchedule}'`);
            }
            this.state.config.defaultSchedule = defaultSchedule.trim();
        }
        if (globalEnabled !== undefined) {
            this.state.config.globalEnabled = Boolean(globalEnabled);
        }
        if (pruneDanglingImages !== undefined) {
            this.state.config.pruneDanglingImages = Boolean(pruneDanglingImages);
        }

        this.saveState();
        this.rescheduleAll();
        return { ...this.state.config };
    }

    setContainerPolicy(name, { enabled, scheduleMode, cronExpression }) {
        const cleanName = validateContainerRef(name);
        if (isProtectedContainer(cleanName) && enabled) {
            throw createHttpError(403, `Protected container '${cleanName}' cannot be enabled for auto-updates.`);
        }

        const existing = this.state.policies[cleanName] || {
            enabled: false,
            scheduleMode: 'global',
            cronExpression: '',
        };

        const nextMode = scheduleMode !== undefined ? scheduleMode : existing.scheduleMode;
        if (nextMode !== 'global' && nextMode !== 'custom') {
            throw createHttpError(400, `Invalid scheduleMode: '${nextMode}'. Must be 'global' or 'custom'.`);
        }

        const nextCron = cronExpression !== undefined ? String(cronExpression).trim() : (existing.cronExpression || '');
        if (nextMode === 'custom') {
            if (!isValidCronExpression(nextCron)) {
                throw createHttpError(400, `Invalid custom cron expression: '${nextCron}'`);
            }
        } else if (cronExpression !== undefined && nextCron !== '' && !isValidCronExpression(nextCron)) {
            throw createHttpError(400, `Invalid cron expression: '${nextCron}'`);
        }

        const updatedPolicy = {
            ...existing,
            enabled: enabled !== undefined ? Boolean(enabled) : Boolean(existing.enabled),
            scheduleMode: nextMode,
            cronExpression: nextCron,
        };

        if (isProtectedContainer(cleanName)) {
            updatedPolicy.enabled = false;
        }

        this.state.policies[cleanName] = updatedPolicy;
        this.saveState();
        this.rescheduleAll();
        return updatedPolicy;
    }

    appendHistory(entry) {
        this.state.history.unshift(entry);
        if (this.state.history.length > MAX_HISTORY_ENTRIES) {
            this.state.history.length = MAX_HISTORY_ENTRIES;
        }
    }

    async runEnabledUpdates({ containerName, forceRecreate = false, trigger = 'manual' } = {}) {
        if (containerName) {
            const clean = validateContainerRef(containerName);
            const res = await this.redeployContainer(clean, {
                pullFirst: true,
                onlyIfNewer: !forceRecreate,
                trigger,
            });
            return {
                results: [res],
                history: [...this.state.history],
            };
        }

        const targets = Object.entries(this.state.policies)
            .filter(([name, p]) => p && p.enabled === true && !isProtectedContainer(name))
            .map(([name]) => name);

        const results = [];
        let anyUpdated = false;
        for (const name of targets) {
            try {
                const res = await this.redeployContainer(name, {
                    pullFirst: true,
                    onlyIfNewer: !forceRecreate,
                    trigger,
                    skipPrune: true,
                });
                if (res.updated) anyUpdated = true;
                results.push(res);
            } catch (err) {
                results.push({
                    containerName: name,
                    updated: false,
                    status: 'failed',
                    message: err.message,
                });
            }
        }

        if (anyUpdated && this.state.config.pruneDanglingImages) {
            await this.pruneDanglingImagesSafely();
        }

        return {
            results,
            history: [...this.state.history],
        };
    }

    async redeployContainer(nameOrId, options = {}) {
        const {
            pullFirst = false,
            onlyIfNewer = false,
            trigger = 'manual',
            activeDeployments = this.activeDeployments,
            onUpdated = this.onUpdated,
            onFailed = this.onFailed,
            skipPrune = false,
        } = options;

        const target = validateContainerRef(nameOrId);
        if (isProtectedContainer(target)) {
            const msg = `Security Protocol Violation: Redeploy of core module '${target}' is blocked to prevent system blackout.`;
            this.auditLog?.('SYSTEM', 'DOCKER_REDEPLOY_BLOCKED', { id: target }, false);
            throw createHttpError(403, msg);
        }

        const startedAt = new Date().toISOString();
        let cleanName = target;
        let image = '';
        let oldImageId = '';
        let newImageId = '';

        let inspectOut = '';
        try {
            ({ stdout: inspectOut } = await execFileAsync('docker', ['inspect', '--format', '{{json .}}', target]));
        } catch (err) {
            throw createHttpError(404, `Container '${target}' does not exist or Docker is unavailable: ${err.message}`);
        }

        const raw = JSON.parse(inspectOut.trim());
        oldImageId = raw.Image || '';
        image = raw.Config?.Image || '';
        cleanName = (raw.Name || target).replace(/^\//, '');
        const labels = raw.Config?.Labels || {};
        const wasRunning = Boolean(raw.State?.Running);

        if (isProtectedContainer(cleanName, labels)) {
            const msg = `Security Protocol Violation: Redeploy of core module '${cleanName}' is blocked to prevent system blackout.`;
            this.auditLog?.('SYSTEM', 'DOCKER_REDEPLOY_BLOCKED', { id: cleanName }, false);
            throw createHttpError(403, msg);
        }

        if (!image) {
            throw createHttpError(400, `Container '${cleanName}' does not have an image reference.`);
        }

        if (this.inFlight.has(cleanName)) {
            throw createHttpError(409, `Redeploy already in progress for '${cleanName}'.`);
        }

        this.inFlight.add(cleanName);
        const deployId = `redeploy-${cleanName}-${Date.now()}`;
        if (Array.isArray(activeDeployments)) {
            activeDeployments.push({
                id: deployId,
                name: `Redeploy: ${cleanName}`,
                status: pullFirst ? `Pulling ${image}...` : 'Preparing redeploy...',
            });
        }

        const setDeployStatus = (statusText) => {
            if (!Array.isArray(activeDeployments)) return;
            const entry = activeDeployments.find(d => d.id === deployId);
            if (entry) entry.status = statusText;
        };

        try {
            newImageId = oldImageId;

            if (pullFirst) {
                setDeployStatus(`Pulling ${image}...`);
                await execFileAsync('docker', ['pull', image], { maxBuffer: 10 * 1024 * 1024 });
                const { stdout: imgIdOut } = await execFileAsync('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
                newImageId = imgIdOut.trim() || oldImageId;
            } else {
                try {
                    const { stdout: imgIdOut } = await execFileAsync('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
                    if (imgIdOut.trim()) newImageId = imgIdOut.trim();
                } catch { /* fallback to oldImageId */ }
            }

            if (onlyIfNewer && newImageId === oldImageId) {
                const finishedAt = new Date().toISOString();
                const message = 'Already running latest image';
                const existingPolicy = this.getPolicy(cleanName);
                this.state.policies[cleanName] = {
                    ...existingPolicy,
                    lastCheckedAt: finishedAt,
                    lastStatus: 'up-to-date',
                    lastMessage: message,
                    lastImageId: newImageId,
                };
                this.appendHistory({
                    id: crypto.randomUUID(),
                    containerName: cleanName,
                    image,
                    trigger,
                    startedAt,
                    finishedAt,
                    status: 'up-to-date',
                    oldImageId,
                    newImageId,
                    message,
                });
                this.saveState();
                this.auditLog?.('SYSTEM', 'DOCKER_AUTO_UPDATE_CHECK', { id: cleanName, status: 'up-to-date' }, true);
                try {
                    await onUpdated?.({ containerName: cleanName, image, newImageId });
                } catch { /* ignore hook errors */ }

                return {
                    updated: false,
                    status: 'up-to-date',
                    containerName: cleanName,
                    image,
                    oldImageId,
                    newImageId,
                    message,
                };
            }

            // Determine recreate strategy: Strategy A (Compose) vs Strategy B (Universal fallback)
            const workingDir = labels['com.docker.compose.project.working_dir'];
            const service = labels['com.docker.compose.service'];
            const hasLocalCompose = Boolean(
                workingDir &&
                service &&
                fs.existsSync(workingDir) &&
                COMPOSE_FILES.some(file => fs.existsSync(path.join(workingDir, file)))
            );

            let strategy = 'standalone';
            if (hasLocalCompose) {
                strategy = 'compose';
                setDeployStatus(`Recreating Compose service ${service}...`);
                await runComposeRecreate(workingDir, service, activeDeployments, deployId);
            } else {
                strategy = 'standalone';
                const { args, secondaryNetworks } = buildDockerRunArgs(raw, cleanName);
                const backupName = `${cleanName}-prev-${Date.now()}`;
                let stopped = false;
                let renamed = false;

                try {
                    if (wasRunning) {
                        setDeployStatus(`Stopping ${cleanName}...`);
                        await execFileAsync('docker', ['stop', cleanName]);
                        stopped = true;
                    }

                    setDeployStatus(`Renaming ${cleanName} to ${backupName}...`);
                    await execFileAsync('docker', ['rename', cleanName, backupName]);
                    renamed = true;

                    setDeployStatus(`Starting updated ${cleanName}...`);
                    const { stdout: newIdOut } = await execFileAsync('docker', args);
                    const newContainerId = newIdOut.trim() || cleanName;

                    for (const secNet of secondaryNetworks) {
                        const connectArgs = ['network', 'connect'];
                        for (const alias of secNet.aliases) {
                            connectArgs.push('--alias', alias);
                        }
                        connectArgs.push(secNet.name, newContainerId);
                        try {
                            await execFileAsync('docker', connectArgs);
                        } catch (netErr) {
                            console.warn(`[ContainerUpdater] Failed attaching secondary network ${secNet.name} to ${cleanName}:`, netErr.message);
                        }
                    }

                    try {
                        await execFileAsync('docker', ['rm', '-f', backupName]);
                    } catch (rmErr) {
                        console.warn(`[ContainerUpdater] Failed removing backup container ${backupName}:`, rmErr.message);
                    }
                } catch (recreateErr) {
                    if (renamed) {
                        try {
                            await execFileAsync('docker', ['rename', backupName, cleanName]);
                        } catch (rbErr) {
                            console.error(`[ContainerUpdater] Rollback rename failed for ${cleanName}:`, rbErr.message);
                        }
                    }
                    if (wasRunning && (stopped || renamed)) {
                        try {
                            await execFileAsync('docker', ['start', cleanName]);
                        } catch (stErr) {
                            console.error(`[ContainerUpdater] Rollback start failed for ${cleanName}:`, stErr.message);
                        }
                    }
                    throw recreateErr;
                }
            }

            try {
                const { stdout: updatedInspect } = await execFileAsync('docker', ['inspect', '--format', '{{.Image}}', cleanName]);
                if (updatedInspect.trim()) newImageId = updatedInspect.trim();
            } catch { /* keep computed newImageId */ }

            const finishedAt = new Date().toISOString();
            const message = `Redeployed via ${strategy} (${image})`;
            const existingPolicy = this.getPolicy(cleanName);
            this.state.policies[cleanName] = {
                ...existingPolicy,
                lastCheckedAt: finishedAt,
                lastUpdatedAt: finishedAt,
                lastStatus: 'updated',
                lastMessage: message,
                lastImageId: newImageId,
            };

            this.appendHistory({
                id: crypto.randomUUID(),
                containerName: cleanName,
                image,
                trigger,
                startedAt,
                finishedAt,
                status: 'updated',
                oldImageId,
                newImageId,
                message,
            });
            this.saveState();

            if (!skipPrune && this.state.config.pruneDanglingImages && trigger === 'scheduled') {
                await this.pruneDanglingImagesSafely();
            }

            this.auditLog?.('SYSTEM', 'DOCKER_REDEPLOY', { id: cleanName, image, strategy, trigger }, true);

            try {
                await onUpdated?.({ containerName: cleanName, image, newImageId });
            } catch { /* ignore hook errors */ }

            return {
                updated: true,
                status: 'updated',
                containerName: cleanName,
                image,
                oldImageId,
                newImageId,
                strategy,
                message,
            };
        } catch (err) {
            const finishedAt = new Date().toISOString();
            const existingPolicy = this.getPolicy(cleanName);
            this.state.policies[cleanName] = {
                ...existingPolicy,
                lastCheckedAt: finishedAt,
                lastStatus: 'failed',
                lastMessage: err.message,
                lastImageId: oldImageId || existingPolicy.lastImageId,
            };
            this.appendHistory({
                id: crypto.randomUUID(),
                containerName: cleanName,
                image,
                trigger,
                startedAt,
                finishedAt,
                status: 'failed',
                oldImageId,
                newImageId: newImageId || oldImageId,
                message: err.message,
            });
            this.saveState();
            this.auditLog?.('SYSTEM', 'DOCKER_REDEPLOY_FAILED', { id: cleanName, error: err.message, trigger }, false);

            try {
                await onFailed?.({ containerName: cleanName, image, error: err.message, trigger });
            } catch { /* ignore hook errors */ }

            throw err;
        } finally {
            this.inFlight.delete(cleanName);
            if (Array.isArray(activeDeployments)) {
                const idx = activeDeployments.findIndex(d => d.id === deployId);
                if (idx !== -1) activeDeployments.splice(idx, 1);
            }
        }
    }
}
