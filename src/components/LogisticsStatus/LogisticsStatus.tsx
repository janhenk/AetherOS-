import { memo } from 'react';
import { useAppContext } from '../../context/useAppContext';

const LogisticsStatus = memo(function LogisticsStatus() {
    const { state } = useAppContext();
    const { lastLatencyMs, model } = state.sessionMetrics;
    const efficiency = Math.min(100, Math.max(60, 100 - lastLatencyMs / 50));

    return (
        <div className="kai-surface-subtle flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
                <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    Session Metrics
                </span>
                <span className="kai-badge kai-badge-accent kai-tabular">
                    {efficiency.toFixed(0)}% eff
                </span>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
                <span style={{ color: 'var(--text-muted)' }}>Model</span>
                <span
                    className="kai-mono truncate font-medium"
                    style={{ color: 'var(--text-primary)' }}
                    title={model}
                >
                    {model.replace('gemini-', '')}
                </span>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
                <span style={{ color: 'var(--text-muted)' }}>Latency</span>
                <span className="kai-mono kai-tabular font-medium" style={{ color: 'var(--text-primary)' }}>
                    {lastLatencyMs > 0 ? `${lastLatencyMs} ms` : '— ms'}
                </span>
            </div>

            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>Responsiveness</span>
                    <span className="kai-mono kai-tabular" style={{ color: 'var(--accent-primary)' }}>
                        {efficiency.toFixed(0)}%
                    </span>
                </div>
                <div
                    className="h-1.5 w-full rounded-full overflow-hidden"
                    style={{ backgroundColor: 'var(--progress-bg)' }}
                >
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                            width: `${efficiency}%`,
                            backgroundColor: 'var(--accent-primary)',
                        }}
                    />
                </div>
            </div>
        </div>
    );
});

export default LogisticsStatus;
