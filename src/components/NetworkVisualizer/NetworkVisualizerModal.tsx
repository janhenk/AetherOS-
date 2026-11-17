import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { useTheme } from '../../theme/useTheme';
import type { Theme } from '../../theme/useTheme';

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

const THEME_NET_PALETTES: Record<Theme, string[]> = {
    dark: ['#60A5FA', '#34D399', '#A78BFA', '#FBBF24', '#F472B6', '#38BDF8', '#FB923C', '#2DD4BF'],
    light: ['#2563EB', '#0F766E', '#7C3AED', '#B45309', '#DB2777', '#0369A1', '#C2410C', '#047857'],
    subtle: ['#0F766E', '#1D4ED8', '#6D28D9', '#9A3412', '#BE185D', '#0E7490', '#B45309', '#166534'],
    monochrome: ['#09090B', '#27272A', '#3F3F46', '#52525B', '#18181B', '#71717A'],
};

function getY(i: number, total: number, h: number): number {
    if (total === 1) return h / 2;
    return 50 + (i * (h - 100)) / (total - 1);
}

export default function NetworkVisualizerModal({ onClose }: Props) {
    const { theme } = useTheme();
    const [networks, setNetworks] = useState<DockerNetwork[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch('/api/docker/networks');
            if (!res.ok) throw new Error('Failed to fetch Docker networks');
            const data = (await res.json()) as { networks?: DockerNetwork[] };
            setNetworks(data.networks || []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to fetch Docker networks');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const palette = THEME_NET_PALETTES[theme] || THEME_NET_PALETTES.dark;

    const containerMap = new Map<string, { name: string; networkIds: string[] }>();
    networks.forEach((net) => {
        net.containers.forEach((c) => {
            const existing = containerMap.get(c.id);
            if (!existing) {
                containerMap.set(c.id, { name: c.name, networkIds: [net.id] });
            } else {
                existing.networkIds.push(net.id);
            }
        });
    });
    const containerList = Array.from(containerMap.entries());

    const rows = Math.max(networks.length, containerList.length, 3);
    const svgHeight = rows * 62 + 44;
    const svgWidth = 700;
    const netX = 118;
    const contX = 582;

    const netNodes = networks.map((net, i) => ({
        ...net,
        x: netX,
        y: getY(i, networks.length, svgHeight),
    }));
    const contNodes = containerList.map(([id, c], i) => ({
        id,
        ...c,
        x: contX,
        y: getY(i, containerList.length, svgHeight),
    }));

    const isNetDim = (netId: string) => {
        if (!selected || selected === netId) return false;
        const cont = containerMap.get(selected);
        if (cont && cont.networkIds.includes(netId)) return false;
        return true;
    };

    const isContDim = (contId: string) => {
        if (!selected || selected === contId) return false;
        const net = networks.find((n) => n.id === selected);
        if (net && net.containers.some((c) => c.id === contId)) return false;
        return true;
    };

    const isLineDim = (netId: string, contId: string) => {
        if (!selected) return false;
        if (selected === netId || selected === contId) return false;
        return true;
    };

    const handleClick = (id: string) => setSelected((prev) => (prev === id ? null : id));

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Network Topology"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="kai-modal" style={{ maxWidth: '52rem' }}>
                {/* Header */}
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-xl" style={{ color: 'var(--accent-primary)' }}>
                            hub
                        </span>
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                Network Topology
                            </h2>
                            <p className="text-xs kai-tabular" style={{ color: 'var(--text-muted)' }}>
                                {networks.length} {networks.length === 1 ? 'network' : 'networks'} &bull;{' '}
                                {containerList.length} {containerList.length === 1 ? 'container' : 'containers'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => {
                                void load();
                            }}
                            className="kai-btn kai-btn-ghost kai-btn-icon"
                            aria-label="Refresh network topology"
                            title="Refresh"
                        >
                            <span className={`material-symbols-outlined text-lg ${loading ? 'animate-spin' : ''}`}>
                                refresh
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="kai-btn kai-btn-ghost kai-btn-icon"
                            aria-label="Close network topology"
                        >
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="kai-modal-body flex flex-col gap-4">
                    {loading && (
                        <div className="kai-empty-state flex items-center justify-center gap-2 py-12">
                            <span className="material-symbols-outlined animate-spin" style={{ color: 'var(--accent-primary)' }}>
                                sync
                            </span>
                            <span>Loading Docker network topology...</span>
                        </div>
                    )}

                    {error && (
                        <div className="kai-alert kai-alert-error text-xs">{error}</div>
                    )}

                    {!loading && !error && networks.length === 0 && (
                        <div className="kai-empty-state">No Docker networks detected.</div>
                    )}

                    {!loading && !error && networks.length > 0 && (
                        <>
                            <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                                <span>Click any network or container node to highlight its connections</span>
                                {selected && (
                                    <button
                                        type="button"
                                        onClick={() => setSelected(null)}
                                        className="kai-btn kai-btn-ghost kai-btn-xs"
                                    >
                                        Clear filter
                                    </button>
                                )}
                            </div>

                            <div
                                className="rounded-lg border p-4 overflow-x-auto"
                                style={{
                                    backgroundColor: 'var(--bg-secondary)',
                                    borderColor: 'var(--border-subtle)',
                                }}
                            >
                                <svg
                                    width="100%"
                                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                                    style={{ overflow: 'visible', minWidth: '520px' }}
                                >
                                    <text
                                        x={netX}
                                        y={18}
                                        textAnchor="middle"
                                        fill="var(--text-muted)"
                                        fontSize={10}
                                        fontFamily="var(--font-mono)"
                                        fontWeight="600"
                                        letterSpacing="2"
                                    >
                                        NETWORKS
                                    </text>
                                    <text
                                        x={contX}
                                        y={18}
                                        textAnchor="middle"
                                        fill="var(--text-muted)"
                                        fontSize={10}
                                        fontFamily="var(--font-mono)"
                                        fontWeight="600"
                                        letterSpacing="2"
                                    >
                                        CONTAINERS
                                    </text>

                                    <line
                                        x1={netX + 64}
                                        y1={28}
                                        x2={contX - 64}
                                        y2={28}
                                        stroke="var(--border-subtle)"
                                        strokeWidth={1}
                                    />

                                    {/* Connection paths */}
                                    {netNodes.map((net, ni) =>
                                        net.containers.map((c) => {
                                            const cont = contNodes.find((cp) => cp.id === c.id);
                                            if (!cont) return null;
                                            const color = palette[ni % palette.length];
                                            const dim = isLineDim(net.id, c.id);
                                            const mx = (net.x + cont.x) / 2;
                                            return (
                                                <path
                                                    key={`${net.id}-${c.id}`}
                                                    d={`M ${net.x + 56} ${net.y} C ${mx} ${net.y}, ${mx} ${cont.y}, ${cont.x - 56} ${cont.y}`}
                                                    stroke={color}
                                                    strokeWidth={dim ? 1 : 2}
                                                    fill="none"
                                                    opacity={dim ? 0.14 : 0.72}
                                                    strokeDasharray={dim ? '4,4' : undefined}
                                                />
                                            );
                                        }),
                                    )}

                                    {/* Network nodes */}
                                    {netNodes.map((net, ni) => {
                                        const color = palette[ni % palette.length];
                                        const dim = isNetDim(net.id);
                                        const label = net.name.length > 15 ? `${net.name.slice(0, 14)}…` : net.name;
                                        return (
                                            <g
                                                key={net.id}
                                                onClick={() => handleClick(net.id)}
                                                style={{ cursor: 'pointer' }}
                                                opacity={dim ? 0.3 : 1}
                                            >
                                                <rect
                                                    x={net.x - 56}
                                                    y={net.y - 20}
                                                    width={112}
                                                    height={40}
                                                    rx={8}
                                                    fill="var(--bg-elevated)"
                                                    stroke={color}
                                                    strokeWidth={selected === net.id ? 2.5 : 1.5}
                                                />
                                                <text
                                                    x={net.x}
                                                    y={net.y - 3}
                                                    textAnchor="middle"
                                                    fill="var(--text-primary)"
                                                    fontSize={10}
                                                    fontFamily="var(--font-mono)"
                                                    fontWeight="600"
                                                >
                                                    {label}
                                                </text>
                                                <text
                                                    x={net.x}
                                                    y={net.y + 12}
                                                    textAnchor="middle"
                                                    fill="var(--text-muted)"
                                                    fontSize={8.5}
                                                    fontFamily="var(--font-mono)"
                                                >
                                                    {net.driver} · {net.containers.length}
                                                </text>
                                            </g>
                                        );
                                    })}

                                    {/* Container nodes */}
                                    {contNodes.map((cont) => {
                                        const dim = isContDim(cont.id);
                                        const firstNetIdx = networks.findIndex((n) =>
                                            n.containers.some((c) => c.id === cont.id),
                                        );
                                        const color = palette[Math.max(firstNetIdx, 0) % palette.length];
                                        const label = cont.name.replace(/^\//, '');
                                        const shortLabel = label.length > 15 ? `${label.slice(0, 14)}…` : label;
                                        const isMultiNet = cont.networkIds.length > 1;
                                        return (
                                            <g
                                                key={cont.id}
                                                onClick={() => handleClick(cont.id)}
                                                style={{ cursor: 'pointer' }}
                                                opacity={dim ? 0.28 : 1}
                                            >
                                                <rect
                                                    x={cont.x - 56}
                                                    y={cont.y - 18}
                                                    width={112}
                                                    height={36}
                                                    rx={18}
                                                    fill="var(--bg-elevated)"
                                                    stroke={color}
                                                    strokeWidth={selected === cont.id ? 2.5 : isMultiNet ? 2 : 1.5}
                                                    strokeDasharray={isMultiNet ? '4,2' : undefined}
                                                />
                                                <text
                                                    x={cont.x}
                                                    y={cont.y + 4}
                                                    textAnchor="middle"
                                                    fill="var(--text-primary)"
                                                    fontSize={9.5}
                                                    fontFamily="var(--font-mono)"
                                                    fontWeight="500"
                                                >
                                                    {shortLabel}
                                                </text>
                                                {isMultiNet && (
                                                    <text
                                                        x={cont.x + 48}
                                                        y={cont.y - 12}
                                                        textAnchor="middle"
                                                        fill={color}
                                                        fontSize={9}
                                                        fontFamily="var(--font-mono)"
                                                        fontWeight="700"
                                                    >
                                                        {cont.networkIds.length}
                                                    </text>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                            </div>

                            {/* Legend */}
                            <div
                                className="pt-3 border-t flex flex-wrap items-center gap-3"
                                style={{ borderColor: 'var(--border-subtle)' }}
                            >
                                {netNodes.map((net, ni) => {
                                    const color = palette[ni % palette.length];
                                    return (
                                        <button
                                            key={net.id}
                                            type="button"
                                            onClick={() => handleClick(net.id)}
                                            className="kai-btn kai-btn-xs kai-btn-ghost"
                                            style={{ opacity: isNetDim(net.id) ? 0.35 : 1 }}
                                        >
                                            <span
                                                className="h-2.5 w-2.5 rounded-sm shrink-0"
                                                style={{ backgroundColor: color }}
                                            />
                                            <span className="kai-mono">{net.name}</span>
                                            <span className="kai-tabular" style={{ color: 'var(--text-muted)' }}>
                                                ({net.containers.length})
                                            </span>
                                        </button>
                                    );
                                })}
                                {containerList.length > 0 && (
                                    <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
                                        Dashed border = multi-network container
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="kai-modal-footer">
                    <button
                        type="button"
                        onClick={onClose}
                        className="kai-btn kai-btn-secondary kai-btn-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
