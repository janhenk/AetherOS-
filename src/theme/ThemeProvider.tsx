import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  THEMES,
  ThemeContext,
  applyThemeToDom,
  clampFontSize,
  isTheme,
  persistFontSize,
  persistTheme,
  readStoredFontSize,
  readStoredTheme,
  type Theme,
  type ThemeContextValue,
} from './useTheme';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/** Provides multi-theme state, font scaling, localStorage persistence, and Ctrl/Cmd+Shift+T cycling. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [fontSize, setFontSizeState] = useState<number>(() => readStoredFontSize());

  useEffect(() => {
    applyThemeToDom(theme, fontSize);
  }, [theme, fontSize]);

  const setTheme = useCallback((next: Theme) => {
    const valid = isTheme(next) ? next : DEFAULT_THEME;
    setThemeState(valid);
    persistTheme(valid);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? DEFAULT_THEME;
      persistTheme(next);
      return next;
    });
  }, []);

  const setFontSize = useCallback((size: number) => {
    const clamped = clampFontSize(size);
    setFontSizeState(clamped);
    persistFontSize(clamped);
  }, []);

  const resetFontSize = useCallback(() => {
    setFontSizeState(DEFAULT_FONT_SIZE);
    persistFontSize(DEFAULT_FONT_SIZE);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 't') return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      cycleTheme();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cycleTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      cycleTheme,
      fontSize,
      setFontSize,
      resetFontSize,
    }),
    [theme, setTheme, cycleTheme, fontSize, setFontSize, resetFontSize],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
