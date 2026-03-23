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
        fs.writeFileSync(this.jobsFile, JSON.stringify(jobs, null, 2));
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

    schedule(config) {
        if (!cron.validate(config.schedule)) {
            console.error(`[CRON] Invalid cron expression for task ${config.name}: ${config.schedule}`);
            return;
        }

        try {
            const task = cron.schedule(config.schedule, async () => {
                const now = new Date().toISOString();
                console.log(`[CRON] [${now}] Executing Task: ${config.name} (Agent: ${config.agentId})`);
                
                try {
                    const settings = this.getSettings();
                    // Inject specific tool instructions if needed, but runAgentLoop handles standard tools
                    // We need the latest agents/tools from the dependencies
                    const currentAgents = this.agents(); // Assume a getter function if they change
                    const agent = currentAgents.find(a => a.id === config.agentId);
                    
                    if (!agent) throw new Error(`Agent ${config.agentId} not found`);

                    await this.runAgentLoop(
                        config.agentId,
                        config.prompt,
                        agent.systemPrompt,
                        [], // Clean history for each cron run
                        settings,
                        this.tools,
                        this.baseUrl,
                        this.internalToken
                    );
                    console.log(`[CRON] [${new Date().toISOString()}] Task Completed: ${config.name}`);
                } catch (err) {
                    console.error(`[CRON] [${new Date().toISOString()}] Task Failed: ${config.name} - ${err.message}`);
                }
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
            // Stop old
            const oldTask = this.activeJobs.get(updatedJob.id);
            if (oldTask) oldTask.stop();
            this.activeJobs.delete(updatedJob.id);

            jobs[index] = updatedJob;
            this.saveJobs(jobs);
            if (updatedJob.enabled) this.schedule(updatedJob);
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
