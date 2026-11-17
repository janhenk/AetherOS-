import React, { useCallback, useEffect, useRef, useState } from 'react';
import './TerminalModal.css';
import { useAppContext } from '../../context/useAppContext';
import { apiFetch } from '../../utils/api';

interface TerminalModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface TerminalLine {
    type: 'input' | 'output' | 'error';
    content: string;
    cwd?: string;
    timestamp?: string;
}

function formatTimestamp(): string {
    const d = new Date();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    return `[${hh}:${mm}:${ss}]`;
}

export default function TerminalModal({ isOpen, onClose }: TerminalModalProps) {
    const { state, dispatch } = useAppContext();
    const [history, setHistory] = useState<TerminalLine[]>([]);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const [draftInput, setDraftInput] = useState('');
    const [inputValue, setInputValue] = useState('');
    const [currentCwd, setCurrentCwd] = useState('~');
    const [isExecuting, setIsExecuting] = useState(false);

    const bodyBottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const fetchCwd = useCallback(async () => {
        try {
            const res = await apiFetch('/api/terminal/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: '' }),
            });
            if (!res.ok) return;
            const data = (await res.json()) as { cwd?: string };
            if (data.cwd) setCurrentCwd(data.cwd);
        } catch (err: unknown) {
            console.error('Failed to query terminal working directory:', err);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        void fetchCwd();
        const timer = window.setTimeout(() => textareaRef.current?.focus(), 80);
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [fetchCwd, isOpen, onClose]);

    useEffect(() => {
        bodyBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history, isExecuting]);

    const handleExecute = useCallback(async () => {
        const cmd = inputValue.trim();
        if (!cmd || isExecuting) return;

        setHistory((prev) => [
            ...prev,
            { type: 'input', content: cmd, cwd: currentCwd, timestamp: formatTimestamp() },
        ]);
        setCommandHistory((prev) => (prev[prev.length - 1] === cmd ? prev : [...prev, cmd]));
        setHistoryIndex(-1);
        setDraftInput('');
        setInputValue('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        setIsExecuting(true);

        try {
            const res = await apiFetch('/api/terminal/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd }),
            });
            const data = (await res.json()) as { error?: string; output?: string; cwd?: string };

            if (cmd === 'aetheros --yolo-confirm') {
                dispatch({ type: 'SET_YOLO_MODE', payload: true });
            }

            if (data.error) {
                setHistory((prev) => [
                    ...prev,
                    { type: 'error', content: data.error || 'Command failed', timestamp: formatTimestamp() },
                ]);
            } else {
                setHistory((prev) => [
                    ...prev,
                    { type: 'output', content: data.output || '', timestamp: formatTimestamp() },
                ]);
            }
            if (data.cwd) setCurrentCwd(data.cwd);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Request failed';
            setHistory((prev) => [
                ...prev,
                { type: 'error', content: `Execution error: ${message}`, timestamp: formatTimestamp() },
            ]);
        } finally {
            setIsExecuting(false);
            window.setTimeout(() => textareaRef.current?.focus(), 50);
        }
    }, [currentCwd, dispatch, inputValue, isExecuting]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleExecute();
                return;
            }

            if (e.key === 'ArrowUp' && !e.shiftKey && commandHistory.length > 0) {
                e.preventDefault();
                if (historyIndex === -1) {
                    setDraftInput(inputValue);
                    const nextIdx = commandHistory.length - 1;
                    setHistoryIndex(nextIdx);
                    setInputValue(commandHistory[nextIdx] || '');
                } else {
                    const nextIdx = Math.max(0, historyIndex - 1);
                    setHistoryIndex(nextIdx);
                    setInputValue(commandHistory[nextIdx] || '');
                }
                return;
            }

            if (e.key === 'ArrowDown' && !e.shiftKey && historyIndex !== -1) {
                e.preventDefault();
                const nextIdx = historyIndex + 1;
                if (nextIdx >= commandHistory.length) {
                    setHistoryIndex(-1);
                    setInputValue(draftInput);
                } else {
                    setHistoryIndex(nextIdx);
                    setInputValue(commandHistory[nextIdx] || '');
                }
            }
        },
        [commandHistory, draftInput, handleExecute, historyIndex, inputValue],
    );

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
        setHistoryIndex(-1);
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    }, []);

    if (!isOpen) return null;

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Host Terminal"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="kai-modal" style={{ maxWidth: '68rem', height: '84vh' }}>
                {/* Header */}
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="material-symbols-outlined text-xl" style={{ color: 'var(--accent-primary)' }}>
                            terminal
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                    Host Terminal
                                </h2>
                                {state.isYoloMode && (
                                    <span className="kai-badge kai-badge-danger">Elevated Host Mode</span>
                                )}
                            </div>
                            <p className="text-xs kai-mono truncate" style={{ color: 'var(--text-muted)' }}>
                                {currentCwd}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <span className={`kai-badge ${isExecuting ? 'kai-badge-warning' : 'kai-badge-success'}`}>
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${isExecuting ? 'animate-pulse' : ''}`}
                                style={{
                                    backgroundColor: isExecuting ? 'var(--warning-color)' : 'var(--success-color)',
                                }}
                            />
                            {isExecuting ? 'Running' : 'Ready'}
                        </span>

                        {history.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setHistory([])}
                                className="kai-btn kai-btn-ghost kai-btn-sm"
                                title="Clear terminal output"
                            >
                                <span className="material-symbols-outlined text-base">delete_sweep</span>
                                <span>Clear</span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={onClose}
                            className="kai-btn kai-btn-ghost kai-btn-icon"
                            aria-label="Close terminal"
                        >
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>
                </div>

                {/* Output Area */}
                <div
                    className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 kai-mono text-xs leading-relaxed terminal-scroll"
                    style={{
                        backgroundColor: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                    }}
                    onClick={() => textareaRef.current?.focus()}
                >
                    <div className="pb-2 mb-2 border-b text-xs" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
                        Interactive shell ready. Use Up/Down arrows to navigate command history.
                    </div>

                    {history.map((line, i) => (
                        <div key={i} className="flex gap-3">
                            {line.type === 'input' && (
                                <>
                                    <span className="shrink-0 kai-tabular" style={{ color: 'var(--text-muted)' }}>
                                        {line.timestamp}
                                    </span>
                                    <span className="flex-1 font-semibold break-all" style={{ color: 'var(--text-primary)' }}>
                                        <span className="mr-2" style={{ color: 'var(--accent-primary)' }}>
                                            {line.cwd} $
                                        </span>
                                        {line.content}
                                    </span>
                                </>
                            )}
                            {line.type === 'output' && (
                                <>
                                    <span className="shrink-0 select-none text-transparent">{line.timestamp}</span>
                                    <span
                                        className="flex-1 whitespace-pre-wrap break-words"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {line.content}
                                    </span>
                                </>
                            )}
                            {line.type === 'error' && (
                                <>
                                    <span className="shrink-0 select-none text-transparent">{line.timestamp}</span>
                                    <span
                                        className="flex-1 whitespace-pre-wrap break-words font-medium"
                                        style={{ color: 'var(--danger-color)' }}
                                    >
                                        {line.content}
                                    </span>
                                </>
                            )}
                        </div>
                    ))}

                    {isExecuting && (
                        <div className="flex gap-3">
                            <span className="shrink-0 select-none text-transparent">[00:00:00]</span>
                            <span className="animate-pulse" style={{ color: 'var(--accent-primary)' }}>
                                Running command...
                            </span>
                        </div>
                    )}

                    <div ref={bodyBottomRef} />
                </div>

                {/* Command Input */}
                <div
                    className="p-3 border-t flex items-end gap-2 shrink-0"
                    style={{
                        backgroundColor: 'var(--bg-secondary)',
                        borderColor: 'var(--border-subtle)',
                    }}
                >
                    <span
                        className="kai-mono text-xs mb-2.5 shrink-0 max-w-[14rem] truncate"
                        style={{ color: 'var(--accent-primary)' }}
                        title={currentCwd}
                    >
                        {currentCwd} $
                    </span>
                    <textarea
                        ref={textareaRef}
                        className="kai-input kai-mono flex-1 resize-none text-xs"
                        style={{ minHeight: '2.375rem', maxHeight: '7.5rem' }}
                        placeholder="Enter command..."
                        aria-label="Terminal command input"
                        value={inputValue}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        disabled={isExecuting}
                        rows={1}
                        spellCheck={false}
                        autoComplete="off"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            void handleExecute();
                        }}
                        disabled={isExecuting || !inputValue.trim()}
                        className="kai-btn kai-btn-primary kai-btn-sm shrink-0"
                        aria-label="Run command"
                    >
                        <span className="material-symbols-outlined text-base">send</span>
                        <span>Run</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
