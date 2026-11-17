import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

export class CronManager {
    constructor(dependencies) {
        this.runAgentLoop = dependencies.runAgentLoop;
        this.agents = dependencies.agents;
        this.tools = dependencies.tools;
        this.getSettings = dependencies.getSettings;
        this.baseUrl = dependencies.baseUrl;
        this.internalToken = dependencies.internalToken;
        this.jobsFile = dependencies.jobsFile;
        this.activeJobs = new Map();
    }

    async init() {
        console.log('[CRON] Initializing Task Scheduling System...');
        this.loadAndSchedule();
    }

    loadJobs() {
        if (!fs.existsSync(this.jobsFile)) return [];
        try {
            return JSON.parse(fs.readFileSync(this.jobsFile, 'utf8'));
        } catch (e) {
            console.error('[CRON] Failed to load jobs:', e);
            return [];
        }
    }

    saveJobs(jobs) {
        const dir = path.dirname(this.jobsFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const serialized = JSON.stringify(jobs, null, 2);
        const tmpFile = `${this.jobsFile}.${process.pid}.${Date.now()}.tmp`;
        try {
            fs.writeFileSync(tmpFile, serialized, 'utf8');
            fs.renameSync(tmpFile, this.jobsFile);
        } catch {
            try {
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
            } catch { /* ignore cleanup error */ }
            fs.writeFileSync(this.jobsFile, serialized, 'utf8');
        }
    }

    updateJobStatus(id, patch) {
        const jobs = this.loadJobs();
        const index = jobs.findIndex(j => j.id === id);
        if (index !== -1) {
            jobs[index] = { ...jobs[index], ...patch };
            this.saveJobs(jobs);
            return jobs[index];
        }
        return null;
    }

    loadAndSchedule() {
        // Stop existing
        for (const job of this.activeJobs.values()) {
            job.stop();
        }
        this.activeJobs.clear();

        const jobs = this.loadJobs();
        for (const config of jobs) {
            if (config.enabled) {
                this.schedule(config);
            }
        }
        console.log(`[CRON] Scheduled ${this.activeJobs.size} active tasks.`);
    }

    async executeJob(config) {
        const startedAt = new Date().toISOString();
        console.log(`[CRON] [${startedAt}] Executing Task: ${config.name} (Agent: ${config.agentId})`);
        this.updateJobStatus(config.id, {
            lastRunAt: startedAt,
            lastStatus: 'running',
            lastError: null,
        });

        try {
            const settings = this.getSettings();
            const currentAgents = typeof this.agents === 'function' ? this.agents() : this.agents;
            const agent = currentAgents.find(a => a.id === config.agentId);

            if (!agent) throw new Error(`Agent ${config.agentId} not found`);

            const systemPrompt = settings.agentOverrides?.[agent.id]?.systemPrompt || agent.systemPrompt;

            const history = await this.runAgentLoop(
                config.agentId,
                config.prompt,
                systemPrompt,
                [],
                settings,
                this.tools,
                this.baseUrl,
                this.internalToken
            );

            const agentMessages = Array.isArray(history) ? history.filter(m => m.role === 'agent') : [];
            const lastMessage = agentMessages[agentMessages.length - 1]?.content || '';

            if (lastMessage.startsWith('⚠ BACKGROUND AGENT ERROR:')) {
                throw new Error(lastMessage.replace(/^⚠\s*BACKGROUND AGENT ERROR:\s*/, ''));
            }

            this.updateJobStatus(config.id, {
                lastRunAt: startedAt,
                lastStatus: 'success',
                lastError: null,
            });
            console.log(`[CRON] [${new Date().toISOString()}] Task Completed: ${config.name}`);

            return {
                success: true,
                jobId: config.id,
                name: config.name,
                lastRunAt: startedAt,
                lastStatus: 'success',
                lastError: null,
                output: lastMessage,
            };
        } catch (err) {
            this.updateJobStatus(config.id, {
                lastRunAt: startedAt,
                lastStatus: 'failed',
                lastError: err.message,
            });
            console.error(`[CRON] [${new Date().toISOString()}] Task Failed: ${config.name} - ${err.message}`);

            return {
                success: false,
                jobId: config.id,
                name: config.name,
                lastRunAt: startedAt,
                lastStatus: 'failed',
                lastError: err.message,
            };
        }
    }

    async runJobNow(id) {
        const jobs = this.loadJobs();
        const job = jobs.find(j => j.id === id);
        if (!job) {
            const err = new Error('Job not found');
            err.statusCode = 404;
            throw err;
        }
        return await this.executeJob(job);
    }

    schedule(config) {
        if (!cron.validate(config.schedule)) {
            console.error(`[CRON] Invalid cron expression for task ${config.name}: ${config.schedule}`);
            return;
        }

        try {
            const task = cron.schedule(config.schedule, async () => {
                await this.executeJob(config);
            });
            this.activeJobs.set(config.id, task);
        } catch (e) {
            console.error(`[CRON] Error scheduling task ${config.name}:`, e.message);
        }
    }

    addJob(job) {
        const jobs = this.loadJobs();
        jobs.push(job);
        this.saveJobs(jobs);
        if (job.enabled) this.schedule(job);
    }

    updateJob(updatedJob) {
        const jobs = this.loadJobs();
        const index = jobs.findIndex(j => j.id === updatedJob.id);
        if (index !== -1) {
            const oldTask = this.activeJobs.get(updatedJob.id);
            if (oldTask) oldTask.stop();
            this.activeJobs.delete(updatedJob.id);

            const prev = jobs[index];
            const merged = {
                ...prev,
                ...updatedJob,
                lastRunAt: updatedJob.lastRunAt !== undefined ? updatedJob.lastRunAt : prev.lastRunAt,
                lastStatus: updatedJob.lastStatus !== undefined ? updatedJob.lastStatus : prev.lastStatus,
                lastError: updatedJob.lastError !== undefined ? updatedJob.lastError : prev.lastError,
            };
            jobs[index] = merged;
            this.saveJobs(jobs);
            if (merged.enabled) this.schedule(merged);
        }
    }

    deleteJob(id) {
        const jobs = this.loadJobs();
        const filtered = jobs.filter(j => j.id !== id);
        this.saveJobs(filtered);

        const task = this.activeJobs.get(id);
        if (task) task.stop();
        this.activeJobs.delete(id);
    }
}
