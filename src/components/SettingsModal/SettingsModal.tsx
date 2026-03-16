import React, { memo, useState, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { apiFetch } from '../../utils/api';
import { AGENTS } from '../../agents';
import type { GeminiModel, Settings } from '../../types';

const MODELS: { id: GeminiModel; label: string; tag?: string }[] = [
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', tag: 'PREVIEW' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', tag: 'PREVIEW' },
    { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', tag: 'PREVIEW' },
    { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image', tag: 'PREVIEW · IMG' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tag: 'GA' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tag: 'GA' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tag: 'GA' },
];

const SettingsModal = memo(function SettingsModal() {
    const { state, dispatch } = useAppContext();
    const { settings, isSettingsOpen } = state;
    const [localSettings, setLocalSettings] = useState<Settings>(() => ({ ...settings }));
    const [yoloConfirmStep, setYoloConfirmStep] = useState(0);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateMessage, setUpdateMessage] = useState<string | null>(null);

    const handleUpdate = useCallback(async () => {
        setIsUpdating(true);
        setUpdateMessage('INITIALIZING UPDATE SEQUENCE...');
        try {
            const res = await apiFetch('/api/system/update', { method: 'POST' });
            if (!res.ok) throw new Error('Update signal failed');
            
            setUpdateMessage('REBUILDING SYSTEM (PAGE WILL RELOAD SHORTLY)...');
            
            // The system rebuild takes a few seconds and drops the connection.
            // When it comes back online, we reload to get the fresh UI.
            setTimeout(() => {
                window.location.reload();
            }, 10000);
        } catch (e: any) {
            setUpdateMessage(`UPDATE FAILED: ${e.message}`);
            setIsUpdating(false);
        }
    }, []);

    const handleLogout = useCallback(() => {
        localStorage.removeItem('aetheros_token');
        window.location.reload();
    }, []);

    const handleSave = useCallback(async () => {
        setIsUpdating(true);
        setUpdateMessage('SAVING SYSTEM CONFIGURATION...');
        try {
            const res = await apiFetch('/api/config/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(localSettings),
            });
            if (!res.ok) throw new Error('Failed to save settings');
            
            // Re-fetch to confirm and update state
            const getRes = await apiFetch('/api/config/get');
            const freshData = await getRes.json();
            
            dispatch({ type: 'UPDATE_SETTINGS', payload: freshData });
            dispatch({ type: 'TOGGLE_SETTINGS' });
        } catch (e: any) {
            setUpdateMessage(`SAVE FAILED: ${e.message}`);
        } finally {
            setIsUpdating(false);
            setUpdateMessage(null);
        }
    }, [dispatch, localSettings]);

    const handleCancel = useCallback(() => {
        setLocalSettings({ ...settings });
        setYoloConfirmStep(0);
        dispatch({ type: 'TOGGLE_SETTINGS' });
    }, [dispatch, settings]);

    if (!isSettingsOpen) return null;

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.85)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(6px)',
            }}
            onClick={(e) => e.target === e.currentTarget && handleCancel()}
        >
            <div style={{
                background: '#090912',
                border: '1px solid var(--lcars-sage)',
                borderRadius: 8,
                width: '100%',
                maxWidth: 580,
                maxHeight: '90vh',
                overflow: 'auto',
                boxShadow: '0 0 40px rgba(187,184,145,0.15)',
            }}>
                {/* Modal Header */}
                <div style={{
                    display: 'flex', alignItems: 'stretch', height: 52, borderBottom: '1px solid #1a1a1a',
                }}>
                    <div style={{
                        width: 120, background: 'var(--lcars-sage)',
                        borderTopLeftRadius: 'var(--radius-pill)',
                    }} />
                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', padding: '0 20px',
                    }}>
                        <span style={{
                            fontFamily: 'var(--font-display)', fontSize: 16,
                            fontWeight: 700, letterSpacing: '0.12em', color: 'var(--lcars-sage)',
                        }}>
                            SYSTEM CONFIGURATION
                        </span>
                    </div>
                </div>

                {/* Modal Body */}
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {/* API Key */}
                    <Field label="GEMINI API KEY" hint="Stored securely on the server — never exposed to the browser.">
                        <input
                            id="api-key-input"
                            type="password"
                            value={localSettings.apiKey || (state.settings.hasKey ? '********' : '')}
                            onChange={(e) => setLocalSettings((s) => ({ ...s, apiKey: e.target.value }))}
                            placeholder="AIza..."
                            style={inputStyle}
                        />
                    </Field>

                    {/* Model */}
                    <Field label="GEMINI MODEL">
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {MODELS.map((m) => (
                                <button
                                    key={m.id}
                                    id={`model-btn-${m.id}`}
                                    onClick={() => setLocalSettings((s) => ({ ...s, model: m.id }))}
                                    style={{
                                        ...pillBtnStyle,
                                        background: localSettings.model === m.id ? 'var(--lcars-sage)' : 'transparent',
                                        color: localSettings.model === m.id ? '#141414' : 'var(--lcars-text-dim)',
                                        border: `1px solid ${localSettings.model === m.id ? 'var(--lcars-sage)' : '#2a2a2a'}`,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}
                                >
                                    {m.label}
                                    {m.tag && (
                                        <span style={{
                                            fontSize: 8, fontWeight: 700,
                                            color: localSettings.model === m.id ? '#141414' : 'var(--lcars-text-dim)',
                                            opacity: 0.7,
                                        }}>{m.tag}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </Field>

                    {/* Temperature */}
                    <Field label={`TEMPERATURE: ${localSettings.temperature.toFixed(1)}`}
                        hint="Higher = more creative. Lower = more deterministic.">
                        <input
                            id="temperature-slider"
                            type="range"
                            min={0} max={1} step={0.1}
                            value={localSettings.temperature}
                            onChange={(e) => setLocalSettings((s) => ({ ...s, temperature: parseFloat(e.target.value) }))}
                            style={{ width: '100%', accentColor: 'var(--lcars-sage)', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#444' }}>
                            <span>PRECISE</span><span>BALANCED</span><span>CREATIVE</span>
                        </div>
                    </Field>

                    {/* Agent system prompts preview */}
                    <Field label="AGENT SYSTEM PROMPTS">
                        {AGENTS.map((a) => (
                            <details key={a.id} style={{ marginBottom: 6 }}>
                                <summary style={{
                                    fontFamily: 'var(--font-display)', fontSize: 11,
                                    letterSpacing: '0.1em', color: a.color,
                                    cursor: 'pointer', padding: '4px 0',
                                }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>{a.icon}</span>{a.shortName}
                                </summary>
                                <div style={{
                                    fontFamily: 'var(--font-mono)', fontSize: 11, color: '#666',
                                    padding: '8px', marginTop: 4, background: '#050505',
                                    borderLeft: `2px solid ${a.color}`, borderRadius: 4,
                                    lineHeight: 1.6,
                                }}>
                                    {a.systemPrompt}
                                </div>
                            </details>
                        ))}
                    </Field>

                    {/* Sandbox Network Access */}
                    <Field label="SANDBOX NETWORK ACCESS" hint="WARNING: Enabling this allows the C# Docker Sandbox to reach the internet and host machines.">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <button
                                type="button"
                                onClick={() => setLocalSettings((s) => ({ ...s, isSandboxNetworkEnabled: !s.isSandboxNetworkEnabled }))}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 16px', borderRadius: 4,
                                    background: localSettings.isSandboxNetworkEnabled ? 'var(--lcars-warning)' : 'var(--lcars-bg-muted)',
                                    color: localSettings.isSandboxNetworkEnabled ? '#141414' : 'var(--lcars-text-dim)',
                                    border: `1px solid ${localSettings.isSandboxNetworkEnabled ? 'var(--lcars-warning)' : 'var(--lcars-border)'}`,
                                    fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer',
                                    transition: 'all 0.2s', width: '100%', justifyContent: 'center'
                                }}
                            >
                                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                                    {localSettings.isSandboxNetworkEnabled ? 'wifi' : 'wifi_off'}
                                </span>
                                {localSettings.isSandboxNetworkEnabled ? 'NETWORK ENABLED' : 'NETWORK OFFLINE'}
                            </button>
                        </div>
                    </Field>

                    {/* Security Protocols */}
                    <Field label="SECURITY PROTOCOLS" hint="Starfleet Protocol (Standard) vs Section 31 (YOLO Mode)">
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button
                                onClick={() => dispatch({ type: 'SET_YOLO_MODE', payload: false })}
                                style={{
                                    ...pillBtnStyle,
                                    flex: 1,
                                    background: !state.isYoloMode ? 'var(--lcars-sage)' : 'transparent',
                                    color: !state.isYoloMode ? '#141414' : 'var(--lcars-text-dim)',
                                    border: `1px solid ${!state.isYoloMode ? 'var(--lcars-sage)' : '#2a2a2a'}`,
                                }}
                            >
                                STARFLEET (SAFE)
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!state.isYoloMode) {
                                        if (yoloConfirmStep === 0) {
                                            setYoloConfirmStep(1);
                                            setTimeout(() => setYoloConfirmStep(0), 3000);
                                        } else {
                                            dispatch({ type: 'SET_YOLO_MODE', payload: true });
                                            setYoloConfirmStep(0);
                                        }
                                    }
                                }}
                                style={{
                                    ...pillBtnStyle,
                                    flex: 1,
                                    background: state.isYoloMode ? '#ff0000' : yoloConfirmStep === 1 ? '#cc5500' : 'transparent',
                                    color: state.isYoloMode || yoloConfirmStep === 1 ? '#ffffff' : 'var(--lcars-text-dim)',
                                    border: `1px solid ${state.isYoloMode ? '#ff0000' : yoloConfirmStep === 1 ? '#cc5500' : '#2a2a2a'}`,
                                }}
                            >
                                {state.isYoloMode ? 'YOLO MODE (RISKY)' : yoloConfirmStep === 1 ? 'CLICK AGAIN TO CONFIRM' : 'YOLO MODE (RISKY)'}
                            </button>
                        </div>
                    </Field>

                    {/* Auto-Updater */}
                    <Field label="SYSTEM FIRMWARE" hint="Pull latest updates from GitHub and rebuild AetherOS containers natively.">
                        <button
                            type="button"
                            onClick={handleUpdate}
                            disabled={isUpdating}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 16px', borderRadius: 4,
                                background: isUpdating ? 'var(--lcars-warning)' : 'var(--lcars-bg-muted)',
                                color: isUpdating ? '#141414' : 'var(--lcars-text-dim)',
                                border: `1px solid ${isUpdating ? 'var(--lcars-warning)' : 'var(--lcars-border)'}`,
                                fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', cursor: isUpdating ? 'wait' : 'pointer',
                                transition: 'all 0.2s', width: '100%', justifyContent: 'center'
                            }}
                        >
                            <span className="material-symbols-outlined" style={{ fontSize: 18, animation: isUpdating ? 'spin 2s linear infinite' : 'none' }}>
                                {isUpdating ? 'sync' : 'system_update'}
                            </span>
                            {isUpdating ? (updateMessage || 'UPDATING...') : 'UPDATE AETHEROS'}
                        </button>
                    </Field>

                    {/* Security - Logout */}
                    <Field label="SECURITY" hint="Terminate active session and lock system.">
                        <button
                            type="button"
                            onClick={handleLogout}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 16px', borderRadius: 4,
                                background: '#1c0e0e',
                                color: '#ff6666',
                                border: '1px solid #4a1c1c',
                                fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer',
                                transition: 'all 0.2s', width: '100%', justifyContent: 'center'
                            }}
                        >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                                logout
                            </span>
                            TERMINATE SESSION
                        </button>
                    </Field>

                </div>

                {/* Footer */}
                <div style={{
                    display: 'flex', justifyContent: 'flex-end', gap: 12,
                    padding: '16px 24px', borderTop: '1px solid #1a1a1a',
                }}>
                    <button id="settings-cancel-btn" onClick={handleCancel} style={{
                        ...pillBtnStyle,
                        border: '1px solid #333', color: 'var(--lcars-text-dim)',
                    }}>
                        CANCEL
                    </button>
                    <button id="settings-save-btn" onClick={handleSave} style={{
                        ...pillBtnStyle,
                        background: 'var(--lcars-sage)', color: '#141414',
                        border: '1px solid var(--lcars-sage)', fontWeight: 700,
                    }}>
                        SAVE & CONFIRM ◈
                    </button>
                </div>
            </div>
        </div>
    );
});

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={{
                display: 'block', fontFamily: 'var(--font-display)',
                fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'var(--lcars-text-dim)', marginBottom: 8,
            }}>
                {label}
                {hint && <span style={{ display: 'block', fontSize: 9, color: '#333', letterSpacing: '0.05em', marginTop: 2, textTransform: 'none' }}>{hint}</span>}
            </label>
            {children}
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#050505',
    border: '1px solid #2a2a2a',
    borderLeft: '3px solid var(--lcars-sage)',
    color: 'var(--lcars-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    padding: '10px 14px',
    borderRadius: 6,
    outline: 'none',
};

const pillBtnStyle: React.CSSProperties = {
    fontFamily: 'var(--font-display)',
    fontSize: 11,
    letterSpacing: '0.12em',
    padding: '8px 20px',
    borderRadius: 20,
    cursor: 'pointer',
    transition: 'all 150ms ease',
    background: 'transparent',
};

export default SettingsModal;
