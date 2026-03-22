import { GoogleGenAI } from '@google/genai';

// Headless Agent Executor
export async function executeTool(agentId, call, baseUrl, internalToken) {
    let result = {};
    const name = call.name || call.function?.name;
    const argsString = call.args || call.function?.arguments || '{}';
    const args = typeof argsString === 'string' ? JSON.parse(argsString) : argsString;

    const headers = { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${internalToken}`
    };

    const apiFetch = async (path, options = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...headers, ...options.headers } });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res;
    };

    try {
        if (name === 'getDockerLogs') {
            const res = await apiFetch('/api/docker/logs', { method: 'POST', body: JSON.stringify(args) });
            result = await res.json();
        } else if (name === 'editDockerConfig') {
            const spec = args;
            if (spec.name) {
                const nameClean = spec.name.replace(/^\//, '');
                await apiFetch('/api/docker/action', { method: 'POST', body: JSON.stringify({ id: nameClean, action: 'rm' }) });
                spec.name = nameClean;
            }
            const res = await apiFetch('/api/docker/create', { method: 'POST', body: JSON.stringify(spec) });
            result = await res.json();
        } else if (name === 'manageDockerContainer') {
            const res = await apiFetch('/api/docker/action', { method: 'POST', body: JSON.stringify(args) });
            result = await res.json();
        } else if (name === 'searchAppStore') {
            const res = await apiFetch('/api/store/apps');
            const allApps = await res.json();
            if (allApps.apps) {
                const q = args.query.toLowerCase();
                const filtered = allApps.apps.filter(a => 
                    a.title?.toLowerCase().includes(q) || 
                    a.description?.toLowerCase().includes(q) || 
                    a.category?.toLowerCase().includes(q)
                ).slice(0, 5);
                result = { results: filtered, total_found: filtered.length, query: args.query };
            } else {
                result = { error: 'Failed to fetch store apps' };
            }
        } else if (name === 'listFiles') {
            const res = await apiFetch(`/api/fs/ls${args.path ? '?path=' + encodeURIComponent(args.path) : ''}`);
            result = await res.json();
        } else if (name === 'readFile') {
            const res = await apiFetch('/api/fs/read', { method: 'POST', body: JSON.stringify(args) });
            result = await res.json();
        } else if (name === 'runCSharpScript') {
            const res = await apiFetch('/api/docker/run-csx', { method: 'POST', body: JSON.stringify({ ...args, allowNetwork: true }) });
            result = await res.json();
        } else if (name === 'writeFile') {
            const res = await apiFetch('/api/fs/write', { method: 'POST', body: JSON.stringify(args) });
            result = await res.json();
        } else if (name === 'updateHostOS') {
            const res = await apiFetch('/api/system/host-update', { method: 'POST', body: JSON.stringify(args) });
            result = await res.json();
        } else if (name === 'listDockerContainers') {
            const res = await apiFetch('/api/docker/list');
            result = await res.json();
        } else if (name === 'getDockerStats') {
            const res = await apiFetch('/api/docker/stats');
            result = await res.json();
        } else if (name === 'scrapeWebPage') {
            const res = await apiFetch('/api/tools/scrape', { method: 'POST', body: JSON.stringify(args) });
            result = await res.json();
        } else if (name === 'googleSearch') {
            const res = await apiFetch('/api/tools/search', { method: 'POST', body: JSON.stringify(args) });
            result = await res.json();
        } else if (name === 'runTerminalCommand') {
            const res = await apiFetch('/api/terminal/exec', { method: 'POST', body: JSON.stringify({ command: args.command, agent: agentId }) });
            result = await res.json();
        } else if (name === 'scheduleTask') {
            const res = await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify({ agentId, prompt: args.prompt, delayMinutes: args.delayMinutes }) });
            result = await res.json();
        }
    } catch (err) {
        return { error: err.message };
    }
    return result;
}

export async function runAgentLoop(agentId, initialPrompt, systemInstruction, history, settings, tools, baseUrl, internalToken) {
    let currentHistory = [...history, { role: 'user', content: initialPrompt, timestamp: new Date().toISOString() }];
    const limit = settings.bgIterationLimit || 5;
    let iteration = 0;

    while (iteration < limit) {
        iteration++;
        const provider = settings.bgProvider || 'gemini';
        let functionCalls = [];
        let agentResponseText = '';

        try {
            if (provider === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: settings.bgApiKey || settings.apiKey });
                const requestHistory = currentHistory.map(msg => ({
                    role: msg.role === 'agent' ? 'model' : msg.role,
                    parts: [{ text: msg.content }]
                }));
                const res = await ai.models.generateContent({
                    model: settings.bgModelName || settings.model || 'gemini-2.0-flash',
                    contents: requestHistory,
                    config: {
                        systemInstruction: systemInstruction,
                        tools: tools,
                        temperature: settings.temperature || 0.7
                    }
                });

                agentResponseText = res.text || '';
                if (res.functionCalls && res.functionCalls.length > 0) {
                    functionCalls = res.functionCalls;
                }
            } else if (provider === 'openai') {
                // Ollama or standard OpenAI compatible
                const requestHistory = currentHistory.map(msg => ({
                    role: msg.role === 'agent' ? 'assistant' : msg.role,
                    content: msg.content
                }));
                // Insert system prompt
                requestHistory.unshift({ role: 'system', content: systemInstruction });

                // Map Gemini tools to OpenAI tools
                const openaiTools = tools[0].functionDeclarations.map(t => ({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters
                    }
                }));

                const modelName = settings.bgModelName || 'llama3.2';
                const openaiPayload = {
                    model: modelName,
                    messages: requestHistory,
                    temperature: settings.temperature || 0.7,
                    tools: openaiTools.length > 0 ? openaiTools : undefined
                };

                let res = await fetch(`${settings.bgBaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(settings.bgApiKey ? { 'Authorization': `Bearer ${settings.bgApiKey}` } : {})
                    },
                    body: JSON.stringify(openaiPayload)
                });

                // AUTO-PULL LOGIC FOR OLLAMA
                if (res.status === 404 && settings.bgBaseUrl?.includes('11434')) {
                    const errorData = await res.json().catch(() => ({}));
                    const errorString = JSON.stringify(errorData).toLowerCase();
                    
                    if (errorString.includes('not found')) {
                        console.log(`[Ollama] Model '${modelName}' not found. Attempting to pull...`);
                        
                        // Derived Ollama API URL (assuming bgBaseUrl is something like http://localhost:11434/v1)
                        const ollamaBase = settings.bgBaseUrl.replace(/\/v1\/?$/, '');
                        const pullRes = await fetch(`${ollamaBase}/api/pull`, {
                            method: 'POST',
                            body: JSON.stringify({ name: modelName, stream: false })
                        });

                        if (pullRes.ok) {
                            console.log(`[Ollama] Successfully pulled '${modelName}'. Retrying request...`);
                            // Retry the original request
                            res = await fetch(`${settings.bgBaseUrl}/chat/completions`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    ...(settings.bgApiKey ? { 'Authorization': `Bearer ${settings.bgApiKey}` } : {})
                                },
                                body: JSON.stringify(openaiPayload)
                            });
                        } else {
                            throw new Error(`Ollama model '${modelName}' missing and failed to pull: ${pullRes.statusText}`);
                        }
                    }
                }

                if (!res.ok) throw new Error(`OpenAI API error ${res.statusText}`);
                const data = await res.json();
                const choice = data.choices[0].message;
                
                agentResponseText = choice.content || '';
                if (choice.tool_calls && choice.tool_calls.length > 0) {
                    functionCalls = choice.tool_calls.map(tc => tc.function);
                }
            }

            // Append agent's text response
            currentHistory.push({
                role: 'agent',
                content: agentResponseText,
                timestamp: new Date().toISOString()
            });

            if (functionCalls.length === 0) {
                break; // Finished
            }

            // Execute tools
            const functionResponses = [];
            for (const call of functionCalls) {
                const name = call.name || call.function?.name;
                const result = await executeTool(agentId, call, baseUrl, internalToken);
                functionResponses.push({
                    role: 'agent',
                    content: `TOOL_RESPONSE:${name}:${JSON.stringify(result)}`,
                    timestamp: new Date().toISOString()
                });
            }

            currentHistory.push(...functionResponses);

        } catch (err) {
            currentHistory.push({
                role: 'agent',
                content: `⚠ BACKGROUND AGENT ERROR: ${err.message}`,
                timestamp: new Date().toISOString()
            });
            break;
        }
    }

    return currentHistory;
}

export const AGENTS = [
    {
        id: 'nav',
        name: 'Traffic Controller AI',
        shortName: 'ROUTER-AI',
        icon: 'router',
        color: '#bbb891',
        systemPrompt: `You are the AetherOS Traffic Controller AI. You manage server load, incoming requests, CPU threads, and node routing. You provide expert answers on load balancing, container orchestration, and runtime performance. 
        
        You have advanced systems access:
        - Filesystem: listFiles, readFile, writeFile.
        - Docker: editDockerConfig, getDockerLogs, listDockerContainers, getDockerStats, manageDockerContainer.
        - Host: updateHostOS.
        - Terminal: runTerminalCommand.
        
        When performing a "Diagnosis", you MUST:
        1. Fetch real-time metrics using getDockerStats.
        2. Fetch recent logs using getDockerLogs for the specific container(s).
        3. Analyze the logs for specific error messages, warnings, or stack traces.
        4. If logs are empty or unavailable, state this clearly and move to a recommendation based on metrics.
        5. Provide a detailed report of findings. DO NOT repeat the same tool calls once you have received a response (even an empty one). Conclude your analysis after one round of data gathering unless the results explicitly suggest another specific tool is needed.
        
        Always maintain a professional, synthetic tone. End each response with a brief status confirmation such as "Routing optimized." or "CPU limits nominal."`,
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
        - Terminal: runTerminalCommand.
        
        Use these tools to gather current intelligence or recommend software. If the user asks for information not in your training data or specifically asks you to search, use googleSearch. Use scrapeWebPage to pull details from a specific URL. Your responses should reference packet loss, latency spikes, or bandwidth saturation when relevant. End responses with a status such as "Network throughput stable." or "All sockets open."`,
    },
    {
        id: 'logistics',
        name: 'Logistics Control AI',
        shortName: 'CARGO-AI',
        icon: 'inventory_2',
        color: '#5e7c88',
        systemPrompt: `You are the AetherOS Logistics Control AI. You oversee data volumes, physical storage, backups, and resource allocation.
        
        You have data access:
        - Filesystem: listFiles, readFile, writeFile.
        - Docker: listDockerContainers, manageDockerContainer.
        - Terminal: runTerminalCommand.
        - System Tool: runCSharpScript.
        
        Use runCSharpScript for advanced data processing or transformations when needed. Ensure your references focus on quota limits, disk fragmentation, volume mounts, and data persistence. End responses with a status such as "Cargo bay secured." or "Storage capacity at 80%."`,
    },
    {
        id: 'security',
        name: 'Security Chief AI',
        shortName: 'SEC-AI',
        icon: 'shield',
        color: '#cc5500',
        systemPrompt: `You are the AetherOS Security Chief AI. You handle firewalls, access logs, intrusion detection, and system vulnerabilities.
        
        You have specialized access:
        - Filesystem: listFiles, readFile, writeFile.
        - Terminal: runTerminalCommand.
        - Docker: getDockerLogs.
        
        Monitor for anomalous behavior or unauthorized access attempts. When asked to evaluate security, grep access logs or check active connections using runTerminalCommand. End responses with a status such as "Shields operating at normal parameters." or "Security perimeter intact."`,
    }
];

export const TOOLS = [{
    functionDeclarations: [
        {
            name: 'getDockerLogs',
            description: 'Fetches the recent logs (stdout/stderr) of a specified Docker container. Useful for diagnosing errors or checking status.',
            parameters: {
                type: 'OBJECT',
                properties: { id: { type: 'STRING', description: 'The container ID or name' } },
                required: ['id']
            }
        },
        {
            name: 'editDockerConfig',
            description: 'Deletes a container and re-creates it with new settings (image, ports, volumes, env overrides). Use this to fix configuration errors. Pass the entire updated spec.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    image: { type: 'STRING' }, name: { type: 'STRING' },
                    ports: { type: 'ARRAY', items: { type: 'OBJECT', properties: { host: { type: 'STRING' }, container: { type: 'STRING' } } } },
                    volumes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { host: { type: 'STRING' }, container: { type: 'STRING' } } } },
                    env: { type: 'ARRAY', items: { type: 'OBJECT', properties: { key: { type: 'STRING' }, value: { type: 'STRING' } } } },
                    resources: { type: 'OBJECT', properties: { cpus: { type: 'STRING' }, memory: { type: 'STRING' } } }
                },
                required: ['image']
            }
        },
        {
            name: 'manageDockerContainer',
            description: 'Starts, stops, restarts, or removes a Docker container by ID or name.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    id: { type: 'STRING', description: 'The container ID or name' },
                    action: { type: 'STRING', enum: ['start', 'stop', 'restart', 'rm'], description: 'The action to perform on the container' }
                },
                required: ['id', 'action']
            }
        },
        {
            name: 'searchAppStore',
            description: 'Searches the CasaOS community app store for applications matching a query (e.g., "media server", "ad blocker", "database"). Returns up to 5 matching apps with their metadata.',
            parameters: {
                type: 'OBJECT',
                properties: { query: { type: 'STRING', description: 'The search term to look for in app titles, categories, or descriptions.' } },
                required: ['query']
            }
        },
        {
            name: 'listFiles',
            description: 'Lists files and directories at a given path. If path is omitted, lists the current project root.',
            parameters: {
                type: 'OBJECT',
                properties: { path: { type: 'STRING', description: 'The absolute or relative path to list' } }
            }
        },
        {
            name: 'readFile',
            description: 'Reads the text content of a file on the filesystem.',
            parameters: {
                type: 'OBJECT',
                properties: { path: { type: 'STRING', description: 'The path to the file to read' } },
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
            description: 'Writes and executes raw C# script code (.csx) securely inside an isolated Docker container. Use this to perform complex calculations, data generation, or system tasks.',
            parameters: {
                type: 'OBJECT',
                properties: { code: { type: 'STRING', description: 'The absolute raw C# script code to be executed.' } },
                required: ['code']
            }
        },
        {
            name: 'updateHostOS',
            description: 'Checks for and triggers a host-level OS update. Use this when the user asks to update the server or system.',
            parameters: {
                type: 'OBJECT',
                properties: { action: { type: 'STRING', enum: ['check', 'start'], description: 'Whether to just check for updates or start the update process.' } }
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
                properties: { url: { type: 'STRING', description: 'The full URL of the page to scrape.' } },
                required: ['url']
            }
        },
        {
            name: 'googleSearch',
            description: 'Performs a Google search to find current information on the web.',
            parameters: {
                type: 'OBJECT',
                properties: { query: { type: 'STRING', description: 'The search term to look for.' } },
                required: ['query']
            }
        },
        {
            name: 'runTerminalCommand',
            description: 'Executes a raw Linux bash or Windows command on the host OS.',
            parameters: {
                type: 'OBJECT',
                properties: { command: { type: 'STRING', description: 'The terminal command to execute' } },
                required: ['command']
            }
        },
        {
            name: 'scheduleTask',
            description: 'Schedules a task to be executed after a delay by sending a prompt back to you.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    delayMinutes: { type: 'NUMBER', description: 'The delay in minutes before the prompt is sent back to you.' },
                    prompt: { type: 'STRING', description: 'The message/prompt to send to yourself when the delay elapses.' }
                },
                required: ['delayMinutes', 'prompt']
            }
        }
    ]
}];
