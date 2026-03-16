import React, {
    createContext,
    useContext,
    useReducer,
    useEffect,
    type ReactNode,
} from 'react';
import type { AppState, AppAction, AgentId, Settings } from '../types';
import { apiFetch } from '../utils/api';

const DEFAULT_SETTINGS: Settings = {
    apiKey: '',
    model: 'gemini-2.0-flash',
    temperature: 0.7,
    isSandboxNetworkEnabled: false,
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
        model: 'gemini-1.5-pro',
    },
    serverState: null,
    activeScenario: null,
    isYoloMode: false,
    pendingApproval: null,
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
                        ...(state.conversations[action.payload.agentId] || []),
                        action.payload,
                    ],
                },
            };

        case 'UPDATE_STREAMING_MESSAGE': {
            const { agentId, id, chunk, toolCalls } = action.payload as any;
            const targetAgentId = agentId as AgentId;
            return {
                ...state,
                conversations: {
                    ...state.conversations,
                    [targetAgentId]: (state.conversations[targetAgentId] || []).map((msg: any) =>
                        msg.id === id ? { 
                            ...msg, 
                            content: chunk ? msg.content + chunk : msg.content,
                            toolCalls: toolCalls ? [...(msg.toolCalls || []), ...toolCalls] : msg.toolCalls
                        } : msg
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
            // Settings persistence is now handled by the server
            return { ...state, settings: newSettings };
        }

        case 'TOGGLE_SETTINGS':
            return { ...state, isSettingsOpen: !state.isSettingsOpen };

        case 'SET_TAB':
            return { ...state, activeTab: action.payload as any };

        case 'UPDATE_METRICS':
            return {
                ...state,
                sessionMetrics: { ...state.sessionMetrics, ...action.payload },
            };

        case 'UPDATE_SERVER_STATE':
            return {
                ...state,
                serverState: { ...state.serverState, ...action.payload }
            };

        case 'INITIALIZE_CONVERSATIONS':
            return {
                ...state,
                conversations: action.payload || INITIAL_STATE.conversations
            };
        case 'SET_YOLO_MODE':
            return { ...state, isYoloMode: action.payload };
        case 'SET_PENDING_APPROVAL':
            return { ...state, pendingApproval: action.payload };
        case 'RESOLVE_APPROVAL':
            return { ...state, pendingApproval: state.pendingApproval?.id === action.payload ? null : state.pendingApproval };
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
    const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

    useEffect(() => {
        // Load System Settings from Server
        const loadSettings = async () => {
            try {
                const res = await apiFetch('/api/config/get');
                if (res.ok) {
                    const data = await res.json();
                    dispatch({ type: 'UPDATE_SETTINGS', payload: data });
                    
                    if (data.isYoloMode !== undefined) {
                        dispatch({ type: 'SET_YOLO_MODE', payload: data.isYoloMode });
                    }
                    
                    // If no model or key (proxied key) configured, open settings
                    if (!data.model || (!data.hasKey && !data.apiKey)) {
                        dispatch({ type: 'TOGGLE_SETTINGS' });
                    }
                }
            } catch (err) {
                console.error("Failed to load system settings", err);
            }
        };
        loadSettings();

        // Poll Live Server Stats
        const fetchStats = async () => {
            try {
                const res = await apiFetch('/api/stats');
                if (res.ok) {
                    const data = await res.json();
                    dispatch({ type: 'UPDATE_SERVER_STATE', payload: data });
                }
            } catch (err) {
                console.error("Failed to fetch server stats", err);
            }
        };

        fetchStats();
        const interval = setInterval(fetchStats, 1000);

        // Load Chat History
        const loadHistory = async () => {
            try {
                const res = await apiFetch('/api/chat/load');
                if (res.ok) {
                    const history = await res.json();
                    if (Object.keys(history).length > 0) {
                        dispatch({ type: 'INITIALIZE_CONVERSATIONS', payload: history });
                    }
                }
            } catch (err) {
                console.error("Failed to load chat history", err);
            }
        };
        loadHistory();

        return () => clearInterval(interval);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Save Chat History on change
    useEffect(() => {
        const saveHistory = async () => {
            // Don't save empty states on initial load
            const totalMessages = Object.values(state.conversations).flat().length;
            if (totalMessages === 0) return;

            try {
                await apiFetch('/api/chat/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(state.conversations)
                });
            } catch (err) {
                console.error("Failed to save chat history", err);
            }
        };

        const timer = setTimeout(saveHistory, 1000); // Debounce saves
        return () => clearTimeout(timer);
    }, [state.conversations]);

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
