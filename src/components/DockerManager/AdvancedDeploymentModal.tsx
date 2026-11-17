import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api';

interface AdvancedDeploymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDeployed: () => void;
}

function AdvancedDeploymentForm({ onClose, onDeployed }: Omit<AdvancedDeploymentModalProps, 'isOpen'>) {
    const [projectName, setProjectName] = useState('');
    const [composeData, setComposeData] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!projectName.trim() || !composeData.trim()) {
            setError('Project name and Compose YAML are required.');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        try {
            const response = await apiFetch('/api/docker/compose-deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectName: projectName.trim(), composeData }),
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const data = (await response.json()) as { error?: string };
                    throw new Error(data.error || 'Deployment failed.');
                }
                const text = await response.text();
                throw new Error(`Server error (${response.status}): ${text.slice(0, 120)}`);
            }

            onDeployed();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Deployment failed.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="advanced-deploy-title"
            onClick={onClose}
        >
            <div
                className="kai-modal max-w-3xl w-full"
                style={{ maxHeight: '90vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-[22px]" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            layers
                        </span>
                        <div>
                            <h2 id="advanced-deploy-title" className="text-base font-semibold">
                                Deploy Compose Stack
                            </h2>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Provision a multi-service Docker Compose stack
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

                <form id="advanced-compose-form" onSubmit={handleSubmit} className="kai-modal-body flex flex-col gap-4 overflow-y-auto">
                    {error && (
                        <div className="kai-alert kai-alert-error text-xs" role="alert">
                            {error}
                        </div>
                    )}

                    <div className="kai-field">
                        <label htmlFor="compose-project-name" className="kai-label">
                            Project Name
                        </label>
                        <input
                            id="compose-project-name"
                            type="text"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            className="kai-input kai-mono"
                            placeholder="e.g. monitoring-stack"
                            required
                        />
                        <p className="kai-help">Unique identifier for this Compose project.</p>
                    </div>

                    <div className="kai-field flex-1 flex flex-col">
                        <label htmlFor="compose-yaml-input" className="kai-label">
                            Docker Compose YAML
                        </label>
                        <textarea
                            id="compose-yaml-input"
                            value={composeData}
                            onChange={(e) => setComposeData(e.target.value)}
                            className="kai-textarea kai-mono min-h-[280px] text-xs leading-relaxed"
                            placeholder={"services:\n  app:\n    image: nginx:latest\n    restart: unless-stopped\n    ports:\n      - \"8080:80\""}
                            spellCheck={false}
                            required
                        />
                    </div>
                </form>

                <div className="kai-modal-footer">
                    <button type="button" onClick={onClose} className="kai-btn kai-btn-secondary">
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="advanced-compose-form"
                        disabled={isSubmitting}
                        className="kai-btn kai-btn-primary"
                    >
                        {isSubmitting && (
                            <span className="material-symbols-outlined animate-spin text-[16px]" aria-hidden="true">sync</span>
                        )}
                        <span>{isSubmitting ? 'Deploying...' : 'Deploy Stack'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AdvancedDeploymentModal({ isOpen, onClose, onDeployed }: AdvancedDeploymentModalProps) {
    if (!isOpen) return null;
    return <AdvancedDeploymentForm onClose={onClose} onDeployed={onDeployed} />;
}
