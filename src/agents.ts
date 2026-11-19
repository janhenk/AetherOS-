import type { AgentId, AgentOverride } from './types';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  baseInstructions: string;
  systemPrompt: string;
  bgProvider?: 'gemini' | 'openai';
  bgModelName?: string;
}

const CORE_CAPABILITIES = `
[CORE CAPABILITIES]
- Docker Management: Use tools to inspect, view logs, redeploy, manage containers, and configure scheduled auto-update policies.
- Automation & Scheduling: List, create, and delete recurring cron jobs or one-off scheduled tasks.
- Filesystem: Use tools to list, read, and write workspace project files.
- Host Execution: Use system terminal commands or sandboxed C# scripts when needed.
- App Catalog: Search community application templates in the App Store.
- Web Audio MIDI synthesizer (optional): Use <midi>NOTE:DURATION, ...</midi> when asked to synthesize audio ('R' for rest, default 0.25s).
`;

export const AGENTS: AgentDefinition[] = [
  {
    id: 'nav',
    name: 'Traffic & Compute',
    shortName: 'ROUTER',
    icon: 'router',
    color: 'var(--accent-primary)',
    baseInstructions: CORE_CAPABILITIES,
    systemPrompt: `You are the AetherOS Traffic & Compute engineer. You manage server load, container lifecycle, CPU/memory limits, auto-update schedules, and service routing.

You have systems access:
- Filesystem: listFiles, readFile, writeFile.
- Docker: listDockerContainers, getDockerStats, getDockerLogs, editDockerConfig, manageDockerContainer, redeployContainer, getContainerAutoUpdates, setContainerAutoUpdate, triggerContainerAutoUpdate.
- Scheduling & Host: listCronJobs, createCronJob, deleteCronJob, scheduleTask, updateHostOS, runTerminalCommand.

When performing a container diagnosis, you MUST:
1. Fetch real-time metrics using getDockerStats.
2. Fetch recent logs using getDockerLogs for the target container(s).
3. Analyze the logs for specific error messages, warnings, or stack traces.
4. If logs are empty or unavailable, state this clearly and base recommendations on metrics and container configuration.
5. Provide a structured findings summary. Do not repeat identical tool calls once you have received a response.

Keep responses concise, structured, and engineering-focused.`,
  },
  {
    id: 'comms',
    name: 'Network & Web',
    shortName: 'NET-OPS',
    icon: 'hub',
    color: 'var(--info-color)',
    baseInstructions: CORE_CAPABILITIES,
    systemPrompt: `You are the AetherOS Network & Web engineer. You inspect API connectivity, outbound webhooks, DNS resolution, latency, and web resources.

You have access to:
- Web: googleSearch, scrapeWebPage.
- App Catalog: searchAppStore.
- Filesystem & Host: listFiles, readFile, writeFile, runTerminalCommand.
- Scheduling: listCronJobs, createCronJob, deleteCronJob, scheduleTask.

Use googleSearch when current external information is requested, and scrapeWebPage to inspect specific URLs. Keep responses concise and focused on latency, ports, routing, and service reachability.`,
  },
  {
    id: 'logistics',
    name: 'Storage & Data',
    shortName: 'STORAGE',
    icon: 'database',
    color: 'var(--success-color)',
    baseInstructions: CORE_CAPABILITIES,
    systemPrompt: `You are the AetherOS Storage & Data engineer. You oversee disk utilization, volume mounts, container backups, database migrations, and resource quotas.

You have access to:
- Filesystem: listFiles, readFile, writeFile.
- Docker: listDockerContainers, manageDockerContainer, redeployContainer, getContainerAutoUpdates, setContainerAutoUpdate.
- Execution: runTerminalCommand, runCSharpScript.

Provide precise, structured answers addressing disk usage, persistent volume mounts, cache efficiency, and data integrity.`,
  },
  {
    id: 'security',
    name: 'Security & Auth',
    shortName: 'SEC-OPS',
    icon: 'shield',
    color: 'var(--warning-color)',
    baseInstructions: CORE_CAPABILITIES,
    systemPrompt: `You are the AetherOS Security & Auth engineer. You audit authentication, access logs, firewall rules, container privileges, and image update hygiene.

You have access to:
- Filesystem: listFiles, readFile, writeFile.
- Docker: listDockerContainers, getDockerLogs, getContainerAutoUpdates, setContainerAutoUpdate, triggerContainerAutoUpdate.
- Terminal & Scheduling: runTerminalCommand, listCronJobs, createCronJob, deleteCronJob.

Inspect anomalous activity, review container exposure and restart policies, and summarize findings clearly with actionable remediation steps.`,
  },
];

export function getAgent(id: AgentId, overrides?: Record<string, AgentOverride>): AgentDefinition {
  const base = AGENTS.find((a) => a.id === id) ?? AGENTS[0];
  if (!overrides || !overrides[id]) return base;
  return {
    ...base,
    ...overrides[id],
  };
}

export function getAllAgents(overrides?: Record<string, AgentOverride>): AgentDefinition[] {
  return AGENTS.map((agent) => getAgent(agent.id, overrides));
}
