import { memo } from 'react';
import { useAppContext } from '../../context/AppContext';

const LogisticsStatus = memo(function LogisticsStatus() {
    const { state } = useAppContext();
    const { lastLatencyMs, model } = state.sessionMetrics;

    return (
        <div style={{
            background: 'rgba(187,184,145,0.06)',
            border: '1px solid rgba(187,184,145,0.15)',
            borderRadius: 4,
            padding: '10px 14px',
        }}>
            <div style={{
                fontFamily: 'var(--font-display)', fontSize: 9,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'var(--lcars-text-dim)', marginBottom: 8, fontWeight: 700,
            }}>System Metrics</div>

            <Row label="Model" value={model.replace('gemini-', '')} color="var(--lcars-sage)" />
            <Row
                label="Latency"
                value={lastLatencyMs > 0 ? `${lastLatencyMs} ms` : '— ms'}
                color="var(--lcars-silver-light)"
            />
            <div style={{ marginTop: 8 }}>
                <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontFamily: 'var(--font-display)', fontSize: 9,
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                    color: 'var(--lcars-text-dim)', marginBottom: 4,
                    fontWeight: 700,
                }}>
                    <span>Efficiency</span>
                    <span style={{ color: 'var(--lcars-sage)' }}>{Math.min(100, Math.max(60, 100 - lastLatencyMs / 50)).toFixed(0)}%</span>
                </div>
                <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(60, 100 - lastLatencyMs / 50))}%`,
                        background: 'var(--lcars-sage)',
                        borderRadius: 2, transition: 'width 1s ease',
                    }} />
                </div>
            </div>
        </div>
    );
});

function Row({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.12em', color: 'var(--lcars-text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color }}>{value}</span>
        </div>
    );
}

export default LogisticsStatus;
