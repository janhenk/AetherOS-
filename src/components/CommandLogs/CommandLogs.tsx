import React, { memo, useRef, useEffect, useState, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { getAgent } from '../../agents';
import { useGemini } from '../../hooks/useGemini';
import type { AgentId } from '../../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
    activeAgent: AgentId;
}

const MARKDOWN_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS: any = {
    p: ({ node, ...props }: any) => <p className="my-1 leading-relaxed" {...props} />,
    strong: ({ node, ...props }: any) => <strong className="font-bold text-slate-200" {...props} />,
    em: ({ node, ...props }: any) => <em className="italic text-slate-300" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="list-disc list-outside my-2 space-y-1 ml-4" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="list-decimal list-outside my-2 space-y-1 ml-4" {...props} />,
    li: ({ node, ...props }: any) => <li className="my-0.5" {...props} />,
    a: ({ node, ...props }: any) => <a className="text-primary hover:underline underline-offset-2" {...props} target="_blank" rel="noopener noreferrer" />,
    table: ({ node, ...props }: any) => <div className="overflow-x-auto my-3 rounded-lg border border-primary/20 bg-primary/5"><table className="w-full border-collapse text-left text-xs" {...props} /></div>,
    th: ({ node, ...props }: any) => <th className="border-b border-primary/20 p-2 bg-primary/10 font-bold text-primary" {...props} />,
    td: ({ node, ...props }: any) => <td className="border-b border-primary/10 p-2 border-r last:border-r-0 border-r-primary/10" {...props} />,
    pre: ({ node, ...props }: any) => <pre className="bg-white/5 border border-primary/20 p-3 rounded-lg my-3 overflow-x-auto font-mono text-[11px] text-white/90 shadow-inner" {...props} />,
    code: ({ node, ...props }: any) => <code className="font-mono text-[11px] text-primary bg-primary/10 px-1 py-0.5 rounded shadow-sm border border-primary/10" {...props} />,
    h1: ({ node, ...props }: any) => <h1 className="text-lg font-bold text-white mt-4 mb-2 tracking-wide" {...props} />,
    h2: ({ node, ...props }: any) => <h2 className="text-base font-bold text-white mt-3 mb-2 tracking-wide" {...props} />,
    h3: ({ node, ...props }: any) => <h3 className="text-sm font-bold text-white/90 mt-2 mb-1 tracking-wide" {...props} />,
    hr: ({ node, ...props }: any) => <hr className="border-primary/20 my-4" {...props} />,
    blockquote: ({ node, children, ...props }: any) => {
        const text = String(children?.[0]?.props?.children || children?.[0] || '');
        const executingRegex = /Executing \d+ system tools\.\.\./;
        const match = text.match(executingRegex);

        if (match) {
            const executingPart = match[0];
            const remainingText = text.replace(executingRegex, '').trim();
            const hasMoreText = remainingText.length > 0 || children.length > 1;

            if (!hasMoreText) {
                return (
                    <div className="my-1">
                        <code className="inline-block bg-primary/10 text-primary/80 border border-primary/20 rounded-full px-3 py-0.5 text-[10px] font-bold tracking-tight italic" {...props}>
                            {executingPart}
                        </code>
                    </div>
                );
            } else {
                return (
                    <blockquote className="border-l-2 border-primary/50 pl-3 my-2 italic text-white/60 bg-primary/5 py-1 pr-2 rounded-r" {...props}>
                        <code className="inline-block bg-primary/10 text-primary/80 border border-primary/20 rounded-full px-2 py-0.5 mr-2 text-[9px] font-bold tracking-tight italic not-italic">
                            {executingPart}
                        </code>
                        {remainingText}
                        {children.slice(1)}
                    </blockquote>
                );
            }
        }
        return <blockquote className="border-l-2 border-primary/50 pl-3 my-2 italic text-white/60 bg-primary/5 py-1 pr-2 rounded-r" {...props}>{children}</blockquote>;
    }
};

const CommandLogs = memo(function CommandLogs({ activeAgent }: Props) {
    const { state, dispatch } = useAppContext();
    const { sendMessage } = useGemini();

    const { conversations, agentStatus } = state;
    const agent = getAgent(activeAgent, state.settings.agentOverrides);
    const messages = conversations[activeAgent];
    const isProcessing = agentStatus[activeAgent] === 'processing';

    const bottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [text, setText] = useState('');
    const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set());

    const toggleToolExpand = (id: string) => {
        setExpandedToolIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isProcessing]);

    const handleSubmit = useCallback(async () => {
        const trimmed = text.trim();
        if (!trimmed || isProcessing) return;
        setText('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        await sendMessage(activeAgent, trimmed);
    }, [text, isProcessing, sendMessage, activeAgent]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    }, []);

    const formatTimestamp = (dateInput: Date | string | number) => {
        const d = new Date(dateInput);
        return `[${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}]`;
    };

    return (
        <div className="glass-panel rounded-xl p-5 flex-1 flex flex-col min-h-0">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary text-sm">terminal</span>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-primary/80">{agent.shortName} Logs</h3>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 rounded-full ${isProcessing ? 'bg-secondary animate-pulse' : 'bg-primary'}`}></div>
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">
                        {isProcessing ? 'Processing' : 'Ready'}
                    </span>
                    <button
                        onClick={() => dispatch({ type: 'CLEAR_CONVERSATION', payload: activeAgent })}
                        className="material-symbols-outlined text-primary/40 hover:text-red-500 transition-colors text-sm ml-2 pointer-events-auto"
                        title="Clear Communications Log"
                    >delete</button>
                </div>
            </div>

            <div className="flex-1 space-y-4 font-mono text-sm leading-relaxed text-white/70 overflow-y-auto pr-2 mb-4">
                {(messages || []).length === 0 ? (
                    <p className="opacity-50">Log initialized. Awaiting input...</p>
                ) : (
                    (() => {
                        const renderedElements: React.ReactNode[] = [];
                        let currentCluster: any[] = [];

                        const flushCluster = (timestamp: any) => {
                            if (currentCluster.length === 0) return;
                            const clusterId = `cluster-${currentCluster[0].id}`;
                            const isClusterExpanded = expandedToolIds.has(clusterId);
                            
                            renderedElements.push(
                                <div key={clusterId} className="flex flex-col gap-2 my-2 ml-4 sm:ml-14">
                                    <button 
                                        onClick={() => toggleToolExpand(clusterId)}
                                        className="flex items-center gap-3 self-start rounded-full bg-primary/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary/60 border border-primary/10 hover:bg-primary/10 transition-all group max-w-full"
                                    >
                                        <div className="flex -space-x-1.5 overflow-hidden">
                                            {currentCluster.slice(0, 3).map((m, i) => (
                                                <div key={i} className={`h-4 w-4 rounded-full border border-black flex items-center justify-center text-[8px] bg-primary/20`}>
                                                    {m.content.startsWith('TOOL_RESPONSE:') ? '✓' : '⚙'}
                                                </div>
                                            ))}
                                        </div>
                                        <span>{currentCluster.length} PROTOCOL OPERATIONS</span>
                                        <span className="text-[9px] opacity-40 font-normal lowercase">{formatTimestamp(timestamp)}</span>
                                        <span className="material-symbols-outlined text-xs group-hover:translate-y-0.5 transition-transform">{isClusterExpanded ? 'expand_less' : 'expand_more'}</span>
                                    </button>

                                    {isClusterExpanded && (
                                        <div className="flex flex-col gap-3 pl-4 border-l-2 border-primary/5 py-1 animate-in fade-in slide-in-from-left-2 duration-300">
                                            {currentCluster.map((msg) => {
                                                const isResult = msg.content.startsWith('TOOL_RESPONSE:') || msg.content.startsWith('TOOL_ERROR:');
                                                if (isResult) {
                                                    const isError = msg.content.startsWith('TOOL_ERROR:');
                                                    const prefix = isError ? 'TOOL_ERROR:' : 'TOOL_RESPONSE:';
                                                    const remaining = msg.content.slice(prefix.length);
                                                    const colonIdx = remaining.indexOf(':');
                                                    const toolName = remaining.slice(0, colonIdx);
                                                    const resultStr = remaining.slice(colonIdx + 1);
                                                    let parsedResult = resultStr;
                                                    try {
                                                        const json = JSON.parse(resultStr);
                                                        parsedResult = JSON.stringify(json, null, 2);
                                                    } catch (e) {}

                                                    return (
                                                        <div key={msg.id} className="flex flex-col gap-1.5">
                                                            <div className="flex items-center gap-2 text-[9px] uppercase font-bold text-primary/40">
                                                                <span className="material-symbols-outlined text-[10px]">{isError ? 'error' : 'data_object'}</span>
                                                                {toolName} OUTPUT
                                                            </div>
                                                            <pre className={`text-[9px] p-2 rounded bg-black/40 border ${isError ? 'border-red-500/20 text-red-200/60' : 'border-primary/5 text-primary/50'} overflow-x-auto max-h-40 font-mono`}>
                                                                {parsedResult}
                                                            </pre>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div key={msg.id} className="flex flex-col gap-2">
                                                        <div className="text-[9px] uppercase font-bold text-primary/40 flex items-center gap-2">
                                                            <span className="material-symbols-outlined text-[10px]">settings_input_component</span>
                                                            INITIALIZED CALL
                                                        </div>
                                                        <div className="text-[10px] text-white/50 bg-white/5 p-2 rounded border border-white/5">
                                                            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={MARKDOWN_COMPONENTS}>
                                                                {msg.content}
                                                            </ReactMarkdown>
                                                            {msg.toolCalls?.map((call: any, idx: number) => (
                                                                <div key={idx} className="mt-1 opacity-80">
                                                                    λ {call.name}({JSON.stringify(call.args)})
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                            currentCluster = [];
                        };

                        messages.forEach((msg, idx) => {
                            const isToolResult = msg.content.startsWith('TOOL_RESPONSE:') || msg.content.startsWith('TOOL_ERROR:');
                            const executingRegex = /^\s*(>\s*)?Executing \d+ system tools\.\.\.[\s]*$/;
                            const isExecutingOnly = executingRegex.test(msg.content);
                            
                            // A message is a "pure tool call" only if it has NO substantive markdown content AND
                            // (has toolCalls OR is an executing placeholder OR is a protocol result).
                            const hasSubstantiveContent = msg.content.trim().length > 0 && !isExecutingOnly && !isToolResult;
                            const isPureToolCall = !hasSubstantiveContent && ((msg.toolCalls?.length || 0) > 0 || isExecutingOnly || msg.content.includes('PROTOCOL OPERATIONS'));

                            if (isToolResult || isPureToolCall) {
                                currentCluster.push(msg);
                            } else {
                                flushCluster(msg.timestamp);
                                
                                let colorClass = 'text-primary/60';
                                if (msg.role === 'user') colorClass = 'text-secondary/60';
                                if (msg.role === 'agent' && msg.content.includes('[MAIN VIEWSCREEN]')) colorClass = 'text-emerald-500/60';

                                renderedElements.push(
                                    <div key={msg.id} className="flex flex-col gap-1">
                                        <div className="flex flex-col sm:flex-row gap-0.5 sm:gap-3">
                                            <span className={`shrink-0 text-[10px] sm:text-xs sm:mt-1 opacity-40 sm:opacity-60 font-bold sm:font-normal ${colorClass}`}>{formatTimestamp(msg.timestamp)}</span>
                                            <div className={`flex-1 overflow-hidden flex flex-col gap-2 ${msg.role === 'user' ? 'text-white/90' : 'text-white/70'}`}>
                                                <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={MARKDOWN_COMPONENTS}>
                                                    {msg.content}
                                                </ReactMarkdown>

                                                {msg.toolCalls && msg.toolCalls.length > 0 && !isPureToolCall && (
                                                    <div className="flex flex-col gap-2 my-1">
                                                        <button 
                                                            onClick={() => toggleToolExpand(msg.id)}
                                                            className="flex items-center gap-2 self-start rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-tighter text-primary border border-primary/20 hover:bg-primary/20 transition-all"
                                                        >
                                                            <span className="material-symbols-outlined text-xs">settings_input_component</span>
                                                            {msg.toolCalls.length} Tool Operations
                                                            <span className="material-symbols-outlined text-xs">{expandedToolIds.has(msg.id) ? 'expand_less' : 'expand_more'}</span>
                                                        </button>
                                                        
                                                        {expandedToolIds.has(msg.id) && (
                                                            <div className="flex flex-col gap-2 pl-2 border-l border-primary/20 bg-black/20 rounded-r py-2 pr-2 animate-in fade-in slide-in-from-left-2 duration-300">
                                                                {msg.toolCalls.map((call: any, i: number) => (
                                                                    <div key={i} className="text-[10px] font-mono">
                                                                        <div className="text-secondary opacity-80 mb-0.5">λ {call.name}</div>
                                                                        <pre className="bg-primary/5 p-1 rounded text-[9px] text-primary/70 overflow-x-auto border border-primary/5">
                                                                            {JSON.stringify(call.args, null, 2)}
                                                                        </pre>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            if (idx === messages.length - 1) {
                                flushCluster(msg.timestamp);
                            }
                        });

                        return renderedElements;
                    })()
                )}

                {isProcessing && (
                    <p className="animate-pulse text-primary"><span className="mr-1">_</span> Processing coordinates...</p>
                )}

                <div ref={bottomRef} />
            </div>

            <div className="mt-auto border-t border-primary/10 pt-3 flex gap-2 items-end">
                <span className="text-primary/50 text-sm font-mono mb-2 shrink-0">{'>'}</span>
                <textarea
                    ref={textareaRef}
                    className="w-full bg-transparent border-none text-sm font-mono text-white/90 focus:ring-0 placeholder-white/20 resize-none py-1"
                    placeholder={`Transmit to ${agent.shortName}...`}
                    value={text}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    disabled={isProcessing}
                    rows={1}
                />
                <button
                    onClick={handleSubmit}
                    disabled={isProcessing || !text.trim()}
                    className="text-primary/70 hover:text-primary transition-colors disabled:opacity-30 pb-1"
                >
                    <span className="material-symbols-outlined text-sm font-bold">send</span>
                </button>
            </div>
        </div>
    );
});

export default CommandLogs;
