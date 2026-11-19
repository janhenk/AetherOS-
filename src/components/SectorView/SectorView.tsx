import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/useAppContext';
import { apiFetch } from '../../utils/api';
import { useGemini } from '../../hooks/useGemini';
import CreateContainerModal from '../DockerManager/CreateContainerModal';
import ContainerAutoUpdateModal from '../DockerManager/ContainerAutoUpdateModal';
import ContainerLogsModal from '../DockerManager/ContainerLogsModal';
import AdvancedDeploymentModal from '../DockerManager/AdvancedDeploymentModal';
import AppStoreModal from '../AppStore/AppStoreModal';
import TerminalModal from '../Terminal/TerminalModal';
import NetworkVisualizerModal from '../NetworkVisualizer/NetworkVisualizerModal';
import CronManagerModal from '../SettingsModal/CronManagerModal';
import { TacticalAlerts } from '../TacticalAlerts/TacticalAlerts';
import type {
    ActiveDeployment,
    ContainerAutoUpdatePolicy,
    DockerContainer,
    DockerCreateSpec,
    PendingApproval,
} from '../../types';

const PROTECTED_CONTAINER_NAMES = new Set([
    'aetheros-dashboard',
    'aetheros-updater',
    'docker-socket-proxy',
]);

function formatSpeed(bps: number): { val: string; unit: string } {
    const positiveBps = Math.max(0, bps);
    if (positiveBps > 1_000_000_000) return { val: (positiveBps / 1_000_000_000).toFixed(2), unit: 'Gbps' };
    if (positiveBps > 1_000_000) return { val: (positiveBps / 1_000_000).toFixed(2), unit: 'Mbps' };
    return { val: (positiveBps / 1_000).toFixed(2), unit: 'Kbps' };
}

function cleanContainerName(name: string): string {
    return name.replace(/^\//, '');
}

function isContainerProtected(container: DockerContainer): boolean {
    return Boolean(container.protected || PROTECTED_CONTAINER_NAMES.has(cleanContainerName(container.name)));
}

interface ApprovalPromptProps {
    approval: PendingApproval;
    onResolve: (id: string) => void;
}

function ApprovalPrompt({ approval, onResolve }: ApprovalPromptProps) {
    const [timeLeft, setTimeLeft] = useState(10);

    useEffect(() => {
        let remaining = 10;
        const timer = window.setInterval(() => {
            remaining -= 1;
            setTimeLeft(Math.max(0, remaining));
            if (remaining <= 0) {
                window.clearInterval(timer);
                onResolve(approval.id);
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, [approval.id, onResolve]);

    return (
        <section
            className="kai-surface flex flex-col gap-3"
            style={{
                borderColor: 'var(--warning-color)',
                borderLeftWidth: '4px',
            }}
            aria-label="Action approval required"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]" style={{ color: 'var(--warning-color)' }} aria-hidden="true">
                        verified_user
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider">
                        Authorization Required
                    </span>
                    <span className="kai-badge kai-badge-warning">{approval.action}</span>
                </div>
                <span className="kai-badge kai-badge-danger kai-tabular">{timeLeft}s</span>
            </div>

            <pre
                className="kai-mono text-xs p-3 rounded-md overflow-x-auto m-0"
                style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                }}
            >
                {JSON.stringify(approval.params, null, 2)}
            </pre>

            <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={() => onResolve(approval.id)}
                    className="kai-btn kai-btn-secondary kai-btn-sm"
                >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                    <span>Abort</span>
                </button>
                <button
                    type="button"
                    onClick={() => onResolve(approval.id)}
                    className="kai-btn kai-btn-primary kai-btn-sm"
                >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">check</span>
                    <span>Authorize</span>
                </button>
            </div>
        </section>
    );
}

function ApprovalPanel() {
    const { state, dispatch } = useAppContext();
    const approval = state.pendingApproval;

    const handleResolve = useCallback(
        (id: string) => {
            dispatch({ type: 'RESOLVE_APPROVAL', payload: id });
        },
        [dispatch]
    );

    if (!approval) return null;
    return <ApprovalPrompt key={approval.id} approval={approval} onResolve={handleResolve} />;
}

export default function SectorView() {
    const { state, dispatch } = useAppContext();
    const { sendMessage } = useGemini();

    const containers = useMemo(() => state.serverState?.containers || [], [state.serverState?.containers]);
    const deployments = useMemo<ActiveDeployment[]>(
        () => state.serverState?.deployments || [],
        [state.serverState?.deployments]
    );

    const hostname = state.serverState?.hostname || 'localhost';
    const osInfo = state.serverState?.osInfo || 'Linux / Host';
    const dockerRunning = state.serverState?.dockerRunning ?? true;
    const ipAddress = state.serverState?.ipAddress || '127.0.0.1';
    const projectVersion = state.serverState?.projectVersion || '0.0.0';
    const networkInbound = state.serverState?.networkInbound;
    const networkOutbound = state.serverState?.networkOutbound;

    const [currentTime, setCurrentTime] = useState(() => new Date());
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isAppStoreOpen, setAppStoreOpen] = useState(false);
    const [isTerminalOpen, setTerminalOpen] = useState(false);
    const [isAdvancedModalOpen, setAdvancedModalOpen] = useState(false);
    const [isNetworkVisualizerOpen, setNetworkVisualizerOpen] = useState(false);
    const [isCronManagerOpen, setCronManagerOpen] = useState(false);
    const [autoUpdateModal, setAutoUpdateModal] = useState<{ open: boolean; containerName?: string }>({
        open: false,
    });
    const [logsTarget, setLogsTarget] = useState<{ id: string; name: string } | null>(null);

    const [editingContainerSpec, setEditingContainerSpec] = useState<DockerCreateSpec | undefined>(undefined);
    const [createModalTab, setCreateModalTab] = useState<'config' | 'compose'>('config');
    const [isProcessing, setIsProcessing] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');
    const [confirmPrune, setConfirmPrune] = useState(false);
    const [confirmHostPower, setConfirmHostPower] = useState<'reboot' | 'shutdown' | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [quickFeedback, setQuickFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
    const [containerFeedback, setContainerFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const lastNetworkState = useRef<{ inbound: number; outbound: number; time: number }>({
        inbound: 0,
        outbound: 0,
        time: 0,
    });
    const [netSpeeds, setNetSpeeds] = useState({
        inbound: { val: '0.00', unit: 'Mbps' },
        outbound: { val: '0.00', unit: 'Mbps' },
    });

    useEffect(() => {
        if (networkInbound === undefined || networkOutbound === undefined) return undefined;
        const now = performance.now();
        const prev = lastNetworkState.current;
        let rafId = 0;

        if (prev.time > 0) {
            const timeDiffSeconds = (now - prev.time) / 1000;
            if (timeDiffSeconds > 0) {
                const inBitsPerSec = ((networkInbound - prev.inbound) / timeDiffSeconds) * 8;
                const outBitsPerSec = ((networkOutbound - prev.outbound) / timeDiffSeconds) * 8;
                const nextSpeeds = {
                    inbound: formatSpeed(inBitsPerSec),
                    outbound: formatSpeed(outBitsPerSec),
                };
                rafId = window.requestAnimationFrame(() => {
                    setNetSpeeds(nextSpeeds);
                });
            }
        }
        lastNetworkState.current = { inbound: networkInbound, outbound: networkOutbound, time: now };

        return () => {
            if (rafId) window.cancelAnimationFrame(rafId);
        };
    }, [networkInbound, networkOutbound]);

    const runningCount = useMemo(
        () => containers.filter((c) => c.status === 'running').length,
        [containers]
    );
    const stoppedCount = containers.length - runningCount;

    const filteredContainers = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return containers.filter((c) => {
            if (statusFilter === 'running' && c.status !== 'running') return false;
            if (statusFilter === 'stopped' && c.status === 'running') return false;
            if (!q) return true;
            const cleanName = cleanContainerName(c.name).toLowerCase();
            const image = (c.image || '').toLowerCase();
            return cleanName.includes(q) || image.includes(q) || c.id.toLowerCase().includes(q);
        });
    }, [containers, searchQuery, statusFilter]);

    const handleStartDocker = async () => {
        setIsProcessing('docker-start');
        setQuickFeedback(null);
        try {
            const res = await apiFetch('/api/docker/start-service', { method: 'POST' });
            const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Failed to start Docker Engine (${res.status})`);
            }
            setQuickFeedback({ kind: 'success', text: data.message || 'Docker Engine start requested.' });
        } catch (err: unknown) {
            setQuickFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : 'Failed to start Docker Engine.',
            });
        } finally {
            setIsProcessing(null);
        }
    };

    const handlePruneImages = async () => {
        setIsProcessing('docker-prune');
        setConfirmPrune(false);
        setQuickFeedback(null);
        try {
            const res = await apiFetch('/api/docker/prune', { method: 'POST' });
            const data = (await res.json().catch(() => ({}))) as { output?: string; error?: string };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Image prune failed (${res.status})`);
            }
            const summary = data.output?.trim() ? data.output.trim().split('\n').pop() : 'Unused dangling images pruned.';
            setQuickFeedback({ kind: 'success', text: summary || 'Unused dangling images pruned.' });
        } catch (err: unknown) {
            setQuickFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : 'Failed to prune unused images.',
            });
        } finally {
            setIsProcessing(null);
        }
    };

    const handleHostPower = async (action: 'reboot' | 'shutdown') => {
        setIsProcessing(`host-${action}`);
        setConfirmHostPower(null);
        setQuickFeedback(null);
        try {
            const res = await apiFetch('/api/system/host-power', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, confirm: true }),
            });
            const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Host ${action} failed (${res.status})`);
            }
            setQuickFeedback({
                kind: 'success',
                text: data.message || `Host ${action} dispatched. This console will go offline shortly.`,
            });
        } catch (err: unknown) {
            setQuickFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : `Failed to ${action} the host.`,
            });
        } finally {
            setIsProcessing(null);
        }
    };

    const handleDiagnose = () => {
        if (containers.length === 0) return;
        const containerNames = containers.map((c) => cleanContainerName(c.name)).join(', ');
        const prompt = `Perform a comprehensive health check on all systems. Current Docker containers: ${containerNames}. Please inspect metrics, logs, and statuses for any anomalies.`;
        dispatch({ type: 'SELECT_AGENT', payload: 'nav' });
        void sendMessage('nav', prompt);
    };

    const handleDiagnoseContainer = (id: string, name: string) => {
        const cleanName = cleanContainerName(name);
        const prompt = `Diagnose Docker container: ${cleanName} (${id.substring(0, 8)}). Check recent logs and resource usage for this container.`;
        dispatch({ type: 'SELECT_AGENT', payload: 'nav' });
        void sendMessage('nav', prompt);
    };

    const handleDockerAction = async (id: string, action: 'start' | 'stop' | 'restart' | 'rm') => {
        setIsProcessing(id);
        setConfirmDeleteId(null);
        setContainerFeedback(null);
        try {
            const res = await apiFetch('/api/docker/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, action }),
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Container ${action} failed (${res.status})`);
            }
        } catch (err: unknown) {
            setContainerFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : `Failed to ${action} container.`,
            });
        } finally {
            setIsProcessing(null);
        }
    };

    const handleToggleAutoUpdate = async (container: DockerContainer) => {
        const cleanName = cleanContainerName(container.name);
        const currentPolicy = container.autoUpdate;
        const nextEnabled = !(currentPolicy?.enabled ?? false);
        const scheduleMode =
            currentPolicy?.scheduleMode === 'custom' && currentPolicy?.cronExpression
                ? 'custom'
                : 'global';

        setIsProcessing(`autoupdate:${cleanName}`);
        setContainerFeedback(null);
        try {
            const res = await apiFetch(`/api/docker/auto-update/container/${encodeURIComponent(cleanName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: nextEnabled,
                    scheduleMode,
                    cronExpression: scheduleMode === 'custom' ? currentPolicy?.cronExpression : undefined,
                }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                policy?: ContainerAutoUpdatePolicy;
                error?: string;
            };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Failed to update auto-update policy (${res.status})`);
            }

            if (state.serverState) {
                const nextPolicy: ContainerAutoUpdatePolicy = data.policy || {
                    enabled: nextEnabled,
                    scheduleMode,
                    cronExpression: currentPolicy?.cronExpression,
                };
                const updatedContainers = containers.map((c) =>
                    cleanContainerName(c.name) === cleanName ? { ...c, autoUpdate: nextPolicy } : c
                );
                dispatch({
                    type: 'UPDATE_SERVER_STATE',
                    payload: { ...state.serverState, containers: updatedContainers },
                });
            }
        } catch (err: unknown) {
            setContainerFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : `Failed to toggle auto-update for ${cleanName}.`,
            });
        } finally {
            setIsProcessing(null);
        }
    };

    const handlePullAndRedeploy = async (container: DockerContainer) => {
        const cleanName = cleanContainerName(container.name);
        setIsProcessing(`redeploy:${cleanName}`);
        setContainerFeedback(null);
        try {
            const res = await apiFetch('/api/docker/auto-update/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ containerName: cleanName, forceRecreate: true }),
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
                throw new Error(firstResult.message || `Redeploy failed for ${cleanName}.`);
            }
            setContainerFeedback({
                kind: 'success',
                text: firstResult?.message ? `${cleanName}: ${firstResult.message}` : `Updated ${cleanName}.`,
            });
        } catch (err: unknown) {
            setContainerFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : `Pull & redeploy failed for ${cleanName}.`,
            });
        } finally {
            setIsProcessing(null);
        }
    };

    const handleInspectOpen = async (containerId: string, tab: 'config' | 'compose') => {
        setIsProcessing(containerId);
        setContainerFeedback(null);
        try {
            const response = await apiFetch('/api/docker/inspect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: containerId }),
            });
            const data = (await response.json().catch(() => ({}))) as DockerCreateSpec & { error?: string };
            if (!response.ok || data.error) {
                throw new Error(data.error || `Failed to inspect container (${response.status})`);
            }
            setEditingContainerSpec(data);
            setCreateModalTab(tab);
            setCreateModalOpen(true);
        } catch (err: unknown) {
            setContainerFeedback({
                kind: 'error',
                text: err instanceof Error ? err.message : 'Failed to inspect container configuration.',
            });
        } finally {
            setIsProcessing(null);
        }
    };

    const handleContainerSubmit = async (spec: DockerCreateSpec) => {
        let replaceId: string | undefined;

        if (editingContainerSpec?.name) {
            const targetName = cleanContainerName(editingContainerSpec.name);
            const oldContainer = containers.find((c) => cleanContainerName(c.name) === targetName);
            if (oldContainer) {
                replaceId = oldContainer.id;
            }
        }

        const res = await apiFetch('/api/docker/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...spec, replaceId }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok || data.error) {
            throw new Error(data.error || `Failed to save container (${res.status})`);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            {/* Host Overview Card */}
            <section className="kai-surface flex flex-col gap-4" aria-label="Host overview">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                                backgroundColor: 'var(--accent-subtle)',
                                color: 'var(--accent-primary)',
                            }}
                        >
                            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">dns</span>
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-bold tracking-tight truncate">{hostname}</h2>
                                <span className="kai-badge kai-badge-accent kai-mono">v{projectVersion}</span>
                                <span className={`kai-badge ${dockerRunning ? 'kai-badge-success' : 'kai-badge-danger'}`}>
                                    {dockerRunning ? 'Docker Online' : 'Docker Offline'}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                <span className="kai-mono">{ipAddress}</span>
                                <span aria-hidden="true">&bull;</span>
                                <span>{osInfo}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 ml-auto">
                        <div className="text-right">
                            <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                {currentTime.toLocaleDateString()}
                            </p>
                            <p className="text-lg font-bold kai-mono kai-tabular">
                                {currentTime.toLocaleTimeString()}
                            </p>
                        </div>
                        <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                            style={{
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">schedule</span>
                        </div>
                    </div>
                </div>

                <div
                    className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                >
                    <div className="kai-surface-subtle p-3">
                        <div className="kai-stat-label">Inbound</div>
                        <div className="text-base font-semibold kai-tabular mt-0.5">
                            {netSpeeds.inbound.val}{' '}
                            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                                {netSpeeds.inbound.unit}
                            </span>
                        </div>
                    </div>
                    <div className="kai-surface-subtle p-3">
                        <div className="kai-stat-label">Outbound</div>
                        <div className="text-base font-semibold kai-tabular mt-0.5">
                            {netSpeeds.outbound.val}{' '}
                            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                                {netSpeeds.outbound.unit}
                            </span>
                        </div>
                    </div>
                    <div className="kai-surface-subtle p-3">
                        <div className="kai-stat-label">Running</div>
                        <div className="text-base font-semibold kai-tabular mt-0.5">
                            {runningCount}{' '}
                            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                                / {containers.length}
                            </span>
                        </div>
                    </div>
                    <div className="kai-surface-subtle p-3">
                        <div className="kai-stat-label">Active Deployments</div>
                        <div className="text-base font-semibold kai-tabular mt-0.5">
                            {deployments.length}
                        </div>
                    </div>
                </div>
            </section>

            <ApprovalPanel />

            <TacticalAlerts />

            {/* Quick Actions */}
            <section className="kai-surface flex flex-col gap-3" aria-label="Quick actions">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-semibold">Quick Actions</h3>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Host operations, scheduling, diagnostics, and maintenance
                        </p>
                    </div>
                </div>

                {quickFeedback && (
                    <div
                        className={`kai-alert text-xs flex items-center justify-between gap-2 ${quickFeedback.kind === 'error' ? 'kai-alert-error' : 'kai-alert-success'}`}
                        role={quickFeedback.kind === 'error' ? 'alert' : 'status'}
                    >
                        <span>{quickFeedback.text}</span>
                        <button
                            type="button"
                            className="kai-btn kai-btn-ghost kai-btn-xs"
                            onClick={() => setQuickFeedback(null)}
                            aria-label="Dismiss status message"
                        >
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {!dockerRunning && (
                        <button
                            type="button"
                            onClick={handleStartDocker}
                            disabled={isProcessing === 'docker-start'}
                            className="kai-btn kai-btn-primary kai-btn-sm justify-start min-w-0 w-full"
                        >
                            <span
                                className={`material-symbols-outlined text-[16px] shrink-0 ${isProcessing === 'docker-start' ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                            >
                                {isProcessing === 'docker-start' ? 'sync' : 'power_settings_new'}
                            </span>
                            <span className="truncate">Start Docker Engine</span>
                        </button>
                    )}

                    {containers.length > 0 && (
                        <button
                            type="button"
                            onClick={handleDiagnose}
                            className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                        >
                            <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                                troubleshoot
                            </span>
                            <span className="truncate">AI Health Check</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => setAutoUpdateModal({ open: true })}
                        className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                    >
                        <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            system_update_alt
                        </span>
                        <span className="truncate">Auto-Updates</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setTerminalOpen(true)}
                        className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                    >
                        <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            terminal
                        </span>
                        <span className="truncate">Host Terminal</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setCronManagerOpen(true)}
                        className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                    >
                        <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            schedule
                        </span>
                        <span className="truncate">Scheduled Jobs</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setNetworkVisualizerOpen(true)}
                        className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                    >
                        <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            hub
                        </span>
                        <span className="truncate">Network Topology</span>
                    </button>

                    {confirmHostPower === 'reboot' ? (
                        <div
                            className="sm:col-span-2 flex items-center gap-2 p-1 rounded-md"
                            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--warning-color)' }}
                        >
                            <button
                                type="button"
                                onClick={() => void handleHostPower('reboot')}
                                className="kai-btn kai-btn-danger kai-btn-sm flex-1"
                            >
                                Confirm Reboot
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmHostPower(null)}
                                className="kai-btn kai-btn-ghost kai-btn-sm"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setConfirmHostPower('reboot')}
                            disabled={isProcessing === 'host-reboot' || isProcessing === 'host-shutdown'}
                            className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                        >
                            <span
                                className={`material-symbols-outlined text-[16px] shrink-0 ${isProcessing === 'host-reboot' ? 'animate-spin' : ''}`}
                                style={{ color: 'var(--warning-color)' }}
                                aria-hidden="true"
                            >
                                {isProcessing === 'host-reboot' ? 'sync' : 'restart_alt'}
                            </span>
                            <span className="truncate">{isProcessing === 'host-reboot' ? 'Rebooting Host...' : 'Reboot Host'}</span>
                        </button>
                    )}

                    {confirmHostPower === 'shutdown' ? (
                        <div
                            className="sm:col-span-2 flex items-center gap-2 p-1 rounded-md"
                            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--danger-color)' }}
                        >
                            <button
                                type="button"
                                onClick={() => void handleHostPower('shutdown')}
                                className="kai-btn kai-btn-danger kai-btn-sm flex-1"
                            >
                                Confirm Shutdown
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmHostPower(null)}
                                className="kai-btn kai-btn-ghost kai-btn-sm"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setConfirmHostPower('shutdown')}
                            disabled={isProcessing === 'host-reboot' || isProcessing === 'host-shutdown'}
                            className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                        >
                            <span
                                className={`material-symbols-outlined text-[16px] shrink-0 ${isProcessing === 'host-shutdown' ? 'animate-spin' : ''}`}
                                style={{ color: 'var(--danger-color)' }}
                                aria-hidden="true"
                            >
                                {isProcessing === 'host-shutdown' ? 'sync' : 'power_settings_new'}
                            </span>
                            <span className="truncate">{isProcessing === 'host-shutdown' ? 'Shutting Down...' : 'Shutdown Host'}</span>
                        </button>
                    )}

                    {!confirmPrune ? (
                        <button
                            type="button"
                            onClick={() => setConfirmPrune(true)}
                            disabled={isProcessing === 'docker-prune'}
                            className="kai-btn kai-btn-secondary kai-btn-sm justify-start min-w-0 w-full"
                        >
                            <span
                                className={`material-symbols-outlined text-[16px] shrink-0 ${isProcessing === 'docker-prune' ? 'animate-spin' : ''}`}
                                style={{ color: 'var(--warning-color)' }}
                                aria-hidden="true"
                            >
                                {isProcessing === 'docker-prune' ? 'sync' : 'cleaning_services'}
                            </span>
                            <span className="truncate">{isProcessing === 'docker-prune' ? 'Pruning...' : 'Prune Images'}</span>
                        </button>
                    ) : (
                        <div className="sm:col-span-2 flex items-center gap-2 p-1 rounded-md" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--warning-color)' }}>
                            <button
                                type="button"
                                onClick={handlePruneImages}
                                className="kai-btn kai-btn-danger kai-btn-sm flex-1"
                            >
                                Confirm Prune
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmPrune(false)}
                                className="kai-btn kai-btn-ghost kai-btn-sm"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            </section>

            {/* Containers Card */}
            <section className="kai-surface flex flex-col gap-4" aria-label="Containers">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold">Containers</h3>
                            <span className="kai-badge kai-tabular">{containers.length}</span>
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Manage container lifecycle, logs, and auto-update policies
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setAutoUpdateModal({ open: true })}
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">update</span>
                            <span>Auto-Update Schedule</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setAppStoreOpen(true)}
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">apps</span>
                            <span>App Store</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setAdvancedModalOpen(true)}
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">layers</span>
                            <span>Deploy Compose</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingContainerSpec(undefined);
                                setCreateModalTab('config');
                                setCreateModalOpen(true);
                            }}
                            className="kai-btn kai-btn-primary kai-btn-sm"
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                            <span>New Container</span>
                        </button>
                    </div>
                </div>

                {/* Search & Status Filter Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex-1 min-w-[220px]">
                        <label htmlFor="containers-search-input" className="sr-only">Search containers</label>
                        <input
                            id="containers-search-input"
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Filter by container name, image, or ID..."
                            className="kai-input"
                        />
                    </div>

                    <div className="flex items-center gap-1.5" role="group" aria-label="Filter containers by status">
                        <button
                            type="button"
                            onClick={() => setStatusFilter('all')}
                            className={`kai-btn kai-btn-xs ${statusFilter === 'all' ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                        >
                            All ({containers.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setStatusFilter('running')}
                            className={`kai-btn kai-btn-xs ${statusFilter === 'running' ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                        >
                            Running ({runningCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setStatusFilter('stopped')}
                            className={`kai-btn kai-btn-xs ${statusFilter === 'stopped' ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                        >
                            Stopped ({stoppedCount})
                        </button>
                    </div>
                </div>

                {containerFeedback && (
                    <div
                        className={`kai-alert text-xs flex items-center justify-between gap-2 ${containerFeedback.kind === 'error' ? 'kai-alert-error' : 'kai-alert-success'}`}
                        role={containerFeedback.kind === 'error' ? 'alert' : 'status'}
                    >
                        <span>{containerFeedback.text}</span>
                        <button
                            type="button"
                            className="kai-btn kai-btn-ghost kai-btn-xs"
                            onClick={() => setContainerFeedback(null)}
                            aria-label="Dismiss container message"
                        >
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
                        </button>
                    </div>
                )}

                {/* Active Deployments */}
                {deployments.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {deployments.map((deployment) => (
                            <div
                                key={deployment.id}
                                className="kai-surface-subtle p-3 flex flex-col gap-2"
                                style={{ borderLeft: '3px solid var(--accent-primary)' }}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="material-symbols-outlined animate-spin text-[16px]" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                                            sync
                                        </span>
                                        <span className="text-xs font-semibold truncate">{deployment.name}</span>
                                    </div>
                                    <span className="kai-badge kai-badge-accent kai-mono truncate max-w-[240px]" title={deployment.status}>
                                        {deployment.status}
                                    </span>
                                </div>
                                {typeof deployment.progress === 'number' && (
                                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--progress-bg)' }}>
                                        <div
                                            className="h-full transition-all"
                                            style={{
                                                width: `${Math.min(100, Math.max(0, deployment.progress))}%`,
                                                backgroundColor: 'var(--accent-primary)',
                                            }}
                                        />
                                    </div>
                                )}
                                {deployment.message && (
                                    <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>
                                        {deployment.message}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Container List */}
                {filteredContainers.length === 0 && deployments.length === 0 ? (
                    <div className="kai-empty-state">
                        {containers.length === 0
                            ? 'No containers provisioned on this host.'
                            : 'No containers match the current filter.'}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {filteredContainers.map((container) => {
                            const cleanName = cleanContainerName(container.name);
                            const isProtected = isContainerProtected(container);
                            const isBusy =
                                isProcessing === container.id ||
                                isProcessing === `redeploy:${cleanName}` ||
                                isProcessing === `autoupdate:${cleanName}`;
                            const autoEnabled = Boolean(container.autoUpdate?.enabled);
                            const autoLabel = autoEnabled
                                ? container.autoUpdate?.scheduleMode === 'custom'
                                    ? 'Custom On'
                                    : 'Nightly On'
                                : 'Auto Off';

                            const dotColor =
                                container.status === 'running'
                                    ? 'var(--success-color)'
                                    : container.status === 'restarting'
                                        ? 'var(--warning-color)'
                                        : 'var(--danger-color)';

                            return (
                                <div
                                    key={container.id}
                                    className="kai-surface-subtle p-3 flex flex-col gap-2.5 overflow-hidden"
                                >
                                    {/* Identity & Metadata */}
                                    <div className="flex items-start gap-2.5 min-w-0">
                                        <span
                                            className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${isBusy ? 'animate-pulse' : ''}`}
                                            style={{ backgroundColor: dotColor }}
                                            title={`Status: ${container.status}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2 min-w-0">
                                                <span className="text-sm font-semibold truncate" title={cleanName}>
                                                    {cleanName}
                                                </span>
                                                {isProtected && (
                                                    <span className="kai-badge kai-badge-warning shrink-0" title="Protected core container">
                                                        Protected
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs mt-0.5 min-w-0" style={{ color: 'var(--text-muted)' }}>
                                                {container.image && (
                                                    <span className="kai-mono truncate max-w-full" title={container.image}>
                                                        {container.image}
                                                    </span>
                                                )}
                                                {container.image && <span aria-hidden="true">&bull;</span>}
                                                <span className="kai-mono">{container.id.slice(0, 12)}</span>
                                                <span aria-hidden="true">&bull;</span>
                                                <span className="capitalize">{container.status}</span>
                                                {container.uptime && (
                                                    <>
                                                        <span aria-hidden="true">&bull;</span>
                                                        <span className="kai-tabular">{container.uptime}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Live Metrics & Auto-Update Controls */}
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {container.cpuPerc && (
                                                <span className="kai-badge kai-tabular">
                                                    CPU {container.cpuPerc}
                                                </span>
                                            )}
                                            {container.memPerc && (
                                                <span className="kai-badge kai-tabular" title={container.memUsage || undefined}>
                                                    RAM {container.memPerc}
                                                </span>
                                            )}
                                        </div>

                                        <div className="inline-flex items-center gap-1 ml-auto">
                                            <button
                                                type="button"
                                                disabled={isProtected || isBusy}
                                                onClick={() => void handleToggleAutoUpdate(container)}
                                                className={`kai-btn kai-btn-xs ${autoEnabled ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                                title={
                                                    isProtected
                                                        ? 'Protected container cannot be auto-updated'
                                                        : autoEnabled
                                                            ? 'Click to disable auto-update'
                                                            : 'Click to enable nightly auto-update'
                                                }
                                                aria-pressed={autoEnabled}
                                            >
                                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                                                    {autoEnabled ? 'autorenew' : 'sync_disabled'}
                                                </span>
                                                <span>{autoLabel}</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => setAutoUpdateModal({ open: true, containerName: cleanName })}
                                                className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                                aria-label={`Configure auto-update schedule for ${cleanName}`}
                                                title="Configure custom cron or view policy"
                                            >
                                                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">schedule</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Compact Action Toolbar */}
                                    <div
                                        className="flex flex-wrap items-center gap-1 pt-2 border-t"
                                        style={{ borderColor: 'var(--border-subtle)' }}
                                    >
                                        {container.status !== 'running' ? (
                                            <button
                                                type="button"
                                                onClick={() => void handleDockerAction(container.id, 'start')}
                                                disabled={isBusy}
                                                className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                                aria-label={`Start ${cleanName}`}
                                                title="Start"
                                            >
                                                <span className="material-symbols-outlined text-[16px]" style={{ color: 'var(--success-color)' }} aria-hidden="true">
                                                    play_arrow
                                                </span>
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => void handleDockerAction(container.id, 'stop')}
                                                disabled={isProtected || isBusy}
                                                className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                                aria-label={`Stop ${cleanName}`}
                                                title={isProtected ? 'Protected container cannot be stopped' : 'Stop'}
                                            >
                                                <span className="material-symbols-outlined text-[16px]" style={{ color: 'var(--warning-color)' }} aria-hidden="true">
                                                    stop
                                                </span>
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => void handleDockerAction(container.id, 'restart')}
                                            disabled={isProtected || isBusy}
                                            className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                            aria-label={`Restart ${cleanName}`}
                                            title={isProtected ? 'Protected container cannot be restarted' : 'Restart'}
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => void handlePullAndRedeploy(container)}
                                            disabled={isProtected || isBusy}
                                            className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                            aria-label={`Pull and redeploy ${cleanName}`}
                                            title={isProtected ? 'Protected container cannot be redeployed' : 'Pull & Redeploy'}
                                        >
                                            <span
                                                className={`material-symbols-outlined text-[16px] ${isProcessing === `redeploy:${cleanName}` ? 'animate-spin' : ''}`}
                                                style={{ color: 'var(--accent-primary)' }}
                                                aria-hidden="true"
                                            >
                                                {isProcessing === `redeploy:${cleanName}` ? 'sync' : 'cloud_download'}
                                            </span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setLogsTarget({ id: container.id, name: cleanName })}
                                            className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                            aria-label={`View logs for ${cleanName}`}
                                            title="Logs"
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">article</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => void handleInspectOpen(container.id, 'compose')}
                                            disabled={isBusy}
                                            className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                            aria-label={`View Compose YAML for ${cleanName}`}
                                            title="Compose Manifest"
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">description</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => void handleInspectOpen(container.id, 'config')}
                                            disabled={isBusy}
                                            className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                            aria-label={`Edit configuration for ${cleanName}`}
                                            title="Edit / Reconfigure"
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => handleDiagnoseContainer(container.id, container.name)}
                                            className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5"
                                            aria-label={`AI diagnose ${cleanName}`}
                                            title="AI Diagnose"
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">troubleshoot</span>
                                        </button>

                                        {confirmDeleteId === container.id ? (
                                            <div className="inline-flex items-center gap-1 ml-auto">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDockerAction(container.id, 'rm')}
                                                    disabled={isProtected || isBusy}
                                                    className="kai-btn kai-btn-danger kai-btn-xs"
                                                >
                                                    Confirm
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
                                                onClick={() => setConfirmDeleteId(container.id)}
                                                disabled={isProtected || isBusy}
                                                className="kai-btn kai-btn-ghost kai-btn-xs !px-1.5 ml-auto"
                                                aria-label={`Delete ${cleanName}`}
                                                title={isProtected ? 'Protected container cannot be deleted' : 'Delete container'}
                                            >
                                                <span className="material-symbols-outlined text-[16px]" style={{ color: 'var(--danger-color)' }} aria-hidden="true">
                                                    delete
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <CreateContainerModal
                isOpen={isCreateModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onSubmit={handleContainerSubmit}
                initialData={editingContainerSpec}
                initialTab={createModalTab}
            />

            <ContainerAutoUpdateModal
                isOpen={autoUpdateModal.open}
                initialContainer={autoUpdateModal.containerName}
                onClose={() => setAutoUpdateModal({ open: false })}
            />

            <ContainerLogsModal
                containerId={logsTarget?.id ?? null}
                containerName={logsTarget?.name ?? ''}
                onClose={() => setLogsTarget(null)}
            />

            <AdvancedDeploymentModal
                isOpen={isAdvancedModalOpen}
                onClose={() => setAdvancedModalOpen(false)}
                onDeployed={() => {}}
            />

            {isAppStoreOpen && (
                <AppStoreModal
                    onClose={() => setAppStoreOpen(false)}
                    onDeployed={() => {}}
                />
            )}

            <TerminalModal
                isOpen={isTerminalOpen}
                onClose={() => setTerminalOpen(false)}
            />

            {isNetworkVisualizerOpen && (
                <NetworkVisualizerModal onClose={() => setNetworkVisualizerOpen(false)} />
            )}

            {isCronManagerOpen && (
                <CronManagerModal onClose={() => setCronManagerOpen(false)} />
            )}
        </div>
    );
}
