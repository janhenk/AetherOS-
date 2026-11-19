import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/useAppContext';
import { ThemeSwitcher } from '../../theme/ThemeSwitcher';
import { apiFetch } from '../../utils/api';
import type { AgentId, TacticalInsight } from '../../types';

interface AppHeaderProps {
  activeAgent: AgentId;
  setActiveAgent: (id: AgentId) => void;
  onSettingsClick: () => void;
}

const HEADER_TABS: readonly { id: AgentId; label: string; icon: string }[] = [
  { id: 'nav', label: 'Compute & Routing', icon: 'router' },
  { id: 'security', label: 'Security & Audit', icon: 'shield' },
  { id: 'logistics', label: 'Storage & Data', icon: 'database' },
  { id: 'comms', label: 'Network & Web', icon: 'hub' },
];

const SEVERITY_BADGE: Record<TacticalInsight['severity'], string> = {
  high: 'kai-badge-danger',
  medium: 'kai-badge-warning',
  low: 'kai-badge-info',
};

const AppHeader = memo(function AppHeader({
  activeAgent,
  setActiveAgent,
  onSettingsClick,
}: AppHeaderProps) {
  const { state, dispatch } = useAppContext();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationBusyId, setNotificationBusyId] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [systemUpdateInfo, setSystemUpdateInfo] = useState<{
    updateAvailable: boolean;
    behindCount: number;
  }>({ updateAvailable: false, behindCount: 0 });
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const version = state.serverState?.projectVersion || '1.0.0';
  const insights = state.serverState?.insights ?? [];

  useEffect(() => {
    let cancelled = false;

    const checkSystemUpdates = async () => {
      try {
        const res = await apiFetch('/api/system/check-updates');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          updateAvailable?: boolean;
          behindCount?: number;
        };
        if (!cancelled) {
          setSystemUpdateInfo({
            updateAvailable: Boolean(data.updateAvailable),
            behindCount: typeof data.behindCount === 'number' ? data.behindCount : 0,
          });
        }
      } catch {
        // Non-fatal: updater check can fail while offline or during local startup
      }
    };

    void checkSystemUpdates();
    const timer = window.setInterval(() => {
      void checkSystemUpdates();
    }, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isNotificationsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        event.target instanceof Node &&
        !popoverRef.current.contains(event.target)
      ) {
        setIsNotificationsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNotificationsOpen]);

  const handleDismissInsight = useCallback(
    async (id: string) => {
      setNotificationBusyId(id);
      setNotificationError(null);
      try {
        const res = await apiFetch('/api/insights/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          throw new Error('Failed to dismiss notification');
        }
        const data = (await res.json()) as { insights?: TacticalInsight[] };
        if (state.serverState && Array.isArray(data.insights)) {
          dispatch({
            type: 'UPDATE_SERVER_STATE',
            payload: { ...state.serverState, insights: data.insights },
          });
        }
      } catch (err: unknown) {
        setNotificationError(err instanceof Error ? err.message : 'Unable to dismiss alert');
      } finally {
        setNotificationBusyId(null);
      }
    },
    [dispatch, state.serverState],
  );

  const handleClearAllInsights = useCallback(async () => {
    setNotificationBusyId('__all__');
    setNotificationError(null);
    try {
      const res = await apiFetch('/api/insights/clear', { method: 'POST' });
      if (!res.ok) {
        throw new Error('Failed to clear notifications');
      }
      const data = (await res.json()) as { insights?: TacticalInsight[] };
      if (state.serverState) {
        dispatch({
          type: 'UPDATE_SERVER_STATE',
          payload: {
            ...state.serverState,
            insights: Array.isArray(data.insights) ? data.insights : [],
          },
        });
      }
    } catch (err: unknown) {
      setNotificationError(err instanceof Error ? err.message : 'Unable to clear alerts');
    } finally {
      setNotificationBusyId(null);
    }
  }, [dispatch, state.serverState]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (err: unknown) {
      console.error('Logout request failed:', err);
    } finally {
      localStorage.removeItem('aetheros_token');
      window.location.reload();
    }
  }, []);

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur-md"
      style={{
        backgroundColor: 'var(--nav-bg)',
        borderColor: 'var(--border-color)',
      }}
    >
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor: 'var(--accent-subtle)',
              color: 'var(--accent-text)',
              border: '1px solid var(--border-color)',
            }}
          >
            <span className="material-symbols-outlined text-[20px]">dns</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1
                className="text-base font-bold tracking-tight"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                AetherOS
              </h1>
              <span className="kai-badge kai-badge-accent kai-mono kai-tabular">v{version}</span>
              {state.isYoloMode && (
                <span className="kai-badge kai-badge-warning">Elevated</span>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Container &amp; AI Operations
            </p>
          </div>
        </div>

        <nav
          className="hidden items-center gap-1 lg:flex"
          aria-label="Operations domains"
        >
          {HEADER_TABS.map((tab) => {
            const isActive = activeAgent === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveAgent(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`kai-btn kai-btn-sm ${
                  isActive ? 'kai-btn-primary' : 'kai-btn-ghost'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeSwitcher compact className="hidden sm:inline-flex" />

          <div className="relative" ref={popoverRef}>
            <button
              type="button"
              onClick={() => setIsNotificationsOpen((prev) => !prev)}
              className="kai-btn kai-btn-ghost kai-btn-icon relative"
              title="Notifications"
              aria-label={`Notifications (${insights.length} active)`}
              aria-expanded={isNotificationsOpen}
              aria-haspopup="dialog"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              {insights.length > 0 && (
                <span
                  className="kai-mono kai-tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold"
                  style={{
                    backgroundColor: 'var(--danger-color)',
                    color: 'var(--danger-contrast)',
                  }}
                >
                  {insights.length > 99 ? '99+' : insights.length}
                </span>
              )}
            </button>

            {isNotificationsOpen && (
              <div
                role="dialog"
                aria-label="System notifications"
                className="kai-surface absolute right-0 mt-2 w-80 sm:w-96 p-0 overflow-hidden z-50"
                style={{ boxShadow: 'var(--shadow-lg)' }}
              >
                <div
                  className="flex items-center justify-between gap-2 px-4 py-3 border-b"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border-subtle)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Notifications
                    </span>
                    <span className="kai-badge kai-tabular">{insights.length}</span>
                  </div>
                  {insights.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleClearAllInsights()}
                      disabled={notificationBusyId !== null}
                      className="kai-btn kai-btn-ghost kai-btn-xs"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {notificationError && (
                  <div className="p-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="kai-alert kai-alert-error text-xs">{notificationError}</div>
                  </div>
                )}

                <div className="max-h-80 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {insights.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      No active system notifications.
                    </div>
                  ) : (
                    insights.map((insight) => (
                      <div
                        key={insight.id}
                        className="flex items-start justify-between gap-3 px-4 py-3"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`kai-badge ${SEVERITY_BADGE[insight.severity]}`}>
                              {insight.severity}
                            </span>
                            <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                              {insight.type}
                            </span>
                          </div>
                          <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                            {insight.message}
                          </p>
                          {insight.suggestion && (
                            <p className="text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>
                              {insight.suggestion}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDismissInsight(insight.id)}
                          disabled={notificationBusyId === insight.id}
                          className="kai-btn kai-btn-ghost kai-btn-xs shrink-0"
                          aria-label={`Dismiss ${insight.message}`}
                          title="Dismiss"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => dispatch({ type: 'OPEN_SETTINGS', payload: 'security' })}
            className="kai-btn kai-btn-ghost kai-btn-icon relative"
            title={
              systemUpdateInfo.updateAvailable
                ? `System update available (${systemUpdateInfo.behindCount || 1} commit(s) behind)`
                : 'System Updates'
            }
            aria-label={
              systemUpdateInfo.updateAvailable
                ? `System Updates (${systemUpdateInfo.behindCount || 1} available)`
                : 'System Updates'
            }
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={systemUpdateInfo.updateAvailable ? { color: 'var(--accent-primary)' } : undefined}
            >
              system_update
            </span>
            {systemUpdateInfo.updateAvailable && (
              <span
                className="kai-mono kai-tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: 'var(--accent-contrast)',
                }}
              >
                {systemUpdateInfo.behindCount > 0 ? systemUpdateInfo.behindCount : '!'}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => dispatch({ type: 'TOGGLE_LOG_VIEWER' })}
            className="kai-btn kai-btn-ghost kai-btn-icon"
            title="System Logs"
            aria-label="System Logs"
          >
            <span className="material-symbols-outlined text-[20px]">terminal</span>
          </button>

          <button
            type="button"
            onClick={onSettingsClick}
            className="kai-btn kai-btn-ghost kai-btn-icon"
            title="Settings"
            aria-label="Settings"
          >
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="kai-btn kai-btn-secondary kai-btn-sm"
            title="Sign Out"
            aria-label="Sign Out"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              logout
            </span>
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>

      {/* Responsive agent tabs on tablet/mobile */}
      <nav
        className="flex items-center gap-1 overflow-x-auto border-t px-4 py-2 lg:hidden"
        style={{ borderColor: 'var(--border-subtle)' }}
        aria-label="Operations domains mobile"
      >
        {HEADER_TABS.map((tab) => {
          const isActive = activeAgent === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveAgent(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`kai-btn kai-btn-xs shrink-0 ${
                isActive ? 'kai-btn-primary' : 'kai-btn-ghost'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
});

export default AppHeader;
