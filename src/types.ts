export type AgentId = 'nav' | 'comms' | 'logistics' | 'security';
export type AgentStatus = 'online' | 'processing' | 'standby' | 'active';
export type GeminiModel = string;

export interface ToolCallEntry {
  name: string;
  args?: Record<string, unknown>;
}

export interface Message {
  id: string;
  agentId: AgentId;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date | string;
  isStreaming?: boolean;
  toolCalls?: ToolCallEntry[];
}

export interface AgentOverride {
  name?: string;
  shortName?: string;
  systemPrompt?: string;
  bgProvider?: 'gemini' | 'openai';
  bgModelName?: string;
}

export interface RegistryEntry {
  server: string;
  username: string;
}

export interface Settings {
  apiKey?: string;
  hasKey?: boolean;
  model: GeminiModel;
  temperature: number;
  isSandboxNetworkEnabled?: boolean;
  registries?: RegistryEntry[];
  isYoloMode?: boolean;
  agentOverrides?: Record<string, AgentOverride>;

  // Background Autonomous Agent Settings
  bgProvider?: 'gemini' | 'openai';
  bgBaseUrl?: string;
  bgApiKey?: string;
  hasBgKey?: boolean;
  bgModelName?: string;
  bgIterationLimit?: number;

  // Slack Integration Settings
  slackEnabled?: boolean;
  slackBotToken?: string;
  hasSlackBotToken?: boolean;
  slackAppToken?: string;
  hasSlackAppToken?: boolean;

  // Host SSH Terminal Settings
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  hasSshPassword?: boolean;
}

export interface SessionMetrics {
  lastLatencyMs: number;
  totalTokens: number;
  model: GeminiModel;
}

export interface ContainerAutoUpdatePolicy {
  enabled: boolean;
  scheduleMode: 'global' | 'custom';
  cronExpression?: string;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
  lastStatus?: 'updated' | 'up-to-date' | 'failed' | 'idle';
  lastMessage?: string;
  lastImageId?: string;
  image?: string;
  protected?: boolean;
}

export interface ContainerAutoUpdateGlobalConfig {
  globalEnabled: boolean;
  defaultSchedule: string;
  pruneDanglingImages: boolean;
}

export interface ContainerUpdateHistoryEntry {
  id: string;
  containerName: string;
  image: string;
  trigger: 'scheduled' | 'manual' | 'directive' | string;
  startedAt: string;
  finishedAt: string;
  status: 'updated' | 'up-to-date' | 'failed';
  oldImageId?: string;
  newImageId?: string;
  message: string;
}

export interface ContainerAutoUpdateResponse {
  config: ContainerAutoUpdateGlobalConfig;
  policies: Record<string, ContainerAutoUpdatePolicy>;
  history: ContainerUpdateHistoryEntry[];
}

export interface DockerContainer {
  id: string;
  name: string;
  image?: string;
  status: 'running' | 'stopped' | 'failed' | 'restarting';
  uptime: string;
  cpuPerc?: string;
  memPerc?: string;
  memUsage?: string;
  protected?: boolean;
  autoUpdate?: ContainerAutoUpdatePolicy | null;
}

export interface TacticalInsight {
  id: string;
  /** Stable de-duplication key assigned by the server. */
  key?: string;
  type: 'resource' | 'security' | 'network' | 'optimization' | 'system';
  severity: 'low' | 'medium' | 'high';
  message: string;
  suggestion: string;
  containerId?: string;
  image?: string;
  imageId?: string;
  timestamp: Date | string;
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
  networks?: string[];
  networkMode?: string;
  restartPolicy?: 'unless-stopped' | 'always' | 'on-failure' | 'no' | string;
  autoUpdate?: {
    enabled: boolean;
    scheduleMode: 'global' | 'custom';
    cronExpression?: string;
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

export interface DiskUsage {
  device: string;
  mount: string;
  total: number;
  used: number;
  percent: number;
}

export interface StatsHistoryPoint {
  cpu: number;
  ram: number;
  timestamp: number;
}

export interface ActiveDeployment {
  id: string;
  name: string;
  status: string;
  progress?: number;
  message?: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  agentId: string;
  prompt: string;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: 'success' | 'failed' | 'running';
  lastError?: string;
}

export interface ServerState {
  cpuLoad: number;
  ramUsed: number;
  storageUsed: number | { aggregatePercent: number; disks: DiskUsage[] };
  containers: DockerContainer[];
  hostname?: string;
  osInfo?: string;
  ipAddress?: string;
  dockerRunning: boolean;
  networkInbound?: number;
  networkOutbound?: number;
  deployments: ActiveDeployment[];
  insights: TacticalInsight[];
  projectVersion?: string;
}

export interface PendingApproval {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

export type SettingsTab = 'appearance' | 'ai' | 'integrations' | 'security';

export interface AppState {
  activeAgent: AgentId;
  conversations: Record<AgentId, Message[]>;
  agentStatus: Record<AgentId, AgentStatus>;
  settings: Settings;
  isSettingsOpen: boolean;
  settingsInitialTab?: SettingsTab;
  isLogViewerOpen: boolean;
  activeTab: 'diagnostics' | 'sensors' | 'network';
  sessionMetrics: SessionMetrics;
  serverState: ServerState | null;
  statsHistory: StatsHistoryPoint[];
  activeScenario: null;
  isYoloMode: boolean;
  pendingApproval: PendingApproval | null;
}

export type AppAction =
  | { type: 'SELECT_AGENT'; payload: AgentId }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | {
      type: 'UPDATE_STREAMING_MESSAGE';
      payload: {
        agentId: AgentId;
        id: string;
        chunk?: string;
        toolCalls?: ToolCallEntry[];
      };
    }
  | { type: 'FINISH_STREAMING'; payload: { agentId: AgentId; id: string } }
  | { type: 'SET_AGENT_STATUS'; payload: { agentId: AgentId; status: AgentStatus } }
  | { type: 'CLEAR_CONVERSATION'; payload: AgentId }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'OPEN_SETTINGS'; payload?: SettingsTab }
  | { type: 'TOGGLE_LOG_VIEWER' }
  | { type: 'SET_TAB'; payload: AppState['activeTab'] }
  | { type: 'UPDATE_METRICS'; payload: Partial<SessionMetrics> }
  | { type: 'UPDATE_SERVER_STATE'; payload: ServerState }
  | { type: 'INITIALIZE_CONVERSATIONS'; payload: Partial<Record<AgentId, Message[]>> }
  | { type: 'SET_YOLO_MODE'; payload: boolean }
  | { type: 'SET_PENDING_APPROVAL'; payload: PendingApproval | null }
  | { type: 'RESOLVE_APPROVAL'; payload: string };
