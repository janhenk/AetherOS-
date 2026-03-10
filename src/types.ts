export type AgentId = 'nav' | 'comms' | 'logistics' | 'security';
export type AgentStatus = 'online' | 'processing' | 'standby' | 'active';
export * from './types/game';
import type { ShipState, Scenario } from './types/game';
export type GeminiModel =
    | 'gemini-3.1-pro-preview'
    | 'gemini-3-flash-preview'
    | 'gemini-3.1-flash-lite-preview'
    | 'gemini-3.1-flash-image-preview'
    | 'gemini-2.0-flash'
    | 'gemini-2.5-pro'
    | 'gemini-1.5-pro';

export interface Message {
    id: string;
    agentId: AgentId;
    role: 'user' | 'agent';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
}

export interface Settings {
    apiKey: string;
    model: GeminiModel;
    temperature: number;
}

export interface SessionMetrics {
    lastLatencyMs: number;
    totalTokens: number;
    model: GeminiModel;
}

export interface AppState {
    activeAgent: AgentId;
    conversations: Record<AgentId, Message[]>;
    agentStatus: Record<AgentId, AgentStatus>;
    settings: Settings;
    isSettingsOpen: boolean;
    activeTab: 'diagnostics' | 'sensors' | 'network';
    sessionMetrics: SessionMetrics;
    gameState: ShipState | null;
    activeScenario: Scenario | null;
}

export type AppAction =
    | { type: 'SELECT_AGENT'; payload: AgentId }
    | { type: 'ADD_MESSAGE'; payload: Message }
    | { type: 'UPDATE_STREAMING_MESSAGE'; payload: { agentId: AgentId; id: string; chunk: string } }
    | { type: 'FINISH_STREAMING'; payload: { agentId: AgentId; id: string } }
    | { type: 'SET_AGENT_STATUS'; payload: { agentId: AgentId; status: AgentStatus } }
    | { type: 'CLEAR_CONVERSATION'; payload: AgentId }
    | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
    | { type: 'TOGGLE_SETTINGS' }
    | { type: 'SET_TAB'; payload: AppState['activeTab'] }
    | { type: 'UPDATE_METRICS'; payload: Partial<SessionMetrics> }
    | { type: 'START_SCENARIO'; payload: { scenario: Scenario; state: ShipState } }
    | { type: 'UPDATE_GAME_STATE'; payload: Partial<ShipState> }
    | { type: 'END_SCENARIO' };
