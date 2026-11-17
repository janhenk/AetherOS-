import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/api';

interface ContainerLogsModalProps {
    containerId: string | null;
    containerName: string;
    onClose: () => void;
}

interface ContainerLogsContentProps {
    containerId: string;
    containerName: string;
    onClose: () => void;
}

type TailOption = 100 | 200 | 500;

function ContainerLogsContent({ containerId, containerName, onClose }: ContainerLogsContentProps) {
    const [tail, setTail] = useState<TailOption>(200);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [rawLogs, setRawLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const fetchLogs = useCallback(async (requestedTail: TailOption) => {
        try {
            const res = await apiFetch('/api/docker/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: containerId, tail: requestedTail })
            });
            const data = (await res.json().catch(() => ({}))) as { logs?: string; error?: string };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Failed to load logs (${res.status})`);
            }
            setRawLogs(typeof data.logs === 'string' ? data.logs : '');
            setError(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to load container logs.');
        } finally {
            setLoading(false);
        }
    }, [containerId]);

    useEffect(() => {
        let active = true;
        apiFetch('/api/docker/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: containerId, tail })
        })
            .then(async (res) => {
                const data = (await res.json().catch(() => ({}))) as { logs?: string; error?: string };
                if (!res.ok || data.error) {
                    throw new Error(data.error || `Failed to load logs (${res.status})`);
                }
                if (active) {
                    setRawLogs(typeof data.logs === 'string' ? data.logs : '');
                    setError(null);
                }
            })
            .catch((err: unknown) => {
                if (active) {
                    setError(err instanceof Error ? err.message : 'Failed to load container logs.');
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [containerId, tail]);

    useEffect(() => {
        if (!autoRefresh) return undefined;
        const interval = window.setInterval(() => {
            void fetchLogs(tail);
        }, 3000);
        return () => window.clearInterval(interval);
    }, [autoRefresh, fetchLogs, tail]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const lines = useMemo(() => (rawLogs ? rawLogs.split(/\r?\n/) : []), [rawLogs]);

    const filteredLines = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return lines;
        return lines.filter((line) => line.toLowerCase().includes(q));
    }, [lines, searchQuery]);

    const displayedLogs = useMemo(() => filteredLines.join('\n'), [filteredLines]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(displayedLogs);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to copy logs to clipboard.');
        }
    };

    const handleDownload = () => {
        const safeName = (containerName || containerId).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const blob = new Blob([displayedLogs], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeName}-logs.log`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="container-logs-title"
            onClick={onClose}
        >
            <div
                className="kai-modal max-w-4xl w-full"
                style={{ maxHeight: '88vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="material-symbols-outlined text-[22px]" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                            article
                        </span>
                        <div className="min-w-0">
                            <h2 id="container-logs-title" className="text-base font-semibold truncate">
                                Container Logs — {containerName}
                            </h2>
                            <p className="text-xs kai-mono truncate" style={{ color: 'var(--text-muted)' }}>
                                {containerId.slice(0, 12)} &bull; {filteredLines.length} / {lines.length} lines
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="kai-btn kai-btn-ghost kai-btn-sm kai-btn-icon"
                        onClick={onClose}
                        aria-label="Close container logs"
                        title="Close"
                    >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                    </button>
                </div>

                <div className="kai-modal-body flex flex-col gap-3 flex-1 min-h-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex-1 min-w-[200px]">
                            <label htmlFor="container-logs-search" className="sr-only">Filter log lines</label>
                            <input
                                id="container-logs-search"
                                type="search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Filter log output..."
                                className="kai-input"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <label htmlFor="container-logs-tail" className="kai-label text-xs whitespace-nowrap">
                                Tail
                            </label>
                            <select
                                id="container-logs-tail"
                                value={tail}
                                onChange={(e) => {
                                    setLoading(true);
                                    setTail(Number(e.target.value) as TailOption);
                                }}
                                className="kai-select w-auto"
                            >
                                <option value={100}>100 lines</option>
                                <option value={200}>200 lines</option>
                                <option value={500}>500 lines</option>
                            </select>
                        </div>

                        <label className="flex items-center gap-2 text-xs cursor-pointer select-none px-2 py-1 rounded" style={{ color: 'var(--text-secondary)' }}>
                            <input
                                type="checkbox"
                                className="kai-switch"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                            />
                            <span>Live (3s)</span>
                        </label>

                        <button
                            type="button"
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                            onClick={() => {
                                setLoading(true);
                                void fetchLogs(tail);
                            }}
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`} aria-hidden="true">
                                refresh
                            </span>
                            <span>Refresh</span>
                        </button>
                    </div>

                    {error && (
                        <div className="kai-alert kai-alert-error text-xs" role="alert">
                            {error}
                        </div>
                    )}

                    <div
                        className="flex-1 min-h-[320px] max-h-[55vh] overflow-auto rounded-md p-3"
                        style={{
                            backgroundColor: 'var(--bg-primary)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)'
                        }}
                    >
                        {loading && !rawLogs ? (
                            <p className="text-xs kai-mono" style={{ color: 'var(--text-muted)' }}>
                                Loading logs...
                            </p>
                        ) : displayedLogs ? (
                            <pre className="kai-mono text-xs leading-relaxed whitespace-pre-wrap break-all m-0">
                                {displayedLogs}
                            </pre>
                        ) : (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {searchQuery.trim() ? 'No log lines match your filter.' : 'No logs recorded for this container.'}
                            </p>
                        )}
                    </div>
                </div>

                <div className="kai-modal-footer justify-between">
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {autoRefresh && (
                            <span className="kai-badge kai-badge-accent">Auto-refreshing every 3s</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                            onClick={handleCopy}
                            disabled={!displayedLogs}
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                                {copied ? 'check' : 'content_copy'}
                            </span>
                            <span>{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                        <button
                            type="button"
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                            onClick={handleDownload}
                            disabled={!displayedLogs}
                        >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                                download
                            </span>
                            <span>Download .log</span>
                        </button>
                        <button
                            type="button"
                            className="kai-btn kai-btn-primary kai-btn-sm"
                            onClick={onClose}
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ContainerLogsModal({ containerId, containerName, onClose }: ContainerLogsModalProps) {
    if (!containerId) return null;
    return (
        <ContainerLogsContent
            key={containerId}
            containerId={containerId}
            containerName={containerName}
            onClose={onClose}
        />
    );
}
