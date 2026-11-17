import { useEffect } from 'react';
import CronManager from './CronManager';

interface Props {
    onClose: () => void;
}

export default function CronManagerModal({ onClose }: Props) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Scheduled Jobs"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="kai-modal" style={{ maxWidth: '46rem' }}>
                <div className="kai-modal-header">
                    <div className="flex items-center gap-2.5">
                        <span
                            className="material-symbols-outlined text-xl"
                            style={{ color: 'var(--accent-primary)' }}
                        >
                            schedule
                        </span>
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                Scheduled Jobs
                            </h2>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Automated agent task scheduler
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="kai-btn kai-btn-ghost kai-btn-icon"
                        aria-label="Close scheduled jobs modal"
                    >
                        <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>

                <div className="kai-modal-body">
                    <CronManager />
                </div>

                <div className="kai-modal-footer">
                    <button
                        type="button"
                        onClick={onClose}
                        className="kai-btn kai-btn-secondary kai-btn-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
