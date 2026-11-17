import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { getAllAgents } from '../../agents';
import { useAppContext } from '../../context/useAppContext';
import type { CronJob } from '../../types';

const CRON_PRESETS: { label: string; expr: string }[] = [
    { label: 'Every hour', expr: '0 * * * *' },
    { label: 'Nightly 03:00', expr: '0 3 * * *' },
    { label: 'Daily 08:00', expr: '0 8 * * *' },
    { label: 'Weekly Mon 08:00', expr: '0 8 * * 1' },
];

const EMPTY_JOB: Partial<CronJob> = {
    name: '',
    schedule: '0 8 * * *',
    agentId: 'nav',
    prompt: '',
    enabled: true,
};

function formatLastRun(timestamp?: string): string {
    if (!timestamp) return 'Never run';
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return timestamp;
    return parsed.toLocaleString();
}

function getStatusBadgeClass(status?: CronJob['lastStatus']): string {
    if (status === 'success') return 'kai-badge kai-badge-success';
    if (status === 'failed') return 'kai-badge kai-badge-danger';
    if (status === 'running') return 'kai-badge kai-badge-warning';
    return 'kai-badge';
}

export default function CronManager() {
    const { state } = useAppContext();
    const [jobs, setJobs] = useState<CronJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [currentJob, setCurrentJob] = useState<Partial<CronJob>>(EMPTY_JOB);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [runningJobId, setRunningJobId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const agents = getAllAgents(state.settings.agentOverrides);

    const fetchJobs = useCallback(async () => {
        try {
            const res = await apiFetch('/api/cron/jobs');
            if (res.ok) {
                const data: unknown = await res.json();
                setJobs(Array.isArray(data) ? (data as CronJob[]) : []);
            }
        } catch (err: unknown) {
            console.error('Failed to fetch cron jobs:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchJobs();
    }, [fetchJobs]);

    const handleSave = async () => {
        if (!currentJob.name?.trim() || !currentJob.schedule?.trim() || !currentJob.prompt?.trim()) {
            setError('Task name, cron expression, and prompt are required.');
            return;
        }
        setError(null);
        setFeedback(null);
        try {
            const res = await apiFetch('/api/cron/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentJob),
            });
            if (res.ok) {
                await fetchJobs();
                setIsEditing(false);
                setCurrentJob(EMPTY_JOB);
                setFeedback({ type: 'success', message: 'Scheduled job saved.' });
            } else {
                const data = (await res.json()) as { error?: string };
                setError(data.error || 'Failed to save scheduled job');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to save scheduled job');
        }
    };

    const handleDelete = async (id: string) => {
        if (confirmDeleteId !== id) {
            setConfirmDeleteId(id);
            return;
        }
        setConfirmDeleteId(null);
        setFeedback(null);
        try {
            const res = await apiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (res.ok) {
                await fetchJobs();
                setFeedback({ type: 'success', message: 'Scheduled job removed.' });
            } else {
                const data = (await res.json()) as { error?: string };
                setFeedback({ type: 'error', message: data.error || 'Failed to delete job' });
            }
        } catch (err: unknown) {
            setFeedback({
                type: 'error',
                message: err instanceof Error ? err.message : 'Failed to delete job',
            });
        }
    };

    const handleToggle = async (id: string) => {
        setFeedback(null);
        try {
            const res = await apiFetch(`/api/cron/jobs/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
            if (res.ok) {
                await fetchJobs();
            }
        } catch (err: unknown) {
            console.error('Failed to toggle job:', err);
        }
    };

    const handleRunNow = async (job: CronJob) => {
        setRunningJobId(job.id);
        setFeedback(null);
        try {
            const res = await apiFetch(`/api/cron/jobs/${encodeURIComponent(job.id)}/run`, {
                method: 'POST',
            });
            const data = (await res.json()) as { success?: boolean; error?: string; status?: string };
            if (!res.ok || data.success === false) {
                throw new Error(data.error || 'Job execution failed');
            }
            setFeedback({ type: 'success', message: `Executed "${job.name}" (${data.status || 'completed'}).` });
            await fetchJobs();
        } catch (err: unknown) {
            setFeedback({
                type: 'error',
                message: err instanceof Error ? err.message : 'Failed to run scheduled job',
            });
            await fetchJobs();
        } finally {
            setRunningJobId(null);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Scheduled Tasks
                    </h3>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Recurring prompts executed autonomously by the assigned agent
                    </p>
                </div>
                {!isEditing && (
                    <button
                        type="button"
                        onClick={() => {
                            setCurrentJob(EMPTY_JOB);
                            setError(null);
                            setIsEditing(true);
                        }}
                        className="kai-btn kai-btn-primary kai-btn-sm"
                    >
                        <span className="material-symbols-outlined text-base">add</span>
                        Add Job
                    </button>
                )}
            </div>

            {feedback && (
                <div className={`kai-alert ${feedback.type === 'success' ? 'kai-alert-success' : 'kai-alert-error'} flex items-center justify-between gap-2`}>
                    <span className="text-xs">{feedback.message}</span>
                    <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="kai-btn kai-btn-ghost kai-btn-xs"
                        aria-label="Dismiss notification"
                    >
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
            )}

            {isEditing && (
                <div className="kai-surface-subtle flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="kai-field">
                            <label className="kai-label" htmlFor="cron-job-name">
                                Job Name
                            </label>
                            <input
                                id="cron-job-name"
                                type="text"
                                className="kai-input"
                                value={currentJob.name || ''}
                                onChange={(e) => setCurrentJob({ ...currentJob, name: e.target.value })}
                                placeholder="e.g. Daily Container Audit"
                            />
                        </div>

                        <div className="kai-field">
                            <label className="kai-label" htmlFor="cron-job-schedule">
                                Cron Expression
                            </label>
                            <input
                                id="cron-job-schedule"
                                type="text"
                                className="kai-input kai-mono"
                                value={currentJob.schedule || ''}
                                onChange={(e) => setCurrentJob({ ...currentJob, schedule: e.target.value })}
                                placeholder="0 8 * * *"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                            Presets:
                        </span>
                        {CRON_PRESETS.map((preset) => {
                            const isSelected = currentJob.schedule?.trim() === preset.expr;
                            return (
                                <button
                                    key={preset.expr}
                                    type="button"
                                    onClick={() => setCurrentJob({ ...currentJob, schedule: preset.expr })}
                                    className={`kai-btn kai-btn-xs ${isSelected ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                >
                                    {preset.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="kai-field">
                        <label className="kai-label" htmlFor="cron-job-agent">
                            Assigned Agent
                        </label>
                        <select
                            id="cron-job-agent"
                            className="kai-select"
                            value={currentJob.agentId || 'nav'}
                            onChange={(e) => setCurrentJob({ ...currentJob, agentId: e.target.value })}
                        >
                            {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.shortName} — {a.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="kai-field">
                        <label className="kai-label" htmlFor="cron-job-prompt">
                            Agent Prompt
                        </label>
                        <textarea
                            id="cron-job-prompt"
                            className="kai-textarea"
                            value={currentJob.prompt || ''}
                            onChange={(e) => setCurrentJob({ ...currentJob, prompt: e.target.value })}
                            placeholder="Describe what the agent should inspect or execute when triggered..."
                            rows={3}
                        />
                    </div>

                    {error && <div className="kai-alert kai-alert-error text-xs">{error}</div>}

                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setIsEditing(false);
                                setError(null);
                            }}
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                void handleSave();
                            }}
                            className="kai-btn kai-btn-primary kai-btn-sm"
                        >
                            Save Job
                        </button>
                    </div>
                </div>
            )}

            {isLoading ? (
                <div className="kai-empty-state">Loading scheduled jobs...</div>
            ) : jobs.length === 0 && !isEditing ? (
                <div className="kai-empty-state">
                    No scheduled jobs configured yet. Click <strong>Add Job</strong> to create an automated task.
                </div>
            ) : (
                <div className="flex flex-col gap-2.5">
                    {jobs.map((job) => {
                        const agent = agents.find((a) => a.id === job.agentId);
                        const isRunning = runningJobId === job.id || job.lastStatus === 'running';
                        const isConfirmingDelete = confirmDeleteId === job.id;

                        return (
                            <div
                                key={job.id}
                                className="kai-surface-subtle flex flex-col gap-2.5"
                                style={{ opacity: job.enabled ? 1 : 0.68 }}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="flex items-start gap-3 min-w-0 flex-1">
                                        <div
                                            className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                                            style={{
                                                backgroundColor: 'var(--accent-subtle)',
                                                color: 'var(--accent-primary)',
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-lg">
                                                {agent?.icon || 'smart_toy'}
                                            </span>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span
                                                    className="text-sm font-semibold truncate"
                                                    style={{ color: 'var(--text-primary)' }}
                                                >
                                                    {job.name}
                                                </span>
                                                <span className="kai-badge kai-mono">{job.schedule}</span>
                                                <span className="kai-badge kai-badge-accent">
                                                    {agent?.shortName || job.agentId}
                                                </span>
                                                {job.lastStatus && (
                                                    <span className={getStatusBadgeClass(job.lastStatus)}>
                                                        {job.lastStatus}
                                                    </span>
                                                )}
                                            </div>
                                            <p
                                                className="text-xs mt-1 line-clamp-2"
                                                style={{ color: 'var(--text-secondary)' }}
                                            >
                                                {job.prompt}
                                            </p>
                                            <div
                                                className="flex flex-wrap items-center gap-3 text-[11px] mt-1.5"
                                                style={{ color: 'var(--text-muted)' }}
                                            >
                                                <span className="kai-tabular">
                                                    Last run: {formatLastRun(job.lastRunAt)}
                                                </span>
                                                {job.lastError && (
                                                    <span style={{ color: 'var(--danger-color)' }}>
                                                        Error: {job.lastError}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void handleRunNow(job);
                                            }}
                                            disabled={isRunning}
                                            className="kai-btn kai-btn-secondary kai-btn-xs"
                                            title="Run this job immediately"
                                        >
                                            <span
                                                className={`material-symbols-outlined text-sm ${isRunning ? 'animate-spin' : ''}`}
                                            >
                                                {isRunning ? 'sync' : 'play_arrow'}
                                            </span>
                                            <span>{isRunning ? 'Running...' : 'Run Now'}</span>
                                        </button>

                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={job.enabled}
                                            aria-label={job.enabled ? `Disable ${job.name}` : `Enable ${job.name}`}
                                            onClick={() => {
                                                void handleToggle(job.id);
                                            }}
                                            className={`kai-switch ${job.enabled ? 'is-checked' : ''}`}
                                            title={job.enabled ? 'Enabled' : 'Disabled'}
                                        >
                                            <span className="kai-switch-thumb" />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setConfirmDeleteId(null);
                                                setError(null);
                                                setCurrentJob(job);
                                                setIsEditing(true);
                                            }}
                                            className="kai-btn kai-btn-ghost kai-btn-xs"
                                            aria-label={`Edit ${job.name}`}
                                            title="Edit job"
                                        >
                                            <span className="material-symbols-outlined text-sm">edit</span>
                                        </button>

                                        {isConfirmingDelete ? (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        void handleDelete(job.id);
                                                    }}
                                                    className="kai-btn kai-btn-danger kai-btn-xs"
                                                >
                                                    Confirm Delete
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmDeleteId(null)}
                                                    className="kai-btn kai-btn-ghost kai-btn-xs"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void handleDelete(job.id);
                                                }}
                                                className="kai-btn kai-btn-ghost kai-btn-xs"
                                                aria-label={`Delete ${job.name}`}
                                                title="Delete job"
                                                style={{ color: 'var(--danger-color)' }}
                                            >
                                                <span className="material-symbols-outlined text-sm">delete</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
