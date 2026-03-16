export type AgentId = 'nav' | 'comms' | 'logistics' | 'security';
export type AgentStatus = 'online' | 'processing' | 'standby' | 'active';
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
    hasKey?: boolean;
    model: GeminiModel;
    temperature: number;
    isSandboxNetworkEnabled?: boolean;
    registries?: { server: string; username: string }[];
    isYoloMode?: boolean;
    agentOverrides?: Record<string, { name?: string; shortName?: string; systemPrompt?: string }>;
}

export interface SessionMetrics {
    lastLatencyMs: number;
    totalTokens: number;
    model: GeminiModel;
}

export interface DockerContainer {
    id: string;
    name: string;
    status: 'running' | 'stopped' | 'failed' | 'restarting';
    uptime: string;
}

export interface TacticalInsight {
    id: string;
    type: 'resource' | 'security' | 'network' | 'optimization';
    severity: 'low' | 'medium' | 'high';
    message: string;
    suggestion: string;
    containerId?: string;
    timestamp: Date;
}


export interface DockerPort {
    host: string;
    container: string;
}

export interface DockerVolume {
    host: string;
    container: string;
}

export interface DockerEnv {
    key: string;
    value: string;
}

export interface DockerCreateSpec {
    image: string;
    name?: string;
    ports?: DockerPort[];
    volumes?: DockerVolume[];
    env?: DockerEnv[];
    resources?: {
        cpus?: string;
        memory?: string;
    };
}

export interface StoreApp {
    id: string;
    title: string;
    tagline: string;
    description: string;
    icon: string;
    category: string;
    developer: string;
    port_map: string;
    path: string;
    store: string;
}

export interface ServerState {
    cpuLoad: number; // 0-100%
    ramUsed: number; // 0-100%
    storageUsed: number; // 0-100%
    containers: DockerContainer[];
    hostname?: string;
    osInfo?: string;
    ipAddress?: string;
    dockerRunning: boolean;
    networkInbound?: number;
    networkOutbound?: number;
    deployments: { id: string; name: string; status: string }[];
    insights: TacticalInsight[];
    projectVersion?: string;
}


export interface AppState {
    activeAgent: AgentId;
    conversations: Record<AgentId, Message[]>;
    agentStatus: Record<AgentId, AgentStatus>;
    settings: Settings;
    isSettingsOpen: boolean;
    activeTab: 'diagnostics' | 'sensors' | 'network';
    sessionMetrics: SessionMetrics;
    serverState: ServerState | null;
    activeScenario: null;
    isYoloMode: boolean;
    pendingApproval: { id: string; action: string; params: any } | null;
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
    | { type: 'SET_TAB'; payload: string }
    | { type: 'UPDATE_METRICS'; payload: Partial<AppState['sessionMetrics']> }
    | { type: 'UPDATE_SERVER_STATE'; payload: any }
    | { type: 'INITIALIZE_CONVERSATIONS'; payload: AppState['conversations'] }
    | { type: 'SET_YOLO_MODE'; payload: boolean }
    | { type: 'SET_PENDING_APPROVAL'; payload: AppState['pendingApproval'] }
    | { type: 'RESOLVE_APPROVAL'; payload: string }; // id of approval to clear
