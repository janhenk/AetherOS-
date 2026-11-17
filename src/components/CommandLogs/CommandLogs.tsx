import React, { memo, useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppContext } from '../../context/useAppContext';
import { getAgent } from '../../agents';
import { useGemini } from '../../hooks/useGemini';
import type { AgentId, Message, ToolCallEntry } from '../../types';
import MidiPlayer from './MidiPlayer';

interface Props {
    activeAgent: AgentId;
}

const MARKDOWN_PLUGINS = [remarkGfm];

function omitNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
    const copy = { ...props };
    delete copy.node;
    return copy;
}

function extractNodeText(node: React.ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractNodeText).join('');
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
        return extractNodeText(node.props.children);
    }
    return '';
}

const MARKDOWN_COMPONENTS: Components = {
    p: (props) => (
        <p className="my-1.5 leading-relaxed" style={{ color: 'var(--text-primary)' }} {...omitNode(props)} />
    ),
    strong: (props) => (
        <strong className="font-semibold" style={{ color: 'var(--text-primary)' }} {...omitNode(props)} />
    ),
    em: (props) => (
        <em className="italic" style={{ color: 'var(--text-secondary)' }} {...omitNode(props)} />
    ),
    ul: (props) => <ul className="list-disc list-outside my-2 space-y-1 ml-5" {...omitNode(props)} />,
    ol: (props) => <ol className="list-decimal list-outside my-2 space-y-1 ml-5" {...omitNode(props)} />,
    li: (props) => <li className="my-0.5 leading-relaxed" {...omitNode(props)} />,
    a: (props) => (
        <a
            className="underline underline-offset-2 font-medium"
            style={{ color: 'var(--accent-primary)' }}
            target="_blank"
            rel="noopener noreferrer"
            {...omitNode(props)}
        />
    ),
    table: (props) => (
        <div className="kai-table-wrap my-3">
            <table className="kai-table text-xs" {...omitNode(props)} />
        </div>
    ),
    th: (props) => <th {...omitNode(props)} />,
    td: (props) => <td {...omitNode(props)} />,
    pre: (props) => (
        <pre
            className="kai-md-pre my-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:border-0"
            style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)',
            }}
            {...omitNode(props)}
        />
    ),
    code: (props) => (
        <code
            className="kai-mono text-xs px-1.5 py-0.5 rounded border"
            style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--accent-primary)',
            }}
            {...omitNode(props)}
        />
    ),
    h1: (props) => (
        <h1 className="text-lg font-semibold mt-4 mb-2" style={{ color: 'var(--text-primary)' }} {...omitNode(props)} />
    ),
    h2: (props) => (
        <h2 className="text-base font-semibold mt-3 mb-1.5" style={{ color: 'var(--text-primary)' }} {...omitNode(props)} />
    ),
    h3: (props) => (
        <h3 className="text-sm font-semibold mt-2.5 mb-1" style={{ color: 'var(--text-primary)' }} {...omitNode(props)} />
    ),
    hr: (props) => <hr className="kai-divider" {...omitNode(props)} />,
    blockquote: ({ children, ...props }) => {
        const cleanProps = omitNode(props);
        const text = extractNodeText(children);
        const executingRegex = /Executing \d+ system tools\.\.\./;
        const match = text.match(executingRegex);

        if (match) {
            const executingPart = match[0];
            const remainingText = text.replace(executingRegex, '').trim();

            if (!remainingText) {
                return (
                    <div className="my-1.5">
                        <span className="kai-badge kai-badge-accent kai-mono text-xs">{executingPart}</span>
                    </div>
                );
            }
            return (
                <blockquote className="kai-md-quote rounded-r my-2" {...cleanProps}>
                    <span className="kai-badge kai-badge-accent kai-mono text-xs mr-2">{executingPart}</span>
                    <span>{remainingText}</span>
                </blockquote>
            );
        }

        return (
            <blockquote className="kai-md-quote rounded-r my-2" {...cleanProps}>
                {children}
            </blockquote>
        );
    },
};

function renderWithMidi(content: string, isLastMessage: boolean) {
    if (!content) return null;
    const parts = content.split(/(<midi>[\s\S]*?<\/midi>)/gi);
    return parts.map((part, idx) => {
        if (part.toLowerCase().startsWith('<midi>') && part.toLowerCase().endsWith('</midi>')) {
            const data = part.slice(6, -7).trim();
            return <MidiPlayer key={idx} data={data} autoPlay={isLastMessage} />;
        }
        return (
            <ReactMarkdown key={idx} remarkPlugins={MARKDOWN_PLUGINS} components={MARKDOWN_COMPONENTS}>
                {part}
            </ReactMarkdown>
        );
    });
}

function formatTimestamp(dateInput: Date | string | number): string {
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '--:--:--';
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function formatToolResultPayload(raw: string): string {
    try {
        const parsed: unknown = JSON.parse(raw);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return raw;
    }
}

const CommandLogs = memo(function CommandLogs({ activeAgent }: Props) {
    const { state, dispatch } = useAppContext();
    const { sendMessage } = useGemini();

    const { conversations, agentStatus } = state;
    const agent = getAgent(activeAgent, state.settings.agentOverrides);
    const messages = conversations[activeAgent] || [];
    const isProcessing = agentStatus[activeAgent] === 'processing';

    const bottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const clearTimeoutRef = useRef<number | null>(null);

    const [text, setText] = useState('');
    const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);

    const toggleToolExpand = useCallback((id: string) => {
        setExpandedToolIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, isProcessing]);

    useEffect(() => {
        return () => {
            if (clearTimeoutRef.current !== null) {
                window.clearTimeout(clearTimeoutRef.current);
            }
        };
    }, []);

    const handleClearChat = useCallback(() => {
        if (!confirmClear) {
            setConfirmClear(true);
            if (clearTimeoutRef.current !== null) {
                window.clearTimeout(clearTimeoutRef.current);
            }
            clearTimeoutRef.current = window.setTimeout(() => {
                setConfirmClear(false);
            }, 3500);
            return;
        }
        if (clearTimeoutRef.current !== null) {
            window.clearTimeout(clearTimeoutRef.current);
            clearTimeoutRef.current = null;
        }
        setConfirmClear(false);
        dispatch({ type: 'CLEAR_CONVERSATION', payload: activeAgent });
    }, [activeAgent, confirmClear, dispatch]);

    const handleCopyMessage = useCallback(async (id: string, content: string) => {
        try {
            await navigator.clipboard.writeText(content);
            setCopiedId(id);
            window.setTimeout(() => {
                setCopiedId((prev) => (prev === id ? null : prev));
            }, 2000);
        } catch (err: unknown) {
            console.error('Failed to copy message:', err);
        }
    }, []);

    const handleSubmit = useCallback(async () => {
        const trimmed = text.trim();
        if (!trimmed || isProcessing) return;
        setText('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        await sendMessage(activeAgent, trimmed);
    }, [text, isProcessing, sendMessage, activeAgent]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
            }
        },
        [handleSubmit],
    );

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
    }, []);

    const renderMessages = () => {
        if (messages.length === 0) {
            return (
                <div className="kai-empty-state my-auto">
                    <div className="flex flex-col items-center gap-2">
                        <span
                            className="material-symbols-outlined text-3xl"
                            style={{ color: 'var(--accent-primary)' }}
                        >
                            {agent.icon}
                        </span>
                        <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {agent.name} ({agent.shortName})
                        </div>
                        <p className="text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
                            Operations console ready. Ask about container diagnostics, system health, logs, or infrastructure tasks.
                        </p>
                    </div>
                </div>
            );
        }

        const renderedElements: React.ReactNode[] = [];
        let currentCluster: Message[] = [];

        const flushCluster = (timestamp: Date | string | number) => {
            if (currentCluster.length === 0) return;
            const clusterItems = [...currentCluster];
            currentCluster = [];

            const clusterId = `cluster-${clusterItems[0].id}`;
            const isClusterExpanded = expandedToolIds.has(clusterId);

            renderedElements.push(
                <div key={clusterId} className="my-2">
                    <button
                        type="button"
                        onClick={() => toggleToolExpand(clusterId)}
                        className="kai-btn kai-btn-secondary kai-btn-xs"
                        aria-expanded={isClusterExpanded}
                    >
                        <span className="material-symbols-outlined text-sm" style={{ color: 'var(--accent-primary)' }}>
                            build
                        </span>
                        <span className="kai-tabular">
                            {clusterItems.length} Tool {clusterItems.length === 1 ? 'Operation' : 'Operations'}
                        </span>
                        <span className="kai-mono kai-tabular text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {formatTimestamp(timestamp)}
                        </span>
                        <span className="material-symbols-outlined text-sm">
                            {isClusterExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                    </button>

                    {isClusterExpanded && (
                        <div
                            className="mt-2 ml-3 pl-3 border-l-2 flex flex-col gap-2"
                            style={{ borderColor: 'var(--border-strong)' }}
                        >
                            {clusterItems.map((clusterMsg) => {
                                const isResult =
                                    clusterMsg.content.startsWith('TOOL_RESPONSE:') ||
                                    clusterMsg.content.startsWith('TOOL_ERROR:');
                                if (isResult) {
                                    const isError = clusterMsg.content.startsWith('TOOL_ERROR:');
                                    const prefix = isError ? 'TOOL_ERROR:' : 'TOOL_RESPONSE:';
                                    const remaining = clusterMsg.content.slice(prefix.length);
                                    const colonIdx = remaining.indexOf(':');
                                    const toolName = colonIdx >= 0 ? remaining.slice(0, colonIdx) : 'tool';
                                    const resultStr = colonIdx >= 0 ? remaining.slice(colonIdx + 1) : remaining;
                                    const formatted = formatToolResultPayload(resultStr);

                                    return (
                                        <div key={clusterMsg.id} className="kai-surface-subtle flex flex-col gap-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <span
                                                    className={`kai-badge ${isError ? 'kai-badge-danger' : 'kai-badge-success'}`}
                                                >
                                                    <span className="material-symbols-outlined text-xs">
                                                        {isError ? 'error' : 'check_circle'}
                                                    </span>
                                                    {toolName}
                                                </span>
                                                <span
                                                    className="kai-mono kai-tabular text-[11px]"
                                                    style={{ color: 'var(--text-muted)' }}
                                                >
                                                    {formatTimestamp(clusterMsg.timestamp)}
                                                </span>
                                            </div>
                                            <pre
                                                className="kai-mono text-xs p-2.5 rounded border overflow-x-auto max-h-48"
                                                style={{
                                                    backgroundColor: 'var(--bg-primary)',
                                                    borderColor: isError ? 'var(--danger-color)' : 'var(--border-subtle)',
                                                    color: isError ? 'var(--danger-color)' : 'var(--text-secondary)',
                                                }}
                                            >
                                                {formatted}
                                            </pre>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={clusterMsg.id} className="kai-surface-subtle flex flex-col gap-1.5">
                                        <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                                            Tool Invocation
                                        </div>
                                        {clusterMsg.content.trim() && (
                                            <div className="text-xs">
                                                {renderWithMidi(
                                                    clusterMsg.content,
                                                    clusterMsg.id === messages[messages.length - 1]?.id,
                                                )}
                                            </div>
                                        )}
                                        {clusterMsg.toolCalls?.map((call: ToolCallEntry, idx: number) => (
                                            <div
                                                key={`${clusterMsg.id}-call-${idx}`}
                                                className="kai-mono text-xs p-2 rounded border overflow-x-auto"
                                                style={{
                                                    backgroundColor: 'var(--bg-primary)',
                                                    borderColor: 'var(--border-subtle)',
                                                    color: 'var(--text-primary)',
                                                }}
                                            >
                                                {call.name}({JSON.stringify(call.args ?? {})})
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>,
            );
        };

        messages.forEach((msg, idx) => {
            const isToolResult =
                msg.content.startsWith('TOOL_RESPONSE:') || msg.content.startsWith('TOOL_ERROR:');
            const executingRegex = /^\s*(>\s*)?Executing \d+ system tools\.\.\.[\s]*$/;
            const isExecutingOnly = executingRegex.test(msg.content);
            const hasSubstantiveContent = msg.content.trim().length > 0 && !isExecutingOnly && !isToolResult;
            const isPureToolCall =
                !hasSubstantiveContent &&
                ((msg.toolCalls?.length || 0) > 0 ||
                    isExecutingOnly ||
                    msg.content.includes('PROTOCOL OPERATIONS'));

            if (isToolResult || isPureToolCall) {
                currentCluster.push(msg);
            } else {
                flushCluster(msg.timestamp);
                const isUser = msg.role === 'user';
                const isLast = msg.id === messages[messages.length - 1]?.id;

                renderedElements.push(
                    <article
                        key={msg.id}
                        className="rounded-lg border p-3.5 flex flex-col gap-2"
                        style={{
                            backgroundColor: isUser ? 'var(--bg-secondary)' : 'var(--bg-elevated)',
                            borderColor: isUser ? 'var(--border-strong)' : 'var(--border-subtle)',
                        }}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span
                                    className="material-symbols-outlined text-base"
                                    style={{ color: isUser ? 'var(--text-secondary)' : 'var(--accent-primary)' }}
                                >
                                    {isUser ? 'person' : agent.icon || 'smart_toy'}
                                </span>
                                <span
                                    className="text-xs font-semibold truncate"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {isUser ? 'Operator' : agent.shortName}
                                </span>
                                <span
                                    className="kai-mono kai-tabular text-[11px]"
                                    style={{ color: 'var(--text-muted)' }}
                                >
                                    {formatTimestamp(msg.timestamp)}
                                </span>
                            </div>

                            {!isUser && msg.content.trim().length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void handleCopyMessage(msg.id, msg.content);
                                    }}
                                    className="kai-btn kai-btn-ghost kai-btn-xs"
                                    aria-label="Copy response"
                                    title="Copy response"
                                >
                                    <span className="material-symbols-outlined text-sm">
                                        {copiedId === msg.id ? 'check' : 'content_copy'}
                                    </span>
                                    <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                                </button>
                            )}
                        </div>

                        <div className="text-sm leading-relaxed overflow-hidden" style={{ color: 'var(--text-primary)' }}>
                            {renderWithMidi(msg.content, isLast)}
                        </div>

                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                            <div className="flex flex-col gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => toggleToolExpand(msg.id)}
                                    className="kai-btn kai-btn-secondary kai-btn-xs self-start"
                                    aria-expanded={expandedToolIds.has(msg.id)}
                                >
                                    <span
                                        className="material-symbols-outlined text-sm"
                                        style={{ color: 'var(--accent-primary)' }}
                                    >
                                        build
                                    </span>
                                    <span className="kai-tabular">
                                        {msg.toolCalls.length} Tool {msg.toolCalls.length === 1 ? 'Call' : 'Calls'}
                                    </span>
                                    <span className="material-symbols-outlined text-sm">
                                        {expandedToolIds.has(msg.id) ? 'expand_less' : 'expand_more'}
                                    </span>
                                </button>

                                {expandedToolIds.has(msg.id) && (
                                    <div
                                        className="flex flex-col gap-2 pl-3 border-l-2"
                                        style={{ borderColor: 'var(--border-strong)' }}
                                    >
                                        {msg.toolCalls.map((call: ToolCallEntry, i: number) => (
                                            <div key={`${msg.id}-tc-${i}`} className="kai-surface-subtle text-xs">
                                                <div
                                                    className="kai-mono font-semibold mb-1"
                                                    style={{ color: 'var(--accent-primary)' }}
                                                >
                                                    {call.name}
                                                </div>
                                                <pre
                                                    className="kai-mono text-xs p-2 rounded border overflow-x-auto"
                                                    style={{
                                                        backgroundColor: 'var(--bg-primary)',
                                                        borderColor: 'var(--border-subtle)',
                                                        color: 'var(--text-secondary)',
                                                    }}
                                                >
                                                    {JSON.stringify(call.args ?? {}, null, 2)}
                                                </pre>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </article>,
                );
            }

            if (idx === messages.length - 1) {
                flushCluster(msg.timestamp);
            }
        });

        return renderedElements;
    };

    return (
        <section className="kai-surface flex-1 flex flex-col min-h-0" aria-label="AI Operations Console">
            {/* Header */}
            <header
                className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b shrink-0"
                style={{ borderColor: 'var(--border-subtle)' }}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div
                        className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                            backgroundColor: 'var(--accent-subtle)',
                            color: 'var(--accent-primary)',
                        }}
                    >
                        <span className="material-symbols-outlined text-lg">{agent.icon}</span>
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                {agent.name}
                            </h2>
                            <span className="kai-badge kai-mono">{agent.shortName}</span>
                        </div>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                            AI Operations Console
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className={`kai-badge ${isProcessing ? 'kai-badge-warning' : 'kai-badge-success'}`}>
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${isProcessing ? 'animate-pulse' : ''}`}
                            style={{ backgroundColor: isProcessing ? 'var(--warning-color)' : 'var(--success-color)' }}
                        />
                        {isProcessing ? 'Processing' : 'Ready'}
                    </span>

                    {messages.length > 0 && (
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={handleClearChat}
                                className={`kai-btn kai-btn-xs ${confirmClear ? 'kai-btn-danger' : 'kai-btn-ghost'}`}
                                title={confirmClear ? 'Click again to clear chat history' : 'Clear chat history'}
                            >
                                <span className="material-symbols-outlined text-sm">
                                    {confirmClear ? 'warning' : 'delete'}
                                </span>
                                <span>{confirmClear ? 'Confirm Clear?' : 'Clear'}</span>
                            </button>
                            {confirmClear && (
                                <button
                                    type="button"
                                    onClick={() => setConfirmClear(false)}
                                    className="kai-btn kai-btn-ghost kai-btn-xs"
                                    aria-label="Cancel clear chat"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </header>

            {/* Message Feed */}
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 min-h-0 mb-3">
                {renderMessages()}

                {isProcessing && (
                    <div
                        className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border animate-pulse"
                        style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-secondary)',
                        }}
                    >
                        <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                        <span>Running assistant response...</span>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div
                className="mt-auto pt-3 border-t flex items-end gap-2 shrink-0"
                style={{ borderColor: 'var(--border-subtle)' }}
            >
                <textarea
                    ref={textareaRef}
                    className="kai-input flex-1 resize-none"
                    style={{ minHeight: '2.625rem', maxHeight: '8.75rem' }}
                    aria-label={`Message ${agent.name}`}
                    placeholder={`Ask ${agent.shortName} (Enter to send, Shift+Enter for new line)...`}
                    value={text}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    disabled={isProcessing}
                    rows={1}
                />
                <button
                    type="button"
                    onClick={() => {
                        void handleSubmit();
                    }}
                    disabled={isProcessing || !text.trim()}
                    className="kai-btn kai-btn-primary shrink-0"
                    aria-label="Send message"
                >
                    <span className="material-symbols-outlined text-base">send</span>
                    <span className="hidden sm:inline">Send</span>
                </button>
            </div>
        </section>
    );
});

export default CommandLogs;
