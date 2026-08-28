import { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';

interface NetworkContainer {
    id: string;
    name: string;
    ipv4: string;
}

interface DockerNetwork {
    id: string;
    name: string;
    driver: string;
    scope: string;
    containers: NetworkContainer[];
}

interface Props {
    onClose: () => void;
}

const NET_COLORS = ['#34d3f3', '#c084fc', '#94fde1', '#fcd34d', '#f97316', '#ec4899', '#6ee7b7', '#a78bfa'];

function getY(i: number, total: number, h: number) {
    if (total === 1) return h / 2;
    return 50 + i * (h - 100) / (total - 1);
}

export default function NetworkVisualizerModal({ onClose }: Props) {
    const [networks, setNetworks] = useState<DockerNetwork[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch('/api/docker/networks');
            if (!res.ok) throw new Error('Failed to fetch networks');
            const data = await res.json();
            setNetworks(data.networks || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    // Build unified container list with their network memberships
    const containerMap = new Map<string, { name: string; networkIds: string[] }>();
    networks.forEach(net => {
        net.containers.forEach(c => {
            if (!containerMap.has(c.id)) {
                containerMap.set(c.id, { name: c.name, networkIds: [net.id] });
            } else {
                containerMap.get(c.id)!.networkIds.push(net.id);
            }
        });
    });
    const containerList = Array.from(containerMap.entries());

    const rows = Math.max(networks.length, containerList.length, 3);
    const svgHeight = rows * 60 + 40;
    const svgWidth = 680;
    const netX = 110;
    const contX = 570;

    const netNodes = networks.map((net, i) => ({ ...net, x: netX, y: getY(i, networks.length, svgHeight) }));
    const contNodes = containerList.map(([id, c], i) => ({ id, ...c, x: contX, y: getY(i, containerList.length, svgHeight) }));

    const isNetDim = (netId: string) => {
        if (!selected) return false;
        if (selected === netId) return false;
        // selected is a container id?
        const cont = containerMap.get(selected);
        if (cont && cont.networkIds.includes(netId)) return false;
        return true;
    };

    const isContDim = (contId: string) => {
        if (!selected) return false;
        if (selected === contId) return false;
        // selected is a network id?
        const net = networks.find(n => n.id === selected);
        if (net && net.containers.some(c => c.id === contId)) return false;
        return true;
    };

    const isLineDim = (netId: string, contId: string) => {
        if (!selected) return false;
        if (selected === netId || selected === contId) return false;
        const cont = containerMap.get(selected);
        if (cont && cont.networkIds.includes(netId) && selected === contId) return false;
        return true;
    };

    const handleClick = (id: string) => setSelected(prev => prev === id ? null : id);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div
                className="glass-panel rounded-2xl flex flex-col overflow-hidden border border-primary/20 shadow-2xl"
                style={{ width: 760, maxHeight: '85vh' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
                    <div>
                        <h2 className="text-sm font-bold text-white tracking-widest uppercase">Network Topology</h2>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">
                            {networks.length} networks &bull; {containerList.length} containers
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={load}
                            className="material-symbols-outlined text-primary/60 hover:text-primary transition-colors text-xl"
                            title="Refresh"
                        >refresh</button>
                        <button
                            onClick={onClose}
                            className="material-symbols-outlined text-white/40 hover:text-white transition-colors text-xl"
                        >close</button>
                    </div>
                </div>

                <div className="overflow-auto p-6 flex-1">
                    {loading && (
                        <div className="flex items-center justify-center py-20 gap-3">
                            <span className="material-symbols-outlined text-primary animate-spin">sync</span>
                            <span className="text-white/40 text-[11px] uppercase tracking-widest font-mono">Scanning subspace networks...</span>
                        </div>
                    )}
                    {error && (
                        <div className="text-red-400 text-xs font-mono p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                            {error}
                        </div>
                    )}
                    {!loading && !error && networks.length === 0 && (
                        <div className="text-center py-16 text-white/30 text-xs uppercase tracking-widest font-mono">
                            No Docker networks detected
                        </div>
                    )}
                    {!loading && !error && networks.length > 0 && (
                        <>
                            <p className="text-[10px] text-white/30 font-mono mb-3 uppercase tracking-widest">
                                Click a node to highlight its connections
                            </p>
                            <svg
                                width="100%"
                                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                                style={{ overflow: 'visible' }}
                            >
                                {/* Column headers */}
                                <text x={netX} y={18} textAnchor="middle" fill="rgba(52,211,243,0.4)" fontSize={8} fontFamily="monospace" letterSpacing="4">NETWORKS</text>
                                <text x={contX} y={18} textAnchor="middle" fill="rgba(52,211,243,0.4)" fontSize={8} fontFamily="monospace" letterSpacing="4">CONTAINERS</text>

                                {/* Center guide line */}
                                <line x1={netX + 50} y1={30} x2={contX - 50} y2={30} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
                                <line x1={netX + 50} y1={svgHeight - 10} x2={contX - 50} y2={svgHeight - 10} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />

                                {/* Connection lines */}
                                {netNodes.map((net, ni) =>
                                    net.containers.map(c => {
                                        const cont = contNodes.find(cp => cp.id === c.id);
                                        if (!cont) return null;
                                        const color = NET_COLORS[ni % NET_COLORS.length];
                                        const dim = isLineDim(net.id, c.id);
                                        const mx = (net.x + cont.x) / 2;
                                        return (
                                            <path
                                                key={`${net.id}-${c.id}`}
                                                d={`M ${net.x + 46} ${net.y} C ${mx} ${net.y}, ${mx} ${cont.y}, ${cont.x - 20} ${cont.y}`}
                                                stroke={color}
                                                strokeWidth={dim ? 0.8 : 1.5}
                                                fill="none"
                                                opacity={dim ? 0.1 : 0.55}
                                                strokeDasharray={dim ? '3,5' : undefined}
                                            />
                                        );
                                    })
                                )}

                                {/* Network nodes */}
                                {netNodes.map((net, ni) => {
                                    const color = NET_COLORS[ni % NET_COLORS.length];
                                    const dim = isNetDim(net.id);
                                    const label = net.name.length > 16 ? net.name.slice(0, 15) + '…' : net.name;
                                    return (
                                        <g key={net.id} onClick={() => handleClick(net.id)} style={{ cursor: 'pointer' }}>
                                            <rect
                                                x={net.x - 46} y={net.y - 20}
                                                width={92} height={40} rx={6}
                                                fill={`${color}18`}
                                                stroke={color}
                                                strokeWidth={dim ? 0.6 : 1.5}
                                                opacity={dim ? 0.3 : 1}
                                            />
                                            <text x={net.x} y={net.y - 5} textAnchor="middle" fill={color} fontSize={9} fontFamily="monospace" fontWeight="bold" opacity={dim ? 0.3 : 1}>
                                                {label}
                                            </text>
                                            <text x={net.x} y={net.y + 10} textAnchor="middle" fill={color} fontSize={7} fontFamily="monospace" opacity={dim ? 0.2 : 0.5}>
                                                {net.driver} · {net.containers.length}
                                            </text>
                                        </g>
                                    );
                                })}

                                {/* Container nodes */}
                                {contNodes.map((cont) => {
                                    const dim = isContDim(cont.id);
                                    const firstNetIdx = networks.findIndex(n => n.containers.some(c => c.id === cont.id));
                                    const color = NET_COLORS[Math.max(firstNetIdx, 0) % NET_COLORS.length];
                                    const label = cont.name.replace(/^\//, '');
                                    const shortLabel = label.length > 13 ? label.slice(0, 12) + '…' : label;
                                    const isMultiNet = cont.networkIds.length > 1;
                                    return (
                                        <g key={cont.id} onClick={() => handleClick(cont.id)} style={{ cursor: 'pointer' }}>
                                            <circle
                                                cx={cont.x} cy={cont.y} r={20}
                                                fill="rgba(10,14,18,0.8)"
                                                stroke={color}
                                                strokeWidth={dim ? 0.6 : isMultiNet ? 2 : 1.5}
                                                opacity={dim ? 0.25 : 1}
                                                strokeDasharray={isMultiNet ? '4,2' : undefined}
                                            />
                                            <text x={cont.x} y={cont.y + 4} textAnchor="middle" fill="rgba(226,232,240,0.9)" fontSize={8} fontFamily="monospace" opacity={dim ? 0.25 : 1}>
                                                {shortLabel}
                                            </text>
                                            {isMultiNet && (
                                                <text x={cont.x + 16} y={cont.y - 14} fill={color} fontSize={8} fontFamily="monospace" opacity={dim ? 0.2 : 0.8}>
                                                    {cont.networkIds.length}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>

                            {/* Legend */}
                            <div className="mt-5 pt-4 border-t border-white/5 flex flex-wrap gap-x-5 gap-y-2">
                                {netNodes.map((net, ni) => (
                                    <button
                                        key={net.id}
                                        onClick={() => handleClick(net.id)}
                                        className="flex items-center gap-2 text-[10px] font-mono hover:opacity-100 transition-opacity"
                                        style={{ opacity: isNetDim(net.id) ? 0.3 : 1 }}
                                    >
                                        <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: NET_COLORS[ni % NET_COLORS.length] }} />
                                        <span style={{ color: NET_COLORS[ni % NET_COLORS.length] }}>{net.name}</span>
                                        <span className="text-white/30">({net.containers.length})</span>
                                    </button>
                                ))}
                                {containerList.length > 0 && (
                                    <span className="text-white/20 text-[10px] font-mono ml-auto">dashed border = multi-network</span>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
