import { memo, useState, useEffect, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { apiFetch } from '../../utils/api';

const LogViewerModal = memo(function LogViewerModal() {
    const { state, dispatch } = useAppContext();
    const [activeTab, setActiveTab] = useState<'updater' | 'agent' | 'comms'>('updater');
    const [logs, setLogs] = useState<string>('');
    const [autoScroll, setAutoScroll] = useState(true);
    const terminalRef = useRef<HTMLPreElement>(null);

    // Poll logs
    useEffect(() => {
        if (!state.isLogViewerOpen) return;

        let isMounted = true;
        const fetchLogs = async () => {
            try {
                const res = await apiFetch(`/api/logs/${activeTab}`);
                if (res.ok && isMounted) {
                    const data = await res.json();
                    setLogs(data.logs || '[SYSTEM] No logs available.');
                }
            } catch (err) {
                if (isMounted) setLogs('[SYSTEM] Error retrieving logs: ' + (err as Error).message);
            }
        };

        fetchLogs();
        const interval = setInterval(fetchLogs, 3000); // poll every 3 seconds
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [activeTab, state.isLogViewerOpen]);

    // Auto-scroll logic
    useEffect(() => {
        if (autoScroll && terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const handleScroll = () => {
        if (!terminalRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
        setAutoScroll(isAtBottom);
    };

    if (!state.isLogViewerOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={() => dispatch({ type: 'TOGGLE_LOG_VIEWER' })}
            />

            {/* Modal */}
            <div className="relative flex flex-col w-full max-w-5xl h-[80vh] bg-[#0a0f12]/95 border border-primary/20 rounded-2xl shadow-2xl shadow-primary/10 overflow-hidden transform transition-all">
                
                {/* Header elements */}
                <div className="absolute top-0 left-0 w-32 h-1 bg-gradient-to-r from-primary to-transparent" />
                <div className="absolute top-0 right-0 w-32 h-1 bg-gradient-to-l from-secondary to-transparent" />
                <div className="absolute -top-10 -left-10 w-40 h-40 bg-primary/5 rounded-full blur-3xl" />
                
                {/* Header */}
                <div className="flex items-center justify-between p-6 pb-4 border-b border-white/5 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="h-3 w-3 rounded-full bg-primary neon-aura-primary animate-pulse" />
                        <div>
                            <h2 className="text-xl font-bold uppercase tracking-[0.2em] text-white">System Diagnostics</h2>
                            <p className="text-xs text-primary/60 tracking-widest uppercase mt-1">Live Telemetry Feed</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => dispatch({ type: 'TOGGLE_LOG_VIEWER' })}
                        className="group flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/5 transition-colors"
                    >
                        <svg className="h-5 w-5 text-white/50 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar Tabs */}
                    <div className="w-48 bg-white/[0.02] border-r border-white/5 flex flex-col p-4 gap-2">
                        {['updater', 'agent', 'comms'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`px-4 py-3 text-left text-xs uppercase tracking-widest font-bold rounded-lg transition-all ${
                                    activeTab === tab 
                                    ? 'bg-primary/20 text-primary border border-primary/30' 
                                    : 'text-white/40 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                {tab === 'comms' ? 'Subspace Comms' : tab}
                            </button>
                        ))}
                    </div>
                    
                    {/* Log Terminal */}
                    <div className="flex-1 flex flex-col relative bg-black">
                        <pre 
                            ref={terminalRef}
                            onScroll={handleScroll}
                            className="flex-1 p-4 overflow-y-auto text-[11px] md:text-xs font-mono text-green-400 whitespace-pre-wrap select-text selection:bg-primary/30"
                            style={{ 
                                lineHeight: '1.4', 
                                tabSize: 2 
                            }}
                        >
                            {logs}
                        </pre>
                        
                        {/* Auto-scroll Status */}
                        {!autoScroll && (
                            <div className="absolute bottom-4 right-4 animate-fade-in fade-in">
                                <button 
                                    onClick={() => setAutoScroll(true)}
                                    className="bg-primary text-black text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 rounded-full shadow-lg shadow-black/50 hover:bg-white transition-colors"
                                >
                                    Resume Auto-Scroll ↓
                                </button>
                            </div>
                        )}
                        <div className="absolute top-0 right-0 p-2 text-[10px] text-white/20 font-mono uppercase">
                            Polling: 3s
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default LogViewerModal;
