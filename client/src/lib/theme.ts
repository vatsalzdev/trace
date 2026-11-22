export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'trace:theme';

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/** Resolve the console theme. A stored choice always wins; the OS preference is
 * used only to seed the very first visit. Every storage access is guarded. */
export function resolveTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* storage may be blocked; fall through to the system preference */
  }

  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* theme still works for this session when storage is unavailable */
  }
}

export function applyConsoleTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function clearConsoleTheme(): void {
  delete document.documentElement.dataset.theme;
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
