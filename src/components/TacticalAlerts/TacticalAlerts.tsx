import React, { useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { apiFetch } from '../../utils/api';
import type { TacticalInsight } from '../../types';
import './TacticalAlerts.css';

/**
 * Collapses equivalent alerts into one entry. The server already de-duplicates
 * on its own key, but older queued alerts (and alerts from a server that has
 * not restarted yet) can still repeat, so the view guards too.
 */
const dedupe = (insights: TacticalInsight[]): TacticalInsight[] => {
    const byKey = new Map<string, TacticalInsight>();
    for (const insight of insights) {
        const key = insight.key || `${insight.type}|${insight.containerId || ''}|${insight.message}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, insight);
            continue;
        }
        // Keep the most recent of the duplicates.
        const a = new Date(existing.timestamp).getTime() || 0;
        const b = new Date(insight.timestamp).getTime() || 0;
        if (b >= a) byKey.set(key, insight);
    }
    return [...byKey.values()];
};

export const TacticalAlerts: React.FC = () => {
    const { state, dispatch } = useAppContext();
    const rawInsights = (state.serverState?.insights || []) as TacticalInsight[];
    const insights = useMemo(() => dedupe(rawInsights), [rawInsights]);

    const [busyId, setBusyId] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const setServerInsights = (next: TacticalInsight[]) => {
        dispatch({ type: 'UPDATE_SERVER_STATE', payload: { ...state.serverState, insights: next } });
    };

    const handleDismiss = async (insight: TacticalInsight) => {
        // Optimistic removal; the next stats poll confirms it.
        setServerInsights(rawInsights.filter(i => i.id !== insight.id));
        try {
            await apiFetch('/api/insights/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: insight.id })
            });
        } catch (err) {
            console.error('Failed to dismiss tactical alert', err);
        }
    };

    const handleClearAll = async () => {
        setServerInsights([]);
        try {
            await apiFetch('/api/insights/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
        } catch (err) {
            console.error('Failed to clear tactical alerts', err);
        }
    };

    const handleExecuteSuggestion = async (insight: TacticalInsight) => {
        const target = insight.containerId;
        if (!target) {
            setErrors(prev => ({ ...prev, [insight.id]: 'No target container on this directive.' }));
            return;
        }

        // 'system' alerts come from an image pull and need a recreate, not a restart:
        // restarting a container reuses the old image layers.
        const endpoint = insight.type === 'system' ? '/api/docker/redeploy' : '/api/docker/action';
        const body = insight.type === 'system'
            ? { id: target }
            : { id: target, action: 'restart' };

        setBusyId(insight.id);
        setErrors(prev => {
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
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);

            // Directive accepted: retire the alert.
            await handleDismiss(insight);
        } catch (err: any) {
            setErrors(prev => ({ ...prev, [insight.id]: err?.message || 'Directive failed.' }));
        } finally {
            setBusyId(null);
        }
    };

    if (insights.length === 0) return null;

    return (
        <div className="tactical-alerts-container">
            <div className="tactical-header">
                <span className="material-symbols-outlined text-[14px] text-secondary">shield</span>
                <span>TACTICAL ANALYSIS // PROACTIVE MODE</span>
                <button className="clear-all-btn" onClick={handleClearAll} title="Dismiss all alerts">
                    CLEAR ALL ({insights.length})
                </button>
            </div>

            <div className="alerts-list">
                {insights.map((insight) => (
                    <div key={insight.id} className={`tactical-alert-item severity-${insight.severity}`}>
                        <div className="alert-badge">
                            <span className="material-symbols-outlined text-base">
                                {insight.severity === 'high' ? 'bolt' : 'monitoring'}
                            </span>
                        </div>

                        <div className="alert-content">
                            <div className="alert-message">{insight.message}</div>
                            <div className="alert-suggestion">{insight.suggestion}</div>

                            <button
                                className="execute-btn"
                                disabled={busyId === insight.id}
                                onClick={() => handleExecuteSuggestion(insight)}
                            >
                                <span className="material-symbols-outlined text-[12px] mr-1">bolt</span>
                                {busyId === insight.id ? 'EXECUTING...' : 'EXECUTE DIRECTIVE'}
                            </button>

                            {errors[insight.id] && (
                                <div className="alert-error">{errors[insight.id]}</div>
                            )}
                        </div>

                        <button
                            className="dismiss-btn"
                            onClick={() => handleDismiss(insight)}
                            title="Dismiss alert"
                            aria-label="Dismiss alert"
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
