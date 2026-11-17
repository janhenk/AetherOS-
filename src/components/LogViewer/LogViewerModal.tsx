import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/useAppContext';
import { apiFetch } from '../../utils/api';

type LogSource = 'updater' | 'agent' | 'comms';

const LOG_TABS: { id: LogSource; label: string; icon: string }[] = [
    { id: 'updater', label: 'Updater', icon: 'system_update' },
    { id: 'agent', label: 'Agent Loop', icon: 'smart_toy' },
    { id: 'comms', label: 'Comms & Audit', icon: 'forum' },
];

const LogViewerModal = memo(function LogViewerModal() {
    const { state, dispatch } = useAppContext();
    const [activeTab, setActiveTab] = useState<LogSource>('updater');
    const [logs, setLogs] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const [copied, setCopied] = useState(false);
    const terminalRef = useRef<HTMLPreElement>(null);

    const handleClose = useCallback(() => {
        dispatch({ type: 'TOGGLE_LOG_VIEWER' });
    }, [dispatch]);

    useEffect(() => {
        if (!state.isLogViewerOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleClose, state.isLogViewerOpen]);

    useEffect(() => {
        if (!state.isLogViewerOpen) return;

        let isMounted = true;
        const fetchLogs = async () => {
            try {
                const res = await apiFetch(`/api/logs/${activeTab}`);
                if (res.ok && isMounted) {
                    const data = (await res.json()) as { logs?: string };
                    setLogs(data.logs || '[SYSTEM] No logs available.');
                }
            } catch (err: unknown) {
                if (isMounted) {
                    const message = err instanceof Error ? err.message : 'Unknown error';
                    setLogs(`[SYSTEM] Error retrieving logs: ${message}`);
                }
            }
        };

        void fetchLogs();
        const interval = window.setInterval(() => {
            void fetchLogs();
        }, 3000);

        return () => {
            isMounted = false;
            window.clearInterval(interval);
        };
    }, [activeTab, state.isLogViewerOpen]);

    const filteredLogs = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return logs;
        return logs
            .split('\n')
            .filter((line) => line.toLowerCase().includes(query))
            .join('\n');
    }, [logs, searchQuery]);

    useEffect(() => {
        if (autoScroll && terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [filteredLogs, autoScroll]);

    const handleScroll = () => {
        if (!terminalRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
        setAutoScroll(isAtBottom);
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(filteredLogs || logs);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch (err: unknown) {
            console.error('Failed to copy logs:', err);
        }
    };

    if (!state.isLogViewerOpen) return null;

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="System Logs"
            onClick={(e) => {
                if (e.target === e.currentTarget) handleClose();
            }}
        >
            <div className="kai-modal" style={{ maxWidth: '64rem', height: '82vh' }}>
                {/* Header */}
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-xl" style={{ color: 'var(--accent-primary)' }}>
                            article
                        </span>
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                System Logs
                            </h2>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Live service diagnostics and audit stream
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="kai-badge kai-badge-accent kai-tabular">
                            <span
                                className="h-1.5 w-1.5 rounded-full animate-pulse"
                                style={{ backgroundColor: 'var(--accent-primary)' }}
                            />
                            Polling: 3s
                        </span>
                        <button
                            type="button"
                            onClick={handleClose}
                            className="kai-btn kai-btn-ghost kai-btn-icon"
                            aria-label="Close system logs"
                        >
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>
                </div>

                {/* Controls Bar */}
                <div
                    className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0"
                    style={{
                        backgroundColor: 'var(--bg-secondary)',
                        borderColor: 'var(--border-subtle)',
                    }}
                >
                    <div className="flex flex-wrap items-center gap-1.5">
                        {LOG_TABS.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`kai-btn kai-btn-sm ${isActive ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                >
                                    <span className="material-symbols-outlined text-base">{tab.icon}</span>
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
                        <div className="relative flex-1 sm:w-64">
                            <span
                                className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-base pointer-events-none"
                                style={{ color: 'var(--text-muted)' }}
                            >
                                search
                            </span>
                            <input
                                type="text"
                                className="kai-input"
                                style={{ minHeight: '2rem', paddingLeft: '2.1rem', fontSize: 'var(--text-xs)' }}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Filter log lines..."
                                aria-label="Filter log lines"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                void handleCopy();
                            }}
                            className="kai-btn kai-btn-secondary kai-btn-sm shrink-0"
                        >
                            <span className="material-symbols-outlined text-base">
                                {copied ? 'check' : 'content_copy'}
                            </span>
                            <span>{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                    </div>
                </div>

                {/* Log Output */}
                <div className="flex-1 min-h-0 relative flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <pre
                        ref={terminalRef}
                        onScroll={handleScroll}
                        className="flex-1 p-4 overflow-y-auto text-xs kai-mono whitespace-pre-wrap select-text leading-relaxed"
                        style={{ color: 'var(--text-primary)', tabSize: 2 }}
                    >
                        {filteredLogs || '[SYSTEM] No matching log lines.'}
                    </pre>

                    {!autoScroll && (
                        <div className="absolute bottom-4 right-4">
                            <button
                                type="button"
                                onClick={() => setAutoScroll(true)}
                                className="kai-btn kai-btn-primary kai-btn-sm"
                            >
                                <span className="material-symbols-outlined text-base">arrow_downward</span>
                                Resume Auto-Scroll
                            </button>
                        </div>
                    )}
                </div>

                <div className="kai-modal-footer justify-between">
                    <span className="text-xs kai-mono" style={{ color: 'var(--text-muted)' }}>
                        Source: {activeTab}
                    </span>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="kai-btn kai-btn-secondary kai-btn-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
});

export default LogViewerModal;
