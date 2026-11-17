import { memo, useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
    type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useAppContext } from '../../context/useAppContext';
import { useTheme } from '../../theme/useTheme';
import type { DiskUsage } from '../../types';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Title,
    Tooltip,
    Legend,
);

type TelemetryMetric = 'cpu' | 'ram' | 'storage';

interface ChartThemePalette {
    accent: string;
    accentSubtle: string;
    warning: string;
    danger: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    borderColor: string;
    bgElevated: string;
}

function readThemePalette(): ChartThemePalette {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return {
            accent: '#3B82F6',
            accentSubtle: 'rgba(59, 130, 246, 0.14)',
            warning: '#F59E0B',
            danger: '#EF4444',
            textPrimary: '#F3F4F6',
            textSecondary: '#9CA3AF',
            textMuted: '#6B7280',
            borderColor: 'rgba(255, 255, 255, 0.08)',
            bgElevated: '#12151B',
        };
    }

    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

    return {
        accent: read('--accent-primary', '#3B82F6'),
        accentSubtle: read('--accent-subtle', 'rgba(59, 130, 246, 0.14)'),
        warning: read('--warning-color', '#F59E0B'),
        danger: read('--danger-color', '#EF4444'),
        textPrimary: read('--text-primary', '#F3F4F6'),
        textSecondary: read('--text-secondary', '#9CA3AF'),
        textMuted: read('--text-muted', '#6B7280'),
        borderColor: read('--border-color', 'rgba(255, 255, 255, 0.08)'),
        bgElevated: read('--bg-elevated', '#12151B'),
    };
}

function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function getThresholdColor(usedPercent: number): string {
    if (usedPercent > 90) return 'var(--danger-color)';
    if (usedPercent > 75) return 'var(--warning-color)';
    return 'var(--accent-primary)';
}

function getThresholdBadgeClass(usedPercent: number): string {
    if (usedPercent > 90) return 'kai-badge kai-badge-danger';
    if (usedPercent > 75) return 'kai-badge kai-badge-warning';
    return 'kai-badge kai-badge-accent';
}

function formatGigabytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 GB';
    return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
}

const VesselStatus = memo(function VesselStatus() {
    const { state } = useAppContext();
    const { theme } = useTheme();
    const [activeChart, setActiveChart] = useState<TelemetryMetric | null>(null);
    const [palette, setPalette] = useState<ChartThemePalette>(() => readThemePalette());

    useEffect(() => {
        const rafId = window.requestAnimationFrame(() => {
            setPalette(readThemePalette());
        });
        return () => window.cancelAnimationFrame(rafId);
    }, [theme]);

    useEffect(() => {
        if (!activeChart) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setActiveChart(null);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeChart]);

    const ss = state.serverState;
    const cpuUsed = clampPercent(ss ? ss.cpuLoad : 0);
    const cpuIdle = clampPercent(100 - cpuUsed);
    const ramUsed = clampPercent(ss ? ss.ramUsed : 0);
    const ramFree = clampPercent(100 - ramUsed);

    const storageInfo = useMemo<{ usedPercent: number; disks: DiskUsage[] }>(() => {
        if (!ss || ss.storageUsed === undefined) {
            return { usedPercent: 0, disks: [] };
        }

        if (typeof ss.storageUsed === 'number') {
            return { usedPercent: clampPercent(ss.storageUsed), disks: [] };
        }

        if (typeof ss.storageUsed === 'object' && ss.storageUsed !== null) {
            const usedPercent = clampPercent(Number(ss.storageUsed.aggregatePercent));
            const disks = Array.isArray(ss.storageUsed.disks) ? ss.storageUsed.disks : [];
            return { usedPercent, disks };
        }

        return { usedPercent: 0, disks: [] };
    }, [ss]);

    const chartData = useMemo(() => {
        if (!activeChart || activeChart === 'storage') return null;

        const data = state.statsHistory.map((point) =>
            clampPercent(activeChart === 'cpu' ? point.cpu : point.ram),
        );
        const labels = state.statsHistory
            .map((_, idx) => `${state.statsHistory.length - 1 - idx}s`)
            .reverse();

        return {
            labels,
            datasets: [
                {
                    label: activeChart === 'cpu' ? 'CPU Load (%)' : 'Memory Usage (%)',
                    data,
                    borderColor: palette.accent,
                    backgroundColor: palette.accentSubtle,
                    tension: 0.2,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                },
            ],
        };
    }, [state.statsHistory, activeChart, palette]);

    const chartOptions = useMemo<ChartOptions<'line'>>(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 150 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: palette.bgElevated,
                    titleColor: palette.textPrimary,
                    bodyColor: palette.textSecondary,
                    borderColor: palette.borderColor,
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y ?? 0).toFixed(1)}%`,
                    },
                },
            },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    border: { color: palette.borderColor },
                    ticks: {
                        color: palette.textMuted,
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8,
                        font: { size: 10 },
                    },
                },
                y: {
                    display: true,
                    min: 0,
                    max: 100,
                    border: { color: palette.borderColor },
                    grid: { color: palette.borderColor },
                    ticks: {
                        color: palette.textMuted,
                        callback: (val) => `${val}%`,
                        font: { size: 10 },
                    },
                },
            },
        }),
        [palette],
    );

    const modalTitle =
        activeChart === 'cpu'
            ? 'CPU Load History'
            : activeChart === 'ram'
              ? 'Memory Usage History'
              : 'Disk Storage Breakdown';

    const activeValue =
        activeChart === 'cpu' ? cpuUsed : activeChart === 'ram' ? ramUsed : storageInfo.usedPercent;

    const modalContent = activeChart && (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={modalTitle}
            onClick={(e) => {
                if (e.target === e.currentTarget) setActiveChart(null);
            }}
        >
            <div className="kai-modal" style={{ maxWidth: '48rem' }}>
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3">
                        <span
                            className="material-symbols-outlined text-xl"
                            style={{ color: getThresholdColor(activeValue) }}
                        >
                            {activeChart === 'cpu'
                                ? 'memory'
                                : activeChart === 'ram'
                                  ? 'data_usage'
                                  : 'hard_drive'}
                        </span>
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {modalTitle}
                            </h2>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {activeChart === 'storage'
                                    ? `${storageInfo.disks.length} mounted ${storageInfo.disks.length === 1 ? 'volume' : 'volumes'}`
                                    : `${state.statsHistory.length} samples in sliding telemetry buffer`}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`${getThresholdBadgeClass(activeValue)} kai-tabular`}>
                            {activeValue.toFixed(1)}% used
                        </span>
                        <button
                            type="button"
                            onClick={() => setActiveChart(null)}
                            className="kai-btn kai-btn-ghost kai-btn-icon"
                            aria-label="Close telemetry modal"
                        >
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>
                </div>

                <div className="kai-modal-body">
                    {activeChart === 'storage' ? (
                        <div className="flex flex-col gap-3">
                            {storageInfo.disks.length > 0 ? (
                                storageInfo.disks.map((disk, idx) => {
                                    const diskPercent = clampPercent(disk.percent);
                                    return (
                                        <div
                                            key={`${disk.device}-${disk.mount}-${idx}`}
                                            className="kai-surface-subtle flex flex-col gap-2"
                                        >
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div
                                                        className="text-sm font-semibold truncate"
                                                        style={{ color: 'var(--text-primary)' }}
                                                    >
                                                        {disk.mount}
                                                    </div>
                                                    <div
                                                        className="kai-mono text-xs truncate"
                                                        style={{ color: 'var(--text-muted)' }}
                                                    >
                                                        {disk.device}
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <span className={`${getThresholdBadgeClass(diskPercent)} kai-tabular`}>
                                                        {diskPercent.toFixed(1)}%
                                                    </span>
                                                    <div
                                                        className="kai-mono kai-tabular text-xs mt-1"
                                                        style={{ color: 'var(--text-secondary)' }}
                                                    >
                                                        {formatGigabytes(disk.used)} / {formatGigabytes(disk.total)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div
                                                className="h-2 w-full rounded-full overflow-hidden"
                                                style={{ backgroundColor: 'var(--progress-bg)' }}
                                            >
                                                <div
                                                    className="h-full rounded-full transition-all duration-300"
                                                    style={{
                                                        width: `${diskPercent}%`,
                                                        backgroundColor: getThresholdColor(diskPercent),
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="kai-empty-state">
                                    No per-mount disk telemetry is currently available.
                                </div>
                            )}
                        </div>
                    ) : (
                        <div
                            className="rounded-lg p-4 border"
                            style={{
                                height: '22rem',
                                backgroundColor: 'var(--bg-secondary)',
                                borderColor: 'var(--border-subtle)',
                            }}
                        >
                            {chartData && state.statsHistory.length > 0 ? (
                                <Line options={chartOptions} data={chartData} />
                            ) : (
                                <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
                                    Collecting telemetry samples...
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="kai-modal-footer justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {activeChart === 'storage'
                            ? `Aggregate capacity used: ${storageInfo.usedPercent.toFixed(1)}%`
                            : 'Thresholds: normal < 75%, warning > 75%, critical > 90%'}
                    </span>
                    <button
                        type="button"
                        onClick={() => setActiveChart(null)}
                        className="kai-btn kai-btn-secondary kai-btn-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );

    const cards: {
        key: TelemetryMetric;
        title: string;
        icon: string;
        usedPercent: number;
        subtitle: string;
    }[] = [
        {
            key: 'cpu',
            title: 'CPU Load',
            icon: 'memory',
            usedPercent: cpuUsed,
            subtitle: `${cpuIdle.toFixed(1)}% idle`,
        },
        {
            key: 'ram',
            title: 'Memory Usage',
            icon: 'data_usage',
            usedPercent: ramUsed,
            subtitle: `${ramFree.toFixed(1)}% free`,
        },
        {
            key: 'storage',
            title: 'Disk Storage',
            icon: 'hard_drive',
            usedPercent: storageInfo.usedPercent,
            subtitle:
                storageInfo.disks.length > 0
                    ? `${storageInfo.disks.length} ${storageInfo.disks.length === 1 ? 'disk' : 'disks'}`
                    : `${clampPercent(100 - storageInfo.usedPercent).toFixed(1)}% free`,
        },
    ];

    return (
        <section className="kai-surface" aria-label="System Telemetry">
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <span
                        className="material-symbols-outlined text-lg"
                        style={{ color: 'var(--accent-primary)' }}
                    >
                        monitoring
                    </span>
                    <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                        System Telemetry
                    </h2>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Click any metric for details
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {cards.map((card) => {
                    const barColor = getThresholdColor(card.usedPercent);
                    return (
                        <button
                            key={card.key}
                            type="button"
                            onClick={() => setActiveChart(card.key)}
                            className="kai-surface-subtle text-left flex flex-col gap-2.5 cursor-pointer transition-colors hover:border-[var(--border-strong)] focus:outline-none focus-visible:ring-2"
                            style={{ borderColor: 'var(--border-subtle)' }}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span
                                    className="inline-flex items-center gap-1.5 text-xs font-medium"
                                    style={{ color: 'var(--text-secondary)' }}
                                >
                                    <span className="material-symbols-outlined text-base" style={{ color: barColor }}>
                                        {card.icon}
                                    </span>
                                    {card.title}
                                </span>
                                <span
                                    className="kai-mono kai-tabular text-sm font-semibold"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {card.usedPercent.toFixed(1)}%
                                </span>
                            </div>

                            <div
                                className="h-2 w-full rounded-full overflow-hidden"
                                style={{ backgroundColor: 'var(--progress-bg)' }}
                            >
                                <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                        width: `${card.usedPercent}%`,
                                        backgroundColor: barColor,
                                    }}
                                />
                            </div>

                            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                                <span className="kai-tabular">{card.subtitle}</span>
                                <span className="inline-flex items-center gap-0.5">
                                    Inspect
                                    <span className="material-symbols-outlined text-xs">chevron_right</span>
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {activeChart && createPortal(modalContent, document.body)}
        </section>
    );
});

export default VesselStatus;
