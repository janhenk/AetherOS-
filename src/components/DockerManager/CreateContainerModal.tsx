import React, { useState, useEffect, useMemo } from 'react';
import type { DockerCreateSpec } from '../../types';
import { downloadCompose, specToCompose, composeServiceName } from '../../utils/compose';
import { apiFetch } from '../../utils/api';

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Sorts every mapping list alphabetically so a reconfigure always reads in a stable, predictable order. */
function sortSpec(spec: DockerCreateSpec): DockerCreateSpec {
    return {
        ...spec,
        ports: [...(spec.ports || [])].sort((a, b) => byName(a.container, b.container)),
        volumes: [...(spec.volumes || [])].sort((a, b) => byName(a.container, b.container)),
        env: [...(spec.env || [])].sort((a, b) => byName(a.key, b.key)),
        networks: [...(spec.networks || [])].sort((a, b) => byName(a, b)),
        networkMode: spec.networkMode || 'bridge'
    };
}

interface CreateContainerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (spec: DockerCreateSpec) => Promise<void>;
    initialData?: DockerCreateSpec;
    initialTab?: 'config' | 'compose';
}

export default function CreateContainerModal({ isOpen, onClose, onSubmit, initialData, initialTab = 'config' }: CreateContainerModalProps) {
    const [spec, setSpec] = useState<DockerCreateSpec>({
        image: '',
        name: '',
        ports: [],
        volumes: [],
        env: [],
        resources: { cpus: '', memory: '' },
        networks: ['bridge'],
        networkMode: 'bridge'
    });
    const [activeTab, setActiveTab] = useState<'config' | 'compose'>(initialTab);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [availableNetworks, setAvailableNetworks] = useState<string[]>([]);
    const [customNetInput, setCustomNetInput] = useState('');

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
            if (initialData) {
                const sorted = sortSpec(initialData);
                // Ensure networks is populated if empty
                if (!sorted.networks || sorted.networks.length === 0) {
                    sorted.networks = [sorted.networkMode || 'bridge'];
                }
                setSpec(sorted);
            } else {
                setSpec({
                    image: '',
                    name: '',
                    ports: [],
                    volumes: [],
                    env: [],
                    resources: { cpus: '', memory: '' },
                    networks: ['bridge'],
                    networkMode: 'bridge'
                });
            }

            // Fetch available docker networks from host
            apiFetch('/api/docker/networks')
                .then(res => res.ok ? res.json() : { networks: [] })
                .then(data => {
                    const names = (data.networks || []).map((n: any) => n.name).filter(Boolean);
                    const defaultNets = ['bridge', 'host', 'none'];
                    const combined = Array.from(new Set([...defaultNets, ...names]));
                    setAvailableNetworks(combined);
                })
                .catch(() => {
                    setAvailableNetworks(['bridge', 'host', 'none']);
                });
        }
    }, [isOpen, initialData, initialTab]);

    const composeYaml = useMemo(() => {
        return specToCompose(spec);
    }, [spec]);

    if (!isOpen) return null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(composeYaml);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy compose YAML', err);
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
            newNets = currentNets.filter(n => n !== netName);
            if (newNets.length === 0) newNets = ['bridge'];
        } else {
            // Remove 'host' or 'none' if adding custom/bridge network
            newNets = [...currentNets.filter(n => n !== 'host' && n !== 'none'), netName];
        }
        setSpec({ ...spec, networks: newNets, networkMode: newNets[0] || 'bridge' });
    };

    const handleAddCustomNetwork = () => {
        const trimmed = customNetInput.trim();
        if (!trimmed) return;
        const currentNets = spec.networks || [];
        if (!currentNets.includes(trimmed)) {
            const newNets = [...currentNets.filter(n => n !== 'host' && n !== 'none'), trimmed];
            setSpec({ ...spec, networks: newNets, networkMode: newNets[0] || 'bridge' });
        }
        if (!availableNetworks.includes(trimmed)) {
            setAvailableNetworks([...availableNetworks, trimmed]);
        }
        setCustomNetInput('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await onSubmit(spec);
            onClose();
        } catch (err) {
            console.error("Failed to create container", err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background-dark/80 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative z-10 w-full max-w-3xl bg-slate-900 border border-primary/20 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-primary/10 border-b border-primary/20 p-4 flex items-center justify-between shrink-0 neon-aura-primary">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary text-2xl">deployed_code</span>
                        <div>
                            <h2 className="text-lg font-bold text-white tracking-widest uppercase">
                                {initialData ? 'Reconfigure Container Node' : 'Initialize New Container Node'}
                            </h2>
                            <p className="text-[10px] text-primary/70 font-mono uppercase tracking-wider">
                                {spec.name ? spec.name : 'Unspecified Instance'} &bull; {spec.image || 'No Image'}
                            </p>
                        </div>
                    </div>

                    {/* View Switcher Tabs */}
                    <div className="flex items-center bg-black/40 border border-primary/30 rounded-lg p-1">
                        <button
                            type="button"
                            onClick={() => setActiveTab('config')}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'config' ? 'bg-primary text-black' : 'text-slate-300 hover:text-white'}`}
                        >
                            <span className="material-symbols-outlined text-sm">tune</span>
                            Config Form
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('compose')}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'compose' ? 'bg-primary text-black' : 'text-slate-300 hover:text-white'}`}
                        >
                            <span className="material-symbols-outlined text-sm">description</span>
                            Compose View
                        </button>
                    </div>
                </div>

                {/* Form or Compose Content */}
                <form id="container-node-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
                    {activeTab === 'config' ? (
                        <>
                            {/* General Settings */}
                            <div className="flex flex-col gap-4">
                                <h3 className="text-sm font-bold text-primary tracking-widest uppercase border-b border-primary/20 pb-2 flex items-center justify-between">
                                    <span>General Setup</span>
                                    <span className="text-[10px] text-slate-400 font-mono lowercase">core identity</span>
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">Container Name (Optional)</label>
                                        <input
                                            type="text"
                                            value={spec.name || ''}
                                            onChange={e => setSpec({ ...spec, name: e.target.value })}
                                            className="w-full bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary font-mono placeholder-slate-600"
                                            placeholder="e.g. redis-cache"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1 text-primary">Image / Tag *</label>
                                        <input
                                            type="text"
                                            required
                                            value={spec.image}
                                            onChange={e => setSpec({ ...spec, image: e.target.value })}
                                            className="w-full bg-black/40 border border-primary/40 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary font-mono placeholder-slate-600"
                                            placeholder="e.g. nginx:latest"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Network Configuration */}
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between border-b border-primary/20 pb-2">
                                    <h3 className="text-sm font-bold text-primary tracking-widest uppercase flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">hub</span>
                                        Network Settings
                                    </h3>
                                    <span className="text-[10px] text-slate-400 font-mono uppercase">
                                        Mode: {spec.networkMode || 'bridge'}
                                    </span>
                                </div>

                                <div className="bg-black/30 border border-primary/10 rounded-lg p-3 flex flex-col gap-3">
                                    <div>
                                        <label className="block text-[10px] text-slate-400 uppercase tracking-widest mb-2">Network Mode</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { id: 'bridge', label: 'Bridge (Default)', desc: 'Standard isolated container bridge' },
                                                { id: 'host', label: 'Host Network', desc: 'Direct access to host networking' },
                                                { id: 'none', label: 'None (Isolated)', desc: 'Disabled networking' }
                                            ].map(mode => (
                                                <button
                                                    key={mode.id}
                                                    type="button"
                                                    onClick={() => handleNetworkToggle(mode.id)}
                                                    className={`p-2 rounded border text-left flex flex-col gap-1 transition-all ${spec.networkMode === mode.id || (mode.id === 'bridge' && (!spec.networkMode || spec.networkMode === 'bridge') && !spec.networks?.includes('host') && !spec.networks?.includes('none')) ? 'border-primary bg-primary/20 text-white' : 'border-white/10 bg-black/40 text-slate-400 hover:border-white/20'}`}
                                                >
                                                    <span className="text-xs font-bold uppercase tracking-wider">{mode.label}</span>
                                                    <span className="text-[9px] text-slate-400 leading-tight">{mode.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {spec.networkMode !== 'host' && spec.networkMode !== 'none' && (
                                        <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                                            <label className="block text-[10px] text-slate-400 uppercase tracking-widest">
                                                Attached Networks (Multi-network Support)
                                            </label>
                                            <div className="flex flex-wrap gap-2">
                                                {availableNetworks.map(net => {
                                                    const isSelected = spec.networks?.includes(net);
                                                    return (
                                                        <button
                                                            key={net}
                                                            type="button"
                                                            onClick={() => handleNetworkToggle(net)}
                                                            className={`px-3 py-1 rounded-full text-xs font-mono flex items-center gap-1.5 transition-all ${isSelected ? 'bg-primary text-black font-bold shadow-sm' : 'bg-white/5 text-slate-300 border border-white/10 hover:border-primary/40'}`}
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                                                            </span>
                                                            {net}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Add Custom Network Input */}
                                            <div className="flex gap-2 items-center mt-2">
                                                <input
                                                    type="text"
                                                    value={customNetInput}
                                                    onChange={e => setCustomNetInput(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomNetwork(); } }}
                                                    className="flex-1 bg-black/40 border border-primary/20 rounded px-3 py-1.5 text-xs text-white font-mono placeholder-slate-600"
                                                    placeholder="Attach custom Docker network name (e.g. traefik-net)..."
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleAddCustomNetwork}
                                                    className="px-3 py-1.5 rounded bg-primary/20 hover:bg-primary text-white font-bold text-xs uppercase tracking-wider transition-colors"
                                                >
                                                    + Attach Network
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Resources */}
                            <div className="flex flex-col gap-4">
                                <h3 className="text-sm font-bold text-primary tracking-widest uppercase border-b border-primary/20 pb-2">Resource Allocation</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">CPU Limit</label>
                                        <input
                                            type="text"
                                            value={spec.resources?.cpus || ''}
                                            onChange={e => setSpec({ ...spec, resources: { ...spec.resources, cpus: e.target.value } })}
                                            className="w-full bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary font-mono placeholder-slate-600"
                                            placeholder="e.g. 1.5"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">Memory Limit</label>
                                        <input
                                            type="text"
                                            value={spec.resources?.memory || ''}
                                            onChange={e => setSpec({ ...spec, resources: { ...spec.resources, memory: e.target.value } })}
                                            className="w-full bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary font-mono placeholder-slate-600"
                                            placeholder="e.g. 512m or 1g"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Ports */}
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between border-b border-primary/20 pb-2">
                                    <h3 className="text-sm font-bold text-primary tracking-widest uppercase">Port Mappings</h3>
                                    <button type="button" onClick={() => setSpec({ ...spec, ports: [...(spec.ports || []), { host: '', container: '' }] })} className="text-[10px] bg-primary/20 hover:bg-primary text-white px-2 py-1 rounded uppercase tracking-wider font-bold transition-colors">Add Port</button>
                                </div>
                                {spec.networkMode === 'host' && (
                                    <p className="text-[11px] text-amber-400 font-mono bg-amber-500/10 border border-amber-500/20 p-2 rounded">
                                        Note: Host networking is active. Container uses host network interfaces directly.
                                    </p>
                                )}
                                {spec.ports?.map((port, idx) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <input type="text" value={port.host} onChange={e => {
                                            const newPorts = [...(spec.ports || [])];
                                            newPorts[idx].host = e.target.value;
                                            setSpec({ ...spec, ports: newPorts });
                                        }} className="flex-1 bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white font-mono" placeholder="Host Port (e.g. 8080)" />
                                        <span className="text-primary font-bold">:</span>
                                        <input type="text" value={port.container} onChange={e => {
                                            const newPorts = [...(spec.ports || [])];
                                            newPorts[idx].container = e.target.value;
                                            setSpec({ ...spec, ports: newPorts });
                                        }} className="flex-1 bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white font-mono" placeholder="Container Port (e.g. 80)" />
                                        <button type="button" onClick={() => {
                                            const newPorts = [...(spec.ports || [])];
                                            newPorts.splice(idx, 1);
                                            setSpec({ ...spec, ports: newPorts });
                                        }} className="material-symbols-outlined text-secondary hover:text-red-400 p-1">close</button>
                                    </div>
                                ))}
                            </div>

                            {/* Volumes */}
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between border-b border-primary/20 pb-2">
                                    <h3 className="text-sm font-bold text-primary tracking-widest uppercase">Volume Mappings</h3>
                                    <button type="button" onClick={() => setSpec({ ...spec, volumes: [...(spec.volumes || []), { host: '', container: '' }] })} className="text-[10px] bg-primary/20 hover:bg-primary text-white px-2 py-1 rounded uppercase tracking-wider font-bold transition-colors">Add Volume</button>
                                </div>
                                {spec.volumes?.map((vol, idx) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <input type="text" value={vol.host} onChange={e => {
                                            const newVols = [...(spec.volumes || [])];
                                            newVols[idx].host = e.target.value;
                                            setSpec({ ...spec, volumes: newVols });
                                        }} className="flex-1 bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white font-mono" placeholder="Host Path (e.g. /data/db)" />
                                        <span className="text-primary font-bold">:</span>
                                        <input type="text" value={vol.container} onChange={e => {
                                            const newVols = [...(spec.volumes || [])];
                                            newVols[idx].container = e.target.value;
                                            setSpec({ ...spec, volumes: newVols });
                                        }} className="flex-1 bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white font-mono" placeholder="Container Path (e.g. /var/lib/mysql)" />
                                        <button type="button" onClick={() => {
                                            const newVols = [...(spec.volumes || [])];
                                            newVols.splice(idx, 1);
                                            setSpec({ ...spec, volumes: newVols });
                                        }} className="material-symbols-outlined text-secondary hover:text-red-400 p-1">close</button>
                                    </div>
                                ))}
                            </div>

                            {/* Environment Variables */}
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between border-b border-primary/20 pb-2">
                                    <h3 className="text-sm font-bold text-primary tracking-widest uppercase">Environment Variables</h3>
                                    <button type="button" onClick={() => setSpec({ ...spec, env: [...(spec.env || []), { key: '', value: '' }] })} className="text-[10px] bg-primary/20 hover:bg-primary text-white px-2 py-1 rounded uppercase tracking-wider font-bold transition-colors">Add Env</button>
                                </div>
                                {spec.env?.map((env, idx) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <input type="text" value={env.key} onChange={e => {
                                            const newEnvs = [...(spec.env || [])];
                                            newEnvs[idx].key = e.target.value;
                                            setSpec({ ...spec, env: newEnvs });
                                        }} className="flex-1 bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white font-mono" placeholder="KEY (e.g. NODE_ENV)" />
                                        <span className="text-primary font-bold">=</span>
                                        <input type="text" value={env.value} onChange={e => {
                                            const newEnvs = [...(spec.env || [])];
                                            newEnvs[idx].value = e.target.value;
                                            setSpec({ ...spec, env: newEnvs });
                                        }} className="flex-1 bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white font-mono" placeholder="VALUE" />
                                        <button type="button" onClick={() => {
                                            const newEnvs = [...(spec.env || [])];
                                            newEnvs.splice(idx, 1);
                                            setSpec({ ...spec, env: newEnvs });
                                        }} className="material-symbols-outlined text-secondary hover:text-red-400 p-1">close</button>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        /* Compose View Tab */
                        <div className="flex flex-col gap-4 h-full">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-bold text-primary tracking-widest uppercase flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">code</span>
                                        Docker Compose Manifest
                                    </h3>
                                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                        Generated compose specification for {composeServiceName(spec)}
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary text-primary hover:text-black font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5"
                                    >
                                        <span className="material-symbols-outlined text-sm">
                                            {copied ? 'check' : 'content_copy'}
                                        </span>
                                        {copied ? 'Copied!' : 'Copy YAML'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => downloadCompose(spec)}
                                        disabled={!spec.image}
                                        className="px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-black font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <span className="material-symbols-outlined text-sm">download</span>
                                        Export Compose
                                    </button>
                                </div>
                            </div>

                            <div className="relative flex-1 min-h-[340px] bg-black/60 border border-primary/30 rounded-xl p-4 overflow-auto font-mono text-xs text-emerald-400 leading-relaxed shadow-inner">
                                <pre className="font-mono whitespace-pre">{composeYaml}</pre>
                            </div>
                        </div>
                    )}
                </form>

                {/* Fixed Sticky Footer */}
                <div className="p-4 border-t border-primary/20 bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => downloadCompose(spec)}
                            disabled={!spec.image}
                            className="px-4 py-2 rounded-lg border border-primary/40 text-primary font-bold uppercase tracking-widest text-xs hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            title="Download configuration as docker-compose.yml"
                        >
                            <span className="material-symbols-outlined text-sm">download</span>
                            Export Compose
                        </button>
                        {activeTab === 'config' ? (
                            <button
                                type="button"
                                onClick={() => setActiveTab('compose')}
                                className="px-3 py-2 rounded-lg border border-white/10 text-slate-300 font-bold uppercase tracking-widest text-xs hover:bg-white/5 transition-colors flex items-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-sm">visibility</span>
                                View Compose
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setActiveTab('config')}
                                className="px-3 py-2 rounded-lg border border-white/10 text-slate-300 font-bold uppercase tracking-widest text-xs hover:bg-white/5 transition-colors flex items-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-sm">edit</span>
                                Edit Config
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2 rounded-lg border border-slate-600 text-slate-300 font-bold uppercase tracking-widest text-xs hover:bg-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            form="container-node-form"
                            disabled={isSubmitting || !spec.image}
                            className="px-6 py-2 rounded-lg bg-primary/20 border border-primary/50 text-white font-bold uppercase tracking-widest text-xs hover:bg-primary hover:text-black transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? <span className="material-symbols-outlined animate-spin text-sm">sync</span> : null}
                            {initialData ? 'Re-deploy Node' : 'Deploy Node'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
