import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/useAppContext';
import { apiFetch } from '../../utils/api';
import type {
    ContainerAutoUpdateGlobalConfig,
    ContainerAutoUpdatePolicy,
    ContainerAutoUpdateResponse,
    ContainerUpdateHistoryEntry,
    DockerContainer,
} from '../../types';

interface ContainerAutoUpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialContainer?: string;
}

interface ContainerAutoUpdateContentProps {
    onClose: () => void;
    initialContainer?: string;
}

const SCHEDULE_PRESETS = [
    { value: '0 3 * * *', label: 'Nightly 03:00' },
    { value: '0 2 * * *', label: 'Nightly 02:00' },
    { value: '0 */6 * * *', label: 'Every 6 hours' },
    { value: '0 3 * * 0', label: 'Weekly Sun 03:00' },
] as const;

const PROTECTED_NAMES = new Set([
    'aetheros-dashboard',
    'aetheros-updater',
    'docker-socket-proxy',
]);

const DEFAULT_CONFIG: ContainerAutoUpdateGlobalConfig = {
    globalEnabled: true,
    defaultSchedule: '0 3 * * *',
    pruneDanglingImages: true,
};

function shortHash(imageId?: string): string {
    if (!imageId) return '—';
    return imageId.replace(/^sha256:/, '').slice(0, 12);
}

function formatDateTime(iso?: string): string {
    if (!iso) return 'Never';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

function statusBadgeClass(status?: string): string {
    if (status === 'updated') return 'kai-badge kai-badge-success';
    if (status === 'up-to-date') return 'kai-badge kai-badge-info';
    if (status === 'failed') return 'kai-badge kai-badge-danger';
    return 'kai-badge';
}

function triggerBadgeClass(trigger: string): string {
    if (trigger === 'scheduled') return 'kai-badge kai-badge-accent';
    if (trigger === 'directive') return 'kai-badge kai-badge-info';
    return 'kai-badge';
}

interface CombinedPolicyItem {
    name: string;
    image: string;
    containerStatus?: DockerContainer['status'];
    isProtected: boolean;
    policy: ContainerAutoUpdatePolicy;
}

function ContainerAutoUpdateContent({ onClose, initialContainer }: ContainerAutoUpdateContentProps) {
    const { state } = useAppContext();
    const targetName = initialContainer?.replace(/^\//, '').trim() || '';

    const [activeTab, setActiveTab] = useState<'policies' | 'history'>('policies');
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<ContainerAutoUpdateGlobalConfig>(DEFAULT_CONFIG);
    const [policies, setPolicies] = useState<Record<string, ContainerAutoUpdatePolicy>>({});
    const [history, setHistory] = useState<ContainerUpdateHistoryEntry[]>([]);
    const [filterText, setFilterText] = useState('');

    const [savingGlobal, setSavingGlobal] = useState(false);
    const [runningAll, setRunningAll] = useState(false);
    const [busyContainer, setBusyContainer] = useState<string | null>(null);
    const [forceCustomPreset, setForceCustomPreset] = useState(false);

    const [globalFeedback, setGlobalFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

    // Local editing state for custom cron per container (so user edits aren't overwritten while typing)
    const [customEditing, setCustomEditing] = useState<Record<string, boolean>>({});
    const [cronDrafts, setCronDrafts] = useState<Record<string, string>>({});

    const highlightedRowRef = useRef<HTMLDivElement | null>(null);
    const globalCronInputRef = useRef<HTMLInputElement | null>(null);
    const didScrollRef = useRef(false);

    const loadAutoUpdateState = useCallback(async () => {
        const res = await apiFetch('/api/docker/auto-update');
        const data = (await res.json().catch(() => ({}))) as Partial<ContainerAutoUpdateResponse> & { error?: string };
        if (!res.ok || data.error) {
            throw new Error(data.error || `Failed to load auto-update configuration (${res.status})`);
        }
        if (data.config) setConfig(data.config);
        if (data.policies) setPolicies(data.policies);
        if (Array.isArray(data.history)) setHistory(data.history);
    }, []);

    useEffect(() => {
        let active = true;
        apiFetch('/api/docker/auto-update')
            .then(async (res) => {
                const data = (await res.json().catch(() => ({}))) as Partial<ContainerAutoUpdateResponse> & { error?: string };
                if (!res.ok || data.error) {
                    throw new Error(data.error || `Failed to load auto-update configuration (${res.status})`);
                }
                if (!active) return;
                if (data.config) setConfig(data.config);
                if (data.policies) setPolicies(data.policies);
                if (Array.isArray(data.history)) setHistory(data.history);
                setGlobalFeedback(null);
            })
            .catch((err: unknown) => {
                if (!active) return;
                setGlobalFeedback({
                    kind: 'error',
                    text: err instanceof Error ? err.message : 'Failed to load auto-update settings.'
                });
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => {
        if (!loading && targetName && highlightedRowRef.current && !didScrollRef.current) {
            didScrollRef.current = true;
            highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [loading, targetName]);

    const combinedRows = useMemo<CombinedPolicyItem[]>(() => {
        const containers = state.serverState?.containers || [];
        const byName = new Map<string, CombinedPolicyItem>();

        for (const c of containers) {
            const cleanName = c.name.replace(/^\//, '');
            const savedPolicy = policies[cleanName] || c.autoUpdate || {
                enabled: false,
                scheduleMode: 'global' as const,
                cronExpression: '',
                lastStatus: 'idle' as const,
            };
            byName.set(cleanName, {
                name: cleanName,
                image: c.image || savedPolicy.image || 'Unknown image',
                containerStatus: c.status,
                isProtected: Boolean(c.protected || savedPolicy.protected || PROTECTED_NAMES.has(cleanName)),
                policy: savedPolicy,
            });
        }

        for (const [name, policy] of Object.entries(policies)) {
            const cleanName = name.replace(/^\//, '');
            if (byName.has(cleanName)) continue;
            byName.set(cleanName, {
                name: cleanName,
                image: policy.image || 'Unknown image',
                isProtected: Boolean(policy.protected || PROTECTED_NAMES.has(cleanName)),
                policy,
            });
        }

        const q = filterText.trim().toLowerCase();
        const items = [...byName.values()].filter((item) => {
            if (!q) return true;
            return (
                item.name.toLowerCase().includes(q) ||
                item.image.toLowerCase().includes(q)
            );
        });

        items.sort((a, b) => {
            if (targetName) {
                if (a.name === targetName && b.name !== targetName) return -1;
                if (b.name === targetName && a.name !== targetName) return 1;
            }
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        return items;
    }, [state.serverState?.containers, policies, filterText, targetName]);

    const matchedPreset = SCHEDULE_PRESETS.some((p) => p.value === config.defaultSchedule)
        ? config.defaultSchedule
        : 'custom';
    const selectedPreset = forceCustomPreset ? 'custom' : matchedPreset;

    const handleSaveGlobal = async () => {
        setSavingGlobal(true);
        setGlobalFeedback(null);
        try {
            const res = await apiFetch('/api/docker/auto-update/global', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            });
            const data = (await res.json().catch(() => ({}))) as {
                config?: ContainerAutoUpdateGlobalConfig;
                error?: string;
            };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Failed to save global schedule (${res.status})`);
            }
            if (data.config) setConfig(data.config);
            setGlobalFeedback({ kind: 'success', text: 'Global auto-update schedule saved.' });
        } catch (err: unknown) {
            setGlobalFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : 'Failed to save schedule.'
            });
        } finally {
            setSavingGlobal(false);
        }
    };

    const handleRunAllEnabled = async () => {
        setRunningAll(true);
        setGlobalFeedback(null);
        try {
            const res = await apiFetch('/api/docker/auto-update/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = (await res.json().catch(() => ({}))) as {
                results?: Array<{ status?: string }>;
                history?: ContainerUpdateHistoryEntry[];
                error?: string;
            };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Update run failed (${res.status})`);
            }
            await loadAutoUpdateState();
            const results = data.results || [];
            const updatedCount = results.filter((r) => r.status === 'updated').length;
            const failedCount = results.filter((r) => r.status === 'failed').length;
            if (results.length === 0) {
                setGlobalFeedback({ kind: 'success', text: 'No containers currently have auto-updates enabled.' });
            } else if (failedCount > 0) {
                setGlobalFeedback({
                    kind: 'error',
                    text: `Processed ${results.length} container(s): ${updatedCount} updated, ${failedCount} failed.`
                });
            } else {
                setGlobalFeedback({
                    kind: 'success',
                    text: `Processed ${results.length} container(s): ${updatedCount} updated.`
                });
            }
        } catch (err: unknown) {
            setGlobalFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : 'Failed to run updates.'
            });
        } finally {
            setRunningAll(false);
        }
    };

    const saveContainerPolicy = async (
        name: string,
        payload: { enabled: boolean; scheduleMode: 'global' | 'custom'; cronExpression?: string }
    ) => {
        setBusyContainer(name);
        setRowErrors((prev) => {
            if (!prev[name]) return prev;
            const next = { ...prev };
            delete next[name];
            return next;
        });

        try {
            const res = await apiFetch(`/api/docker/auto-update/container/${encodeURIComponent(name)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = (await res.json().catch(() => ({}))) as {
                policy?: ContainerAutoUpdatePolicy;
                error?: string;
            };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Failed to update policy (${res.status})`);
            }
            if (data.policy) {
                setPolicies((prev) => ({ ...prev, [name]: data.policy as ContainerAutoUpdatePolicy }));
            } else {
                await loadAutoUpdateState();
            }
            setCustomEditing((prev) => ({ ...prev, [name]: false }));
        } catch (err: unknown) {
            setRowErrors((prev) => ({
                ...prev,
                [name]: err instanceof Error ? err.message : 'Failed to save container policy.'
            }));
        } finally {
            setBusyContainer(null);
        }
    };

    const handlePullAndRedeploy = async (name: string) => {
        setBusyContainer(name);
        setRowErrors((prev) => {
            if (!prev[name]) return prev;
            const next = { ...prev };
            delete next[name];
            return next;
        });

        try {
            const res = await apiFetch('/api/docker/auto-update/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ containerName: name, forceRecreate: true }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                results?: Array<{ status?: string; message?: string }>;
                error?: string;
            };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Pull & redeploy failed (${res.status})`);
            }
            const firstResult = data.results?.[0];
            if (firstResult?.status === 'failed') {
                throw new Error(firstResult.message || `Pull & redeploy failed for '${name}'.`);
            }
            await loadAutoUpdateState();
            setGlobalFeedback({
                kind: 'success',
                text: firstResult?.message
                    ? `${name}: ${firstResult.message}`
                    : `Pulled latest image and redeployed '${name}'.`,
            });
        } catch (err: unknown) {
            setRowErrors((prev) => ({
                ...prev,
                [name]: err instanceof Error ? err.message : 'Pull & redeploy failed.'
            }));
        } finally {
            setBusyContainer(null);
        }
    };

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-update-modal-title"
            onClick={onClose}
        >
            <div
                className="kai-modal max-w-4xl w-full"
                style={{ maxHeight: '90vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="material-symbols-outlined text-[22px]" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            system_update_alt
                        </span>
                        <div className="min-w-0">
                            <h2 id="auto-update-modal-title" className="text-base font-semibold truncate">
                                Container Auto-Updates
                            </h2>
                            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                                Scheduled image pulls, rolling recreates, and update history
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="kai-btn kai-btn-ghost kai-btn-sm kai-btn-icon"
                        onClick={onClose}
                        aria-label="Close modal"
                        title="Close"
                    >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                    </button>
                </div>

                <div className="kai-modal-body flex flex-col gap-4">
                    <div className="kai-tabs" role="tablist" aria-label="Auto-update sections">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'policies'}
                            className={`kai-tab ${activeTab === 'policies' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('policies')}
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">tune</span>
                            <span>Schedule &amp; Policies</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'history'}
                            className={`kai-tab ${activeTab === 'history' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('history')}
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">history</span>
                            <span>Update History</span>
                            <span className="kai-badge kai-tabular">{history.length}</span>
                        </button>
                    </div>

                    {globalFeedback && (
                        <div
                            className={`kai-alert text-xs ${globalFeedback.kind === 'error' ? 'kai-alert-error' : 'kai-alert-success'}`}
                            role={globalFeedback.kind === 'error' ? 'alert' : 'status'}
                        >
                            {globalFeedback.text}
                        </div>
                    )}

                    {loading ? (
                        <div className="kai-empty-state">Loading auto-update configuration...</div>
                    ) : activeTab === 'policies' ? (
                        <div className="flex flex-col gap-5">
                            {/* Global Nightly Schedule Card */}
                            <section className="kai-surface-subtle flex flex-col gap-4" aria-label="Global Nightly Schedule">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-semibold">Global Nightly Schedule</h3>
                                        <p className="kai-help">
                                            Applies to all containers configured to follow the global schedule.
                                        </p>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            className="kai-switch"
                                            checked={config.globalEnabled}
                                            onChange={(e) => setConfig({ ...config, globalEnabled: e.target.checked })}
                                        />
                                        <span>Enable scheduled auto-updates</span>
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="kai-field">
                                        <label htmlFor="global-schedule-preset" className="kai-label text-xs">
                                            Schedule Preset
                                        </label>
                                        <select
                                            id="global-schedule-preset"
                                            value={selectedPreset}
                                            onChange={(e) => {
                                                if (e.target.value === 'custom') {
                                                    setForceCustomPreset(true);
                                                    globalCronInputRef.current?.focus();
                                                } else {
                                                    setForceCustomPreset(false);
                                                    setConfig({ ...config, defaultSchedule: e.target.value });
                                                }
                                            }}
                                            className="kai-select"
                                        >
                                            {SCHEDULE_PRESETS.map((preset) => (
                                                <option key={preset.value} value={preset.value}>
                                                    {preset.label} ({preset.value})
                                                </option>
                                            ))}
                                            <option value="custom">Custom Cron</option>
                                        </select>
                                    </div>

                                    <div className="kai-field">
                                        <label htmlFor="global-schedule-cron" className="kai-label text-xs">
                                            Cron Expression
                                        </label>
                                        <input
                                            ref={globalCronInputRef}
                                            id="global-schedule-cron"
                                            type="text"
                                            value={config.defaultSchedule}
                                            onChange={(e) => setConfig({ ...config, defaultSchedule: e.target.value })}
                                            className="kai-input kai-mono"
                                            placeholder="0 3 * * *"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={config.pruneDanglingImages}
                                            onChange={(e) => setConfig({ ...config, pruneDanglingImages: e.target.checked })}
                                        />
                                        <span>Prune dangling images after updates</span>
                                    </label>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className="kai-btn kai-btn-secondary kai-btn-sm"
                                            onClick={handleRunAllEnabled}
                                            disabled={runningAll || savingGlobal}
                                        >
                                            <span className={`material-symbols-outlined text-[16px] ${runningAll ? 'animate-spin' : ''}`} aria-hidden="true">
                                                {runningAll ? 'sync' : 'play_arrow'}
                                            </span>
                                            <span>{runningAll ? 'Running Updates...' : 'Run Enabled Updates Now'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="kai-btn kai-btn-primary kai-btn-sm"
                                            onClick={handleSaveGlobal}
                                            disabled={savingGlobal || runningAll}
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">save</span>
                                            <span>{savingGlobal ? 'Saving...' : 'Save Schedule'}</span>
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {/* Per-Container Policies */}
                            <section className="flex flex-col gap-3" aria-label="Per-Container Policies">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <h3 className="text-sm font-semibold">Per-Container Policies</h3>
                                        <p className="kai-help">
                                            Configure individual auto-update switches and custom cron schedules.
                                        </p>
                                    </div>
                                    <div className="w-full sm:w-64">
                                        <label htmlFor="policy-filter-input" className="sr-only">Filter containers</label>
                                        <input
                                            id="policy-filter-input"
                                            type="search"
                                            value={filterText}
                                            onChange={(e) => setFilterText(e.target.value)}
                                            className="kai-input"
                                            placeholder="Filter containers..."
                                        />
                                    </div>
                                </div>

                                {combinedRows.length === 0 ? (
                                    <div className="kai-empty-state">
                                        {filterText.trim()
                                            ? 'No containers match your filter.'
                                            : 'No containers discovered yet.'}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2.5">
                                        {combinedRows.map((item) => {
                                            const { name, image, containerStatus, isProtected, policy } = item;
                                            const isHighlighted = Boolean(targetName && name === targetName);
                                            const isBusy = busyContainer === name;
                                            const isCustomOpen = Boolean(customEditing[name] || policy.scheduleMode === 'custom');
                                            const draftCron = cronDrafts[name] ?? (policy.cronExpression || config.defaultSchedule || '0 3 * * *');
                                            const lastTime = policy.lastUpdatedAt || policy.lastCheckedAt;
                                            const lastStatus = policy.lastStatus || 'idle';

                                            return (
                                                <div
                                                    key={name}
                                                    ref={isHighlighted ? highlightedRowRef : undefined}
                                                    data-highlighted={isHighlighted ? 'true' : undefined}
                                                    className="kai-surface-subtle flex flex-col gap-3"
                                                    style={
                                                        isHighlighted
                                                            ? {
                                                                borderColor: 'var(--accent-primary)',
                                                                boxShadow: '0 0 0 1px var(--accent-primary)'
                                                            }
                                                            : undefined
                                                    }
                                                >
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-sm font-semibold truncate">{name}</span>
                                                                {containerStatus && (
                                                                    <span className={`kai-badge ${containerStatus === 'running' ? 'kai-badge-success' : ''}`}>
                                                                        {containerStatus}
                                                                    </span>
                                                                )}
                                                                {isProtected && (
                                                                    <span className="kai-badge kai-badge-warning" title="Protected core container cannot be auto-redeployed">
                                                                        Protected
                                                                    </span>
                                                                )}
                                                                <span className={statusBadgeClass(lastStatus)}>
                                                                    {lastStatus}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs kai-mono truncate mt-1" style={{ color: 'var(--text-muted)' }}>
                                                                {image}
                                                            </p>
                                                            {(lastTime || policy.lastMessage) && (
                                                                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                                                    Last checked: <span className="kai-tabular">{formatDateTime(lastTime)}</span>
                                                                    {policy.lastMessage ? ` — ${policy.lastMessage}` : ''}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <label
                                                                className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none px-2 py-1"
                                                                title={isProtected ? 'Protected container cannot be auto-updated' : 'Toggle auto-update'}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    className="kai-switch"
                                                                    checked={Boolean(policy.enabled)}
                                                                    disabled={isProtected || isBusy}
                                                                    onChange={(e) => {
                                                                        const nextEnabled = e.target.checked;
                                                                        void saveContainerPolicy(name, {
                                                                            enabled: nextEnabled,
                                                                            scheduleMode: policy.scheduleMode || 'global',
                                                                            cronExpression: policy.scheduleMode === 'custom' ? draftCron : policy.cronExpression,
                                                                        });
                                                                    }}
                                                                />
                                                                <span>{policy.enabled ? 'Auto-Update On' : 'Auto-Update Off'}</span>
                                                            </label>

                                                            <select
                                                                aria-label={`Schedule mode for ${name}`}
                                                                value={isCustomOpen ? 'custom' : 'global'}
                                                                disabled={isProtected || isBusy}
                                                                onChange={(e) => {
                                                                    const mode = e.target.value as 'global' | 'custom';
                                                                    if (mode === 'global') {
                                                                        setCustomEditing((prev) => ({ ...prev, [name]: false }));
                                                                        void saveContainerPolicy(name, {
                                                                            enabled: Boolean(policy.enabled),
                                                                            scheduleMode: 'global',
                                                                            cronExpression: policy.cronExpression,
                                                                        });
                                                                    } else {
                                                                        setCustomEditing((prev) => ({ ...prev, [name]: true }));
                                                                        setCronDrafts((prev) => ({
                                                                            ...prev,
                                                                            [name]: prev[name] ?? (policy.cronExpression || config.defaultSchedule || '0 3 * * *'),
                                                                        }));
                                                                    }
                                                                }}
                                                                className="kai-select w-auto text-xs"
                                                            >
                                                                <option value="global">Global</option>
                                                                <option value="custom">Custom Cron</option>
                                                            </select>

                                                            <button
                                                                type="button"
                                                                className="kai-btn kai-btn-secondary kai-btn-sm"
                                                                disabled={isProtected || isBusy}
                                                                onClick={() => void handlePullAndRedeploy(name)}
                                                                title={isProtected ? 'Protected container cannot be redeployed' : 'Pull latest image and recreate container now'}
                                                            >
                                                                <span className={`material-symbols-outlined text-[15px] ${isBusy ? 'animate-spin' : ''}`} aria-hidden="true">
                                                                    {isBusy ? 'sync' : 'cloud_download'}
                                                                </span>
                                                                <span>Pull &amp; Redeploy Now</span>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {isCustomOpen && !isProtected && (
                                                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                                            <label htmlFor={`custom-cron-${name}`} className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                                                Custom Cron:
                                                            </label>
                                                            <input
                                                                id={`custom-cron-${name}`}
                                                                type="text"
                                                                value={draftCron}
                                                                onChange={(e) =>
                                                                    setCronDrafts((prev) => ({ ...prev, [name]: e.target.value }))
                                                                }
                                                                className="kai-input kai-mono flex-1 min-w-[160px]"
                                                                placeholder="0 3 * * *"
                                                            />
                                                            <button
                                                                type="button"
                                                                className="kai-btn kai-btn-primary kai-btn-sm"
                                                                disabled={isBusy}
                                                                onClick={() =>
                                                                    void saveContainerPolicy(name, {
                                                                        enabled: Boolean(policy.enabled),
                                                                        scheduleMode: 'custom',
                                                                        cronExpression: draftCron,
                                                                    })
                                                                }
                                                            >
                                                                Save
                                                            </button>
                                                        </div>
                                                    )}

                                                    {rowErrors[name] && (
                                                        <div className="kai-alert kai-alert-error text-xs" role="alert">
                                                            {rowErrors[name]}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>
                    ) : (
                        /* Tab 2: Update History */
                        <div className="flex flex-col gap-3">
                            {history.length === 0 ? (
                                <div className="kai-empty-state">
                                    No container update runs have been recorded yet.
                                </div>
                            ) : (
                                <div className="kai-table-wrap">
                                    <table className="kai-table">
                                        <thead>
                                            <tr>
                                                <th>Timestamp</th>
                                                <th>Container</th>
                                                <th>Image</th>
                                                <th>Trigger</th>
                                                <th>Image ID Delta</th>
                                                <th>Status</th>
                                                <th>Message</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {history.map((entry) => (
                                                <tr key={entry.id}>
                                                    <td className="kai-tabular text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                                        {formatDateTime(entry.finishedAt || entry.startedAt)}
                                                    </td>
                                                    <td className="font-medium whitespace-nowrap">{entry.containerName}</td>
                                                    <td className="kai-mono text-xs">{entry.image}</td>
                                                    <td>
                                                        <span className={triggerBadgeClass(entry.trigger)}>
                                                            {entry.trigger}
                                                        </span>
                                                    </td>
                                                    <td className="kai-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                                        {shortHash(entry.oldImageId)} &rarr; {shortHash(entry.newImageId)}
                                                    </td>
                                                    <td>
                                                        <span className={statusBadgeClass(entry.status)}>
                                                            {entry.status}
                                                        </span>
                                                    </td>
                                                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                                        {entry.message}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="kai-modal-footer">
                    <button type="button" className="kai-btn kai-btn-primary kai-btn-sm" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function ContainerAutoUpdateModal({ isOpen, onClose, initialContainer }: ContainerAutoUpdateModalProps) {
    if (!isOpen) return null;
    return (
        <ContainerAutoUpdateContent
            key={initialContainer || '__all__'}
            onClose={onClose}
            initialContainer={initialContainer}
        />
    );
}
