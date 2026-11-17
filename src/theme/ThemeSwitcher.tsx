import { useId, useRef, type KeyboardEvent } from 'react';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  THEMES,
  useTheme,
  type Theme,
} from './useTheme';

interface ThemeSwitcherProps {
  compact?: boolean;
  showKeyboardShortcut?: boolean;
  showFontSize?: boolean;
  className?: string;
}

const THEME_METADATA: Record<Theme, { label: string; description: string }> = {
  dark: {
    label: 'Dark',
    description: 'Obsidian minimal dark workspace',
  },
  light: {
    label: 'Light',
    description: 'Clean architectural paper light',
  },
  subtle: {
    label: 'Subtle',
    description: 'Warm Nordic stone low-glare',
  },
  monochrome: {
    label: 'Monochrome',
    description: 'Pure high-contrast black and white',
  },
};

/** Accessible font-size slider (12px-22px) paired with a reset action. */
export function FontSizeControl() {
  const { fontSize, setFontSize, resetFontSize } = useTheme();
  const sliderId = useId();

  return (
    <div className="kai-font-control">
      <label className="kai-label" htmlFor={sliderId}>
        Base text size
      </label>
      <input
        id={sliderId}
        className="kai-font-slider"
        type="range"
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        step={1}
        value={fontSize}
        aria-valuetext={`${fontSize}px`}
        onChange={(event) => setFontSize(Number(event.currentTarget.value))}
      />
      <span className="kai-mono kai-tabular text-xs text-text-secondary">
        {fontSize}px
      </span>
      <button
        type="button"
        className="kai-btn kai-btn-secondary kai-btn-sm"
        onClick={resetFontSize}
      >
        Reset
      </button>
    </div>
  );
}

/** Kai multi-theme radio switcher: compact pill strip for topbars or full 4-card visual grid. */
export function ThemeSwitcher({
  compact = false,
  showKeyboardShortcut = false,
  showFontSize = false,
  className,
}: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % THEMES.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + THEMES.length) % THEMES.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = THEMES.length - 1;
    }

    if (nextIndex === null) return;
    const nextTheme = THEMES[nextIndex];
    if (!nextTheme) return;

    event.preventDefault();
    setTheme(nextTheme);
    optionRefs.current[nextIndex]?.focus();
  }

  const rootClassName = [
    'kai-theme-switcher',
    compact ? 'is-compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (compact) {
    return (
      <div className={rootClassName}>
        <div className="kai-theme-pills" role="radiogroup" aria-label="Theme">
          {THEMES.map((item, index) => {
            const meta = THEME_METADATA[item];
            const isActive = theme === item;

            return (
              <button
                key={item}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={meta.label}
                title={`${meta.label} theme`}
                tabIndex={isActive ? 0 : -1}
                className={isActive ? 'kai-theme-pill is-active' : 'kai-theme-pill'}
                onClick={() => setTheme(item)}
                onKeyDown={(event) => handleRadioKeyDown(event, index)}
              >
                <span className={`kai-theme-dot kai-theme-dot--${item}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <div className="kai-theme-cards" role="radiogroup" aria-label="Theme">
        {THEMES.map((item, index) => {
          const meta = THEME_METADATA[item];
          const isActive = theme === item;

          return (
            <button
              key={item}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              className={isActive ? 'kai-theme-card is-active' : 'kai-theme-card'}
              onClick={() => setTheme(item)}
              onKeyDown={(event) => handleRadioKeyDown(event, index)}
            >
              <span className={`kai-theme-swatch kai-theme-swatch--${item}`} aria-hidden="true">
                <span className="kai-theme-swatch-bar">
                  <span className="kai-theme-swatch-line" />
                  <span className="kai-theme-swatch-accent" />
                </span>
                <span className="kai-theme-swatch-line" />
              </span>
              <span className="kai-theme-card-head">
                <span className="kai-theme-card-title">
                  <span className={`kai-theme-dot kai-theme-dot--${item}`} aria-hidden="true" />
                  <span>{meta.label}</span>
                </span>
              </span>
              <span className="kai-theme-card-desc">{meta.description}</span>
            </button>
          );
        })}
      </div>

      {showKeyboardShortcut && (
        <div className="kai-theme-shortcut">
          <span>Cycle theme</span>
          <kbd className="kai-kbd">Ctrl</kbd>
          <span aria-hidden="true">+</span>
          <kbd className="kai-kbd">Shift</kbd>
          <span aria-hidden="true">+</span>
          <kbd className="kai-kbd">T</kbd>
        </div>
      )}

      {showFontSize && <FontSizeControl />}
    </div>
  );
}
