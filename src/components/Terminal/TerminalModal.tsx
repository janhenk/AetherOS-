import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';

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

export default function TerminalModal({ isOpen, onClose }: TerminalModalProps) {
    const { state, dispatch } = useAppContext();
    const [history, setHistory] = useState<TerminalLine[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [currentCwd, setCurrentCwd] = useState('...');
    const [isExecuting, setIsExecuting] = useState(false);
    
    // Note: Reusing textareaRef pattern from CommandLogs
    const bodyRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const formatTimestamp = () => {
        const d = new Date();
        return `[${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}]`;
    };

    // Initial load to get CWD
    useEffect(() => {
        if (isOpen) {
            fetchCwd();
            setTimeout(() => textareaRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const fetchCwd = async () => {
        try {
            const res = await fetch('/api/terminal/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: '' })
            });
            const data = await res.json();
            setCurrentCwd(data.cwd);
        } catch (e) {}
    };

    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [history, isExecuting]);

    const handleExecute = async () => {
        const cmd = inputValue.trim();
        if (!cmd) return;

        setHistory(prev => [...prev, { type: 'input', content: cmd, cwd: currentCwd, timestamp: formatTimestamp() }]);
        setInputValue('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        setIsExecuting(true);

        try {
            const res = await fetch('/api/terminal/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
            });
            const data = await res.json();
            
            if (cmd === 'aetheros --yolo-confirm') {
                dispatch({ type: 'SET_YOLO_MODE', payload: true });
            }
            
            if (data.error) {
                setHistory(prev => [...prev, { type: 'error', content: data.error, timestamp: formatTimestamp() }]);
            } else {
                setHistory(prev => [...prev, { type: 'output', content: data.output, timestamp: formatTimestamp() }]);
            }
            setCurrentCwd(data.cwd);
        } catch (err: any) {
            setHistory(prev => [...prev, { type: 'error', content: `Fatal Error: ${err.message}`, timestamp: formatTimestamp() }]);
        } finally {
            setIsExecuting(false);
            setTimeout(() => textareaRef.current?.focus(), 50);
        }
    };

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleExecute();
        }
    }, [inputValue, isExecuting]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    }, []);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6 md:p-12"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="glass-panel w-full max-w-6xl rounded-xl p-5 flex flex-col h-full max-h-[900px] shadow-2xl border border-primary/20 bg-[#0d0f12] animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="mb-4 flex items-center justify-between border-b border-primary/10 pb-4">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary text-sm">terminal</span>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-primary/80">
                            Subspace Terminal
                        </h3>
                        {state.isYoloMode && (
                            <span className="ml-3 rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-500 uppercase tracking-widest border border-red-500/30">
                                YOLO Mode Active
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className={`h-1.5 w-1.5 rounded-full ${isExecuting ? 'bg-secondary animate-pulse' : 'bg-primary'}`}></div>
                            <span className="text-[9px] uppercase tracking-widest text-slate-500">
                                {isExecuting ? 'Executing' : 'Ready'}
                            </span>
                        </div>
                        <button 
                            onClick={onClose}
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/5 text-white/50 hover:text-white transition-colors"
                        >
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div 
                    className="flex-1 space-y-4 font-mono text-[13px] leading-relaxed text-white/70 overflow-y-auto pr-2 mb-4"
                    onClick={() => textareaRef.current?.focus()}
                >
                    <div className="opacity-50 mb-6">
                        [SYSTEM] AetherOS Interactive Shell Initialized.<br/>
                        [SYSTEM] Host environment verified. Secure connection established.
                    </div>

                    {history.map((line, i) => (
                        <div key={i} className="flex gap-3">
                            {line.type === 'input' && (
                                <>
                                    <span className="shrink-0 mt-0.5 text-primary/60">{line.timestamp}</span>
                                    <span className="flex-1 overflow-hidden text-white/90 font-bold">
                                        <span className="text-secondary/60 mr-2">{line.cwd} {'>'}</span> {line.content}
                                    </span>
                                </>
                            )}
                            {line.type === 'output' && (
                                <>
                                    <span className="shrink-0 mt-0.5 text-transparent select-none">{line.timestamp}</span>
                                    <span className="flex-1 overflow-hidden text-white/70 whitespace-pre-wrap break-all">
                                        {line.content}
                                    </span>
                                </>
                            )}
                            {line.type === 'error' && (
                                <>
                                    <span className="shrink-0 mt-0.5 text-transparent select-none">{line.timestamp}</span>
                                    <span className="flex-1 overflow-hidden text-red-400 whitespace-pre-wrap break-all font-semibold">
                                        {line.content}
                                    </span>
                                </>
                            )}
                        </div>
                    ))}

                    {isExecuting && (
                        <div className="flex gap-3">
                            <span className="shrink-0 mt-0.5 text-transparent select-none">[00:00:00]</span>
                            <span className="animate-pulse text-primary"><span className="mr-1">_</span> Processing command...</span>
                        </div>
                    )}

                    <div ref={bodyRef} className="h-4" />
                </div>

                {/* Input Container */}
                <div className="mt-auto border-t border-primary/10 pt-4 flex gap-2 items-end">
                    <span className="text-primary/50 text-sm font-mono mb-2.5 shrink-0">{currentCwd} {'>'}</span>
                    <textarea
                        ref={textareaRef}
                        className="w-full bg-transparent border-none text-sm font-mono text-white/90 focus:ring-0 placeholder-white/20 resize-none py-2"
                        placeholder={`Execute command...`}
                        value={inputValue}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        disabled={isExecuting}
                        rows={1}
                        spellCheck={false}
                        autoComplete="off"
                    />
                    <button
                        onClick={handleExecute}
                        disabled={isExecuting || !inputValue.trim()}
                        className="text-primary/70 hover:text-primary transition-colors disabled:opacity-30 pb-2 mb-0.5 h-8 w-8 flex items-center justify-center shrink-0"
                    >
                        <span className="material-symbols-outlined text-sm font-bold">send</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
