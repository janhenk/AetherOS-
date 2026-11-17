import React, { useMemo, useState } from 'react';
import { useAppContext } from '../../context/useAppContext';
import { apiFetch } from '../../utils/api';
import type { TacticalInsight } from '../../types';
import './TacticalAlerts.css';

const COLLAPSED_STORAGE_KEY = 'kai-tactical-collapsed';

function readInitialCollapsed(): boolean {
    try {
        return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

/**
 * Collapses equivalent alerts into one entry so duplicate server-queued items
 * never stack in the UI.
 */
function dedupe(insights: TacticalInsight[]): TacticalInsight[] {
    const byKey = new Map<string, TacticalInsight>();
    for (const insight of insights) {
        const key = insight.key || `${insight.type}|${insight.containerId || ''}|${insight.message}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, insight);
            continue;
        }
        const a = new Date(existing.timestamp).getTime() || 0;
        const b = new Date(insight.timestamp).getTime() || 0;
        if (b >= a) byKey.set(key, insight);
    }
    return [...byKey.values()];
}

function severityBadgeClass(severity: TacticalInsight['severity']): string {
    if (severity === 'high') return 'kai-badge kai-badge-danger';
    if (severity === 'medium') return 'kai-badge kai-badge-warning';
    return 'kai-badge kai-badge-info';
}

export const TacticalAlerts: React.FC = () => {
    const { state, dispatch } = useAppContext();
    const rawInsights = useMemo(
        () => (state.serverState?.insights ?? []) as TacticalInsight[],
        [state.serverState?.insights]
    );
    const insights = useMemo(() => dedupe(rawInsights), [rawInsights]);

    const [isCollapsed, setIsCollapsed] = useState<boolean>(readInitialCollapsed);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [dismissingId, setDismissingId] = useState<string | null>(null);
    const [clearingAll, setClearingAll] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [globalError, setGlobalError] = useState<string | null>(null);

    const setServerInsights = (next: TacticalInsight[]) => {
        if (!state.serverState) return;
        dispatch({ type: 'UPDATE_SERVER_STATE', payload: { ...state.serverState, insights: next } });
    };

    const toggleCollapsed = () => {
        setIsCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
            } catch {
                // Storage access can fail in restricted browser contexts; ignore persistence failure.
            }
            return next;
        });
    };

    const handleDismiss = async (insight: TacticalInsight) => {
        setDismissingId(insight.id);
        setErrors((prev) => {
            if (!prev[insight.id]) return prev;
            const next = { ...prev };
            delete next[insight.id];
            return next;
        });

        try {
            const res = await apiFetch('/api/insights/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: insight.id })
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string; insights?: TacticalInsight[] };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Dismiss failed (${res.status})`);
            }
            const nextInsights = Array.isArray(data.insights)
                ? data.insights
                : rawInsights.filter((item) => item.id !== insight.id);
            setServerInsights(nextInsights);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to dismiss alert.';
            setErrors((prev) => ({ ...prev, [insight.id]: message }));
        } finally {
            setDismissingId(null);
        }
    };

    const handleClearAll = async () => {
        setClearingAll(true);
        setGlobalError(null);
        try {
            const res = await apiFetch('/api/insights/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string; insights?: TacticalInsight[] };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Clear failed (${res.status})`);
            }
            setServerInsights(Array.isArray(data.insights) ? data.insights : []);
            setErrors({});
        } catch (err: unknown) {
            setGlobalError(err instanceof Error ? err.message : 'Failed to clear alerts.');
        } finally {
            setClearingAll(false);
        }
    };

    const handleExecuteSuggestion = async (insight: TacticalInsight) => {
        const target = insight.containerId;
        if (!target) {
            setErrors((prev) => ({ ...prev, [insight.id]: 'No target container on this alert.' }));
            return;
        }

        const isSystemUpdate = insight.type === 'system';
        const endpoint = isSystemUpdate ? '/api/docker/redeploy' : '/api/docker/action';
        const body = isSystemUpdate
            ? { id: target, pullFirst: true }
            : { id: target, action: 'restart' };

        setBusyId(insight.id);
        setErrors((prev) => {
            if (!prev[insight.id]) return prev;
            const next = { ...prev };
            delete next[insight.id];
            return next;
        });

        try {
            const res = await apiFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok || data.error) {
                throw new Error(data.error || `Request failed (${res.status})`);
            }

            await handleDismiss(insight);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Action failed.';
            setErrors((prev) => ({ ...prev, [insight.id]: message }));
        } finally {
            setBusyId(null);
        }
    };

    if (insights.length === 0) return null;

    const hasHighSeverity = insights.some((item) => item.severity === 'high');

    return (
        <section className="tactical-alerts-container" aria-label="Tactical analysis alerts">
            <div className={`tactical-header ${!isCollapsed ? 'is-expanded' : ''}`}>
                <div className="tactical-header-left">
                    <span className="material-symbols-outlined tactical-header-icon" aria-hidden="true">
                        shield
                    </span>
                    <span className="tactical-title">TACTICAL ANALYSIS</span>
                    <span className={`kai-badge kai-tabular ${hasHighSeverity ? 'kai-badge-danger' : 'kai-badge-accent'}`}>
                        {insights.length}
                    </span>
                </div>

                <div className="tactical-header-actions">
                    <button
                        type="button"
                        className="kai-btn kai-btn-ghost kai-btn-xs"
                        onClick={toggleCollapsed}
                        aria-expanded={!isCollapsed}
                        title={isCollapsed ? 'Expand tactical analysis' : 'Collapse tactical analysis'}
                    >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                            {isCollapsed ? 'expand_more' : 'expand_less'}
                        </span>
                        <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
                    </button>

                    <button
                        type="button"
                        className="kai-btn kai-btn-secondary kai-btn-xs"
                        onClick={handleClearAll}
                        disabled={clearingAll}
                        title="Dismiss all alerts"
                    >
                        {clearingAll ? 'Clearing...' : `Clear all (${insights.length})`}
                    </button>
                </div>
            </div>

            {!isCollapsed && (
                <div className="tactical-alerts-list">
                    {globalError && (
                        <div className="kai-alert kai-alert-error text-xs" role="alert">
                            {globalError}
                        </div>
                    )}

                    {insights.map((insight) => {
                        const isBusy = busyId === insight.id;
                        const isDismissing = dismissingId === insight.id;
                        const actionLabel = insight.type === 'system' ? 'Redeploy container' : 'Restart container';
                        const actionIcon = insight.type === 'system' ? 'deployed_code_update' : 'restart_alt';

                        return (
                            <div key={insight.id} className={`tactical-alert-item severity-${insight.severity}`}>
                                <div className="tactical-alert-badge" aria-hidden="true">
                                    <span className="material-symbols-outlined text-[16px]">
                                        {insight.severity === 'high' ? 'warning' : insight.type === 'system' ? 'system_update_alt' : 'monitoring'}
                                    </span>
                                </div>

                                <div className="tactical-alert-content">
                                    <div className="tactical-alert-meta">
                                        <span className={severityBadgeClass(insight.severity)}>
                                            {insight.severity}
                                        </span>
                                        <span className="kai-badge">{insight.type}</span>
                                        {insight.containerId && (
                                            <span className="kai-badge kai-mono">{insight.containerId}</span>
                                        )}
                                    </div>

                                    <div className="tactical-alert-message">{insight.message}</div>
                                    <div className="tactical-alert-suggestion">{insight.suggestion}</div>

                                    <div className="tactical-alert-actions">
                                        <button
                                            type="button"
                                            className="kai-btn kai-btn-primary kai-btn-xs"
                                            disabled={isBusy || isDismissing}
                                            onClick={() => handleExecuteSuggestion(insight)}
                                        >
                                            <span className={`material-symbols-outlined text-[14px] ${isBusy ? 'animate-spin' : ''}`} aria-hidden="true">
                                                {isBusy ? 'sync' : actionIcon}
                                            </span>
                                            <span>{isBusy ? 'Working...' : actionLabel}</span>
                                        </button>
                                    </div>

                                    {errors[insight.id] && (
                                        <div className="kai-alert kai-alert-error text-xs mt-1" role="alert">
                                            {errors[insight.id]}
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    className="tactical-dismiss-btn"
                                    onClick={() => handleDismiss(insight)}
                                    disabled={isDismissing || isBusy}
                                    aria-label="Dismiss alert"
                                    title="Dismiss alert"
                                >
                                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                                        close
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};
