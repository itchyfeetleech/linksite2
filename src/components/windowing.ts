import type { Readable } from 'svelte/store';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowPersistentState {
  bounds: Bounds;
  isMaximized: boolean;
  isMinimized: boolean;
  isClosed: boolean;
  restoreBounds: Bounds | null;
}

export interface WindowInstanceState extends WindowPersistentState {
  id: string;
  title: string;
  zIndex: number;
  isFocused: boolean;
  allowClose: boolean;
  allowMinimize: boolean;
  allowMaximize: boolean;
  minWidth: number;
  minHeight: number;
  maxWidth: number | null;
  maxHeight: number | null;
  lastInteraction: 'drag' | 'resize' | 'keyboard' | 'programmatic' | null;
}

export interface WindowRegistration {
  id: string;
  title: string;
  initialState: WindowPersistentState;
  constraints?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
  behaviors?: {
    closeable?: boolean;
    minimizable?: boolean;
    maximizable?: boolean;
  };
  restoreFocus?: boolean;
}

export interface WindowUpdateOptions {
  persist?: boolean;
  interaction?: WindowInstanceState['lastInteraction'];
}

export interface WindowController {
  state: Readable<WindowInstanceState>;
  update(partial: Partial<WindowInstanceState>, options?: WindowUpdateOptions): void;
  updateState(updater: (state: WindowInstanceState) => WindowInstanceState, options?: WindowUpdateOptions): void;
  focus(): void;
  minimize(value: boolean, options?: WindowUpdateOptions): void;
  maximize(value: boolean, options?: WindowUpdateOptions): void;
  close(options?: WindowUpdateOptions): void;
  reopen(options?: WindowUpdateOptions): void;
}

export interface WindowManagerContext {
  registerWindow(registration: WindowRegistration): WindowController;
  unregisterWindow(id: string): void;
  focusWindow(id: string): void;
  bringToFront(id: string): number;
  getViewportBounds(): DOMRect | null;
  clampToViewport(bounds: Bounds): Bounds;
  windows: Readable<WindowInstanceState[]>;
  activateWindow(id: string): void;
  minimizeWindow(id: string, value: boolean): void;
}

export const WINDOW_MANAGER_CONTEXT = Symbol('biolink-window-manager');
