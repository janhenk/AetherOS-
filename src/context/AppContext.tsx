import { useEffect, useReducer, type ReactNode } from 'react';
import { AppContext } from './useAppContext';
import { apiFetch } from '../utils/api';
import type {
  AgentId,
  AppAction,
  AppState,
  Message,
  ServerState,
  Settings,
} from '../types';

const AGENT_IDS: readonly AgentId[] = ['nav', 'comms', 'logistics', 'security'];

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
  isLogViewerOpen: false,
  activeTab: 'diagnostics',
  sessionMetrics: {
    lastLatencyMs: 0,
    totalTokens: 0,
    model: 'gemini-2.0-flash',
  },
  serverState: null,
  statsHistory: [],
  activeScenario: null,
  isYoloMode: false,
  pendingApproval: null,
};

function sanitizeConversations(raw: unknown): Record<AgentId, Message[]> {
  const result: Record<AgentId, Message[]> = {
    nav: [],
    comms: [],
    logistics: [],
    security: [],
  };
  if (!raw || typeof raw !== 'object') return result;
  const record = raw as Record<string, unknown>;
  for (const agentId of AGENT_IDS) {
    const entries = record[agentId];
    if (Array.isArray(entries)) {
      result[agentId] = entries as Message[];
    }
  }
  return result;
}

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
      const { agentId, id, chunk, toolCalls } = action.payload;
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [agentId]: (state.conversations[agentId] || []).map((msg) =>
            msg.id === id
              ? {
                  ...msg,
                  content: chunk ? msg.content + chunk : msg.content,
                  toolCalls: toolCalls
                    ? [...(msg.toolCalls || []), ...toolCalls]
                    : msg.toolCalls,
                }
              : msg,
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
          [agentId]: (state.conversations[agentId] || []).map((msg) =>
            msg.id === id ? { ...msg, isStreaming: false } : msg,
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
      return {
        ...state,
        settings: newSettings,
        sessionMetrics: action.payload.model
          ? { ...state.sessionMetrics, model: action.payload.model }
          : state.sessionMetrics,
      };
    }

    case 'TOGGLE_SETTINGS':
      return { ...state, isSettingsOpen: !state.isSettingsOpen };

    case 'TOGGLE_LOG_VIEWER':
      return { ...state, isLogViewerOpen: !state.isLogViewerOpen };

    case 'SET_TAB':
      return { ...state, activeTab: action.payload };

    case 'UPDATE_METRICS':
      return {
        ...state,
        sessionMetrics: { ...state.sessionMetrics, ...action.payload },
      };

    case 'UPDATE_SERVER_STATE': {
      const nextServerState: ServerState = {
        ...(state.serverState ?? {
          cpuLoad: 0,
          ramUsed: 0,
          storageUsed: 0,
          containers: [],
          dockerRunning: false,
          deployments: [],
          insights: [],
        }),
        ...action.payload,
      };
      const newHistory = [
        ...state.statsHistory,
        {
          cpu: nextServerState.cpuLoad,
          ram: nextServerState.ramUsed,
          timestamp: Date.now(),
        },
      ].slice(-600);

      return {
        ...state,
        serverState: nextServerState,
        statsHistory: newHistory,
      };
    }

    case 'INITIALIZE_CONVERSATIONS':
      return {
        ...state,
        conversations: sanitizeConversations(action.payload),
      };

    case 'SET_YOLO_MODE':
      return { ...state, isYoloMode: action.payload };

    case 'SET_PENDING_APPROVAL':
      return { ...state, pendingApproval: action.payload };

    case 'RESOLVE_APPROVAL':
      return {
        ...state,
        pendingApproval:
          state.pendingApproval?.id === action.payload ? null : state.pendingApproval,
      };

    default:
      return state;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const res = await apiFetch('/api/config/get');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Partial<Settings>;
        if (cancelled) return;
        dispatch({ type: 'UPDATE_SETTINGS', payload: data });

        if (data.isYoloMode !== undefined) {
          dispatch({ type: 'SET_YOLO_MODE', payload: Boolean(data.isYoloMode) });
        }

        if (!data.model || (!data.hasKey && !data.apiKey)) {
          dispatch({ type: 'TOGGLE_SETTINGS' });
        }
      } catch (err: unknown) {
        console.error('Failed to load system settings:', err);
      }
    };

    const fetchStats = async () => {
      try {
        const res = await apiFetch('/api/stats');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ServerState;
        if (!cancelled) {
          dispatch({ type: 'UPDATE_SERVER_STATE', payload: data });
        }
      } catch (err: unknown) {
        console.error('Failed to fetch server stats:', err);
      }
    };

    const loadHistory = async () => {
      try {
        const res = await apiFetch('/api/chat/load');
        if (!res.ok || cancelled) return;
        const history = (await res.json()) as Record<string, unknown>;
        if (!cancelled && history && Object.keys(history).length > 0) {
          dispatch({
            type: 'INITIALIZE_CONVERSATIONS',
            payload: sanitizeConversations(history),
          });
        }
      } catch (err: unknown) {
        console.error('Failed to load chat history:', err);
      }
    };

    void loadSettings();
    void fetchStats();
    void loadHistory();
    const interval = window.setInterval(fetchStats, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const totalMessages = Object.values(state.conversations).flat().length;
    if (totalMessages === 0) return;

    const timer = window.setTimeout(async () => {
      try {
        await apiFetch('/api/chat/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.conversations),
        });
      } catch (err: unknown) {
        console.error('Failed to save chat history:', err);
      }
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [state.conversations]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
