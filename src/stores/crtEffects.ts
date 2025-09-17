import { writable } from 'svelte/store';

export type CRTTheme = 'green' | 'amber';
export type CRTToggle = 'scanlines' | 'glow' | 'barrel';

export interface CRTIntensity {
  scanlines: number;
  glow: number;
  barrel: number;
}

export interface CRTEffectsState {
  theme: CRTTheme;
  plainMode: boolean;
  scanlines: boolean;
  glow: boolean;
  barrel: boolean;
  intensity: CRTIntensity;
}

const STORAGE_KEY = 'biolink-crt-effects';

const DEFAULT_STATE: CRTEffectsState = {
  theme: 'green',
  plainMode: false,
  scanlines: true,
  glow: true,
  barrel: true,
  intensity: {
    scanlines: 0.18,
    glow: 0.55,
    barrel: 0.0025
  }
};

const hasWindow = typeof window !== 'undefined';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const applyDocumentEffects = (state: CRTEffectsState) => {
  if (!hasWindow) {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = state.theme;

  if (state.plainMode) {
    root.dataset.mode = 'plain';
  } else {
    delete root.dataset.mode;
  }

  const scanlineValue = state.plainMode || !state.scanlines ? 0 : state.intensity.scanlines;
  const glowValue = state.plainMode || !state.glow ? 0 : state.intensity.glow;
  const barrelValue = state.plainMode || !state.barrel ? 0 : state.intensity.barrel;

  root.style.setProperty('--scanline-opacity', scanlineValue.toString());
  root.style.setProperty('--glow-strength', glowValue.toString());
  root.style.setProperty('--barrel-strength', barrelValue.toString());
};

const readPersistedState = (): CRTEffectsState => {
  if (!hasWindow) {
    return DEFAULT_STATE;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return DEFAULT_STATE;
    }

    const parsed = JSON.parse(stored) as Partial<CRTEffectsState>;
    const next = {
      ...DEFAULT_STATE,
      ...parsed,
      intensity: {
        ...DEFAULT_STATE.intensity,
        ...(parsed?.intensity ?? {})
      }
    } satisfies CRTEffectsState;

    next.intensity.scanlines = clamp(next.intensity.scanlines, 0, 1);
    next.intensity.glow = clamp(next.intensity.glow, 0, 1);
    next.intensity.barrel = clamp(next.intensity.barrel, 0, 0.01);

    return next;
  } catch (error) {
    console.warn('Failed to parse CRT effect preferences', error);
    return DEFAULT_STATE;
  }
};

const initializeState = readPersistedState();

const baseWritable = writable<CRTEffectsState>(initializeState);

if (hasWindow) {
  applyDocumentEffects(initializeState);

  baseWritable.subscribe((value) => {
    applyDocumentEffects(value);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  });
}

const setTheme = (theme: CRTTheme) => {
  baseWritable.update((state) => ({
    ...state,
    theme
  }));
};

const togglePlainMode = () => {
  baseWritable.update((state) => ({
    ...state,
    plainMode: !state.plainMode
  }));
};

const toggleEffect = (key: CRTToggle) => {
  baseWritable.update((state) => ({
    ...state,
    [key]: !state[key]
  }));
};

const setIntensity = (key: CRTToggle, value: number) => {
  baseWritable.update((state) => ({
    ...state,
    intensity: {
      ...state.intensity,
      [key]: key === 'barrel' ? clamp(value, 0, 0.01) : clamp(value, 0, 1)
    }
  }));
};

export const crtEffects = {
  subscribe: baseWritable.subscribe,
  setTheme,
  togglePlainMode,
  toggleEffect,
  setIntensity
};

export { DEFAULT_STATE as defaultEffectsState };
