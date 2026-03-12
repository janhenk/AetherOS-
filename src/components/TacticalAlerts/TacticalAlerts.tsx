import React from 'react';
import { useAppContext } from '../../context/AppContext';
import './TacticalAlerts.css';

export const TacticalAlerts: React.FC = () => {
    const { state } = useAppContext();
    const insights = state.serverState?.insights || [];

    if (insights.length === 0) return null;

    const handleExecuteSuggestion = async (insight: any) => {
        if (insight.type === 'resource' && insight.containerId) {
            try {
                await fetch('/api/docker/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: insight.containerId, action: 'restart' })
                });
                alert(`Tactical directive executed: Restarting ${insight.containerId}...`);
            } catch (err) {
                console.error("Failed to execute tactical directive", err);
            }
        }
    };

    return (
        <div className="tactical-alerts-container">
            <div className="tactical-header">
                <span className="material-symbols-outlined text-[14px] text-secondary">shield</span>
                <span>TACTICAL ANALYSIS // PROACTIVE MODE</span>
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
                                onClick={() => handleExecuteSuggestion(insight)}
                            >
                                <span className="material-symbols-outlined text-[12px] mr-1">bolt</span>
                                EXECUTE DIRECTIVE
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
