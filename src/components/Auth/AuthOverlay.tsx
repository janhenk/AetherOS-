import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';

export const AuthOverlay: React.FC<{ onAuthenticated: () => void }> = ({ onAuthenticated }) => {
    const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkStatus = async () => {
            try {
                // Use built-in fetch to bypass the interceptor on the /auth routes
                const res = await fetch('/api/auth/status');
                if (res.ok) {
                    const data = await res.json();
                    setNeedsSetup(data.needsSetup);

                    // If NO setup needed and a token exists, try to validate it silently
                    const token = localStorage.getItem('aetheros_token');
                    if (!data.needsSetup && token) {
                        try {
                            const testRes = await apiFetch('/api/stats');
                            if (testRes.ok) {
                                onAuthenticated();
                                return;
                            }
                        } catch (e) { /* Token invalid, surface login */ }
                    }
                }
            } catch (err) {
                setError('Failed to establish secure link to Core Systems.');
            } finally {
                setLoading(false);
            }
        };

        checkStatus();
    }, [onAuthenticated]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) return;
        setError('');
        setLoading(true);
        
        const endpoint = needsSetup ? '/api/auth/setup' : '/api/auth/login';
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            
            if (res.ok && data.token) {
                localStorage.setItem('aetheros_token', data.token);
                onAuthenticated();
            } else {
                setError(data.error || 'Authentication Checksum Failed');
            }
        } catch (err) {
            setError('Neural link disconnected.');
        } finally {
            setLoading(false);
        }
    };

    if (loading && needsSetup === null) {
        return (
            <div className="fixed inset-0 bg-[#0a0f18] flex items-center justify-center z-[100] text-primary font-mono tracking-widest text-sm animate-pulse">
                ESTABLISHING SECURE HANDSHAKE...
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-6">
            <div className="max-w-md w-full glass-panel neon-aura-secondary rounded-2xl p-8 border border-secondary/30 shadow-[0_0_50px_rgba(245,158,11,0.15)] relative overflow-hidden">
                
                {/* Decorative Elements */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-secondary to-transparent opacity-50"></div>
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-secondary/10 blur-3xl rounded-full"></div>
                <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-secondary/10 blur-3xl rounded-full"></div>

                <div className="text-center mb-10 relative z-10">
                    <span className="material-symbols-outlined text-6xl text-secondary block mb-4 filter drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]">
                        {needsSetup ? 'admin_panel_settings' : 'lock'}
                    </span>
                    <h1 className="text-2xl font-bold text-slate-100 tracking-[0.2em] uppercase mb-2">
                        {needsSetup ? 'System Initialization' : 'AetherOS Override'}
                    </h1>
                    <p className="text-xs text-secondary/70 tracking-widest uppercase font-mono">
                        {needsSetup ? 'Establish core encryption key' : 'Provide administrative clearance'}
                    </p>
                </div>
                
                {error && (
                    <div className="mb-8 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono tracking-widest text-center animate-fade-in flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-sm">warning</span>
                        {error}
                    </div>
                )}
                
                <form onSubmit={handleSubmit} className="flex flex-col gap-6 relative z-10">
                    <div className="relative">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={needsSetup ? "DEFINE COMMAND KEY" : "ENTER COMMAND KEY"}
                            autoFocus
                            className="w-full bg-[#0a0f18]/80 border-2 border-secondary/20 rounded-xl px-12 py-4 text-slate-100 placeholder-secondary/30 focus:border-secondary focus:shadow-[0_0_20px_rgba(245,158,11,0.2)] focus:outline-none transition-all text-center tracking-[0.3em] uppercase font-mono text-sm"
                        />
                        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-secondary/50">key</span>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !password}
                        className="w-full rounded-xl bg-secondary text-black font-bold uppercase tracking-[0.2em] py-4 hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-3 mt-2"
                    >
                        {loading ? (
                            <span className="material-symbols-outlined animate-spin text-lg">sync</span>
                        ) : (
                            <span className="material-symbols-outlined text-lg">{needsSetup ? 'lock_reset' : 'login'}</span>
                        )}
                        {needsSetup ? 'Encrypt Node' : 'Authenticate'}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-secondary/10 flex justify-between text-[10px] text-secondary/40 font-mono tracking-widest">
                    <span>SECURE NODE // AETHEROS</span>
                    <span>V 2.1.0</span>
                </div>
            </div>
        </div>
    );
};
