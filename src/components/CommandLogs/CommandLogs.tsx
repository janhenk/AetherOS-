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

const CommandLogs = memo(function CommandLogs({ activeAgent }: Props) {
    const { state } = useAppContext();
    const { sendMessage } = useGemini();

    const { conversations, agentStatus } = state;
    const agent = getAgent(activeAgent);
    const messages = conversations[activeAgent];
    const isProcessing = agentStatus[activeAgent] === 'processing';

    const bottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [text, setText] = useState('');

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
                </div>
            </div>

            <div className="flex-1 space-y-4 font-mono text-sm leading-relaxed text-slate-400 overflow-y-auto pr-2 mb-4">
                {messages.length === 0 ? (
                    <p className="opacity-50">Log initialized. Awaiting input...</p>
                ) : (
                    messages.map((msg) => {
                        let colorClass = 'text-primary/60'; // Default agent
                        if (msg.role === 'user') colorClass = 'text-secondary/60';
                        if (msg.role === 'agent' && msg.content.includes('[MAIN VIEWSCREEN]')) colorClass = 'text-emerald-500/60';

                        return (
                            <div key={msg.id} className="flex gap-3">
                                <span className={`shrink-0 mt-1 ${colorClass}`}>{formatTimestamp(msg.timestamp)}</span>
                                <span className={`flex-1 overflow-hidden ${msg.role === 'user' ? 'text-slate-300' : 'text-slate-400'}`}>
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            p: ({ node, ...props }) => <p className="my-1 leading-relaxed" {...props} />,
                                            strong: ({ node, ...props }) => <strong className="font-bold text-slate-200" {...props} />,
                                            em: ({ node, ...props }) => <em className="italic text-slate-300" {...props} />,
                                            ul: ({ node, ...props }) => <ul className="list-disc list-outside my-2 space-y-1 ml-4" {...props} />,
                                            ol: ({ node, ...props }) => <ol className="list-decimal list-outside my-2 space-y-1 ml-4" {...props} />,
                                            li: ({ node, ...props }) => <li className="my-0.5" {...props} />,
                                            a: ({ node, ...props }) => <a className="text-primary hover:underline underline-offset-2" {...props} target="_blank" rel="noopener noreferrer" />,
                                            table: ({ node, ...props }) => <div className="overflow-x-auto my-3 rounded-lg border border-primary/20 bg-primary/5"><table className="w-full border-collapse text-left text-xs" {...props} /></div>,
                                            th: ({ node, ...props }) => <th className="border-b border-primary/20 p-2 bg-primary/10 font-bold text-primary" {...props} />,
                                            td: ({ node, ...props }) => <td className="border-b border-primary/10 p-2 border-r last:border-r-0 border-r-primary/10" {...props} />,
                                            pre: ({ node, ...props }) => <pre className="bg-slate-900 border border-primary/20 p-3 rounded-lg my-3 overflow-x-auto font-mono text-[11px] text-slate-300 shadow-inner" {...props} />,
                                            code: ({ node, ...props }) => <code className="font-mono text-[11px] text-primary bg-primary/10 px-1 py-0.5 rounded shadow-sm border border-primary/10" {...props} />,
                                            h1: ({ node, ...props }) => <h1 className="text-lg font-bold text-white mt-4 mb-2 tracking-wide" {...props} />,
                                            h2: ({ node, ...props }) => <h2 className="text-base font-bold text-white mt-3 mb-2 tracking-wide" {...props} />,
                                            h3: ({ node, ...props }) => <h3 className="text-sm font-bold text-slate-200 mt-2 mb-1 tracking-wide" {...props} />,
                                            hr: ({ node, ...props }) => <hr className="border-primary/20 my-4" {...props} />,
                                            blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-primary/50 pl-3 my-2 italic text-slate-400 bg-primary/5 py-1 pr-2 rounded-r" {...props} />
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                </span>
                            </div>
                        );
                    })
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
                    className="w-full bg-transparent border-none text-sm font-mono text-slate-300 focus:ring-0 placeholder-slate-600 resize-none py-1"
                    placeholder={`Transmit to ${agent.name}...`}
                    value={text}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    disabled={isProcessing}
                    rows={1}
                />
                <button
                    onClick={handleSubmit}
                    disabled={isProcessing || !text.trim()}
                    className="text-primary/50 hover:text-primary transition-colors disabled:opacity-30 pb-1"
                >
                    <span className="material-symbols-outlined text-sm">send</span>
                </button>
            </div>
        </div>
    );
});

export default CommandLogs;
