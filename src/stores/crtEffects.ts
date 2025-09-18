import { writable } from 'svelte/store';
import type { CRTRenderMode } from '../lib/crt/types';

export type CRTModePreference = 'auto' | CRTRenderMode;

export type CRTTheme = 'green' | 'amber';
export type CRTToggle = 'scanlines' | 'glow' | 'aberration' | 'barrel';

export interface CRTIntensity {
  scanlines: number;
  glow: number;
  aberration: number;
  barrel: number;
}

export interface CRTEffectsState {
  theme: CRTTheme;
  plainMode: boolean;
  scanlines: boolean;
  glow: boolean;
  aberration: boolean;
  barrel: boolean;
  intensity: CRTIntensity;
  modePreference: CRTModePreference;
}

const STORAGE_KEY = 'biolink-crt-effects';

const DEFAULT_STATE: CRTEffectsState = {
  theme: 'green',
  plainMode: false,
  scanlines: true,
  glow: true,
  aberration: false,
  barrel: true,
  intensity: {
    scanlines: 0.18,
    glow: 0.55,
    aberration: 0.35,
    barrel: 0.0025
  },
  modePreference: 'auto'
};

const hasWindow = typeof window !== 'undefined';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const applyDocumentEffects = (state: CRTEffectsState, mode: CRTRenderMode) => {
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

  const cssEnabled = mode === 'css';

  const scanlineValue = !cssEnabled || state.plainMode || !state.scanlines ? 0 : state.intensity.scanlines;
  const glowValue = state.plainMode
    ? 0
    : cssEnabled && state.glow
      ? state.intensity.glow
      : 0.08;
  const aberrationValue = !cssEnabled || state.plainMode || !state.aberration ? 0 : state.intensity.aberration;
  const barrelValue = !cssEnabled || state.plainMode || !state.barrel ? 0 : state.intensity.barrel;

  root.style.setProperty('--scanline-opacity', scanlineValue.toString());
  root.style.setProperty('--glow-strength', glowValue.toString());
  root.style.setProperty('--aberration-strength', aberrationValue.toString());
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
    next.intensity.aberration = clamp(next.intensity.aberration, 0, 1);
    next.intensity.barrel = clamp(next.intensity.barrel, 0, 0.01);

    if (next.modePreference !== 'webgpu' && next.modePreference !== 'webgl2' && next.modePreference !== 'css') {
      next.modePreference = 'auto';
    }

    return next;
  } catch (error) {
    console.warn('Failed to parse CRT effect preferences', error);
    return DEFAULT_STATE;
  }
};

const initializeState = readPersistedState();

const baseWritable = writable<CRTEffectsState>(initializeState);
const renderModeWritable = writable<CRTRenderMode>('css');

let currentMode: CRTRenderMode = 'css';
let latestState = initializeState;

if (hasWindow) {
  applyDocumentEffects(initializeState, currentMode);

  baseWritable.subscribe((value) => {
    latestState = value;
    applyDocumentEffects(value, currentMode);
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

const reset = () => {
  baseWritable.set({
    ...DEFAULT_STATE,
    intensity: { ...DEFAULT_STATE.intensity }
  });
};

const setRenderMode = (mode: CRTRenderMode) => {
  currentMode = mode;
  renderModeWritable.set(mode);
  applyDocumentEffects(latestState, currentMode);
};

const setModePreference = (mode: CRTModePreference) => {
  baseWritable.update((state) => ({
    ...state,
    modePreference: mode
  }));
};

export const crtEffects = {
  subscribe: baseWritable.subscribe,
  setTheme,
  togglePlainMode,
  toggleEffect,
  setIntensity,
  reset,
  setRenderMode,
  setModePreference
};

export { DEFAULT_STATE as defaultEffectsState };
export const crtRenderMode = { subscribe: renderModeWritable.subscribe };
