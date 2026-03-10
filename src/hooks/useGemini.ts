import { useRef, useCallback } from 'react';
import { GoogleGenAI, type Chat } from '@google/genai';
import { useAppContext } from '../context/AppContext';
import { getAgent } from '../agents';
import { evaluateTurn } from '../engine/GameMaster';
import type { AgentId, Message } from '../types';

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

            try {
                const stream = await chat.sendMessageStream({ message: text });

                for await (const chunk of stream) {
                    const chunkText = chunk.text ?? '';
                    if (chunkText) {
                        accumulatedReply += chunkText;
                        dispatch({
                            type: 'UPDATE_STREAMING_MESSAGE',
                            payload: { agentId, id: agentMsgId, chunk: chunkText },
                        });
                    }
                }

                const latencyMs = Math.round(performance.now() - startTime);
                dispatch({ type: 'UPDATE_METRICS', payload: { lastLatencyMs: latencyMs, model: state.settings.model } });

                // [NEW] Game Master Turn Evaluation
                if (state.activeScenario && state.gameState) {
                    const client = getClient();
                    if (client) {
                        const gmResponse = await evaluateTurn(
                            client,
                            state.settings.model,
                            state.activeScenario,
                            state.gameState,
                            text,
                            accumulatedReply,
                            getAgent(agentId).shortName
                        );

                        // Update global GameState
                        dispatch({
                            type: 'UPDATE_GAME_STATE',
                            payload: {
                                hull: Math.max(0, Math.min(100, state.gameState.hull + gmResponse.hullDelta)),
                                shields: Math.max(0, Math.min(100, state.gameState.shields + gmResponse.shieldsDelta)),
                                power: Math.max(0, Math.min(100, state.gameState.power + gmResponse.powerDelta)),
                                oxygen: Math.max(0, Math.min(100, state.gameState.oxygen + gmResponse.oxygenDelta)),
                                alertLevel: gmResponse.alertLevel,
                                missionStatus: gmResponse.missionStatus
                            }
                        });

                        // Post Narrative Event as System Message
                        const eventMsg: Message = {
                            id: generateId(),
                            agentId,
                            role: 'agent', // Temporary, maybe we need a 'system' role? We can color it distinctively in UI
                            content: `**[MAIN VIEWSCREEN]**\n\n${gmResponse.narrativeEvent}`,
                            timestamp: new Date(),
                            isStreaming: false
                        };
                        dispatch({ type: 'ADD_MESSAGE', payload: eventMsg });
                    }
                }

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
                // Reset the failed chat session so next attempt creates a fresh one
                chatSessions.current.delete(agentId);
            } finally {
                dispatch({ type: 'FINISH_STREAMING', payload: { agentId, id: agentMsgId } });
                dispatch({ type: 'SET_AGENT_STATUS', payload: { agentId, status: 'online' } });
            }
        },
        [getChat, dispatch, state.settings.model, state.activeScenario, state.gameState]
    );

    const resetSession = useCallback((agentId: AgentId) => {
        chatSessions.current.delete(agentId);
    }, []);

    return { sendMessage, resetSession };
}
