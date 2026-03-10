import React, {
    createContext,
    useContext,
    useReducer,
    useEffect,
    type ReactNode,
} from 'react';
import type { AppState, AppAction, AgentId, Settings } from '../types';

const DEFAULT_SETTINGS: Settings = {
    apiKey: '',
    model: 'gemini-2.0-flash',
    temperature: 0.7,
};

const INITIAL_STATE: AppState = {
    activeAgent: 'nav',
    conversations: { nav: [], comms: [], logistics: [], security: [] },
    agentStatus: { nav: 'online', comms: 'online', logistics: 'standby', security: 'active' },
    settings: DEFAULT_SETTINGS,
    isSettingsOpen: false,
    activeTab: 'diagnostics',
    sessionMetrics: {
        lastLatencyMs: 0,
        totalTokens: 0,
        model: 'gemini-2.0-flash',
    },
    gameState: null,
    activeScenario: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case 'SELECT_AGENT':
            return { ...state, activeAgent: action.payload };

        case 'ADD_MESSAGE':
            return {
                ...state,
                conversations: {
                    ...state.conversations,
                    [action.payload.agentId]: [
                        ...state.conversations[action.payload.agentId],
                        action.payload,
                    ],
                },
            };

        case 'UPDATE_STREAMING_MESSAGE': {
            const { agentId, id, chunk } = action.payload;
            return {
                ...state,
                conversations: {
                    ...state.conversations,
                    [agentId]: state.conversations[agentId].map((msg) =>
                        msg.id === id ? { ...msg, content: msg.content + chunk } : msg
                    ),
                },
            };
        }

        case 'FINISH_STREAMING': {
            const { agentId, id } = action.payload;
            return {
                ...state,
                conversations: {
                    ...state.conversations,
                    [agentId]: state.conversations[agentId].map((msg) =>
                        msg.id === id ? { ...msg, isStreaming: false } : msg
                    ),
                },
            };
        }

        case 'SET_AGENT_STATUS':
            return {
                ...state,
                agentStatus: {
                    ...state.agentStatus,
                    [action.payload.agentId]: action.payload.status,
                },
            };

        case 'CLEAR_CONVERSATION':
            return {
                ...state,
                conversations: {
                    ...state.conversations,
                    [action.payload]: [],
                },
            };

        case 'UPDATE_SETTINGS': {
            const newSettings = { ...state.settings, ...action.payload };
            try { localStorage.setItem('lcars_settings', JSON.stringify(newSettings)); } catch (_) { /* ignore */ }
            return { ...state, settings: newSettings };
        }

        case 'TOGGLE_SETTINGS':
            return { ...state, isSettingsOpen: !state.isSettingsOpen };

        case 'SET_TAB':
            return { ...state, activeTab: action.payload };

        case 'UPDATE_METRICS':
            return {
                ...state,
                sessionMetrics: { ...state.sessionMetrics, ...action.payload },
            };

        case 'START_SCENARIO':
            return {
                ...state,
                activeScenario: action.payload.scenario,
                gameState: action.payload.state,
                conversations: { nav: [], comms: [], logistics: [], security: [] }
            };

        case 'UPDATE_GAME_STATE':
            if (!state.gameState) return state;
            return {
                ...state,
                gameState: { ...state.gameState, ...action.payload }
            };

        case 'END_SCENARIO':
            return {
                ...state,
                gameState: null,
                activeScenario: null
            };

        default:
            return state;
    }
}

interface AppContextValue {
    state: AppState;
    dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(appReducer, INITIAL_STATE, (init) => {
        try {
            const stored = localStorage.getItem('lcars_settings');
            if (stored) {
                const settings = JSON.parse(stored) as Settings;
                return { ...init, settings: { ...init.settings, ...settings } };
            }
        } catch (_) { /* ignore */ }
        return init;
    });

    useEffect(() => {
        if (!state.settings.apiKey) {
            dispatch({ type: 'TOGGLE_SETTINGS' });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <AppContext.Provider value={{ state, dispatch }}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext(): AppContextValue {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useAppContext must be used within AppProvider');
    return ctx;
}

export type { AgentId };
