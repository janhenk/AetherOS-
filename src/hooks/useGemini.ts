import { useRef, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { apiFetch } from '../utils/api';
import { getAgent } from '../agents';
import type { AgentId, Message, DockerCreateSpec } from '../types';

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useGemini() {
    const { state, dispatch } = useAppContext();
    const chatState = useRef<Map<AgentId, any>>(new Map());

    const resetSession = useCallback((agentId: AgentId) => {
        chatState.current.delete(agentId);
    }, []);

    const sendMessage = useCallback(
        async (agentId: AgentId, text: string) => {
            const agentDef = getAgent(agentId);
            
            // Add user message
            const userMsg: Message = {
                id: generateId(),
                agentId,
                role: 'user',
                content: text,
                timestamp: new Date(),
            };
            dispatch({ type: 'ADD_MESSAGE', payload: userMsg });

            // Add placeholder for agent response
            const agentMsgId = generateId();
            const agentMsg: Message = {
                id: agentMsgId,
                agentId,
                role: 'agent',
                content: '',
                timestamp: new Date(),
                isStreaming: true,
            };
            dispatch({ type: 'ADD_MESSAGE', payload: agentMsg });
            dispatch({ type: 'SET_AGENT_STATUS', payload: { agentId, status: 'processing' } });

            const startTime = performance.now();
            let accumulatedReply = '';

            const handleRequest = async (currentMessages: Message[]) => {
                try {
                    const response = await apiFetch('/api/ai/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messages: currentMessages,
                            agentId,
                            systemInstruction: agentDef.systemPrompt,
                            tools: [{
                                functionDeclarations: [
                                    {
                                        name: 'getDockerLogs',
                                        description: 'Fetches the recent logs (stdout/stderr) of a specified Docker container. Useful for diagnosing errors or checking status.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                id: { type: 'STRING', description: 'The container ID or name' }
                                            },
                                            required: ['id']
                                        }
                                    },
                                    {
                                        name: 'editDockerConfig',
                                        description: 'Deletes a container and re-creates it with new settings (image, ports, volumes, env overrides). Use this to fix configuration errors. Pass the entire updated spec.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                image: { type: 'STRING' },
                                                name: { type: 'STRING' },
                                                ports: { type: 'ARRAY', items: { type: 'OBJECT', properties: { host: { type: 'STRING' }, container: { type: 'STRING' } } } },
                                                volumes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { host: { type: 'STRING' }, container: { type: 'STRING' } } } },
                                                env: { type: 'ARRAY', items: { type: 'OBJECT', properties: { key: { type: 'STRING' }, value: { type: 'STRING' } } } },
                                                resources: { type: 'OBJECT', properties: { cpus: { type: 'STRING' }, memory: { type: 'STRING' } } }
                                            },
                                            required: ['image']
                                        }
                                    },
                                    {
                                        name: 'searchAppStore',
                                        description: 'Searches the CasaOS community app store for applications matching a query (e.g., "media server", "ad blocker", "database"). Returns up to 5 matching apps with their metadata.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                query: { type: 'STRING', description: 'The search term to look for in app titles, categories, or descriptions.' }
                                            },
                                            required: ['query']
                                        }
                                    },
                                    {
                                        name: 'listFiles',
                                        description: 'Lists files and directories at a given path. If path is omitted, lists the current project root.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                path: { type: 'STRING', description: 'The absolute or relative path to list' }
                                            }
                                        }
                                    },
                                    {
                                        name: 'readFile',
                                        description: 'Reads the text content of a file on the filesystem.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                path: { type: 'STRING', description: 'The path to the file to read' }
                                            },
                                            required: ['path']
                                        }
                                    },
                                    {
                                        name: 'writeFile',
                                        description: 'Writes text content to a file. Overwrites if it exists.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                path: { type: 'STRING', description: 'The path to the file to write' },
                                                content: { type: 'STRING', description: 'The content to write' }
                                            },
                                            required: ['path', 'content']
                                        }
                                    },
                                    {
                                        name: 'runCSharpScript',
                                        description: 'Writes and executes raw C# script code (.csx) securely inside an offline, isolated Docker container. Use this to perform complex calculations, data generation, or system tasks. Access to the internet and host network is blocked.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                code: { type: 'STRING', description: 'The absolute raw C# script code to be executed.' }
                                            },
                                            required: ['code']
                                        }
                                    },
                                    {
                                        name: 'updateHostOS',
                                        description: 'Checks for and triggers a host-level OS update. Use this when the user asks to update the server or system.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                action: { type: 'STRING', enum: ['check', 'start'], description: 'Whether to just check for updates or start the update process.' }
                                            }
                                        }
                                    },
                                    {
                                        name: 'listDockerContainers',
                                        description: 'Returns a detailed list of all Docker containers on the system, including stopped ones.',
                                        parameters: { type: 'OBJECT', properties: {} }
                                    },
                                    {
                                        name: 'getDockerStats',
                                        description: 'Returns real-time resource usage statistics (CPU, Memory, Network I/O) for all active Docker containers.',
                                        parameters: { type: 'OBJECT', properties: {} }
                                    },
                                    {
                                        name: 'scrapeWebPage',
                                        description: 'Fetches the text content of a web page. Use this to get information from a specific URL.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                url: { type: 'STRING', description: 'The full URL of the page to scrape.' }
                                            },
                                            required: ['url']
                                        }
                                    },
                                    {
                                        name: 'googleSearch',
                                        description: 'Performs a Google search to find current information on the web.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                query: { type: 'STRING', description: 'The search term to look for.' }
                                            },
                                            required: ['query']
                                        }
                                    }
                                ]
                            }]
                        })
                    });

                    if (!response.ok) {
                        const data = await response.json();
                        throw new Error(data.error || 'AI Bridge communication failure.');
                    }

                    const reader = response.body?.getReader();
                    if (!reader) throw new Error('Stream reader unavailable.');

                    const decoder = new TextDecoder();
                    let buffer = '';
                    let functionCallsToExecute: any[] = [];

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const data = JSON.parse(line.slice(6));
                                    if (data.text) {
                                        accumulatedReply += data.text;
                                        dispatch({
                                            type: 'UPDATE_STREAMING_MESSAGE',
                                            payload: { agentId, id: agentMsgId, chunk: data.text },
                                        });
                                    }
                                    if (data.functionCalls && data.functionCalls.length > 0) {
                                        functionCallsToExecute.push(...data.functionCalls);
                                    }
                                } catch (e) { /* ignore parse errors in stream */ }
                            }
                        }
                    }

                    if (functionCallsToExecute.length > 0) {
                        dispatch({
                            type: 'UPDATE_STREAMING_MESSAGE',
                            payload: { agentId, id: agentMsgId, chunk: `\n\n> \`Executing ${functionCallsToExecute.length} system tools...\`\n` },
                        });

                        const functionResponses = [];
                        for (const call of functionCallsToExecute) {
                            try {
                                let result = {};
                                if (call.name === 'getDockerLogs') {
                                    const args = call.args as { id: string };
                                    const startRes = await apiFetch('/api/docker/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                    result = await startRes.json();
                                } else if (call.name === 'editDockerConfig') {
                                    const spec = call.args as DockerCreateSpec;
                                    if (spec.name) {
                                        const nameClean = spec.name.replace(/^\//, '');
                                        await apiFetch('/api/docker/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nameClean, action: 'rm' }) });
                                        spec.name = nameClean;
                                    }
                                    const startRes = await apiFetch('/api/docker/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
                                    result = await startRes.json();
                                } else if (call.name === 'searchAppStore') {
                                    const args = call.args as { query: string };
                                    const searchRes = await apiFetch('/api/store/apps');
                                    const allApps = await searchRes.json();
                                    if (allApps.apps) {
                                        const q = args.query.toLowerCase();
                                        const filtered = allApps.apps.filter((a: any) =>
                                            a.title?.toLowerCase().includes(q) ||
                                            a.description?.toLowerCase().includes(q) ||
                                            a.category?.toLowerCase().includes(q)
                                        ).slice(0, 5);
                                        result = { results: filtered, total_found: filtered.length, query: args.query };
                                    } else {
                                        result = { error: 'Failed to fetch store apps' };
                                    }
                                } else if (call.name === 'listFiles') {
                                    const args = call.args as { path?: string };
                                    const lsRes = await apiFetch(`/api/fs/ls${args.path ? '?path=' + encodeURIComponent(args.path) : ''}`);
                                    result = await lsRes.json();
                                } else if (call.name === 'readFile') {
                                    const args = call.args as { path: string };
                                    const readRes = await apiFetch('/api/fs/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                    result = await readRes.json();
                                } else if (call.name === 'runCSharpScript') {
                                    const args = call.args as { code: string };
                                    const runRes = await apiFetch('/api/docker/run-csx', { 
                                        method: 'POST', 
                                        headers: { 'Content-Type': 'application/json' }, 
                                        body: JSON.stringify({ ...args, allowNetwork: state.settings.isSandboxNetworkEnabled || false }) 
                                    });
                                    result = await runRes.json();
                                } else if (call.name === 'writeFile') {
                                    const args = call.args as { path: string; content: string };
                                    const writeRes = await apiFetch('/api/fs/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                    result = await writeRes.json();
                                } else if (call.name === 'updateHostOS') {
                                    const args = call.args as { action?: string };
                                    const updateRes = await apiFetch('/api/system/host-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                    result = await updateRes.json();
                                } else if (call.name === 'listDockerContainers') {
                                    const lsRes = await apiFetch('/api/docker/list');
                                    result = await lsRes.json();
                                } else if (call.name === 'getDockerStats') {
                                    const statsRes = await apiFetch('/api/docker/stats');
                                    result = await statsRes.json();
                                } else if (call.name === 'scrapeWebPage') {
                                    const args = call.args as { url: string };
                                    const scrapeRes = await apiFetch('/api/tools/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                    result = await scrapeRes.json();
                                } else if (call.name === 'googleSearch') {
                                    const args = call.args as { query: string };
                                    const searchRes = await apiFetch('/api/tools/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                    result = await searchRes.json();
                                }

                                functionResponses.push({
                                    id: generateId(),
                                    agentId,
                                    role: 'agent',
                                    content: `TOOL_RESPONSE:${call.name}:${JSON.stringify(result)}`,
                                    timestamp: new Date()
                                });
                            } catch (err: any) {
                                functionResponses.push({
                                    id: generateId(),
                                    agentId,
                                    role: 'agent',
                                    content: `TOOL_ERROR:${call.name}:${err.message}`,
                                    timestamp: new Date()
                                });
                            }
                        }

                        await handleRequest([...currentMessages, { id: agentMsgId, role: 'agent', content: accumulatedReply, agentId, timestamp: new Date() }, ...functionResponses as any]);
                    }
                } catch (err: any) {
                    throw err;
                }
            };

            try {
                const currentHistory = state.conversations[agentId] || [];
                await handleRequest([...currentHistory, userMsg]);

                const latencyMs = Math.round(performance.now() - startTime);
                dispatch({ type: 'UPDATE_METRICS', payload: { lastLatencyMs: latencyMs, model: state.settings.model } });

            } catch (err: unknown) {
                const errorText = err instanceof Error ? err.message : 'Unknown error occurred';
                dispatch({
                    type: 'UPDATE_STREAMING_MESSAGE',
                    payload: {
                        agentId,
                        id: agentMsgId,
                        chunk: `\n⚠ TRANSMISSION ERROR: ${errorText}`,
                    },
                });
            } finally {
                dispatch({ type: 'FINISH_STREAMING', payload: { agentId, id: agentMsgId } });
                dispatch({ type: 'SET_AGENT_STATUS', payload: { agentId, status: 'online' } });
            }
        },
        [dispatch, state.conversations, state.settings.model, state.settings.isSandboxNetworkEnabled]
    );

    return { sendMessage, resetSession };
}
