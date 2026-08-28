import CronManager from './CronManager';

interface Props {
    onClose: () => void;
}

export default function CronManagerModal({ onClose }: Props) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div
                className="glass-panel rounded-2xl flex flex-col overflow-hidden border border-primary/20 shadow-2xl"
                style={{ width: 680, maxHeight: '85vh' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
                    <div>
                        <h2 className="text-sm font-bold text-white tracking-widest uppercase">Scheduled Protocols</h2>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">Automated agent task scheduler</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="material-symbols-outlined text-white/40 hover:text-white transition-colors text-xl"
                    >close</button>
                </div>
                <div className="overflow-auto p-6 flex-1">
                    <CronManager />
                </div>
            </div>
        </div>
    );
}
