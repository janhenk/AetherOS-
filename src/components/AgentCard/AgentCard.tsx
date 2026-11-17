import React, { memo, useCallback } from 'react';
import './AgentCard.css';
import { useAppContext } from '../../context/useAppContext';
import { getAgent } from '../../agents';
import type { AgentId } from '../../types';

const ROLE_SUMMARIES: Record<AgentId, string> = {
    nav: 'Compute & Routing',
    comms: 'Network & Web',
    logistics: 'Storage & Data',
    security: 'Security & Audit',
};

const AgentCard = memo(function AgentCard({ agentId }: { agentId: AgentId }) {
    const { state, dispatch } = useAppContext();
    const agent = getAgent(agentId, state.settings.agentOverrides);
    const isActive = state.activeAgent === agentId;
    const status = state.agentStatus[agentId];
    const msgCount = state.conversations[agentId]?.length || 0;

    const handleSelect = useCallback(() => {
        dispatch({ type: 'SELECT_AGENT', payload: agentId });
    }, [dispatch, agentId]);

    const handleClear = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            dispatch({ type: 'CLEAR_CONVERSATION', payload: agentId });
        },
        [dispatch, agentId],
    );

    return (
        <div
            id={`agent-card-${agentId}`}
            className={`kai-agent-card${isActive ? ' is-active' : ''}`}
        >
            <button
                type="button"
                className="kai-agent-card-main"
                onClick={handleSelect}
                aria-pressed={isActive}
            >
                <div className="kai-agent-card-identity">
                    <span className="material-symbols-outlined kai-agent-card-icon">
                        {agent.icon}
                    </span>
                    <div className="kai-agent-card-titles">
                        <span className="kai-agent-card-name">{agent.shortName}</span>
                        <span className="kai-agent-card-role">{ROLE_SUMMARIES[agentId]}</span>
                    </div>
                </div>
                <span className={`kai-badge ${status === 'processing' ? 'kai-badge-warning' : isActive ? 'kai-badge-accent' : ''}`}>
                    {status}
                </span>
            </button>

            {msgCount > 0 && (
                <div className="kai-agent-card-footer">
                    <span className="kai-tabular">{msgCount} {msgCount === 1 ? 'message' : 'messages'}</span>
                    <button
                        type="button"
                        className="kai-btn kai-btn-ghost kai-btn-xs"
                        onClick={handleClear}
                        aria-label={`Clear ${agent.shortName} conversation`}
                    >
                        Clear
                    </button>
                </div>
            )}
        </div>
    );
});

export default AgentCard;
