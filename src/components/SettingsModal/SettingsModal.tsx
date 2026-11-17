import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../context/useAppContext';
import { getAllAgents } from '../../agents';
import { apiFetch } from '../../utils/api';
import { ThemeSwitcher } from '../../theme/ThemeSwitcher';
import type { GeminiModel, Settings } from '../../types';
import SlackHelp from './SlackHelp';

type SettingsTab = 'appearance' | 'ai' | 'integrations' | 'security';

interface ModelOption {
    id: GeminiModel;
    label: string;
    tag?: string;
    maxTokens?: number;
}

interface UpdateCheckStatus {
    updateAvailable: boolean;
    behindCount?: number;
    branch?: string;
    lastCommit?: string;
}

const DEFAULT_MODELS: ModelOption[] = [
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', tag: 'PREVIEW' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', tag: 'PREVIEW' },
    { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', tag: 'PREVIEW' },
    { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image', tag: 'PREVIEW · IMG' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tag: 'GA' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tag: 'GA' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tag: 'GA' },
];

function createEditableSettings(source: Settings): Settings {
    return {
        ...source,
        slackBotToken: source.hasSlackBotToken ? undefined : source.slackBotToken,
        slackAppToken: source.hasSlackAppToken ? undefined : source.slackAppToken,
        apiKey: source.hasKey ? undefined : source.apiKey,
        bgApiKey: source.hasBgKey ? undefined : source.bgApiKey,
        sshPassword: source.hasSshPassword ? undefined : source.sshPassword,
    };
}

const SettingsModal = memo(function SettingsModal() {
    const { state } = useAppContext();
    if (!state.isSettingsOpen) return null;

    const modalKey = [
        state.settings.hasKey ? 'k1' : 'k0',
        state.settings.hasBgKey ? 'bk1' : 'bk0',
        state.settings.hasSlackBotToken ? 'sb1' : 'sb0',
        state.settings.hasSlackAppToken ? 'sa1' : 'sa0',
        state.settings.hasSshPassword ? 'sp1' : 'sp0',
        state.settings.model,
    ].join('-');

    return <SettingsModalContent key={modalKey} initialSettings={state.settings} />;
});

function SettingsModalContent({ initialSettings }: { initialSettings: Settings }) {
    const { state, dispatch } = useAppContext();
    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
    const [localSettings, setLocalSettings] = useState<Settings>(() =>
        createEditableSettings(initialSettings),
    );
    const [elevatedConfirmStep, setElevatedConfirmStep] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [isUpdating, setIsUpdating] = useState(false);
    const [updateProgress, setUpdateProgress] = useState<string | null>(null);
    const [updateInfo, setUpdateInfo] = useState<UpdateCheckStatus | null>(null);
    const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

    const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [showSlackHelp, setShowSlackHelp] = useState(false);

    // Change password state
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordResult, setPasswordResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const fetchModels = useCallback(async () => {
        setIsFetchingModels(true);
        try {
            const res = await apiFetch('/api/models');
            if (res.ok) {
                const data = (await res.json()) as { models?: ModelOption[] };
                if (data.models && data.models.length > 0) {
                    setAvailableModels(data.models);
                }
            }
        } catch (err: unknown) {
            console.error('Failed to fetch models:', err);
        } finally {
            setIsFetchingModels(false);
        }
    }, []);

    const checkUpdates = useCallback(async () => {
        setIsCheckingUpdates(true);
        try {
            const res = await apiFetch('/api/system/check-updates');
            if (res.ok) {
                const data = (await res.json()) as UpdateCheckStatus;
                setUpdateInfo({
                    updateAvailable: Boolean(data.updateAvailable),
                    behindCount: data.behindCount,
                    branch: data.branch,
                    lastCommit: data.lastCommit,
                });
            }
        } catch (err: unknown) {
            console.error('Failed to check for updates:', err);
        } finally {
            setIsCheckingUpdates(false);
        }
    }, []);

    useEffect(() => {
        void fetchModels();
        void checkUpdates();
    }, [fetchModels, checkUpdates]);

    const handleCancel = useCallback(() => {
        setElevatedConfirmStep(0);
        dispatch({ type: 'TOGGLE_SETTINGS' });
    }, [dispatch]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (showSlackHelp) {
                    setShowSlackHelp(false);
                } else {
                    handleCancel();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleCancel, showSlackHelp]);

    const handleUpdate = useCallback(async () => {
        setIsUpdating(true);
        setUpdateProgress('Fetching upstream changes...');
        try {
            const res = await apiFetch('/api/system/update', { method: 'POST' });
            const data = (await res.json()) as { success?: boolean; error?: string; message?: string };
            if (!res.ok) {
                throw new Error(data.error || 'System update failed');
            }
            setUpdateProgress(data.message || 'Update triggered. Reloading dashboard in 5 seconds...');
            window.setTimeout(() => {
                window.location.reload();
            }, 5000);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Update failed';
            setUpdateProgress(`Update failed: ${message}`);
            setIsUpdating(false);
        }
    }, []);

    const handleLogout = useCallback(async () => {
        try {
            await apiFetch('/api/auth/logout', { method: 'POST' });
        } catch (err: unknown) {
            console.error('Logout request failed:', err);
        } finally {
            localStorage.removeItem('aetheros_token');
            window.location.reload();
        }
    }, []);

    const handleChangePassword = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            setPasswordResult(null);

            if (!currentPassword || !newPassword) {
                setPasswordResult({ type: 'error', text: 'Current and new password are required.' });
                return;
            }
            if (newPassword !== confirmPassword) {
                setPasswordResult({ type: 'error', text: 'New password and confirmation do not match.' });
                return;
            }

            setIsChangingPassword(true);
            try {
                const res = await apiFetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentPassword, newPassword }),
                });
                const data = (await res.json()) as { success?: boolean; error?: string };
                if (!res.ok || data.success === false) {
                    throw new Error(data.error || 'Failed to update password');
                }
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setPasswordResult({ type: 'success', text: 'Password updated successfully.' });
            } catch (err: unknown) {
                setPasswordResult({
                    type: 'error',
                    text: err instanceof Error ? err.message : 'Failed to update password',
                });
            } finally {
                setIsChangingPassword(false);
            }
        },
        [confirmPassword, currentPassword, newPassword],
    );

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        setSaveMessage(null);
        try {
            const savePayload: Settings = {
                ...localSettings,
                registries: state.settings.registries,
                isYoloMode: state.isYoloMode,
            };
            const res = await apiFetch('/api/config/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(savePayload),
            });
            if (!res.ok) {
                const errData = (await res.json()) as { error?: string };
                throw new Error(errData.error || 'Failed to save settings');
            }

            const getRes = await apiFetch('/api/config/get');
            const freshData = (await getRes.json()) as Partial<Settings>;
            dispatch({ type: 'UPDATE_SETTINGS', payload: freshData });
            dispatch({ type: 'TOGGLE_SETTINGS' });
        } catch (err: unknown) {
            setSaveMessage({
                type: 'error',
                text: err instanceof Error ? err.message : 'Failed to save settings',
            });
        } finally {
            setIsSaving(false);
        }
    }, [dispatch, localSettings, state.isYoloMode, state.settings.registries]);

    const groupedModels = useMemo(() => {
        const modelsToUse = availableModels.length > 0 ? availableModels : DEFAULT_MODELS;
        const groups: Record<string, ModelOption[]> = {};

        modelsToUse.forEach((m) => {
            let groupName = 'Other';
            const match = m.label.match(/Gemini (\d+(\.\d+)?)/i);
            if (match) {
                groupName = `Gemini ${match[1]}`;
            } else if (m.label.toLowerCase().includes('gemini')) {
                groupName = 'Gemini Legacy';
            }
            if (!groups[groupName]) groups[groupName] = [];
            groups[groupName].push(m);
        });

        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [availableModels]);

    const tabs: { id: SettingsTab; label: string; icon: string }[] = [
        { id: 'appearance', label: 'Appearance', icon: 'palette' },
        { id: 'ai', label: 'AI & Agents', icon: 'smart_toy' },
        { id: 'integrations', label: 'Integrations', icon: 'hub' },
        { id: 'security', label: 'Security & System', icon: 'shield' },
    ];

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="System Settings"
            onClick={(e) => {
                if (e.target === e.currentTarget) handleCancel();
            }}
        >
            <div className="kai-modal" style={{ maxWidth: '50rem' }}>
                {/* Header */}
                <div className="kai-modal-header">
                    <div className="flex items-center gap-2.5">
                        <span
                            className="material-symbols-outlined text-xl"
                            style={{ color: 'var(--accent-primary)' }}
                        >
                            settings
                        </span>
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                System Configuration
                            </h2>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Appearance, AI providers, integrations, and security
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="kai-btn kai-btn-ghost kai-btn-icon"
                        aria-label="Close settings"
                    >
                        <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>

                {/* Body */}
                <div className="kai-modal-body flex flex-col gap-5">
                    {showSlackHelp ? (
                        <SlackHelp onBack={() => setShowSlackHelp(false)} />
                    ) : (
                        <>
                            <div className="kai-tabs" role="tablist" aria-label="Settings sections">
                                {tabs.map((tab) => {
                                    const selected = activeTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={selected}
                                            className={`kai-tab ${selected ? 'is-active' : ''}`}
                                            onClick={() => setActiveTab(tab.id)}
                                        >
                                            <span className="material-symbols-outlined text-base">{tab.icon}</span>
                                            <span>{tab.label}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {activeTab === 'appearance' && (
                                <div className="flex flex-col gap-5">
                                    <Field
                                        label="Workspace Theme & Typography"
                                        hint="Choose between Dark, Light, Subtle, and Monochrome themes and adjust the base text scale."
                                    >
                                        <div className="kai-surface-subtle">
                                            <ThemeSwitcher showKeyboardShortcut showFontSize />
                                        </div>
                                    </Field>
                                </div>
                            )}

                            {activeTab === 'ai' && (
                                <div className="flex flex-col gap-5">
                                    <Field
                                        label="Gemini API Key"
                                        hint="Stored on the backend server and never returned in plaintext."
                                        htmlFor="api-key-input"
                                    >
                                        <input
                                            id="api-key-input"
                                            type="password"
                                            className="kai-input kai-mono"
                                            value={localSettings.apiKey === undefined ? '********' : localSettings.apiKey}
                                            onChange={(e) =>
                                                setLocalSettings((s) => ({ ...s, apiKey: e.target.value }))
                                            }
                                            placeholder="AIza..."
                                        />
                                    </Field>

                                    <Field label="Default Chat Model">
                                        <div className="flex items-center gap-2 mb-3">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void fetchModels();
                                                }}
                                                disabled={isFetchingModels}
                                                className="kai-btn kai-btn-secondary kai-btn-sm"
                                            >
                                                <span
                                                    className={`material-symbols-outlined text-sm ${isFetchingModels ? 'animate-spin' : ''}`}
                                                >
                                                    sync
                                                </span>
                                                <span>{isFetchingModels ? 'Syncing...' : 'Sync Google Models'}</span>
                                            </button>
                                        </div>

                                        <div className="flex flex-col gap-4">
                                            {groupedModels.map(([groupName, modelsInGroup]) => (
                                                <div key={groupName} className="flex flex-col gap-2">
                                                    <div
                                                        className="text-xs font-semibold uppercase tracking-wider pb-1 border-b"
                                                        style={{
                                                            color: 'var(--text-secondary)',
                                                            borderColor: 'var(--border-subtle)',
                                                        }}
                                                    >
                                                        {groupName}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {modelsInGroup.map((m) => {
                                                            const isSelected = localSettings.model === m.id;
                                                            return (
                                                                <button
                                                                    key={m.id}
                                                                    id={`model-btn-${m.id}`}
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setLocalSettings((s) => ({ ...s, model: m.id }))
                                                                    }
                                                                    className={`kai-btn kai-btn-sm ${isSelected ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                                                >
                                                                    <span>{m.label}</span>
                                                                    {(m.tag || m.maxTokens) && (
                                                                        <span className="text-[10px] opacity-80 kai-mono">
                                                                            {m.tag ||
                                                                                `${Math.round((m.maxTokens ?? 0) / 1000)}k`}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </Field>

                                    <Field
                                        label={`Temperature (${localSettings.temperature.toFixed(1)})`}
                                        hint="Lower values produce more deterministic output; higher values increase creativity."
                                        htmlFor="temperature-slider"
                                    >
                                        <input
                                            id="temperature-slider"
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.1}
                                            value={localSettings.temperature}
                                            onChange={(e) =>
                                                setLocalSettings((s) => ({
                                                    ...s,
                                                    temperature: parseFloat(e.target.value),
                                                }))
                                            }
                                            className="w-full cursor-pointer"
                                            style={{ accentColor: 'var(--accent-primary)' }}
                                        />
                                        <div
                                            className="flex justify-between text-xs mt-1"
                                            style={{ color: 'var(--text-muted)' }}
                                        >
                                            <span>Precise (0.0)</span>
                                            <span>Balanced (0.5)</span>
                                            <span>Creative (1.0)</span>
                                        </div>
                                    </Field>

                                    <Field
                                        label="Background Autonomous Provider"
                                        hint="LLM backend used for scheduled jobs and autonomous diagnostics."
                                    >
                                        <div className="kai-surface-subtle flex flex-col gap-3">
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setLocalSettings((s) => ({ ...s, bgProvider: 'gemini' }))
                                                    }
                                                    className={`kai-btn kai-btn-sm flex-1 ${(localSettings.bgProvider || 'gemini') === 'gemini' ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                                >
                                                    Gemini API
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setLocalSettings((s) => ({ ...s, bgProvider: 'openai' }))
                                                    }
                                                    className={`kai-btn kai-btn-sm flex-1 ${localSettings.bgProvider === 'openai' ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                                >
                                                    OpenAI / Ollama
                                                </button>
                                            </div>

                                            {localSettings.bgProvider === 'openai' && (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="kai-field">
                                                        <label className="kai-label" htmlFor="bg-base-url">
                                                            API Base URL
                                                        </label>
                                                        <input
                                                            id="bg-base-url"
                                                            type="text"
                                                            className="kai-input kai-mono"
                                                            placeholder="http://localhost:11434/v1"
                                                            value={localSettings.bgBaseUrl || ''}
                                                            onChange={(e) =>
                                                                setLocalSettings((s) => ({
                                                                    ...s,
                                                                    bgBaseUrl: e.target.value,
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                    <div className="kai-field">
                                                        <label className="kai-label" htmlFor="bg-api-key">
                                                            API Key (optional)
                                                        </label>
                                                        <input
                                                            id="bg-api-key"
                                                            type="password"
                                                            className="kai-input kai-mono"
                                                            placeholder="sk-..."
                                                            value={
                                                                localSettings.bgApiKey === undefined
                                                                    ? '********'
                                                                    : localSettings.bgApiKey
                                                            }
                                                            onChange={(e) =>
                                                                setLocalSettings((s) => ({
                                                                    ...s,
                                                                    bgApiKey: e.target.value,
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="bg-model-name">
                                                        Background Model Name
                                                    </label>
                                                    <input
                                                        id="bg-model-name"
                                                        type="text"
                                                        className="kai-input kai-mono"
                                                        placeholder={
                                                            localSettings.bgProvider === 'openai'
                                                                ? 'llama3.2'
                                                                : 'gemini-2.5-pro'
                                                        }
                                                        value={localSettings.bgModelName || ''}
                                                        onChange={(e) =>
                                                            setLocalSettings((s) => ({
                                                                ...s,
                                                                bgModelName: e.target.value,
                                                            }))
                                                        }
                                                    />
                                                </div>
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="bg-iter-limit">
                                                        Max Tool Iterations: {localSettings.bgIterationLimit || 5}
                                                    </label>
                                                    <input
                                                        id="bg-iter-limit"
                                                        type="range"
                                                        min={1}
                                                        max={20}
                                                        step={1}
                                                        value={localSettings.bgIterationLimit || 5}
                                                        onChange={(e) =>
                                                            setLocalSettings((s) => ({
                                                                ...s,
                                                                bgIterationLimit: parseInt(e.target.value, 10),
                                                            }))
                                                        }
                                                        className="w-full cursor-pointer"
                                                        style={{ accentColor: 'var(--accent-primary)' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </Field>

                                    <Field
                                        label="Per-Agent Overrides"
                                        hint="Customize names, prompts, and background engines for each operations specialist."
                                    >
                                        <div className="flex flex-col gap-2">
                                            {getAllAgents(localSettings.agentOverrides).map((agent) => {
                                                const effectiveProvider =
                                                    agent.bgProvider || localSettings.bgProvider || 'gemini';
                                                return (
                                                    <details key={agent.id} className="kai-surface-subtle">
                                                        <summary
                                                            className="flex items-center justify-between gap-2 cursor-pointer text-sm font-medium select-none"
                                                            style={{ color: 'var(--text-primary)' }}
                                                        >
                                                            <span className="inline-flex items-center gap-2">
                                                                <span
                                                                    className="material-symbols-outlined text-base"
                                                                    style={{ color: 'var(--accent-primary)' }}
                                                                >
                                                                    {agent.icon}
                                                                </span>
                                                                <span>{agent.shortName}</span>
                                                                <span
                                                                    className="text-xs font-normal"
                                                                    style={{ color: 'var(--text-muted)' }}
                                                                >
                                                                    ({agent.name})
                                                                </span>
                                                            </span>
                                                            <span className="kai-badge">{effectiveProvider}</span>
                                                        </summary>

                                                        <div className="mt-3 pt-3 border-t flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
                                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                                <div className="kai-field">
                                                                    <label className="kai-label">Short Label</label>
                                                                    <input
                                                                        type="text"
                                                                        className="kai-input"
                                                                        value={agent.shortName}
                                                                        onChange={(e) =>
                                                                            setLocalSettings((s) => ({
                                                                                ...s,
                                                                                agentOverrides: {
                                                                                    ...s.agentOverrides,
                                                                                    [agent.id]: {
                                                                                        ...(s.agentOverrides?.[agent.id] || {}),
                                                                                        shortName: e.target.value,
                                                                                    },
                                                                                },
                                                                            }))
                                                                        }
                                                                    />
                                                                </div>
                                                                <div className="kai-field sm:col-span-2">
                                                                    <label className="kai-label">Display Name</label>
                                                                    <input
                                                                        type="text"
                                                                        className="kai-input"
                                                                        value={agent.name}
                                                                        onChange={(e) =>
                                                                            setLocalSettings((s) => ({
                                                                                ...s,
                                                                                agentOverrides: {
                                                                                    ...s.agentOverrides,
                                                                                    [agent.id]: {
                                                                                        ...(s.agentOverrides?.[agent.id] || {}),
                                                                                        name: e.target.value,
                                                                                    },
                                                                                },
                                                                            }))
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div className="kai-field">
                                                                <label className="kai-label">System Instructions</label>
                                                                <textarea
                                                                    className="kai-textarea kai-mono text-xs"
                                                                    rows={3}
                                                                    value={agent.systemPrompt}
                                                                    onChange={(e) =>
                                                                        setLocalSettings((s) => ({
                                                                            ...s,
                                                                            agentOverrides: {
                                                                                ...s.agentOverrides,
                                                                                [agent.id]: {
                                                                                    ...(s.agentOverrides?.[agent.id] || {}),
                                                                                    systemPrompt: e.target.value,
                                                                                },
                                                                            },
                                                                        }))
                                                                    }
                                                                />
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-3">
                                                                <div className="flex gap-1.5">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setLocalSettings((s) => ({
                                                                                ...s,
                                                                                agentOverrides: {
                                                                                    ...s.agentOverrides,
                                                                                    [agent.id]: {
                                                                                        ...(s.agentOverrides?.[agent.id] || {}),
                                                                                        bgProvider: 'gemini',
                                                                                    },
                                                                                },
                                                                            }))
                                                                        }
                                                                        className={`kai-btn kai-btn-xs ${effectiveProvider === 'gemini' ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                                                    >
                                                                        Gemini
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setLocalSettings((s) => ({
                                                                                ...s,
                                                                                agentOverrides: {
                                                                                    ...s.agentOverrides,
                                                                                    [agent.id]: {
                                                                                        ...(s.agentOverrides?.[agent.id] || {}),
                                                                                        bgProvider: 'openai',
                                                                                    },
                                                                                },
                                                                            }))
                                                                        }
                                                                        className={`kai-btn kai-btn-xs ${effectiveProvider === 'openai' ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                                                    >
                                                                        OpenAI / Ollama
                                                                    </button>
                                                                </div>
                                                                <input
                                                                    type="text"
                                                                    className="kai-input kai-mono flex-1 min-w-[10rem]"
                                                                    placeholder={
                                                                        effectiveProvider === 'gemini'
                                                                            ? 'Override model (e.g. gemini-2.0-flash)'
                                                                            : 'Override model (e.g. llama3.2)'
                                                                    }
                                                                    value={agent.bgModelName || ''}
                                                                    onChange={(e) =>
                                                                        setLocalSettings((s) => ({
                                                                            ...s,
                                                                            agentOverrides: {
                                                                                ...s.agentOverrides,
                                                                                [agent.id]: {
                                                                                    ...(s.agentOverrides?.[agent.id] || {}),
                                                                                    bgModelName: e.target.value,
                                                                                },
                                                                            },
                                                                        }))
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </details>
                                                );
                                            })}
                                        </div>
                                    </Field>
                                </div>
                            )}

                            {activeTab === 'integrations' && (
                                <div className="flex flex-col gap-5">
                                    <RegistrySection />

                                    <Field
                                        label="Slack Integration (Socket Mode)"
                                        hint="Connect Kai Ops to Slack via outbound Socket Mode (no public inbound port required)."
                                    >
                                        <div className="kai-surface-subtle flex flex-col gap-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="kai-switch"
                                                        checked={localSettings.slackEnabled || false}
                                                        onChange={(e) =>
                                                            setLocalSettings((s) => ({
                                                                ...s,
                                                                slackEnabled: e.target.checked,
                                                            }))
                                                        }
                                                    />
                                                    <span>Enable Slack Socket Mode</span>
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowSlackHelp(true)}
                                                    className="kai-btn kai-btn-secondary kai-btn-xs"
                                                >
                                                    <span className="material-symbols-outlined text-sm">help</span>
                                                    Setup Guide
                                                </button>
                                            </div>

                                            {localSettings.slackEnabled && (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                                    <div className="kai-field">
                                                        <label className="kai-label" htmlFor="slack-bot-token">
                                                            Slack Bot Token
                                                        </label>
                                                        <input
                                                            id="slack-bot-token"
                                                            type="password"
                                                            className="kai-input kai-mono"
                                                            placeholder="xoxb-..."
                                                            value={
                                                                localSettings.slackBotToken === undefined
                                                                    ? '********'
                                                                    : localSettings.slackBotToken
                                                            }
                                                            onChange={(e) =>
                                                                setLocalSettings((s) => ({
                                                                    ...s,
                                                                    slackBotToken: e.target.value,
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                    <div className="kai-field">
                                                        <label className="kai-label" htmlFor="slack-app-token">
                                                            Slack App Token
                                                        </label>
                                                        <input
                                                            id="slack-app-token"
                                                            type="password"
                                                            className="kai-input kai-mono"
                                                            placeholder="xapp-..."
                                                            value={
                                                                localSettings.slackAppToken === undefined
                                                                    ? '********'
                                                                    : localSettings.slackAppToken
                                                            }
                                                            onChange={(e) =>
                                                                setLocalSettings((s) => ({
                                                                    ...s,
                                                                    slackAppToken: e.target.value,
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </Field>

                                    <Field
                                        label="Host SSH Terminal"
                                        hint="Route the Host Terminal to a remote SSH host instead of the local container shell. Leave Host empty to use the local shell."
                                    >
                                        <div className="kai-surface-subtle flex flex-col gap-3">
                                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                                <div className="kai-field sm:col-span-3">
                                                    <label className="kai-label" htmlFor="ssh-host">
                                                        SSH Host / IP
                                                    </label>
                                                    <input
                                                        id="ssh-host"
                                                        type="text"
                                                        className="kai-input kai-mono"
                                                        placeholder="172.17.0.1 or host.docker.internal"
                                                        value={localSettings.sshHost || ''}
                                                        onChange={(e) =>
                                                            setLocalSettings((s) => ({
                                                                ...s,
                                                                sshHost: e.target.value,
                                                            }))
                                                        }
                                                    />
                                                </div>
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="ssh-port">
                                                        Port
                                                    </label>
                                                    <input
                                                        id="ssh-port"
                                                        type="number"
                                                        className="kai-input kai-mono kai-tabular"
                                                        placeholder="22"
                                                        value={localSettings.sshPort || 22}
                                                        onChange={(e) =>
                                                            setLocalSettings((s) => ({
                                                                ...s,
                                                                sshPort: parseInt(e.target.value, 10) || 22,
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="ssh-username">
                                                        Username
                                                    </label>
                                                    <input
                                                        id="ssh-username"
                                                        type="text"
                                                        className="kai-input kai-mono"
                                                        placeholder="root"
                                                        value={localSettings.sshUsername || ''}
                                                        onChange={(e) =>
                                                            setLocalSettings((s) => ({
                                                                ...s,
                                                                sshUsername: e.target.value,
                                                            }))
                                                        }
                                                    />
                                                </div>
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="ssh-password">
                                                        SSH Password
                                                    </label>
                                                    <input
                                                        id="ssh-password"
                                                        type="password"
                                                        className="kai-input kai-mono"
                                                        placeholder="Enter SSH password"
                                                        value={
                                                            localSettings.sshPassword === undefined
                                                                ? localSettings.hasSshPassword
                                                                    ? '********'
                                                                    : ''
                                                                : localSettings.sshPassword
                                                        }
                                                        onChange={(e) =>
                                                            setLocalSettings((s) => ({
                                                                ...s,
                                                                sshPassword: e.target.value,
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </Field>
                                </div>
                            )}

                            {activeTab === 'security' && (
                                <div className="flex flex-col gap-5">
                                    <Field
                                        label="Execution Mode"
                                        hint="Standard Safe Mode requires operator confirmation for privileged host changes. Elevated Host Mode allows autonomous execution without prompts."
                                    >
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    setElevatedConfirmStep(0);
                                                    dispatch({ type: 'SET_YOLO_MODE', payload: false });
                                                    await apiFetch('/api/config/save', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ isYoloMode: false }),
                                                    });
                                                }}
                                                className={`kai-btn ${!state.isYoloMode ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                                            >
                                                <span className="material-symbols-outlined text-base">verified_user</span>
                                                Standard Safe Mode
                                            </button>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if (!state.isYoloMode) {
                                                        if (elevatedConfirmStep === 0) {
                                                            setElevatedConfirmStep(1);
                                                            window.setTimeout(() => setElevatedConfirmStep(0), 3500);
                                                        } else {
                                                            setElevatedConfirmStep(0);
                                                            dispatch({ type: 'SET_YOLO_MODE', payload: true });
                                                            await apiFetch('/api/config/save', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ isYoloMode: true }),
                                                            });
                                                        }
                                                    }
                                                }}
                                                className={`kai-btn ${
                                                    state.isYoloMode || elevatedConfirmStep === 1
                                                        ? 'kai-btn-danger'
                                                        : 'kai-btn-secondary'
                                                }`}
                                            >
                                                <span className="material-symbols-outlined text-base">admin_panel_settings</span>
                                                {state.isYoloMode
                                                    ? 'Elevated Host Mode (Active)'
                                                    : elevatedConfirmStep === 1
                                                      ? 'Click Again to Confirm'
                                                      : 'Elevated Host Mode'}
                                            </button>
                                        </div>
                                    </Field>

                                    <Field
                                        label="Sandbox Script Networking"
                                        hint="Allow executed C# sandbox scripts to access outbound network connections."
                                    >
                                        <div className="kai-surface-subtle flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className="material-symbols-outlined text-base">
                                                    {localSettings.isSandboxNetworkEnabled ? 'wifi' : 'wifi_off'}
                                                </span>
                                                <span>
                                                    {localSettings.isSandboxNetworkEnabled
                                                        ? 'Outbound sandbox network enabled'
                                                        : 'Outbound sandbox network disabled (isolated)'}
                                                </span>
                                            </div>
                                            <input
                                                type="checkbox"
                                                className="kai-switch"
                                                aria-label="Toggle sandbox network access"
                                                checked={localSettings.isSandboxNetworkEnabled || false}
                                                onChange={(e) =>
                                                    setLocalSettings((s) => ({
                                                        ...s,
                                                        isSandboxNetworkEnabled: e.target.checked,
                                                    }))
                                                }
                                            />
                                        </div>
                                    </Field>

                                    <Field label="Change Password" hint="Update the console access password.">
                                        <form onSubmit={handleChangePassword} className="kai-surface-subtle flex flex-col gap-3">
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="current-password">
                                                        Current Password
                                                    </label>
                                                    <input
                                                        id="current-password"
                                                        type="password"
                                                        className="kai-input"
                                                        value={currentPassword}
                                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                                        autoComplete="current-password"
                                                    />
                                                </div>
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="new-password">
                                                        New Password
                                                    </label>
                                                    <input
                                                        id="new-password"
                                                        type="password"
                                                        className="kai-input"
                                                        value={newPassword}
                                                        onChange={(e) => setNewPassword(e.target.value)}
                                                        autoComplete="new-password"
                                                    />
                                                </div>
                                                <div className="kai-field">
                                                    <label className="kai-label" htmlFor="confirm-password">
                                                        Confirm Password
                                                    </label>
                                                    <input
                                                        id="confirm-password"
                                                        type="password"
                                                        className="kai-input"
                                                        value={confirmPassword}
                                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                                        autoComplete="new-password"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    {passwordResult && (
                                                        <div
                                                            className={`kai-alert text-xs ${passwordResult.type === 'success' ? 'kai-alert-success' : 'kai-alert-error'}`}
                                                        >
                                                            {passwordResult.text}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    type="submit"
                                                    disabled={isChangingPassword}
                                                    className="kai-btn kai-btn-secondary kai-btn-sm shrink-0"
                                                >
                                                    {isChangingPassword ? 'Updating...' : 'Update Password'}
                                                </button>
                                            </div>
                                        </form>
                                    </Field>

                                    <Field
                                        label="System Updates"
                                        hint="Check upstream git status and trigger an application rebuild via the updater service."
                                    >
                                        <div className="kai-surface-subtle flex flex-col gap-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                                    {updateInfo ? (
                                                        <>
                                                            <span
                                                                className={`kai-badge ${updateInfo.updateAvailable ? 'kai-badge-warning' : 'kai-badge-success'}`}
                                                            >
                                                                {updateInfo.updateAvailable
                                                                    ? `${updateInfo.behindCount ?? 1} update(s) available`
                                                                    : 'Up to date'}
                                                            </span>
                                                            {updateInfo.branch && (
                                                                <span className="kai-badge kai-mono">
                                                                    {updateInfo.branch}
                                                                </span>
                                                            )}
                                                            {updateInfo.lastCommit && (
                                                                <span
                                                                    className="kai-mono truncate max-w-[16rem]"
                                                                    style={{ color: 'var(--text-muted)' }}
                                                                    title={updateInfo.lastCommit}
                                                                >
                                                                    {updateInfo.lastCommit}
                                                                </span>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)' }}>
                                                            Checking update status...
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            void checkUpdates();
                                                        }}
                                                        disabled={isCheckingUpdates || isUpdating}
                                                        className="kai-btn kai-btn-secondary kai-btn-sm"
                                                    >
                                                        <span
                                                            className={`material-symbols-outlined text-sm ${isCheckingUpdates ? 'animate-spin' : ''}`}
                                                        >
                                                            refresh
                                                        </span>
                                                        Check
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            void handleUpdate();
                                                        }}
                                                        disabled={isUpdating}
                                                        className="kai-btn kai-btn-primary kai-btn-sm"
                                                    >
                                                        <span
                                                            className={`material-symbols-outlined text-sm ${isUpdating ? 'animate-spin' : ''}`}
                                                        >
                                                            {isUpdating ? 'sync' : 'system_update'}
                                                        </span>
                                                        {isUpdating ? 'Updating...' : 'Apply Update'}
                                                    </button>
                                                </div>
                                            </div>

                                            {updateProgress && (
                                                <div className="kai-alert kai-alert-info text-xs">{updateProgress}</div>
                                            )}
                                        </div>
                                    </Field>

                                    <Field label="Session" hint="Revoke your current access token and lock the dashboard.">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void handleLogout();
                                            }}
                                            className="kai-btn kai-btn-danger kai-btn-sm self-start"
                                        >
                                            <span className="material-symbols-outlined text-base">logout</span>
                                            Sign Out
                                        </button>
                                    </Field>
                                </div>
                            )}

                            {saveMessage && (
                                <div
                                    className={`kai-alert text-xs ${saveMessage.type === 'success' ? 'kai-alert-success' : 'kai-alert-error'}`}
                                >
                                    {saveMessage.text}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {!showSlackHelp && (
                    <div className="kai-modal-footer">
                        <button
                            id="settings-cancel-btn"
                            type="button"
                            onClick={handleCancel}
                            className="kai-btn kai-btn-secondary kai-btn-sm"
                        >
                            Cancel
                        </button>
                        <button
                            id="settings-save-btn"
                            type="button"
                            onClick={() => {
                                void handleSave();
                            }}
                            disabled={isSaving}
                            className="kai-btn kai-btn-primary kai-btn-sm"
                        >
                            <span className="material-symbols-outlined text-base">
                                {isSaving ? 'sync' : 'save'}
                            </span>
                            {isSaving ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function Field({
    label,
    hint,
    htmlFor,
    children,
}: {
    label: string;
    hint?: string;
    htmlFor?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="kai-field gap-2">
            <div>
                <label className="kai-label" htmlFor={htmlFor}>
                    {label}
                </label>
                {hint && <p className="kai-help mt-0.5">{hint}</p>}
            </div>
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
            const data = (await res.json()) as { error?: string };
            if (res.ok) {
                setLoginResult({ success: true, message: 'Registry authentication succeeded.' });
                const getRes = await apiFetch('/api/config/get');
                const freshData = (await getRes.json()) as Partial<Settings>;
                dispatch({ type: 'UPDATE_SETTINGS', payload: freshData });
                setServer('');
                setUsername('');
                setPassword('');
            } else {
                setLoginResult({ success: false, message: data.error || 'Registry authentication failed.' });
            }
        } catch (err: unknown) {
            setLoginResult({
                success: false,
                message: err instanceof Error ? err.message : 'Registry authentication failed.',
            });
        } finally {
            setIsLoggingIn(false);
        }
    };

    return (
        <Field
            label="Container Registries"
            hint="Authenticate with private Docker registries (e.g. ACR, GHCR, Docker Hub)."
        >
            <div className="flex flex-col gap-3">
                {state.settings.registries && state.settings.registries.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {state.settings.registries.map((r, i) => (
                            <div
                                key={`${r.server}-${r.username}-${i}`}
                                className="kai-surface-subtle flex items-center justify-between gap-3 py-2.5 px-3"
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <span
                                        className="material-symbols-outlined text-base"
                                        style={{ color: 'var(--accent-primary)' }}
                                    >
                                        database
                                    </span>
                                    <div className="min-w-0">
                                        <div
                                            className="text-sm font-medium truncate kai-mono"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {r.server}
                                        </div>
                                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                            Signed in as {r.username}
                                        </div>
                                    </div>
                                </div>
                                <span className="kai-badge kai-badge-success">Authenticated</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="kai-surface-subtle flex flex-col gap-3">
                    <div className="kai-field">
                        <label className="kai-label" htmlFor="registry-server">
                            Registry Server
                        </label>
                        <input
                            id="registry-server"
                            type="text"
                            className="kai-input kai-mono"
                            value={server}
                            onChange={(e) => setServer(e.target.value)}
                            placeholder="myregistry.azurecr.io"
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="kai-field">
                            <label className="kai-label" htmlFor="registry-username">
                                Username
                            </label>
                            <input
                                id="registry-username"
                                type="text"
                                className="kai-input kai-mono"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Username"
                            />
                        </div>
                        <div className="kai-field">
                            <label className="kai-label" htmlFor="registry-password">
                                Password / Token
                            </label>
                            <input
                                id="registry-password"
                                type="password"
                                className="kai-input kai-mono"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password or token"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            {loginResult && (
                                <div
                                    className={`kai-alert text-xs ${loginResult.success ? 'kai-alert-success' : 'kai-alert-error'}`}
                                >
                                    {loginResult.message}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                void handleLogin();
                            }}
                            disabled={isLoggingIn || !server || !username || !password}
                            className="kai-btn kai-btn-primary kai-btn-sm shrink-0"
                        >
                            {isLoggingIn ? 'Authenticating...' : 'Sign In to Registry'}
                        </button>
                    </div>
                </div>
            </div>
        </Field>
    );
}

export default SettingsModal;
