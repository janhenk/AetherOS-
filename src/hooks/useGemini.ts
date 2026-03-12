import { useRef, useCallback } from 'react';
import { GoogleGenAI, Type, type Chat } from '@google/genai';
import { useAppContext } from '../context/AppContext';
import { getAgent } from '../agents';
import type { AgentId, Message, DockerCreateSpec } from '../types';

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useGemini() {
    const { state, dispatch } = useAppContext();
    const chatSessions = useRef<Map<AgentId, Chat>>(new Map());
    const clientRef = useRef<GoogleGenAI | null>(null);
    const lastApiKey = useRef<string>('');
    const lastModel = useRef<string>('');

    const getClient = useCallback((): GoogleGenAI | null => {
        const { apiKey } = state.settings;
        if (!apiKey) return null;
        if (clientRef.current && apiKey === lastApiKey.current) return clientRef.current;
        clientRef.current = new GoogleGenAI({ apiKey });
        lastApiKey.current = apiKey;
        // Reset sessions when key changes
        chatSessions.current.clear();
        return clientRef.current;
    }, [state.settings]);

    const getChat = useCallback(
        (agentId: AgentId): Chat | null => {
            const client = getClient();
            if (!client) return null;

            const { model, temperature } = state.settings;
            // If model changed, reset sessions
            if (model !== lastModel.current) {
                chatSessions.current.clear();
                lastModel.current = model;
            }

            if (!chatSessions.current.has(agentId)) {
                const agentDef = getAgent(agentId);
                const chat = client.chats.create({
                    model,
                    config: {
                        temperature,
                        systemInstruction: agentDef.systemPrompt,
                        tools: [{
                            functionDeclarations: [
                                {
                                    name: 'getDockerLogs',
                                    description: 'Fetches the recent logs (stdout/stderr) of a specified Docker container. Useful for diagnosing errors or checking status.',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            id: { type: Type.STRING, description: 'The container ID or name' }
                                        },
                                        required: ['id']
                                    }
                                },
                                {
                                    name: 'editDockerConfig',
                                    description: 'Deletes a container and re-creates it with new settings (image, ports, volumes, env overrides). Use this to fix configuration errors. Pass the entire updated spec.',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            image: { type: Type.STRING },
                                            name: { type: Type.STRING },
                                            ports: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { host: { type: Type.STRING }, container: { type: Type.STRING } } } },
                                            volumes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { host: { type: Type.STRING }, container: { type: Type.STRING } } } },
                                            env: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { key: { type: Type.STRING }, value: { type: Type.STRING } } } },
                                            resources: { type: Type.OBJECT, properties: { cpus: { type: Type.STRING }, memory: { type: Type.STRING } } }
                                        },
                                        required: ['image']
                                    }
                                },
                                {
                                    name: 'searchAppStore',
                                    description: 'Searches the CasaOS community app store for applications matching a query (e.g., "media server", "ad blocker", "database"). Returns up to 5 matching apps with their metadata.',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            query: { type: Type.STRING, description: 'The search term to look for in app titles, categories, or descriptions.' }
                                        },
                                        required: ['query']
                                    }
                                },
                                {
                                    name: 'listFiles',
                                    description: 'Lists files and directories at a given path. If path is omitted, lists the current project root.',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            path: { type: Type.STRING, description: 'The absolute or relative path to list' }
                                        }
                                    }
                                },
                                {
                                    name: 'readFile',
                                    description: 'Reads the text content of a file on the filesystem.',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            path: { type: Type.STRING, description: 'The path to the file to read' }
                                        },
                                        required: ['path']
                                    }
                                },
                                {
                                    name: 'writeFile',
                                    description: 'Writes text content to a file. Overwrites if it exists.',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            path: { type: Type.STRING, description: 'The path to the file to write' },
                                            content: { type: Type.STRING, description: 'The content to write' }
                                        },
                                        required: ['path', 'content']
                                    }
                                },
                                {
                                    name: 'runCSharpScript',
                                    description: 'Writes and executes raw C# script code (.csx) securely inside an offline, isolated Docker container. Use this to perform complex calculations, data generation, or system tasks. Access to the internet and host network is blocked.',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            code: { type: Type.STRING, description: 'The absolute raw C# script code to be executed.' }
                                        },
                                        required: ['code']
                                    }
                                }
                            ]
                        }]
                    },
                });
                chatSessions.current.set(agentId, chat);
            }
            return chatSessions.current.get(agentId)!;
        },
        [getClient, state.settings]
    );

    const sendMessage = useCallback(
        async (agentId: AgentId, text: string) => {
            const chat = getChat(agentId);

            // Add user message
            const userMsg: Message = {
                id: generateId(),
                agentId,
                role: 'user',
                content: text,
                timestamp: new Date(),
            };
            dispatch({ type: 'ADD_MESSAGE', payload: userMsg });

            if (!chat) {
                const errMsg: Message = {
                    id: generateId(),
                    agentId,
                    role: 'agent',
                    content: '⚠ SYSTEM ERROR: No API key configured. Please open settings and enter your Google Gemini API key.',
                    timestamp: new Date(),
                    isStreaming: false,
                };
                dispatch({ type: 'ADD_MESSAGE', payload: errMsg });
                return;
            }

            // Add empty streaming agent message
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

            const handleStream = async (stream: any) => {
                let functionCallsToExecute: any[] = [];

                for await (const chunk of stream) {
                    const chunkText = chunk.text ?? '';
                    if (chunkText) {
                        accumulatedReply += chunkText;
                        dispatch({
                            type: 'UPDATE_STREAMING_MESSAGE',
                            payload: { agentId, id: agentMsgId, chunk: chunkText },
                        });
                    }
                    if (chunk.functionCalls) {
                        functionCallsToExecute.push(...chunk.functionCalls);
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
                                const startRes = await fetch('/api/docker/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                result = await startRes.json();
                            } else if (call.name === 'editDockerConfig') {
                                const spec = call.args as DockerCreateSpec;
                                if (spec.name) {
                                    const nameClean = spec.name.replace(/^\//, '');
                                    await fetch('/api/docker/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nameClean, action: 'rm' }) });
                                    spec.name = nameClean;
                                }
                                const startRes = await fetch('/api/docker/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
                                result = await startRes.json();
                            } else if (call.name === 'searchAppStore') {
                                const args = call.args as { query: string };
                                const searchRes = await fetch('/api/store/apps');
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
                                const lsRes = await fetch(`/api/fs/ls${args.path ? '?path=' + encodeURIComponent(args.path) : ''}`);
                                result = await lsRes.json();
                            } else if (call.name === 'readFile') {
                                const args = call.args as { path: string };
                                const readRes = await fetch('/api/fs/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                result = await readRes.json();
                            } else if (call.name === 'runCSharpScript') {
                                const args = call.args as { code: string };
                                const runRes = await fetch('/api/docker/run-csx', { 
                                    method: 'POST', 
                                    headers: { 'Content-Type': 'application/json' }, 
                                    body: JSON.stringify({ ...args, allowNetwork: state.settings.isSandboxNetworkEnabled || false }) 
                                });
                                result = await runRes.json();
                            } else if (call.name === 'writeFile') {
                                const args = call.args as { path: string; content: string };
                                const writeRes = await fetch('/api/fs/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
                                result = await writeRes.json();
                            }

                            functionResponses.push({
                                functionResponse: {
                                    name: call.name,
                                    response: result
                                }
                            });
                        } catch (err: any) {
                            functionResponses.push({
                                functionResponse: {
                                    name: call.name,
                                    response: { error: err.message }
                                }
                            });
                        }
                    }

                    // Send the responses back to the model and continue streaming
                    const followUpStream = await chat.sendMessageStream({ message: functionResponses });
                    await handleStream(followUpStream);
                }
            };

            try {
                const initialStream = await chat.sendMessageStream({ message: text });
                await handleStream(initialStream);

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
                chatSessions.current.delete(agentId);
            } finally {
                dispatch({ type: 'FINISH_STREAMING', payload: { agentId, id: agentMsgId } });
                dispatch({ type: 'SET_AGENT_STATUS', payload: { agentId, status: 'online' } });
            }
        },
        [getChat, dispatch, state.settings.model]
    );

    const resetSession = useCallback((agentId: AgentId) => {
        chatSessions.current.delete(agentId);
    }, []);

    return { sendMessage, resetSession };
}
