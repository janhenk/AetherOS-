import React, { memo, useCallback } from 'react';
import './AgentCard.css';
import { useAppContext } from '../../context/AppContext';
import { getAgent } from '../../agents';
import type { AgentId } from '../../types';

const STATUS_LABELS: Record<string, string> = {
    nav: 'Coordinates: Sector 001',
    comms: 'Encryption: Level 5',
    logistics: 'Resources: Optimized',
    security: 'Grid: 402.11.B',
};

const AgentCard = memo(function AgentCard({ agentId }: { agentId: AgentId }) {
    const { state, dispatch } = useAppContext();
    const agent = getAgent(agentId);
    const isActive = state.activeAgent === agentId;
    const status = state.agentStatus[agentId];
    const msgCount = state.conversations[agentId].length;

    const handleSelect = useCallback(() => {
        dispatch({ type: 'SELECT_AGENT', payload: agentId });
    }, [dispatch, agentId]);

    const handleClear = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        dispatch({ type: 'CLEAR_CONVERSATION', payload: agentId });
    }, [dispatch, agentId]);

    return (
        <div
            id={`agent-card-${agentId}`}
            className={`agent-card${isActive ? ' active' : ''}`}
            style={{ '--agent-color': agent.color } as React.CSSProperties}
            onClick={handleSelect}
            role="button"
            aria-pressed={isActive}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleSelect()}
        >
            {/* Pill header */}
            <div className="agent-card-header">
                <div className="agent-card-identity">
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{agent.icon}</span>
                    <span className="agent-card-name">{agent.shortName}</span>
                </div>
                <span className="agent-card-status-text">{status.toUpperCase()}</span>
            </div>

            {/* Sub-info strip */}
            <div className="agent-card-sub">
                <span>{STATUS_LABELS[agentId]}</span>
                {msgCount > 0 && (
                    <button className="agent-card-clear-btn" onClick={handleClear}>CLR</button>
                )}
            </div>
        </div>
    );
});

export default AgentCard;
