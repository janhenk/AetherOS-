import React, { useState, useEffect } from 'react';
import type { DockerCreateSpec } from '../../types';

interface CreateContainerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (spec: DockerCreateSpec) => Promise<void>;
    initialData?: DockerCreateSpec;
}

export default function CreateContainerModal({ isOpen, onClose, onSubmit, initialData }: CreateContainerModalProps) {
    const [spec, setSpec] = useState<DockerCreateSpec>({
        image: '',
        name: '',
        ports: [],
        volumes: [],
        env: [],
        resources: { cpus: '', memory: '' }
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen && initialData) {
            setSpec(initialData);
        } else if (!isOpen) {
            // Reset on close
            setSpec({
                image: '', name: '', ports: [], volumes: [], env: [], resources: { cpus: '', memory: '' }
            });
        }
    }, [isOpen, initialData]);

    if (!isOpen) return null;

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
            <div className="relative z-10 w-full max-w-2xl bg-slate-900 border border-primary/20 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-primary/10 border-b border-primary/20 p-4 flex items-center justify-between pointer-events-none neon-aura-primary">
                    <h2 className="text-xl font-bold text-white tracking-widest uppercase">
                        {initialData ? 'Reconfigure Container Node' : 'Initialize New Container Node'}
                    </h2>
                    <span className="material-symbols-outlined text-primary text-2xl">deployed_code</span>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex flex-col gap-6">
                    {/* General Settings */}
                    <div className="flex flex-col gap-4">
                        <h3 className="text-sm font-bold text-primary tracking-widest uppercase border-b border-primary/20 pb-2">General Setup</h3>
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

                    <div className="flex justify-end gap-4 mt-4 pt-4 border-t border-primary/20">
                        <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-600 text-slate-300 font-bold uppercase tracking-widest text-xs hover:bg-slate-800 transition-colors">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-5 py-2 rounded-lg bg-primary/20 border border-primary/50 text-white font-bold uppercase tracking-widest text-xs hover:bg-primary transition-colors flex items-center gap-2">
                            {isSubmitting ? <span className="material-symbols-outlined animate-spin text-sm">sync</span> : null}
                            {initialData ? 'Re-deploy Node' : 'Deploy Node'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
