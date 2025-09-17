import type { Config } from 'tailwindcss';

const withOpacity = (variableName: string) => {
  return ({ opacityValue }: { opacityValue?: string }) => {
    if (opacityValue) {
      return `rgb(var(${variableName}) / ${opacityValue})`;
    }

    return `rgb(var(${variableName}))`;
  };
};

const toColor = (variableName: string) => withOpacity(variableName) as unknown as string;

const config: Config = {
  content: ['src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: toColor('--bg'),
        'surface-glare': toColor('--bg-glare'),
        accent: toColor('--accent'),
        'accent-soft': toColor('--accent-soft'),
        text: toColor('--fg'),
        muted: toColor('--muted')
      },
      fontFamily: {
        sans: ['var(--font-sans)', '"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', '"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        glow: '0 0 calc(24px * var(--glow-strength)) rgb(var(--accent) / 0.45)'
      },
      backgroundImage: {
        'crt-noise': 'repeating-linear-gradient(transparent 0, transparent 1px, rgb(var(--accent) / 0.05) 1px, rgb(var(--accent) / 0.05) 2px)'
      },
      spacing: {
        'safe-t': 'var(--safe-area-top)',
        'safe-r': 'var(--safe-area-right)',
        'safe-b': 'var(--safe-area-bottom)',
        'safe-l': 'var(--safe-area-left)'
      }
    }
  },
  plugins: []
};

export default config;
