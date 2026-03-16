import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { apiFetch } from '../../utils/api';
import { useGemini } from '../../hooks/useGemini';
import CreateContainerModal from '../DockerManager/CreateContainerModal';
import AppStoreModal from '../AppStore/AppStoreModal';
import TerminalModal from '../Terminal/TerminalModal';
import AdvancedDeploymentModal from '../DockerManager/AdvancedDeploymentModal';
import { TacticalAlerts } from '../TacticalAlerts/TacticalAlerts';
import type { DockerCreateSpec } from '../../types';

function ApprovalPanel() {
    const { state, dispatch } = useAppContext();
    const [timeLeft, setTimeLeft] = useState(10);
    const approval = state.pendingApproval;

    useEffect(() => {
        if (!approval) return;
        setTimeLeft(10);
        const timer = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    dispatch({ type: 'RESOLVE_APPROVAL', payload: approval.id });
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [approval, dispatch]);

    if (!approval) return null;

    return (
        <div className="glass-panel mb-6 border-red-500/50 p-4 animate-pulse bg-red-500/10">
            <div className="flex items-center justify-between mb-4">
                <span className="text-red-500 font-bold tracking-widest text-xs">AUTHORIZATION REQUIRED</span>
                <span className="text-red-500 font-mono font-bold">{timeLeft}s</span>
            </div>
            <div className="text-[10px] text-white/70 mb-4 font-mono">
                <div className="text-red-400 mb-1 uppercase">{approval.action} REQUEST</div>
                <div className="bg-white/5 p-2 rounded border border-white/20 overflow-x-auto">
                    {JSON.stringify(approval.params, null, 2)}
                </div>
            </div>
            <div className="flex gap-2">
                <button
                    onClick={() => dispatch({ type: 'RESOLVE_APPROVAL', payload: approval.id })}
                    className="flex-1 bg-red-500 text-black text-[10px] font-bold py-2 rounded hover:brightness-110"
                >
                    AUTHORIZE ◈
                </button>
                <button
                    onClick={() => dispatch({ type: 'RESOLVE_APPROVAL', payload: approval.id })}
                    className="flex-1 bg-white/10 text-white text-[10px] font-bold py-2 rounded border border-white/20"
                >
                    ABORT
                </button>
            </div>
        </div>
    );
}

export default function SectorView() {
    const { state, dispatch } = useAppContext();
    const { sendMessage } = useGemini();
    const containers = state.serverState?.containers || [];
    const deployments = state.serverState?.deployments || [];
    const hostname = state.serverState?.hostname || 'AETHER-CORE-01';
    const osInfo = state.serverState?.osInfo || 'AetherOS v1.0';
    const dockerRunning = state.serverState?.dockerRunning ?? true;
    const ipAddress = state.serverState?.ipAddress || '127.0.0.1';

    const [currentTime, setCurrentTime] = useState(new Date());
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isAppStoreOpen, setAppStoreOpen] = useState(false);
    const [isTerminalOpen, setTerminalOpen] = useState(false);
    const [isAdvancedModalOpen, setAdvancedModalOpen] = useState(false);
    const [editingContainerSpec, setEditingContainerSpec] = useState<DockerCreateSpec | undefined>(undefined);
    const [isProcessing, setIsProcessing] = useState<string | null>(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Network Calculation Refs
    const lastNetworkState = useRef<{ inbound: number, outbound: number, time: number }>({ inbound: 0, outbound: 0, time: 0 });
    const [netSpeeds, setNetSpeeds] = useState({ inbound: { val: '0.00', unit: 'Mbps' }, outbound: { val: '0.00', unit: 'Mbps' } });

    useEffect(() => {
        if (state.serverState && state.serverState.networkInbound !== undefined && state.serverState.networkOutbound !== undefined) {
            const now = performance.now();
            const { networkInbound: currentIn, networkOutbound: currentOut } = state.serverState;

            if (lastNetworkState.current.time > 0) {
                const timeDiffSeconds = (now - lastNetworkState.current.time) / 1000;
                if (timeDiffSeconds > 0) {
                    // bytes/sec * 8 = bits/sec
                    const inBitsPerSec = ((currentIn - lastNetworkState.current.inbound) / timeDiffSeconds) * 8;
                    const outBitsPerSec = ((currentOut - lastNetworkState.current.outbound) / timeDiffSeconds) * 8;

                    const formatSpeed = (bps: number) => {
                        const positiveBps = Math.max(0, bps); // prevent negative glitch
                        if (positiveBps > 1000000000) return { val: (positiveBps / 1000000000).toFixed(2), unit: 'Gbps' };
                        if (positiveBps > 1000000) return { val: (positiveBps / 1000000).toFixed(2), unit: 'Mbps' };
                        return { val: (positiveBps / 1000).toFixed(2), unit: 'Kbps' };
                    };

                    setNetSpeeds({
                        inbound: formatSpeed(inBitsPerSec),
                        outbound: formatSpeed(outBitsPerSec)
                    });
                }
            }
            lastNetworkState.current = { inbound: currentIn, outbound: currentOut, time: now };
        }
    }, [state.serverState?.networkInbound, state.serverState?.networkOutbound]);

    const handleStartDocker = async () => {
        setIsProcessing('docker-start');
        try {
            await fetch('/api/docker/start-service', { method: 'POST' });
        } catch (err) {
            console.error(err);
        } finally {
            setIsProcessing(null);
        }
    };

    const handleDiagnose = () => {
        if (containers.length === 0) return;
        
        // Comprehensive health check message
        const containerNames = containers.map(c => c.name.replace(/^\//, '')).join(', ');
        const prompt = `Perform a comprehensive health check on all systems. Current Docker Nodes: ${containerNames}. Please check metrics, logs, and statuses for any anomalies.`;

        dispatch({ type: 'SELECT_AGENT', payload: 'nav' }); // ROUTER-AI for system diagnostics
        sendMessage('nav', prompt);
    };

    const handleDiagnoseNode = (id: string, name: string) => {
        const cleanName = name.replace(/^\//, '');
        const prompt = `Diagnose Docker node: ${cleanName} (${id.substring(0, 8)}). Check recent logs and resource usage for this specific container.`;

        dispatch({ type: 'SELECT_AGENT', payload: 'nav' });
        sendMessage('nav', prompt);
    };

    const handleDockerAction = async (id: string, action: string) => {
        try {
            setIsProcessing(id);
            await fetch('/api/docker/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, action })
            });
        } catch (err) {
            console.error(err);
        } finally {
            setIsProcessing(null);
        }
    };

    const handleContainerSubmit = async (spec: DockerCreateSpec) => {
        // If we were editing, delete the old one first
        if (editingContainerSpec && editingContainerSpec.name && spec.name === editingContainerSpec.name) {
            const oldContainer = containers.find(c => c.name === editingContainerSpec.name || c.name === '/' + editingContainerSpec.name);
            if (oldContainer) {
                await fetch('/api/docker/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: oldContainer.id, action: 'rm' })
                });
            }
        }
        await fetch('/api/docker/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(spec)
        });
    };
    // No more activeScenario or gameState checks needed.

    return (
        <div className="flex flex-col gap-6">
            <div className="relative overflow-hidden rounded-xl bg-slate-800 min-h-[260px] group flex flex-col shadow-xl">
                <div
                    className="absolute inset-0 z-0 animate-pan-slow opacity-60"
                    style={{
                        backgroundImage: "url('/nebula_grid.png')",
                        backgroundSize: '120% 120%'
                    }}
                ></div>
                <div className="absolute inset-0 z-10 bg-gradient-to-t from-background-dark via-background-dark/40 to-transparent"></div>
                <div className="absolute inset-0 z-20 flex flex-col justify-between p-6">
                    <div className="flex flex-col gap-3">
                        <div className="glass-panel rounded-lg px-4 py-2 border-primary/20 backdrop-blur-md self-start flex gap-6">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-primary">Hostname</p>
                                <h2 className="text-xl font-bold text-white tracking-wide">{hostname}</h2>
                                <p className="text-[10px] font-mono text-emerald-400 mt-0.5">{ipAddress}</p>
                            </div>
                            <div className="border-l border-primary/20 pl-6">
                                <p className="text-[10px] uppercase tracking-widest text-primary">OS / Kernel</p>
                                <p className="text-sm font-bold text-slate-200 tracking-wide mt-1">{osInfo}</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-end justify-between mt-auto">
                        <div className="flex gap-6">
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.2em] text-white/70">Inbound</p>
                                <p className="text-xl font-bold text-white drop-shadow-md">{netSpeeds.inbound.val} <span className="text-xs font-light text-primary">{netSpeeds.inbound.unit}</span></p>
                            </div>
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.2em] text-white/70">Outbound</p>
                                <p className="text-xl font-bold text-white drop-shadow-md">{netSpeeds.outbound.val} <span className="text-xs font-light text-primary">{netSpeeds.outbound.unit}</span></p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-right">
                                <p className="text-[9px] uppercase tracking-[0.2em] text-white/70">{currentTime.toLocaleDateString()}</p>
                                <p className="text-xl font-mono font-bold text-white drop-shadow-md">{currentTime.toLocaleTimeString()}</p>
                            </div>
                            <div className="h-10 w-10 flex items-center justify-center rounded-full border border-primary/40 bg-primary/20 neon-aura-primary backdrop-blur-md">
                                <span className="material-symbols-outlined text-primary text-xl">schedule</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <ApprovalPanel />

            <TacticalAlerts />

            <div className="glass-panel rounded-xl p-5">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-wide">AetherOS Core Server</h3>
                        <p className="text-[10px] text-white/50 uppercase tracking-widest">Instance Type: {state.serverState?.hostname || 'AETHER-CORE-01'}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-bold text-primary capitalize tracking-widest">Online</p>
                    </div>
                </div>

                <div className="relative border border-primary/20 rounded-lg p-3 bg-primary/5">
                    <div className="text-xs text-white/80 font-mono leading-relaxed line-clamp-4">
                        Primary compute cluster responsible for handling real-time API integrations, LLM request routing, and deep learning model inference. Cluster health is optimal. No anomalous traffic detected in the past 24 hours.
                    </div>
                </div>
            </div>

            <div className="glass-panel rounded-xl p-5 flex flex-col justify-between">
                <div>
                    <h3 className="text-sm font-bold text-white mb-1 tracking-wide">Quick Actions</h3>
                    <p className="text-[10px] text-white/50 mb-4 uppercase tracking-widest">Situation Driven Responses</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {!dockerRunning && (
                        <button onClick={handleStartDocker} disabled={isProcessing === 'docker-start'} className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 transition-all hover:bg-amber-500/20 group">
                            <span className={`material-symbols-outlined text-amber-500 text-sm ${isProcessing === 'docker-start' ? 'animate-spin' : ''}`}>{isProcessing === 'docker-start' ? 'sync' : 'power_settings_new'}</span>
                            <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Start Engine</span>
                        </button>
                    )}
                    {containers.length > 0 && (
                        <button onClick={handleDiagnose} className="flex items-center gap-2 rounded-lg border border-primary/10 bg-primary/5 p-2 transition-all hover:bg-primary/20 group">
                            <span className="material-symbols-outlined text-primary text-sm group-hover:animate-pulse">troubleshoot</span>
                            <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Diagnose AI</span>
                        </button>
                    )}
                    <button className="flex items-center gap-2 rounded-lg border border-primary/10 bg-primary/5 p-2 transition-all hover:bg-primary/20">
                        <span className="material-symbols-outlined text-primary text-sm">refresh</span>
                        <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Reboot Host</span>
                    </button>
                    <button onClick={() => setTerminalOpen(true)} className="flex items-center gap-2 rounded-lg border border-primary/10 bg-primary/5 p-2 transition-all hover:bg-primary/20">
                        <span className="material-symbols-outlined text-primary text-sm">terminal</span>
                        <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Subspace Terminal</span>
                    </button>
                    <button className="flex items-center gap-2 rounded-lg border border-secondary/10 bg-secondary/5 p-2 transition-all hover:bg-secondary/20 hover:neon-aura-secondary">
                        <span className="material-symbols-outlined text-secondary text-sm">gpp_bad</span>
                        <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Kill Switch</span>
                    </button>
                </div>
            </div>

            <div className="glass-panel rounded-xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-wide">Docker Nodes</h3>
                        <p className="text-[10px] text-white/50 uppercase tracking-widest">{containers.length} provisioned instances</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setAppStoreOpen(true)}
                            className="material-symbols-outlined text-primary text-xl opacity-80 hover:text-white hover:opacity-100 transition-colors"
                            title="Open AetherOS App Grid"
                        >apps</button>
                        <button
                            onClick={() => setAdvancedModalOpen(true)}
                            className="material-symbols-outlined text-amber-500 text-xl opacity-80 hover:text-white hover:opacity-100 transition-colors"
                            title="Advanced Compose Deployment"
                        >layers</button>
                        <button
                            onClick={() => { setEditingContainerSpec(undefined); setCreateModalOpen(true); }}
                            className="material-symbols-outlined text-primary text-xl opacity-80 hover:text-white hover:opacity-100 transition-colors"
                            title="Deploy New Node"
                        >add_circle</button>
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    {deployments.map((deployment: any) => (
                        <div key={deployment.id} className="group flex items-center justify-between border-b border-primary/10 pb-2 last:border-0 last:pb-0">
                            <div className="flex items-center gap-3">
                                <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse neon-aura-primary"></div>
                                <div>
                                    <p className="text-xs font-bold text-slate-200 truncate max-w-[120px]" title={deployment.name}>{deployment.name}</p>
                                    <p className="text-[9px] text-blue-400 font-mono uppercase truncate max-w-[160px]" title={deployment.status}>Deploying &bull; {deployment.status}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[14px] text-blue-400 animate-spin">sync</span>
                            </div>
                        </div>
                    ))}
                    {containers.map((container) => (
                        <div key={container.id} className="group flex items-center justify-between border-b border-primary/10 pb-2 last:border-0 last:pb-0">
                            <div className="flex items-center gap-3">
                                <div className={`h-2 w-2 rounded-full ${container.status === 'running' ? 'bg-emerald-500 neon-aura-primary' :
                                    container.status === 'restarting' ? 'bg-amber-400' :
                                        'bg-red-500 neon-aura-secondary'
                                    } ${isProcessing === container.id ? 'animate-pulse' : ''}`}></div>
                                <div>
                                    <p className="text-xs font-bold text-slate-200 truncate max-w-[120px]" title={container.name}>{container.name}</p>
                                    <p className="text-[9px] text-white/40 font-mono uppercase truncate">{container.id.substring(0, 8)} &bull; {container.status}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Hover Actions */}
                                <div className="hidden group-hover:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {container.status !== 'running' ? (
                                        <button onClick={() => handleDockerAction(container.id, 'start')} disabled={isProcessing === container.id} className="material-symbols-outlined text-[14px] text-emerald-400 hover:text-emerald-300 pointer transition-colors" title="Start">play_arrow</button>
                                    ) : (
                                        <button onClick={() => handleDockerAction(container.id, 'stop')} disabled={isProcessing === container.id} className="material-symbols-outlined text-[14px] text-amber-400 hover:text-amber-300 pointer transition-colors" title="Stop">stop</button>
                                    )}
                                    <button onClick={() => handleDockerAction(container.id, 'restart')} disabled={isProcessing === container.id} className="material-symbols-outlined text-[14px] text-primary hover:text-white pointer transition-colors" title="Restart">refresh</button>
                                    <button onClick={() => handleDiagnoseNode(container.id, container.name)} className="material-symbols-outlined text-[14px] text-amber-400 hover:text-amber-300 pointer transition-colors" title="AI Diagnose Node">troubleshoot</button>
                                    <button onClick={async () => {
                                        setIsProcessing(container.id);
                                        try {
                                            const response = await apiFetch('/api/docker/inspect', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ id: container.id })
                                            });
                                            if (response.ok) {
                                                const liveSpec = await response.json();
                                                setEditingContainerSpec(liveSpec);
                                                setCreateModalOpen(true);
                                            }
                                        } catch (err) {
                                            console.error('Failed to inspect container', err);
                                        } finally {
                                            setIsProcessing(null);
                                        }
                                    }} disabled={isProcessing === container.id} className="material-symbols-outlined text-[14px] text-slate-400 hover:text-white pointer transition-colors" title="Edit/Re-deploy">edit</button>
                                    <button onClick={() => handleDockerAction(container.id, 'rm')} disabled={isProcessing === container.id} className="material-symbols-outlined text-[14px] text-red-500 hover:text-red-400 pointer ml-1 transition-colors" title="Force Delete">delete</button>
                                </div>
                                <p className="text-[10px] text-slate-400 font-mono group-hover:hidden">{container.uptime}</p>
                            </div>
                        </div>
                    ))}
                    {containers.length === 0 && deployments.length === 0 && (
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest text-center py-4">No Nodes Provisioned</p>
                    )}
                </div>
            </div>

            <CreateContainerModal
                isOpen={isCreateModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onSubmit={handleContainerSubmit}
                initialData={editingContainerSpec}
            />

            <AdvancedDeploymentModal
                 isOpen={isAdvancedModalOpen}
                 onClose={() => setAdvancedModalOpen(false)}
                 onDeployed={() => {}} // Polling handled by AppContext
            />

            {isAppStoreOpen && (
                <AppStoreModal
                    onClose={() => setAppStoreOpen(false)}
                    onDeployed={() => { }} // Polling in AppContext handles refreshing the nodes list automatically
                />
            )}

            <TerminalModal
                isOpen={isTerminalOpen}
                onClose={() => setTerminalOpen(false)}
            />
        </div>
    );
};
