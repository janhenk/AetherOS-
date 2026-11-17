import { useRef, useCallback } from 'react';
import { useAppContext } from '../context/useAppContext';
import { apiFetch } from '../utils/api';
import { getAgent } from '../agents';
import type {
  AgentId,
  DockerCreateSpec,
  Message,
  StoreApp,
  ToolCallEntry,
} from '../types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface StreamFrame {
  text?: string;
  functionCalls?: ToolCallEntry[];
}

export function useGemini() {
  const { state, dispatch } = useAppContext();
  const abortControllers = useRef<Map<AgentId, AbortController>>(new Map());

  const resetSession = useCallback((agentId: AgentId) => {
    const existing = abortControllers.current.get(agentId);
    if (existing) {
      existing.abort();
      abortControllers.current.delete(agentId);
    }
  }, []);

  const sendMessage = useCallback(
    async (agentId: AgentId, text: string) => {
      const agentDef = getAgent(agentId, state.settings.agentOverrides);

      const userMsg: Message = {
        id: generateId(),
        agentId,
        role: 'user',
        content: text,
        timestamp: new Date(),
      };
      dispatch({ type: 'ADD_MESSAGE', payload: userMsg });

      const agentMsgId = generateId();
      const agentMsg: Message = {
        id: agentMsgId,
        agentId,
        role: 'agent',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        toolCalls: [],
      };
      dispatch({ type: 'ADD_MESSAGE', payload: agentMsg });
      dispatch({ type: 'SET_AGENT_STATUS', payload: { agentId, status: 'processing' } });

      const controller = new AbortController();
      abortControllers.current.set(agentId, controller);

      const startTime = performance.now();
      let accumulatedReply = '';

      const executeToolCall = async (call: ToolCallEntry): Promise<unknown> => {
        const args = (call.args ?? {}) as Record<string, unknown>;

        if (call.name === 'getDockerLogs') {
          const res = await apiFetch('/api/docker/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return res.json();
        }

        if (call.name === 'editDockerConfig') {
          const spec = args as unknown as DockerCreateSpec;
          if (spec.name) {
            const nameClean = spec.name.replace(/^\//, '');
            await apiFetch('/api/docker/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: nameClean, action: 'rm' }),
            });
            spec.name = nameClean;
          }
          const res = await apiFetch('/api/docker/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(spec),
          });
          return res.json();
        }

        if (call.name === 'manageDockerContainer') {
          const res = await apiFetch('/api/docker/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return res.json();
        }

        if (call.name === 'redeployContainer') {
          const res = await apiFetch('/api/docker/redeploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: String(args.id ?? ''),
              pullFirst: Boolean(args.pullFirst),
            }),
          });
          return res.json();
        }

        if (call.name === 'getContainerAutoUpdates') {
          const res = await apiFetch('/api/docker/auto-update');
          return res.json();
        }

        if (call.name === 'setContainerAutoUpdate') {
          const name = String(args.name ?? '').replace(/^\//, '');
          const res = await apiFetch(`/api/docker/auto-update/container/${encodeURIComponent(name)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled: Boolean(args.enabled),
              scheduleMode: args.scheduleMode === 'custom' ? 'custom' : 'global',
              cronExpression: typeof args.cronExpression === 'string' ? args.cronExpression : undefined,
            }),
          });
          return res.json();
        }

        if (call.name === 'triggerContainerAutoUpdate') {
          const res = await apiFetch('/api/docker/auto-update/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              containerName: typeof args.containerName === 'string' ? args.containerName : undefined,
              forceRecreate: Boolean(args.forceRecreate),
            }),
          });
          return res.json();
        }

        if (call.name === 'searchAppStore') {
          const query = String(args.query ?? '');
          const searchRes = await apiFetch('/api/store/apps');
          const allApps = (await searchRes.json()) as { apps?: StoreApp[] };
          if (allApps.apps) {
            const q = query.toLowerCase();
            const filtered = allApps.apps
              .filter(
                (app) =>
                  app.title?.toLowerCase().includes(q) ||
                  app.description?.toLowerCase().includes(q) ||
                  app.category?.toLowerCase().includes(q),
              )
              .slice(0, 5);
            return { results: filtered, total_found: filtered.length, query };
          }
          return { error: 'Failed to fetch store apps' };
        }

        if (call.name === 'listFiles') {
          const targetPath = typeof args.path === 'string' ? args.path : '';
          const lsRes = await apiFetch(
            `/api/fs/ls${targetPath ? `?path=${encodeURIComponent(targetPath)}` : ''}`,
          );
          return lsRes.json();
        }

        if (call.name === 'readFile') {
          const readRes = await apiFetch('/api/fs/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return readRes.json();
        }

        if (call.name === 'writeFile') {
          const writeRes = await apiFetch('/api/fs/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return writeRes.json();
        }

        if (call.name === 'runCSharpScript') {
          const runRes = await apiFetch('/api/docker/run-csx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...args,
              allowNetwork: state.settings.isSandboxNetworkEnabled || false,
            }),
          });
          return runRes.json();
        }

        if (call.name === 'updateHostOS') {
          const updateRes = await apiFetch('/api/system/host-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return updateRes.json();
        }

        if (call.name === 'listDockerContainers') {
          const lsRes = await apiFetch('/api/docker/list');
          return lsRes.json();
        }

        if (call.name === 'getDockerStats') {
          const statsRes = await apiFetch('/api/docker/stats');
          return statsRes.json();
        }

        if (call.name === 'scrapeWebPage') {
          const scrapeRes = await apiFetch('/api/tools/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return scrapeRes.json();
        }

        if (call.name === 'googleSearch') {
          const searchRes = await apiFetch('/api/tools/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return searchRes.json();
        }

        if (call.name === 'runTerminalCommand') {
          const execRes = await apiFetch('/api/terminal/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: String(args.command ?? ''), agent: agentId }),
          });
          return execRes.json();
        }

        if (call.name === 'scheduleTask') {
          const schedRes = await apiFetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId,
              prompt: String(args.prompt ?? ''),
              delayMinutes: Number(args.delayMinutes ?? 1),
            }),
          });
          return schedRes.json();
        }

        if (call.name === 'listCronJobs') {
          const res = await apiFetch('/api/cron/jobs');
          return res.json();
        }

        if (call.name === 'createCronJob') {
          const res = await apiFetch('/api/cron/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: String(args.name ?? ''),
              schedule: String(args.schedule ?? ''),
              agentId: typeof args.agentId === 'string' ? args.agentId : agentId,
              prompt: String(args.prompt ?? ''),
              enabled: args.enabled !== false,
            }),
          });
          return res.json();
        }

        if (call.name === 'deleteCronJob') {
          const id = String(args.id ?? '');
          const res = await apiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          });
          return res.json();
        }

        return { error: `Unknown tool: ${call.name}` };
      };

      const handleRequest = async (currentMessages: Message[]): Promise<void> => {
        const response = await apiFetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            messages: currentMessages,
            agentId,
            systemInstruction: `${agentDef.baseInstructions}\n\n${agentDef.systemPrompt}`,
            tools: [
              {
                functionDeclarations: [
                  {
                    name: 'getDockerLogs',
                    description:
                      'Fetches the recent logs (stdout/stderr) of a specified Docker container. Useful for diagnosing errors or checking status.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        id: { type: 'STRING', description: 'The container ID or name' },
                      },
                      required: ['id'],
                    },
                  },
                  {
                    name: 'editDockerConfig',
                    description:
                      'Deletes a container and re-creates it with new settings (image, ports, volumes, env overrides, restartPolicy). Pass the entire updated spec.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        image: { type: 'STRING' },
                        name: { type: 'STRING' },
                        restartPolicy: { type: 'STRING' },
                        ports: {
                          type: 'ARRAY',
                          items: {
                            type: 'OBJECT',
                            properties: { host: { type: 'STRING' }, container: { type: 'STRING' } },
                          },
                        },
                        volumes: {
                          type: 'ARRAY',
                          items: {
                            type: 'OBJECT',
                            properties: { host: { type: 'STRING' }, container: { type: 'STRING' } },
                          },
                        },
                        env: {
                          type: 'ARRAY',
                          items: {
                            type: 'OBJECT',
                            properties: { key: { type: 'STRING' }, value: { type: 'STRING' } },
                          },
                        },
                        resources: {
                          type: 'OBJECT',
                          properties: { cpus: { type: 'STRING' }, memory: { type: 'STRING' } },
                        },
                      },
                      required: ['image'],
                    },
                  },
                  {
                    name: 'manageDockerContainer',
                    description: 'Starts, stops, restarts, or removes a Docker container by ID or name.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        id: { type: 'STRING', description: 'The container ID or name' },
                        action: {
                          type: 'STRING',
                          enum: ['start', 'stop', 'restart', 'rm'],
                          description: 'The action to perform on the container',
                        },
                      },
                      required: ['id', 'action'],
                    },
                  },
                  {
                    name: 'redeployContainer',
                    description:
                      'Recreates a container with its existing configuration (optionally pulling the latest image first).',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        id: { type: 'STRING', description: 'The container ID or name' },
                        pullFirst: {
                          type: 'BOOLEAN',
                          description: 'Whether to pull the latest image before recreating',
                        },
                      },
                      required: ['id'],
                    },
                  },
                  {
                    name: 'getContainerAutoUpdates',
                    description:
                      'Reads global auto-update schedule configuration, per-container auto-update policies, and recent update history.',
                    parameters: { type: 'OBJECT', properties: {} },
                  },
                  {
                    name: 'setContainerAutoUpdate',
                    description:
                      'Configures automatic image pull and redeploy policy for a specific container.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        name: { type: 'STRING', description: 'The container name' },
                        enabled: { type: 'BOOLEAN', description: 'Enable or disable auto-updates' },
                        scheduleMode: {
                          type: 'STRING',
                          enum: ['global', 'custom'],
                          description: 'Use global schedule or a custom cron expression',
                        },
                        cronExpression: {
                          type: 'STRING',
                          description: 'Custom cron expression when scheduleMode is custom',
                        },
                      },
                      required: ['name', 'enabled'],
                    },
                  },
                  {
                    name: 'triggerContainerAutoUpdate',
                    description:
                      'Triggers an immediate image check and pull-redeploy run for a specific container or all enabled containers.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        containerName: {
                          type: 'STRING',
                          description: 'Optional container name (omit to run all enabled containers)',
                        },
                        forceRecreate: {
                          type: 'BOOLEAN',
                          description: 'Recreate even if the image digest is unchanged',
                        },
                      },
                    },
                  },
                  {
                    name: 'searchAppStore',
                    description:
                      'Searches the community app catalog for applications matching a query. Returns up to 5 matching apps.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        query: {
                          type: 'STRING',
                          description: 'Search term for app titles, categories, or descriptions.',
                        },
                      },
                      required: ['query'],
                    },
                  },
                  {
                    name: 'listFiles',
                    description: 'Lists files and directories at a given path.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        path: { type: 'STRING', description: 'The path to list' },
                      },
                    },
                  },
                  {
                    name: 'readFile',
                    description: 'Reads the text content of a file on the filesystem.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        path: { type: 'STRING', description: 'The path to the file to read' },
                      },
                      required: ['path'],
                    },
                  },
                  {
                    name: 'writeFile',
                    description: 'Writes text content to a file. Overwrites if it exists.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        path: { type: 'STRING', description: 'The path to the file to write' },
                        content: { type: 'STRING', description: 'The content to write' },
                      },
                      required: ['path', 'content'],
                    },
                  },
                  {
                    name: 'runCSharpScript',
                    description: state.isYoloMode
                      ? 'Executes C# script code (.csx) with elevated host mode enabled (network and host filesystem access).'
                      : 'Executes C# script code (.csx) inside an isolated offline Docker container.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        code: { type: 'STRING', description: 'Raw C# script code to execute.' },
                      },
                      required: ['code'],
                    },
                  },
                  {
                    name: 'updateHostOS',
                    description: 'Checks for and triggers a host-level OS update.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        action: {
                          type: 'STRING',
                          enum: ['check', 'start'],
                          description: 'Check for updates or start updating.',
                        },
                      },
                    },
                  },
                  {
                    name: 'listDockerContainers',
                    description: 'Returns a detailed list of all Docker containers, including stopped ones.',
                    parameters: { type: 'OBJECT', properties: {} },
                  },
                  {
                    name: 'getDockerStats',
                    description: 'Returns real-time resource usage statistics (CPU, Memory, Network I/O) for active containers.',
                    parameters: { type: 'OBJECT', properties: {} },
                  },
                  {
                    name: 'scrapeWebPage',
                    description: 'Fetches the text content of a web page URL.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        url: { type: 'STRING', description: 'The full URL of the page to scrape.' },
                      },
                      required: ['url'],
                    },
                  },
                  {
                    name: 'googleSearch',
                    description: 'Performs a web search to find current information.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        query: { type: 'STRING', description: 'The search term to look for.' },
                      },
                      required: ['query'],
                    },
                  },
                  {
                    name: 'runTerminalCommand',
                    description:
                      'Executes a command on the host OS. If POSIX utilities fail on Windows, use PowerShell commands.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        command: { type: 'STRING', description: 'The terminal command to execute' },
                      },
                      required: ['command'],
                    },
                  },
                  {
                    name: 'scheduleTask',
                    description: 'Schedules a one-time delayed prompt task for the agent.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        delayMinutes: {
                          type: 'NUMBER',
                          description: 'Delay in minutes before the prompt is sent.',
                        },
                        prompt: {
                          type: 'STRING',
                          description: 'Prompt to run when the delay elapses.',
                        },
                      },
                      required: ['delayMinutes', 'prompt'],
                    },
                  },
                  {
                    name: 'listCronJobs',
                    description: 'Lists all configured recurring cron jobs.',
                    parameters: { type: 'OBJECT', properties: {} },
                  },
                  {
                    name: 'createCronJob',
                    description: 'Creates a recurring cron job using a standard cron expression.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        name: { type: 'STRING', description: 'Descriptive job name' },
                        schedule: {
                          type: 'STRING',
                          description: 'Cron expression (e.g. "0 3 * * *")',
                        },
                        agentId: {
                          type: 'STRING',
                          description: 'Target agent ID (nav, comms, logistics, security)',
                        },
                        prompt: { type: 'STRING', description: 'Prompt executed on schedule' },
                        enabled: { type: 'BOOLEAN', description: 'Whether the job is active' },
                      },
                      required: ['name', 'schedule', 'agentId', 'prompt'],
                    },
                  },
                  {
                    name: 'deleteCronJob',
                    description: 'Deletes a recurring cron job by its ID.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        id: { type: 'STRING', description: 'ID of the cron job to delete' },
                      },
                      required: ['id'],
                    },
                  },
                ],
              },
            ],
          }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || 'AI service communication failure.');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Stream reader unavailable.');

        const decoder = new TextDecoder();
        let buffer = '';
        const functionCallsToExecute: ToolCallEntry[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const rawJson = line.slice(6).trim();
            if (!rawJson) continue;
            try {
              const data = JSON.parse(rawJson) as StreamFrame;
              if (data.text) {
                accumulatedReply += data.text;
                dispatch({
                  type: 'UPDATE_STREAMING_MESSAGE',
                  payload: { agentId, id: agentMsgId, chunk: data.text },
                });
              }
              if (data.functionCalls && data.functionCalls.length > 0) {
                functionCallsToExecute.push(...data.functionCalls);
                dispatch({
                  type: 'UPDATE_STREAMING_MESSAGE',
                  payload: { agentId, id: agentMsgId, toolCalls: data.functionCalls },
                });
              }
            } catch (parseErr: unknown) {
              console.warn('Skipping malformed SSE chunk:', parseErr);
            }
          }
        }

        if (functionCallsToExecute.length > 0) {
          dispatch({
            type: 'UPDATE_STREAMING_MESSAGE',
            payload: {
              agentId,
              id: agentMsgId,
              chunk: `\n\n> \`Executing ${functionCallsToExecute.length} system tools...\`\n`,
            },
          });

          const functionResponses: Message[] = [];
          for (const call of functionCallsToExecute) {
            try {
              const result = await executeToolCall(call);
              functionResponses.push({
                id: generateId(),
                agentId,
                role: 'agent',
                content: `TOOL_RESPONSE:${call.name}:${JSON.stringify(result)}`,
                timestamp: new Date(),
              });
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              functionResponses.push({
                id: generateId(),
                agentId,
                role: 'agent',
                content: `TOOL_ERROR:${call.name}:${errMsg}`,
                timestamp: new Date(),
              });
            }
          }

          await handleRequest([
            ...currentMessages,
            {
              id: agentMsgId,
              role: 'agent',
              content: accumulatedReply,
              agentId,
              timestamp: new Date(),
            },
            ...functionResponses,
          ]);
        }
      };

      try {
        const currentHistory = state.conversations[agentId] || [];
        await handleRequest([...currentHistory, userMsg]);

        const latencyMs = Math.round(performance.now() - startTime);
        dispatch({
          type: 'UPDATE_METRICS',
          payload: { lastLatencyMs: latencyMs, model: state.settings.model },
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const errorText = err instanceof Error ? err.message : 'Unknown error occurred';
        dispatch({
          type: 'UPDATE_STREAMING_MESSAGE',
          payload: {
            agentId,
            id: agentMsgId,
            chunk: `\n⚠ Request failed: ${errorText}`,
          },
        });
      } finally {
        abortControllers.current.delete(agentId);
        dispatch({ type: 'FINISH_STREAMING', payload: { agentId, id: agentMsgId } });
        dispatch({ type: 'SET_AGENT_STATUS', payload: { agentId, status: 'online' } });
      }
    },
    [
      dispatch,
      state.conversations,
      state.isYoloMode,
      state.settings.agentOverrides,
      state.settings.isSandboxNetworkEnabled,
      state.settings.model,
    ],
  );

  return { sendMessage, resetSession };
}
