import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-1': 'var(--bg-1)',
        'bg-2': 'var(--bg-2)',
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        overlay: 'var(--overlay)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        ink: 'var(--text)',
        'ink-2': 'var(--text-2)',
        'ink-3': 'var(--text-3)',
        accent: 'var(--accent)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        ok: 'var(--ok)',
      },
      fontFamily: {
        sans: ['Geist Variable', 'Geist', 'Inter Tight', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        card: '12px',
        panel: '10px',
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        30: '7.5rem',
      },
      maxWidth: {
        page: '1180px',
      },
      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
