import { memo } from 'react';
import { useAppContext } from '../../context/useAppContext';
import { THEME_LABELS, useTheme } from '../../theme/useTheme';

const AppFooter = memo(function AppFooter() {
  const { state } = useAppContext();
  const { theme } = useTheme();
  const ss = state.serverState;

  const hostname = ss?.hostname || 'localhost';
  const dockerRunning = Boolean(ss?.dockerRunning);
  const cpuPercent = ss ? Math.round(ss.cpuLoad) : 0;
  const ramPercent = ss ? Math.round(ss.ramUsed) : 0;

  return (
    <footer
      className="mt-auto border-t px-4 py-2.5 lg:px-6"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderColor: 'var(--border-color)',
      }}
    >
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
              dns
            </span>
            <span className="kai-mono font-medium" style={{ color: 'var(--text-primary)' }}>
              {hostname}
            </span>
          </div>

          <span
            className={`kai-badge ${
              dockerRunning ? 'kai-badge-success' : 'kai-badge-danger'
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: dockerRunning
                  ? 'var(--success-color)'
                  : 'var(--danger-color)',
              }}
              aria-hidden="true"
            />
            <span>Docker Engine: {dockerRunning ? 'Online' : 'Offline'}</span>
          </span>

          <div
            className="kai-mono kai-tabular flex items-center gap-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>CPU {cpuPercent}%</span>
            <span aria-hidden="true">·</span>
            <span>RAM {ramPercent}%</span>
          </div>
        </div>

        <div className="flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
          <span>
            Theme:{' '}
            <strong className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {THEME_LABELS[theme]}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>AetherOS</span>
        </div>
      </div>
    </footer>
  );
});

export default AppFooter;
