import { useId, useState, useEffect, type FormEvent } from 'react';
import { apiFetch } from '../../utils/api';
import { ThemeSwitcher } from '../../theme/ThemeSwitcher';

export function AuthOverlay({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const passwordInputId = useId();

  useEffect(() => {
    let cancelled = false;

    const checkStatus = async () => {
      try {
        const res = await fetch('/api/auth/status');
        if (!res.ok) {
          if (!cancelled) {
            setError('Unable to reach authentication service.');
          }
          return;
        }

        const data = (await res.json()) as { needsSetup?: boolean };
        if (cancelled) return;
        const setupRequired = Boolean(data.needsSetup);
        setNeedsSetup(setupRequired);

        const token = localStorage.getItem('aetheros_token');
        if (!setupRequired && token) {
          try {
            const testRes = await apiFetch('/api/stats');
            if (testRes.ok && !cancelled) {
              onAuthenticated();
              return;
            }
          } catch (tokenErr: unknown) {
            console.warn('Stored authentication token failed validation:', tokenErr);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Connection error: ${err.message}`
              : 'Failed to connect to the Kai Ops server.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void checkStatus();
    return () => {
      cancelled = true;
    };
  }, [onAuthenticated]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setError('');
    setLoading(true);

    const endpoint = needsSetup ? '/api/auth/setup' : '/api/auth/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { token?: string; error?: string };

      if (res.ok && data.token) {
        localStorage.setItem('aetheros_token', data.token);
        onAuthenticated();
      } else {
        setError(data.error || 'Authentication failed. Check your password and try again.');
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? `Sign in failed: ${err.message}`
          : 'Unable to reach authentication service.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading && needsSetup === null) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-6"
        style={{
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-secondary)',
        }}
      >
        <div className="flex items-center gap-3 text-sm font-medium">
          <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>
          <span>Connecting to Kai Ops...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 sm:p-6"
      style={{
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="fixed right-4 top-4 sm:right-6 sm:top-6">
        <ThemeSwitcher compact />
      </div>

      <div
        className="kai-surface w-full max-w-md p-6 sm:p-8"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg"
            style={{
              backgroundColor: 'var(--accent-subtle)',
              color: 'var(--accent-text)',
              border: '1px solid var(--border-color)',
            }}
          >
            <span className="material-symbols-outlined text-[26px]">
              {needsSetup ? 'admin_panel_settings' : 'lock'}
            </span>
          </div>
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {needsSetup ? 'Initialize Kai Ops' : 'Sign in to Kai Ops'}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {needsSetup
              ? 'Create an administrator password to secure this host console.'
              : 'Enter your administrator password to manage containers and agents.'}
          </p>
        </div>

        {error && (
          <div className="kai-alert kai-alert-error mb-5 flex items-center gap-2 text-sm" role="alert">
            <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="kai-field">
            <label className="kai-label" htmlFor={passwordInputId}>
              {needsSetup ? 'Administrator Password' : 'Password'}
            </label>
            <div className="relative">
              <input
                id={passwordInputId}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  needsSetup ? 'Choose a strong password' : 'Enter administrator password'
                }
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                autoFocus
                className="kai-input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="kai-btn kai-btn-ghost kai-btn-xs absolute right-1.5 top-1/2 -translate-y-1/2"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="kai-btn kai-btn-primary w-full mt-1"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                loading ? 'animate-spin' : ''
              }`}
              aria-hidden="true"
            >
              {loading ? 'sync' : needsSetup ? 'lock_reset' : 'login'}
            </span>
            <span>{needsSetup ? 'Complete Setup' : 'Sign In'}</span>
          </button>
        </form>

        <div
          className="mt-6 flex items-center justify-between border-t pt-4 text-xs"
          style={{
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
        >
          <span>Kai Ops Console</span>
          <span className="kai-mono">Protected Session</span>
        </div>
      </div>
    </div>
  );
}
