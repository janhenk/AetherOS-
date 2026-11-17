import React, { useEffect, useMemo, useState } from 'react';
import type { DockerCreateSpec } from '../../types';
import { composeServiceName, downloadCompose, specToCompose } from '../../utils/compose';
import { apiFetch } from '../../utils/api';

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const RESTART_POLICIES = [
    { value: 'unless-stopped', label: 'Unless Stopped (Recommended)' },
    { value: 'always', label: 'Always' },
    { value: 'on-failure', label: 'On Failure' },
    { value: 'no', label: 'No (Do not restart)' },
] as const;

function buildInitialSpec(initialData?: DockerCreateSpec): DockerCreateSpec {
    if (!initialData) {
        return {
            image: '',
            name: '',
            ports: [],
            volumes: [],
            env: [],
            resources: { cpus: '', memory: '' },
            networks: ['bridge'],
            networkMode: 'bridge',
            restartPolicy: 'unless-stopped',
            autoUpdate: {
                enabled: false,
                scheduleMode: 'global',
                cronExpression: ''
            }
        };
    }

    const networkMode = initialData.networkMode || 'bridge';
    const networks = [...(initialData.networks || [])].sort(byName);
    return {
        ...initialData,
        ports: [...(initialData.ports || [])].map((p) => ({ ...p })).sort((a, b) => byName(a.container, b.container)),
        volumes: [...(initialData.volumes || [])].map((v) => ({ ...v })).sort((a, b) => byName(a.container, b.container)),
        env: [...(initialData.env || [])].map((e) => ({ ...e })).sort((a, b) => byName(a.key, b.key)),
        resources: {
            cpus: initialData.resources?.cpus || '',
            memory: initialData.resources?.memory || ''
        },
        networks: networks.length > 0 ? networks : [networkMode],
        networkMode,
        restartPolicy: initialData.restartPolicy || 'no',
        autoUpdate: {
            enabled: Boolean(initialData.autoUpdate?.enabled),
            scheduleMode: initialData.autoUpdate?.scheduleMode || 'global',
            cronExpression: initialData.autoUpdate?.cronExpression || ''
        }
    };
}

interface CreateContainerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (spec: DockerCreateSpec) => Promise<void>;
    initialData?: DockerCreateSpec;
    initialTab?: 'config' | 'compose';
}

interface CreateContainerFormProps {
    onClose: () => void;
    onSubmit: (spec: DockerCreateSpec) => Promise<void>;
    initialData?: DockerCreateSpec;
    initialTab: 'config' | 'compose';
}

function CreateContainerForm({ onClose, onSubmit, initialData, initialTab }: CreateContainerFormProps) {
    const [spec, setSpec] = useState<DockerCreateSpec>(() => buildInitialSpec(initialData));
    const [activeTab, setActiveTab] = useState<'config' | 'compose'>(initialTab);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [availableNetworks, setAvailableNetworks] = useState<string[]>(['bridge', 'host', 'none']);
    const [customNetInput, setCustomNetInput] = useState('');

    useEffect(() => {
        let active = true;
        apiFetch('/api/docker/networks')
            .then((res) => (res.ok ? res.json() : { networks: [] }))
            .then((data: { networks?: Array<{ name?: string }> }) => {
                if (!active) return;
                const names = (data.networks || [])
                    .map((n) => n.name)
                    .filter((n): n is string => Boolean(n));
                setAvailableNetworks(Array.from(new Set(['bridge', 'host', 'none', ...names])));
            })
            .catch(() => {
                if (active) setAvailableNetworks(['bridge', 'host', 'none']);
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

    const composeYaml = useMemo(() => specToCompose(spec), [spec]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(composeYaml);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch (err: unknown) {
            setSubmitError(err instanceof Error ? err.message : 'Failed to copy Compose YAML.');
        }
    };

    const handleNetworkToggle = (netName: string) => {
        const currentNets = spec.networks || [];
        if (netName === 'host' || netName === 'none') {
            setSpec({ ...spec, networkMode: netName, networks: [netName] });
            return;
        }

        let newNets: string[];
        if (currentNets.includes(netName)) {
            newNets = currentNets.filter((n) => n !== netName);
            if (newNets.length === 0) newNets = ['bridge'];
        } else {
            newNets = [...currentNets.filter((n) => n !== 'host' && n !== 'none'), netName];
        }
        setSpec({ ...spec, networks: newNets, networkMode: newNets[0] || 'bridge' });
    };

    const handleAddCustomNetwork = () => {
        const trimmed = customNetInput.trim();
        if (!trimmed) return;
        const currentNets = spec.networks || [];
        if (!currentNets.includes(trimmed)) {
            const newNets = [...currentNets.filter((n) => n !== 'host' && n !== 'none'), trimmed];
            setSpec({ ...spec, networks: newNets, networkMode: newNets[0] || 'bridge' });
        }
        if (!availableNetworks.includes(trimmed)) {
            setAvailableNetworks((prev) => [...prev, trimmed]);
        }
        setCustomNetInput('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            await onSubmit(spec);
            onClose();
        } catch (err: unknown) {
            setSubmitError(err instanceof Error ? err.message : 'Failed to deploy container.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const autoUpdateEnabled = Boolean(spec.autoUpdate?.enabled);
    const scheduleMode = spec.autoUpdate?.scheduleMode || 'global';
    const cronExpression = spec.autoUpdate?.cronExpression || '';

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-container-title"
            onClick={onClose}
        >
            <div
                className="kai-modal max-w-3xl w-full"
                style={{ maxHeight: '90vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="kai-modal-header flex-wrap gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="material-symbols-outlined text-[24px]" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            deployed_code
                        </span>
                        <div className="min-w-0">
                            <h2 id="create-container-title" className="text-base font-semibold truncate">
                                {initialData ? 'Reconfigure Container' : 'Create Container'}
                            </h2>
                            <p className="text-xs kai-mono truncate" style={{ color: 'var(--text-muted)' }}>
                                {spec.name ? spec.name : 'Unnamed container'} &bull; {spec.image || 'No image selected'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                        <div className="inline-flex rounded-md p-0.5" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                            <button
                                type="button"
                                onClick={() => setActiveTab('config')}
                                className={`kai-btn kai-btn-xs ${activeTab === 'config' ? 'kai-btn-primary' : 'kai-btn-ghost'}`}
                            >
                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">tune</span>
                                <span>Configuration</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('compose')}
                                className={`kai-btn kai-btn-xs ${activeTab === 'compose' ? 'kai-btn-primary' : 'kai-btn-ghost'}`}
                            >
                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">description</span>
                                <span>Compose YAML</span>
                            </button>
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
                </div>

                <form id="container-node-form" onSubmit={handleSubmit} className="kai-modal-body flex flex-col gap-5">
                    {submitError && (
                        <div className="kai-alert kai-alert-error text-xs" role="alert">
                            {submitError}
                        </div>
                    )}

                    {activeTab === 'config' ? (
                        <>
                            {/* General Settings */}
                            <section className="kai-surface-subtle flex flex-col gap-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                    General Setup
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="kai-field">
                                        <label htmlFor="container-name-input" className="kai-label text-xs">
                                            Container Name
                                        </label>
                                        <input
                                            id="container-name-input"
                                            type="text"
                                            value={spec.name || ''}
                                            onChange={(e) => setSpec({ ...spec, name: e.target.value })}
                                            className="kai-input kai-mono"
                                            placeholder="e.g. redis-cache"
                                        />
                                    </div>
                                    <div className="kai-field">
                                        <label htmlFor="container-image-input" className="kai-label text-xs">
                                            Image / Tag *
                                        </label>
                                        <input
                                            id="container-image-input"
                                            type="text"
                                            required
                                            value={spec.image}
                                            onChange={(e) => setSpec({ ...spec, image: e.target.value })}
                                            className="kai-input kai-mono"
                                            placeholder="e.g. nginx:latest"
                                        />
                                    </div>
                                    <div className="kai-field">
                                        <label htmlFor="container-restart-select" className="kai-label text-xs">
                                            Restart Policy
                                        </label>
                                        <select
                                            id="container-restart-select"
                                            value={spec.restartPolicy || 'unless-stopped'}
                                            onChange={(e) => setSpec({ ...spec, restartPolicy: e.target.value })}
                                            className="kai-select"
                                        >
                                            {RESTART_POLICIES.map((policy) => (
                                                <option key={policy.value} value={policy.value}>
                                                    {policy.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </section>

                            {/* Auto-Update Policy */}
                            <section className="kai-surface-subtle flex flex-col gap-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                            Auto-Update Policy
                                        </h3>
                                        <p className="kai-help">
                                            Automatically pull newer image digests and recreate this container on schedule.
                                        </p>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            className="kai-switch"
                                            checked={autoUpdateEnabled}
                                            onChange={(e) =>
                                                setSpec({
                                                    ...spec,
                                                    autoUpdate: {
                                                        enabled: e.target.checked,
                                                        scheduleMode,
                                                        cronExpression
                                                    }
                                                })
                                            }
                                        />
                                        <span>Enable automatic pull &amp; redeploy</span>
                                    </label>
                                </div>

                                {autoUpdateEnabled && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                        <div className="kai-field">
                                            <label htmlFor="container-autoupdate-mode" className="kai-label text-xs">
                                                Schedule Mode
                                            </label>
                                            <select
                                                id="container-autoupdate-mode"
                                                value={scheduleMode}
                                                onChange={(e) =>
                                                    setSpec({
                                                        ...spec,
                                                        autoUpdate: {
                                                            enabled: true,
                                                            scheduleMode: e.target.value as 'global' | 'custom',
                                                            cronExpression
                                                        }
                                                    })
                                                }
                                                className="kai-select"
                                            >
                                                <option value="global">Global schedule</option>
                                                <option value="custom">Custom cron expression</option>
                                            </select>
                                        </div>

                                        {scheduleMode === 'custom' && (
                                            <div className="kai-field">
                                                <label htmlFor="container-autoupdate-cron" className="kai-label text-xs">
                                                    Custom Cron Expression
                                                </label>
                                                <input
                                                    id="container-autoupdate-cron"
                                                    type="text"
                                                    value={cronExpression}
                                                    onChange={(e) =>
                                                        setSpec({
                                                            ...spec,
                                                            autoUpdate: {
                                                                enabled: true,
                                                                scheduleMode: 'custom',
                                                                cronExpression: e.target.value
                                                            }
                                                        })
                                                    }
                                                    className="kai-input kai-mono"
                                                    placeholder="0 3 * * *"
                                                    required
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>

                            {/* Network Configuration */}
                            <section className="kai-surface-subtle flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                        Network Settings
                                    </h3>
                                    <span className="kai-badge kai-mono">Mode: {spec.networkMode || 'bridge'}</span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    {[
                                        { id: 'bridge', label: 'Bridge', desc: 'Isolated container bridge' },
                                        { id: 'host', label: 'Host', desc: 'Direct host networking' },
                                        { id: 'none', label: 'None', desc: 'Disable networking' }
                                    ].map((mode) => {
                                        const selected =
                                            spec.networkMode === mode.id ||
                                            (mode.id === 'bridge' &&
                                                (!spec.networkMode || spec.networkMode === 'bridge') &&
                                                !spec.networks?.includes('host') &&
                                                !spec.networks?.includes('none'));

                                        return (
                                            <button
                                                key={mode.id}
                                                type="button"
                                                onClick={() => handleNetworkToggle(mode.id)}
                                                className="p-2.5 rounded-md text-left flex flex-col gap-0.5 transition-colors"
                                                style={{
                                                    backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                                    border: `1px solid ${selected ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                                    color: 'var(--text-primary)'
                                                }}
                                            >
                                                <span className="text-xs font-semibold">{mode.label}</span>
                                                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                                    {mode.desc}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {spec.networkMode !== 'host' && spec.networkMode !== 'none' && (
                                    <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                        <span className="kai-label text-xs">Attached Networks</span>
                                        <div className="flex flex-wrap gap-2">
                                            {availableNetworks.map((net) => {
                                                const isSelected = Boolean(spec.networks?.includes(net));
                                                return (
                                                    <button
                                                        key={net}
                                                        type="button"
                                                        onClick={() => handleNetworkToggle(net)}
                                                        className={`kai-btn kai-btn-xs kai-mono ${isSelected ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                                                            {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                                                        </span>
                                                        <span>{net}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <div className="flex gap-2 items-center mt-1">
                                            <input
                                                type="text"
                                                value={customNetInput}
                                                onChange={(e) => setCustomNetInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleAddCustomNetwork();
                                                    }
                                                }}
                                                className="kai-input kai-mono flex-1"
                                                placeholder="Attach custom Docker network (e.g. proxy-net)"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleAddCustomNetwork}
                                                className="kai-btn kai-btn-secondary kai-btn-sm"
                                            >
                                                Attach Network
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </section>

                            {/* Resources */}
                            <section className="kai-surface-subtle flex flex-col gap-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                    Resource Limits
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="kai-field">
                                        <label htmlFor="container-cpu-limit" className="kai-label text-xs">CPU Limit</label>
                                        <input
                                            id="container-cpu-limit"
                                            type="text"
                                            value={spec.resources?.cpus || ''}
                                            onChange={(e) => setSpec({ ...spec, resources: { ...spec.resources, cpus: e.target.value } })}
                                            className="kai-input kai-mono"
                                            placeholder="e.g. 1.5"
                                        />
                                    </div>
                                    <div className="kai-field">
                                        <label htmlFor="container-mem-limit" className="kai-label text-xs">Memory Limit</label>
                                        <input
                                            id="container-mem-limit"
                                            type="text"
                                            value={spec.resources?.memory || ''}
                                            onChange={(e) => setSpec({ ...spec, resources: { ...spec.resources, memory: e.target.value } })}
                                            className="kai-input kai-mono"
                                            placeholder="e.g. 512m or 1g"
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Port Mappings */}
                            <section className="kai-surface-subtle flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                        Port Mappings
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setSpec({ ...spec, ports: [...(spec.ports || []), { host: '', container: '' }] })}
                                        className="kai-btn kai-btn-secondary kai-btn-xs"
                                    >
                                        Add Port
                                    </button>
                                </div>
                                {spec.networkMode === 'host' && (
                                    <div className="kai-alert kai-alert-warning text-xs">
                                        Host networking is active. Port mappings are ignored because the container uses host interfaces directly.
                                    </div>
                                )}
                                {spec.ports?.map((port, idx) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            value={port.host}
                                            onChange={(e) => {
                                                const newPorts = [...(spec.ports || [])];
                                                newPorts[idx] = { ...newPorts[idx], host: e.target.value };
                                                setSpec({ ...spec, ports: newPorts });
                                            }}
                                            className="kai-input kai-mono flex-1"
                                            placeholder="Host port (e.g. 8080)"
                                            aria-label={`Host port ${idx + 1}`}
                                        />
                                        <span className="kai-mono font-semibold" style={{ color: 'var(--text-muted)' }}>:</span>
                                        <input
                                            type="text"
                                            value={port.container}
                                            onChange={(e) => {
                                                const newPorts = [...(spec.ports || [])];
                                                newPorts[idx] = { ...newPorts[idx], container: e.target.value };
                                                setSpec({ ...spec, ports: newPorts });
                                            }}
                                            className="kai-input kai-mono flex-1"
                                            placeholder="Container port (e.g. 80)"
                                            aria-label={`Container port ${idx + 1}`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newPorts = [...(spec.ports || [])];
                                                newPorts.splice(idx, 1);
                                                setSpec({ ...spec, ports: newPorts });
                                            }}
                                            className="kai-btn kai-btn-ghost kai-btn-sm kai-btn-icon"
                                            aria-label="Remove port mapping"
                                            title="Remove port mapping"
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                                        </button>
                                    </div>
                                ))}
                            </section>

                            {/* Volume Mappings */}
                            <section className="kai-surface-subtle flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                        Volume Mappings
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setSpec({ ...spec, volumes: [...(spec.volumes || []), { host: '', container: '' }] })}
                                        className="kai-btn kai-btn-secondary kai-btn-xs"
                                    >
                                        Add Volume
                                    </button>
                                </div>
                                {spec.volumes?.map((vol, idx) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            value={vol.host}
                                            onChange={(e) => {
                                                const newVols = [...(spec.volumes || [])];
                                                newVols[idx] = { ...newVols[idx], host: e.target.value };
                                                setSpec({ ...spec, volumes: newVols });
                                            }}
                                            className="kai-input kai-mono flex-1"
                                            placeholder="Host path (e.g. /data/app)"
                                            aria-label={`Host path ${idx + 1}`}
                                        />
                                        <span className="kai-mono font-semibold" style={{ color: 'var(--text-muted)' }}>:</span>
                                        <input
                                            type="text"
                                            value={vol.container}
                                            onChange={(e) => {
                                                const newVols = [...(spec.volumes || [])];
                                                newVols[idx] = { ...newVols[idx], container: e.target.value };
                                                setSpec({ ...spec, volumes: newVols });
                                            }}
                                            className="kai-input kai-mono flex-1"
                                            placeholder="Container path (e.g. /var/lib/data)"
                                            aria-label={`Container path ${idx + 1}`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newVols = [...(spec.volumes || [])];
                                                newVols.splice(idx, 1);
                                                setSpec({ ...spec, volumes: newVols });
                                            }}
                                            className="kai-btn kai-btn-ghost kai-btn-sm kai-btn-icon"
                                            aria-label="Remove volume mapping"
                                            title="Remove volume mapping"
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                                        </button>
                                    </div>
                                ))}
                            </section>

                            {/* Environment Variables */}
                            <section className="kai-surface-subtle flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                        Environment Variables
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setSpec({ ...spec, env: [...(spec.env || []), { key: '', value: '' }] })}
                                        className="kai-btn kai-btn-secondary kai-btn-xs"
                                    >
                                        Add Variable
                                    </button>
                                </div>
                                {spec.env?.map((env, idx) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            value={env.key}
                                            onChange={(e) => {
                                                const newEnvs = [...(spec.env || [])];
                                                newEnvs[idx] = { ...newEnvs[idx], key: e.target.value };
                                                setSpec({ ...spec, env: newEnvs });
                                            }}
                                            className="kai-input kai-mono flex-1"
                                            placeholder="KEY (e.g. NODE_ENV)"
                                            aria-label={`Environment key ${idx + 1}`}
                                        />
                                        <span className="kai-mono font-semibold" style={{ color: 'var(--text-muted)' }}>=</span>
                                        <input
                                            type="text"
                                            value={env.value}
                                            onChange={(e) => {
                                                const newEnvs = [...(spec.env || [])];
                                                newEnvs[idx] = { ...newEnvs[idx], value: e.target.value };
                                                setSpec({ ...spec, env: newEnvs });
                                            }}
                                            className="kai-input kai-mono flex-1"
                                            placeholder="VALUE"
                                            aria-label={`Environment value ${idx + 1}`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newEnvs = [...(spec.env || [])];
                                                newEnvs.splice(idx, 1);
                                                setSpec({ ...spec, env: newEnvs });
                                            }}
                                            className="kai-btn kai-btn-ghost kai-btn-sm kai-btn-icon"
                                            aria-label="Remove environment variable"
                                            title="Remove environment variable"
                                        >
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                                        </button>
                                    </div>
                                ))}
                            </section>
                        </>
                    ) : (
                        <div className="flex flex-col gap-3 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold">Docker Compose Manifest</h3>
                                    <p className="text-xs kai-mono" style={{ color: 'var(--text-muted)' }}>
                                        Service: {composeServiceName(spec)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={handleCopy} className="kai-btn kai-btn-secondary kai-btn-sm">
                                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                                            {copied ? 'check' : 'content_copy'}
                                        </span>
                                        <span>{copied ? 'Copied' : 'Copy YAML'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => downloadCompose(spec)}
                                        disabled={!spec.image}
                                        className="kai-btn kai-btn-secondary kai-btn-sm"
                                    >
                                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span>
                                        <span>Export Compose</span>
                                    </button>
                                </div>
                            </div>

                            <div
                                className="flex-1 min-h-[320px] rounded-md p-4 overflow-auto"
                                style={{
                                    backgroundColor: 'var(--bg-primary)',
                                    border: '1px solid var(--border-subtle)',
                                    color: 'var(--text-primary)'
                                }}
                            >
                                <pre className="kai-mono text-xs whitespace-pre leading-relaxed m-0">{composeYaml}</pre>
                            </div>
                        </div>
                    )}
                </form>

                <div className="kai-modal-footer justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => downloadCompose(spec)}
                            disabled={!spec.image}
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                            title="Download configuration as docker-compose.yml"
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span>
                            <span>Export Compose</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab(activeTab === 'config' ? 'compose' : 'config')}
                            className="kai-btn kai-btn-ghost kai-btn-sm"
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                                {activeTab === 'config' ? 'visibility' : 'edit'}
                            </span>
                            <span>{activeTab === 'config' ? 'View Compose' : 'Edit Config'}</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <button type="button" onClick={onClose} className="kai-btn kai-btn-secondary">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            form="container-node-form"
                            disabled={isSubmitting || !spec.image}
                            className="kai-btn kai-btn-primary"
                        >
                            {isSubmitting && (
                                <span className="material-symbols-outlined animate-spin text-[16px]" aria-hidden="true">sync</span>
                            )}
                            <span>{initialData ? 'Redeploy Container' : 'Deploy Container'}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function CreateContainerModal({
    isOpen,
    onClose,
    onSubmit,
    initialData,
    initialTab = 'config'
}: CreateContainerModalProps) {
    if (!isOpen) return null;
    const formKey = `${initialData?.name || '__new__'}|${initialData?.image || ''}|${initialTab}`;
    return (
        <CreateContainerForm
            key={formKey}
            onClose={onClose}
            onSubmit={onSubmit}
            initialData={initialData}
            initialTab={initialTab}
        />
    );
}
