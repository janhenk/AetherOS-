import React, { useState } from 'react';
import { apiFetch } from '../../utils/api';

interface AdvancedDeploymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDeployed: () => void;
}

export default function AdvancedDeploymentModal({ isOpen, onClose, onDeployed }: AdvancedDeploymentModalProps) {
    const [projectName, setProjectName] = useState('');
    const [composeData, setComposeData] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!projectName || !composeData) {
            setError('Project Name and Compose YAML are required.');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        try {
            const response = await apiFetch('/api/docker/compose-deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectName, composeData }),
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const data = await response.json();
                    throw new Error(data.error || 'Deployment failed');
                } else {
                    const text = await response.text();
                    throw new Error(`Server Error (${response.status}): ${text.slice(0, 100)}...`);
                }
            }

            onDeployed();
            onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background-dark/80 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative z-10 w-full max-w-3xl bg-slate-900 border border-primary/20 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-primary/10 border-b border-primary/20 p-4 flex items-center justify-between pointer-events-none neon-aura-primary">
                    <h2 className="text-xl font-bold text-white tracking-widest uppercase">
                        Advanced Compose Deployment
                    </h2>
                    <span className="material-symbols-outlined text-primary text-2xl">layers</span>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex flex-col gap-6">
                    {error && (
                        <div className="bg-secondary/10 border border-secondary/40 p-3 rounded text-secondary text-xs font-mono">
                            ERROR: {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1 text-primary">Project Name ◈</label>
                        <input
                            type="text"
                            value={projectName}
                            onChange={e => setProjectName(e.target.value)}
                            className="w-full bg-black/40 border border-primary/20 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary font-mono placeholder-slate-600"
                            placeholder="e.g. microservices-stack"
                            required
                        />
                        <p className="text-[9px] text-slate-500 mt-1 uppercase tracking-wider">Unique identifier for this stack cluster.</p>
                    </div>

                    <div className="flex-1 min-h-[300px] flex flex-col">
                        <label className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1 text-primary">Docker Compose YAML (Manifest) ◈</label>
                        <textarea
                            value={composeData}
                            onChange={e => setComposeData(e.target.value)}
                            className="flex-1 w-full bg-black/60 border border-primary/20 rounded p-4 text-xs text-emerald-400 focus:outline-none focus:border-primary font-mono resize-none leading-relaxed"
                            placeholder="services:&#10;  app:&#10;    image: nginx:latest&#10;    ports:&#10;      - '8080:80'"
                            spellCheck={false}
                            required
                        />
                    </div>

                    <div className="flex justify-end gap-4 mt-4 pt-4 border-t border-primary/20">
                        <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-600 text-slate-300 font-bold uppercase tracking-widest text-xs hover:bg-slate-800 transition-colors">Abort</button>
                        <button type="submit" disabled={isSubmitting} className="px-8 py-2 rounded-lg bg-primary/20 border border-primary/50 text-white font-bold uppercase tracking-widest text-xs hover:bg-primary transition-colors flex items-center gap-2">
                            {isSubmitting ? <span className="material-symbols-outlined animate-spin text-sm">sync</span> : null}
                            Initialize Stack Deployment ◈
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
