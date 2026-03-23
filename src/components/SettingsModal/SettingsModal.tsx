import React, { memo, useState, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { getAllAgents } from '../../agents';
import { apiFetch } from '../../utils/api';
import type { GeminiModel, Settings } from '../../types';
import SlackHelp from './SlackHelp';
import CronManager from './CronManager';

const DEFAULT_MODELS: { id: GeminiModel; label: string; tag?: string; maxTokens?: number }[] = [
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
    const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null);
    const [availableModels, setAvailableModels] = useState<{ id: string; label: string; tag?: string; maxTokens?: number }[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [showSlackHelp, setShowSlackHelp] = useState(false);

    const fetchModels = useCallback(async () => {
        setIsFetchingModels(true);
        try {
            const res = await apiFetch('/api/models');
            if (res.ok) {
                const data = await res.json();
                if (data.models && data.models.length > 0) {
                    setAvailableModels(data.models);
                }
            }
        } catch (e) {
            console.error('Failed to fetch models:', e);
        } finally {
            setIsFetchingModels(false);
        }
    }, []);

    React.useEffect(() => {
        if (isSettingsOpen) {
            checkUpdates();
            fetchModels();
            // Store tokens as 'undefined' if masked, so we can detect when user clears them to ''
            setLocalSettings({ 
                ...settings,
                slackBotToken: settings.hasSlackBotToken ? undefined : settings.slackBotToken,
                slackAppToken: settings.hasSlackAppToken ? undefined : settings.slackAppToken,
                apiKey: settings.hasKey ? undefined : settings.apiKey,
                bgApiKey: settings.hasBgKey ? undefined : settings.bgApiKey
            });
        }
    }, [isSettingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Sync localSettings if global settings change (e.g. from RegistrySection)
    React.useEffect(() => {
        setLocalSettings(s => ({ ...s, registries: settings.registries }));
    }, [settings.registries]);

    const checkUpdates = async () => {
        try {
            const res = await apiFetch('/api/system/check-updates');
            if (res.ok) {
                const data = await res.json();
                setUpdateAvailable(data.updateAvailable);
            }
        } catch (e) {
            console.error('Failed to check for updates:', e);
        }
    };

    const handleUpdate = useCallback(async () => {
        setIsUpdating(true);
        
        const steps = [
            'SYNCHRONIZING WITH SUBSPACE (FETCHING commits)...',
            'PULLING DATA CORES (GIT PULL)...',
            'REBUILDING NEURAL NETWORKS (PREPARING ENVIRONMENT)...',
            'REBOOTING SYSTEMS (PAGE RELOAD IN 5s)...'
        ];

        try {
            setUpdateMessage(steps[0]);
            await new Promise(r => setTimeout(r, 1500));
            
            setUpdateMessage(steps[1]);
            const res = await apiFetch('/api/system/update', { method: 'POST' });
            if (!res.ok) throw new Error('Update failed');
            
            setUpdateMessage(steps[2]);
            await new Promise(r => setTimeout(r, 2000));
            
            setUpdateMessage(steps[3]);
            
            setTimeout(() => {
                window.location.reload();
            }, 5000);
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
            const savePayload = { 
                ...localSettings, 
                isYoloMode: state.isYoloMode // Persist current YOLO state
            };
            const res = await apiFetch('/api/config/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(savePayload),
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

    const groupedModels = React.useMemo(() => {
        const modelsToUse = availableModels.length > 0 ? availableModels : DEFAULT_MODELS;
        const groups: { [key: string]: typeof modelsToUse } = {};
        
        modelsToUse.forEach(m => {
            let groupName = "Other";
            const match = m.label.match(/Gemini (\d+(\.\d+)?)/i);
            if (match) {
                groupName = `Gemini ${match[1]}`;
            } else if (m.label.toLowerCase().includes('gemini')) {
                groupName = "Gemini Legacy";
            }
            if (!groups[groupName]) groups[groupName] = [];
            groups[groupName].push(m);
        });
        
        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [availableModels]);

    if (!isSettingsOpen) return null;

    if (showSlackHelp) {
        return (
            <div
                style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.85)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(6px)',
                }}
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
                    <SlackHelp onBack={() => setShowSlackHelp(false)} />
                </div>
            </div>
        );
    }

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
                            value={localSettings.apiKey === undefined ? '********' : localSettings.apiKey}
                            onChange={(e) => setLocalSettings((s) => ({ ...s, apiKey: e.target.value }))}
                            placeholder="AIza..."
                            style={inputStyle}
                        />
                    </Field>

                    {/* Model */}
                    <Field label="GEMINI MODEL">
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                            <button
                                type="button"
                                onClick={fetchModels}
                                disabled={isFetchingModels}
                                style={{
                                    ...pillBtnStyle,
                                    border: '1px solid var(--lcars-sage)',
                                    color: 'var(--lcars-sage)',
                                    padding: '6px 14px',
                                    fontSize: 10,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    opacity: isFetchingModels ? 0.5 : 1
                                }}
                            >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>sync</span>
                                {isFetchingModels ? 'SYNCING...' : 'SYNC GOOGLE MODELS'}
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {groupedModels.map(([groupName, modelsInGroup]) => (
                                <div key={groupName}>
                                    <h3 style={{ 
                                        fontFamily: 'var(--font-display)', fontSize: 12, 
                                        color: 'var(--lcars-sage)', marginBottom: 8, 
                                        letterSpacing: '0.1em', textTransform: 'uppercase',
                                        margin: '0 0 8px 0', borderBottom: '1px solid #1a1a1a', paddingBottom: 4
                                    }}>
                                        {groupName}
                                    </h3>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {modelsInGroup.map((m) => (
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
                                                {(m.tag || m.maxTokens) && (
                                                    <span style={{
                                                        fontSize: 8, fontWeight: 700,
                                                        color: localSettings.model === m.id ? '#141414' : 'var(--lcars-text-dim)',
                                                        opacity: 0.7,
                                                    }}>{m.tag || `${Math.round(m.maxTokens!/1000)}k`}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
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
                    <Field label="AGENT CUSTOMIZATION" hint="Modify system protocols and identifiers for specialized AIs.">
                        {getAllAgents(localSettings.agentOverrides).map((a) => (
                            <details key={a.id} style={{ marginBottom: 12, border: '1px solid #1a1a1a', borderRadius: 4, padding: '4px 8px' }}>
                                <summary style={{
                                    fontFamily: 'var(--font-display)', fontSize: 11,
                                    letterSpacing: '0.1em', color: a.color,
                                    cursor: 'pointer', padding: '8px 0',
                                    display: 'flex', alignItems: 'center'
                                }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 8 }}>{a.icon}</span>
                                    <span style={{ fontWeight: 700 }}>{a.shortName}</span>
                                    <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 8 }}>({a.name})</span>
                                </summary>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 4px 12px 4px' }}>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 9, color: '#444', marginBottom: 4 }}>PROTOCOL NAME</div>
                                            <input 
                                                type="text" 
                                                value={a.shortName} 
                                                onChange={(e) => setLocalSettings(s => ({
                                                    ...s,
                                                    agentOverrides: {
                                                        ...s.agentOverrides,
                                                        [a.id]: { ...(s.agentOverrides?.[a.id] || {}), shortName: e.target.value }
                                                    }
                                                }))}
                                                style={{ ...inputStyle, padding: '6px 10px', fontSize: 11 }}
                                            />
                                        </div>
                                        <div style={{ flex: 2 }}>
                                            <div style={{ fontSize: 9, color: '#444', marginBottom: 4 }}>FULL DESIGNATION</div>
                                            <input 
                                                type="text" 
                                                value={a.name} 
                                                onChange={(e) => setLocalSettings(s => ({
                                                    ...s,
                                                    agentOverrides: {
                                                        ...s.agentOverrides,
                                                        [a.id]: { ...(s.agentOverrides?.[a.id] || {}), name: e.target.value }
                                                    }
                                                }))}
                                                style={{ ...inputStyle, padding: '6px 10px', fontSize: 11 }}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 9, color: '#444', marginBottom: 4 }}>SYSTEM INSTRUCTIONS</div>
                                        <textarea 
                                            value={a.systemPrompt} 
                                            onChange={(e) => setLocalSettings(s => ({
                                                ...s,
                                                agentOverrides: {
                                                    ...s.agentOverrides,
                                                    [a.id]: { ...(s.agentOverrides?.[a.id] || {}), systemPrompt: e.target.value }
                                                }
                                            }))}
                                            style={{ 
                                                ...inputStyle, 
                                                height: 80, 
                                                resize: 'vertical', 
                                                fontSize: 11, 
                                                lineHeight: 1.5,
                                                fontFamily: 'var(--font-mono)'
                                            }}
                                        />
                                    </div>

                                    {/* Per-Agent LLM Provider */}
                                    <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 10, marginTop: 4 }}>
                                        <div style={{ fontSize: 9, color: 'var(--lcars-sage)', marginBottom: 8, letterSpacing: '0.1em' }}>AUTONOMOUS PROTOCOL ENGINE</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                                            <div style={{ display: 'flex', gap: 4, background: '#050505', padding: 2, borderRadius: 20, border: '1px solid #2a2a2a' }}>
                                                <button
                                                    onClick={() => setLocalSettings(s => ({
                                                        ...s,
                                                        agentOverrides: {
                                                            ...s.agentOverrides,
                                                            [a.id]: { ...(s.agentOverrides?.[a.id] || {}), bgProvider: 'gemini' }
                                                        }
                                                    }))}
                                                    style={{
                                                        ...pillBtnStyle,
                                                        padding: '4px 10px', fontSize: 9,
                                                        background: (a.bgProvider || localSettings.bgProvider || 'gemini') === 'gemini' ? 'var(--lcars-sage)' : 'transparent',
                                                        color: (a.bgProvider || localSettings.bgProvider || 'gemini') === 'gemini' ? '#141414' : 'var(--lcars-text-dim)',
                                                        border: 'none',
                                                    }}
                                                >GEMINI</button>
                                                <button
                                                    onClick={() => setLocalSettings(s => ({
                                                        ...s,
                                                        agentOverrides: {
                                                            ...s.agentOverrides,
                                                            [a.id]: { ...(s.agentOverrides?.[a.id] || {}), bgProvider: 'openai' }
                                                        }
                                                    }))}
                                                    style={{
                                                        ...pillBtnStyle,
                                                        padding: '4px 10px', fontSize: 9,
                                                        background: (a.bgProvider || localSettings.bgProvider) === 'openai' ? 'var(--lcars-sage)' : 'transparent',
                                                        color: (a.bgProvider || localSettings.bgProvider) === 'openai' ? '#141414' : 'var(--lcars-text-dim)',
                                                        border: 'none',
                                                    }}
                                                >OLLAMA</button>
                                            </div>

                                            <div style={{ flex: 1, minWidth: 150 }}>
                                                <input 
                                                    type="text" 
                                                    placeholder={ (a.bgProvider || localSettings.bgProvider || 'gemini') === 'gemini' ? "Model (e.g. gemini-2.0-flash)" : "Model (e.g. llama3.2)" }
                                                    value={a.bgModelName || ''}
                                                    onChange={(e) => setLocalSettings(s => ({
                                                        ...s,
                                                        agentOverrides: {
                                                            ...s.agentOverrides,
                                                            [a.id]: { ...(s.agentOverrides?.[a.id] || {}), bgModelName: e.target.value }
                                                        }
                                                    }))}
                                                    style={{ ...inputStyle, padding: '4px 10px', fontSize: 10, borderLeft: '2px solid var(--lcars-sage)' }}
                                                />
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 8, color: '#444', marginTop: 4 }}>OVERRIDING GLOBAL DEFAULTS FOR THIS UNIT.</div>
                                    </div>
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
                                onClick={async () => {
                                    dispatch({ type: 'SET_YOLO_MODE', payload: false });
                                    // Persistent save
                                    await apiFetch('/api/config/save', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ isYoloMode: false }),
                                    });
                                }}
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
                                onClick={async () => {
                                    if (!state.isYoloMode) {
                                        if (yoloConfirmStep === 0) {
                                            setYoloConfirmStep(1);
                                            setTimeout(() => setYoloConfirmStep(0), 3000);
                                        } else {
                                            dispatch({ type: 'SET_YOLO_MODE', payload: true });
                                            setYoloConfirmStep(0);
                                            // Persistent save
                                            await apiFetch('/api/config/save', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ isYoloMode: true }),
                                            });
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

                    {/* Container Registries */}
                    <RegistrySection />

                    {/* Autonomous Agent Configuration */}
                    <Field label="AUTONOMOUS AGENT CONFIGURATION" hint="Settings for background tasks and true autonomous execution (Option 2).">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    onClick={() => setLocalSettings(s => ({ ...s, bgProvider: 'gemini' }))}
                                    style={{
                                        ...pillBtnStyle, flex: 1,
                                        background: localSettings.bgProvider === 'gemini' ? 'var(--lcars-sage)' : 'transparent',
                                        color: localSettings.bgProvider === 'gemini' ? '#141414' : 'var(--lcars-text-dim)',
                                        border: `1px solid ${localSettings.bgProvider === 'gemini' ? 'var(--lcars-sage)' : '#2a2a2a'}`,
                                    }}
                                >GEMINI API</button>
                                <button
                                    onClick={() => setLocalSettings(s => ({ ...s, bgProvider: 'openai' }))}
                                    style={{
                                        ...pillBtnStyle, flex: 1,
                                        background: localSettings.bgProvider === 'openai' ? 'var(--lcars-sage)' : 'transparent',
                                        color: localSettings.bgProvider === 'openai' ? '#141414' : 'var(--lcars-text-dim)',
                                        border: `1px solid ${localSettings.bgProvider === 'openai' ? 'var(--lcars-sage)' : '#2a2a2a'}`,
                                    }}
                                >OLLAMA / OPENAI</button>
                            </div>
                            
                            {localSettings.bgProvider === 'openai' && (
                                <>
                                    <input 
                                        type="text" 
                                        placeholder="API Base URL (e.g. http://localhost:11434/v1)" 
                                        value={localSettings.bgBaseUrl || ''}
                                        onChange={e => setLocalSettings(s => ({ ...s, bgBaseUrl: e.target.value }))}
                                        style={inputStyle} 
                                    />
                                    <input 
                                        type="password" 
                                        placeholder="Ollama/OpenAI Key (optional)" 
                                        value={localSettings.bgApiKey === undefined ? '********' : localSettings.bgApiKey}
                                        onChange={e => setLocalSettings(s => ({ ...s, bgApiKey: e.target.value }))}
                                        style={inputStyle} 
                                    />
                                </>
                            )}
                            
                            <input 
                                type="text" 
                                placeholder={localSettings.bgProvider === 'gemini' ? "Model Name (e.g. gemini-2.5-pro)" : "Model Name (e.g. llama3.2)"}
                                value={localSettings.bgModelName || ''}
                                onChange={e => setLocalSettings(s => ({ ...s, bgModelName: e.target.value }))}
                                style={inputStyle} 
                            />
                            
                            <div>
                                <div style={{ fontSize: 9, color: '#444', marginBottom: 4 }}>MAX TOOL ITERATIONS: {localSettings.bgIterationLimit || 5}</div>
                                <input
                                    type="range"
                                    min={1} max={20} step={1}
                                    value={localSettings.bgIterationLimit || 5}
                                    onChange={(e) => setLocalSettings(s => ({ ...s, bgIterationLimit: parseInt(e.target.value) }))}
                                    style={{ width: '100%', accentColor: 'var(--lcars-sage)', cursor: 'pointer' }}
                                />
                            </div>
                        </div>
                    </Field>

                    <Field label="SLACK INTEGRATION" hint="Connect LCARS to your business Slack. Uses Socket Mode (no public IP needed).">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, cursor: 'pointer', fontFamily: 'var(--lcars-font-mono, monospace)', textTransform: 'uppercase' }}>
                                    <input 
                                        type="checkbox" 
                                        checked={localSettings.slackEnabled || false}
                                        onChange={e => setLocalSettings(s => ({ ...s, slackEnabled: e.target.checked }))}
                                        style={{ accentColor: 'var(--lcars-sage)' }}
                                    />
                                    ENABLE SLACK SOCKET MODE
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setShowSlackHelp(true)}
                                    style={{
                                        background: 'none', border: 'none', color: 'var(--lcars-warning)',
                                        fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 700,
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                        padding: '2px 6px', borderLeft: '2px solid var(--lcars-warning)'
                                    }}
                                >
                                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>help</span>
                                    HELP / SETUP GUIDE
                                </button>
                            </div>
                            
                            {localSettings.slackEnabled && (
                                <>
                                    <input 
                                        type="password" 
                                        placeholder="Slack Bot Token (xoxb-...)" 
                                        value={localSettings.slackBotToken === undefined ? '********' : localSettings.slackBotToken}
                                        onChange={e => setLocalSettings(s => ({ ...s, slackBotToken: e.target.value }))}
                                        style={inputStyle} 
                                    />
                                    <input 
                                        type="password" 
                                        placeholder="Slack App Token (xapp-...)" 
                                        value={localSettings.slackAppToken === undefined ? '********' : localSettings.slackAppToken}
                                        onChange={e => setLocalSettings(s => ({ ...s, slackAppToken: e.target.value }))}
                                        style={inputStyle} 
                                    />
                                    <div style={{ fontSize: 9, color: '#666', marginTop: -4 }}>
                                        Create a Slack App, enable Socket Mode, and copy the App-Level Token. 
                                        Then add OAuth bot scopes (e.g. chat:write, app_mentions:read) and install to workspace to get the Bot Token.
                                    </div>
                                </>
                            )}
                        </div>
                    </Field>

                    <CronManager />

                    <Field 
                        label="SYSTEM FIRMWARE" 
                        hint="Pull latest updates from GitHub and rebuild AetherOS containers natively."
                    >
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
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <span>{isUpdating ? (updateMessage || 'UPDATING...') : 'UPDATE AETHEROS'}</span>
                                {!isUpdating && updateAvailable && (
                                    <span style={{ fontSize: 9, color: 'var(--lcars-sage)', marginTop: 2 }}>[ NEW UPDATES DETECTED ]</span>
                                )}
                            </div>
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

function RegistrySection() {
    const { state, dispatch } = useAppContext();
    const [server, setServer] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [loginResult, setLoginResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleLogin = async () => {
        setIsLoggingIn(true);
        setLoginResult(null);
        try {
            const res = await apiFetch('/api/docker/registry/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ server, username, password }),
            });
            const data = await res.json();
            if (res.ok) {
                setLoginResult({ success: true, message: 'AUTHENTICATION SUCCESSFUL' });
                // Re-fetch settings to show updated registries
                const getRes = await apiFetch('/api/config/get');
                const freshData = await getRes.json();
                dispatch({ type: 'UPDATE_SETTINGS', payload: freshData });
                // Reset inputs
                setServer('');
                setUsername('');
                setPassword('');
            } else {
                setLoginResult({ success: false, message: data.error || 'AUTHENTICATION FAILED' });
            }
        } catch (e: any) {
            setLoginResult({ success: false, message: e.message });
        } finally {
            setIsLoggingIn(false);
        }
    };

    return (
        <Field label="CONTAINER REGISTRIES" hint="Authenticate with private registries like Azure (ACR).">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {state.settings.registries?.map((r, i) => (
                    <div key={i} style={{ 
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', 
                        background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #2a2a2a'
                    }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--lcars-sage)' }}>database</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'white' }}>{r.server}</div>
                            <div style={{ fontSize: 9, color: '#666' }}>LOGGED IN AS: {r.username}</div>
                        </div>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#444' }}>verified</span>
                    </div>
                ))}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, padding: 12, border: '1px dashed #2a2a2a', borderRadius: 6 }}>
                    <input 
                        type="text" value={server} onChange={e => setServer(e.target.value)} 
                        placeholder="Registry Server (e.g. myacr.azurecr.io)" style={inputStyle}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input 
                            type="text" value={username} onChange={e => setUsername(e.target.value)} 
                            placeholder="Username" style={{ ...inputStyle, flex: 1 }}
                        />
                        <input 
                            type="password" value={password} onChange={e => setPassword(e.target.value)} 
                            placeholder="Password / Secret" style={{ ...inputStyle, flex: 1 }}
                        />
                    </div>
                    <button 
                        onClick={handleLogin} disabled={isLoggingIn || !server || !username || !password}
                        style={{ ...pillBtnStyle, background: 'var(--lcars-sage)', color: '#141414', fontWeight: 700, width: '100%', marginTop: 4 }}
                    >
                        {isLoggingIn ? 'AUTHENTICATING...' : 'IDENTIFY & AUTHENTICATE ◈'}
                    </button>
                    {loginResult && (
                        <div style={{ 
                            fontSize: 10, textAlign: 'center', fontWeight: 700, 
                            color: loginResult.success ? 'var(--lcars-sage)' : '#ff4444' 
                        }}>
                            {loginResult.message}
                        </div>
                    )}
                </div>
            </div>
        </Field>
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

