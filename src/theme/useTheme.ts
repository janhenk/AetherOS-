import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export const THEMES = ['dark', 'light', 'subtle', 'monochrome'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'dark';
export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 22;

export const THEME_COLORS: Record<Theme, string> = {
  dark: '#0A0B0D',
  light: '#FAFAFA',
  subtle: '#F1F0EC',
  monochrome: '#FFFFFF',
};

export const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  subtle: 'Subtle',
  monochrome: 'Monochrome',
};

const THEME_STORAGE_KEY = 'kai-theme';
const FONT_SIZE_STORAGE_KEY = 'kai-font-size';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  resetFontSize: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

export function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function readStoredFontSize(): number {
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (raw !== null && raw !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return clampFontSize(parsed);
    }
    return DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    return;
  }
}

export function persistFontSize(fontSize: number): void {
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  } catch {
    return;
  }
}

export function applyThemeToDom(theme: Theme, fontSize: number): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.setProperty('--app-base-font-size', `${fontSize}px`);

  for (const name of THEMES) {
    root.classList.remove(`theme-${name}`);
    document.body?.classList.remove(`theme-${name}`);
  }
  root.classList.add(`theme-${theme}`);
  document.body?.classList.add(`theme-${theme}`);

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta && document.head) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[theme]);
  }
}

/** Reads the active Kai theme and font-size controls, with a resilient standalone fallback. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const [fallbackTheme, setFallbackTheme] = useState<Theme>(() => readStoredTheme());
  const [fallbackFontSize, setFallbackFontSize] = useState<number>(() => readStoredFontSize());

  useEffect(() => {
    if (!ctx) {
      applyThemeToDom(fallbackTheme, fallbackFontSize);
    }
  }, [ctx, fallbackTheme, fallbackFontSize]);

  return useMemo<ThemeContextValue>(() => {
    if (ctx) return ctx;
    return {
      theme: fallbackTheme,
      setTheme: (next: Theme) => {
        const valid = isTheme(next) ? next : DEFAULT_THEME;
        setFallbackTheme(valid);
        persistTheme(valid);
      },
      cycleTheme: () => {
        setFallbackTheme((current) => {
          const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? DEFAULT_THEME;
          persistTheme(next);
          return next;
        });
      },
      fontSize: fallbackFontSize,
      setFontSize: (size: number) => {
        const clamped = clampFontSize(size);
        setFallbackFontSize(clamped);
        persistFontSize(clamped);
      },
      resetFontSize: () => {
        setFallbackFontSize(DEFAULT_FONT_SIZE);
        persistFontSize(DEFAULT_FONT_SIZE);
      },
    };
  }, [ctx, fallbackTheme, fallbackFontSize]);
}
