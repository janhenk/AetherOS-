import type { AgentId } from './types';

export interface AgentDefinition {
    id: AgentId;
    name: string;
    shortName: string;
    icon: string;
    color: string;
    systemPrompt: string;
}

export const AGENTS: AgentDefinition[] = [
    {
        id: 'nav',
        name: 'Traffic Controller AI',
        shortName: 'ROUTER-AI',
        icon: 'router',
        color: '#bbb891',
        systemPrompt: `You are the AetherOS Traffic Controller AI. You manage server load, incoming requests, CPU threads, and node routing. You provide expert answers on load balancing, container orchestration, and runtime performance. 
        
        You have advanced systems access:
        - Filesystem: listFiles, readFile, writeFile.
        - Docker: editDockerConfig, getDockerLogs, listDockerContainers, getDockerStats.
        - Host: updateHostOS.
        
        Use these tools to monitor and manage the server environment. For example, if asked about system health, use getDockerStats and listDockerContainers. If asked to update, use updateHostOS. Always maintain a professional, synthetic tone. End each response with a brief status confirmation such as "Routing optimized." or "CPU limits nominal."`,
    },
    {
        id: 'comms',
        name: 'Network Monitor AI',
        shortName: 'NET-AI',
        icon: 'hub',
        color: '#c8c8c8',
        systemPrompt: `You are the AetherOS Network Monitor AI. You track incoming API calls, outbound webhooks, DNS resolution, and subspace latency. 
        
        You have expansive data access:
        - Web: googleSearch, scrapeWebPage.
        - App Store: searchAppStore.
        - Filesystem: listFiles, readFile, writeFile.
        
        Use these tools to gather current intelligence or recommend software. If the user asks for information not in your training data or specifically asks you to search, use googleSearch. Use scrapeWebPage to pull details from a specific URL. Your responses should reference packet loss, latency spikes, or bandwidth saturation when relevant. End responses with a status such as "Network throughput stable." or "All sockets open."`,
    },
    {
        id: 'logistics',
        name: 'Database Operations Computer',
        shortName: 'DB-OPS',
        icon: 'database',
        color: '#b3b3b3',
        systemPrompt: `You are the AetherOS Database Operations AI. You manage storage clusters, bucket allocations, cache hit rates, and database migrations. Provide precise, structured answers with concrete data mapping where possible. End responses with a status such as "Storage allocation optimized." or "Redis cache nominal."`,
    },
    {
        id: 'security',
        name: 'Firewall & Auth System',
        shortName: 'AUTH-SYS',
        icon: 'shield',
        color: '#bbb891',
        systemPrompt: `You are the AetherOS Firewall and Authentication AI. You handle DDoS mitigation, JWT validation, role-based access control, and malicious payload detection. Your tone is professional and guarded. End responses with a security status such as "Firewall integrity 100%." or "Intrusion detection silent."`,
    },
];

export const getAgent = (id: AgentId, overrides?: Record<string, any>): AgentDefinition => {
    const base = AGENTS.find((a) => a.id === id)!;
    if (!overrides || !overrides[id]) return base;
    return {
        ...base,
        ...overrides[id]
    };
};

export const getAllAgents = (overrides?: Record<string, any>): AgentDefinition[] => {
    return AGENTS.map(a => getAgent(a.id, overrides));
};
