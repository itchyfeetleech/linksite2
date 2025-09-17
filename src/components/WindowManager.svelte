<script lang="ts">
  import { onDestroy, onMount, setContext } from 'svelte';
  import { get, writable, type Writable } from 'svelte/store';
  import {
    WINDOW_MANAGER_CONTEXT,
    type Bounds,
    type WindowController,
    type WindowInstanceState,
    type WindowManagerContext,
    type WindowPersistentState,
    type WindowRegistration,
    type WindowUpdateOptions
  } from './windowing';

  const browser = typeof window !== 'undefined';

  export let storageKey = 'biolink-window-state';
  export let schemaVersion = 1;

  interface PersistPayload {
    version: number;
    windows: Record<string, WindowPersistentState>;
  }

  interface InternalWindow {
    id: string;
    store: Writable<WindowInstanceState>;
    needsPersist: boolean;
  }

  const windowList = writable<WindowInstanceState[]>([]);

  let persisted: PersistPayload = {
    version: schemaVersion,
    windows: {}
  };

  const windows = new Map<string, InternalWindow>();
  let zCursor = 0;
  let focusedId: string | null = null;

  let container: HTMLElement | undefined;
  let viewportRect: DOMRect | null = null;
  let flushHandle: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const readPersisted = (): PersistPayload => {
    if (!browser) {
      return {
        version: schemaVersion,
        windows: {}
      };
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        return {
          version: schemaVersion,
          windows: {}
        };
      }

      const parsed = JSON.parse(stored) as PersistPayload;
      if (!parsed || parsed.version !== schemaVersion || typeof parsed.windows !== 'object') {
        return {
          version: schemaVersion,
          windows: {}
        };
      }

      return parsed;
    } catch (error) {
      console.warn('Failed to read persisted window state', error);
      return {
        version: schemaVersion,
        windows: {}
      };
    }
  };

  if (browser) {
    persisted = readPersisted();
  }

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const clampToViewport = (bounds: Bounds): Bounds => {
    if (!viewportRect) {
      return { ...bounds };
    }

    const minSize = 120;
    const width = clamp(bounds.width, minSize, viewportRect.width);
    const height = clamp(bounds.height, minSize, viewportRect.height);
    const maxX = Math.max(0, viewportRect.width - width);
    const maxY = Math.max(0, viewportRect.height - height);

    return {
      x: clamp(bounds.x, 0, maxX),
      y: clamp(bounds.y, 0, maxY),
      width,
      height
    };
  };

  const applyViewportConstraint = () => {
    if (!viewportRect) {
      return;
    }

    let changed = false;

    windows.forEach((internal) => {
      internal.store.update((state) => {
        if (state.isMaximized) {
          return state;
        }
        const constrained = clampToViewport(state.bounds);
        if (
          constrained.x === state.bounds.x &&
          constrained.y === state.bounds.y &&
          constrained.width === state.bounds.width &&
          constrained.height === state.bounds.height
        ) {
          return state;
        }
        changed = true;
        internal.needsPersist = true;
        return {
          ...state,
          bounds: constrained
        };
      });
    });

    if (changed) {
      scheduleFlush();
    }
  };

  const persistIfNeeded = () => {
    if (!browser) {
      return;
    }

    const payload: PersistPayload = {
      version: schemaVersion,
      windows: {}
    };

    let shouldWrite = false;
    const pendingReset: InternalWindow[] = [];
    const previousIds = new Set(Object.keys(persisted.windows));

    windows.forEach((internal) => {
      const state = get(internal.store);

      payload.windows[state.id] = {
        bounds: { ...state.bounds },
        isMaximized: state.isMaximized,
        isMinimized: state.isMinimized,
        isClosed: state.isClosed,
        restoreBounds: state.restoreBounds ?? null
      } satisfies WindowPersistentState;

      if (internal.needsPersist) {
        shouldWrite = true;
        pendingReset.push(internal);
      }

      previousIds.delete(state.id);
    });

    if (previousIds.size > 0) {
      shouldWrite = true;
    }

    if (!shouldWrite) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
      persisted = payload;
      pendingReset.forEach((internal) => {
        internal.needsPersist = false;
      });
    } catch (error) {
      console.warn('Failed to persist window state', error);
    }
  };

  const scheduleFlush = () => {
    if (!browser) {
      const snapshot = Array.from(windows.values()).map((internal) => get(internal.store));
      windowList.set(snapshot);
      return;
    }

    if (flushHandle !== null) {
      return;
    }

    flushHandle = window.requestAnimationFrame(() => {
      flushHandle = null;
      const snapshot = Array.from(windows.values()).map((internal) => get(internal.store));
      windowList.set(snapshot);
      persistIfNeeded();
    });
  };

  const updateFocusFlags = (targetId: string | null) => {
    if (focusedId === targetId) {
      return;
    }

    focusedId = targetId;

    windows.forEach((internal) => {
      internal.store.update((state) => ({
        ...state,
        isFocused: state.id === targetId
      }));
    });

    scheduleFlush();
  };

  const bringToFront = (id: string): number => {
    const internal = windows.get(id);
    if (!internal) {
      return zCursor;
    }

    zCursor += 1;
    internal.store.update((state) => ({
      ...state,
      zIndex: zCursor
    }));
    scheduleFlush();
    return zCursor;
  };

  const focusWindow = (id: string) => {
    const internal = windows.get(id);
    if (!internal) {
      return;
    }

    const state = get(internal.store);
    if (state.isClosed || state.isMinimized) {
      return;
    }

    bringToFront(id);
    updateFocusFlags(id);
  };

  const activateWindow = (id: string) => {
    const internal = windows.get(id);
    if (!internal) {
      return;
    }

    applyUpdate(
      internal,
      (state) => ({
        ...state,
        isMinimized: false,
        isClosed: false
      }),
      { persist: true, interaction: 'programmatic' }
    );

    focusWindow(id);
  };

  const minimizeWindow = (id: string, value: boolean) => {
    const internal = windows.get(id);
    if (!internal) {
      return;
    }

    applyUpdate(
      internal,
      (state) => ({
        ...state,
        isMinimized: value,
        isFocused: value ? false : state.isFocused,
        isClosed: value ? state.isClosed : false
      }),
      { persist: true, interaction: 'programmatic' }
    );

    if (value) {
      if (focusedId === id) {
        updateFocusFlags(null);
      }
    } else {
      focusWindow(id);
    }
  };

  const applyUpdate = (
    internal: InternalWindow,
    mutate: (state: WindowInstanceState) => WindowInstanceState,
    options: WindowUpdateOptions = {}
  ) => {
    const { persist = true, interaction = null } = options;

    internal.store.update((current) => {
      const next = mutate({ ...current });
      if (interaction) {
        next.lastInteraction = interaction;
      }
      return next;
    });

    if (persist) {
      internal.needsPersist = true;
    }

    scheduleFlush();
  };

  const registerWindow = (registration: WindowRegistration): WindowController => {
    const existing = windows.get(registration.id);
    if (existing) {
      return createController(existing);
    }

    const constraints = registration.constraints ?? {};
    const minWidth = constraints.minWidth ?? 240;
    const minHeight = constraints.minHeight ?? 180;
    const maxWidth = constraints.maxWidth ?? null;
    const maxHeight = constraints.maxHeight ?? null;

    const persistedState =
      persisted.version === schemaVersion ? persisted.windows[registration.id] : undefined;

    const baseState = persistedState ?? registration.initialState;
    const bounded = clampToViewport({ ...baseState.bounds });

    const store = writable<WindowInstanceState>({
      id: registration.id,
      title: registration.title,
      bounds: bounded,
      isMaximized: baseState.isMaximized,
      isMinimized: baseState.isMinimized,
      isClosed: baseState.isClosed,
      restoreBounds: baseState.restoreBounds ?? null,
      zIndex: ++zCursor,
      isFocused: false,
      allowClose: registration.behaviors?.closeable ?? true,
      allowMinimize: registration.behaviors?.minimizable ?? true,
      allowMaximize: registration.behaviors?.maximizable ?? true,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      lastInteraction: null
    });

    const internal: InternalWindow = {
      id: registration.id,
      store,
      needsPersist: !persistedState
    };

    windows.set(registration.id, internal);

    if (!baseState.isClosed && !baseState.isMinimized && (registration.restoreFocus ?? true)) {
      focusWindow(registration.id);
    } else {
      scheduleFlush();
    }

    return createController(internal);
  };

  const unregisterWindow = (id: string) => {
    const internal = windows.get(id);
    if (!internal) {
      return;
    }

    windows.delete(id);

    if (focusedId === id) {
      const remaining = Array.from(windows.values())
        .map((entry) => get(entry.store))
        .filter((state) => !state.isMinimized && !state.isClosed);
      if (remaining.length) {
        const top = remaining.reduce((acc, state) => (state.zIndex > acc.zIndex ? state : acc));
        updateFocusFlags(top.id);
      } else {
        updateFocusFlags(null);
      }
    }

    scheduleFlush();
  };

  const createController = (internal: InternalWindow): WindowController => ({
    state: { subscribe: internal.store.subscribe },
    update(partial, options) {
      applyUpdate(
        internal,
        (state) => ({
          ...state,
          ...partial
        }),
        options
      );
    },
    updateState(updater, options) {
      applyUpdate(internal, updater, options);
    },
    focus() {
      focusWindow(internal.id);
    },
    minimize(value, options) {
      applyUpdate(
        internal,
        (state) => ({
          ...state,
          isMinimized: value,
          isFocused: value ? false : state.isFocused,
          isClosed: value ? state.isClosed : false
        }),
        options
      );
      if (!value) {
        focusWindow(internal.id);
      } else if (focusedId === internal.id) {
        updateFocusFlags(null);
      }
    },
    maximize(value, options) {
      applyUpdate(
        internal,
        (state) => {
          if (value === state.isMaximized) {
            return state;
          }

          if (value) {
            const restoreBounds = { ...state.bounds };
            const maxBounds = viewportRect
              ? {
                  x: 0,
                  y: 0,
                  width: viewportRect.width,
                  height: viewportRect.height
                }
              : state.bounds;

            return {
              ...state,
              isMaximized: true,
              restoreBounds,
              bounds: maxBounds
            };
          }

          const restored = state.restoreBounds ?? state.bounds;
          const constrained = clampToViewport(restored);

          return {
            ...state,
            isMaximized: false,
            bounds: constrained,
            restoreBounds: null
          };
        },
        options
      );
      focusWindow(internal.id);
    },
    close(options) {
      applyUpdate(
        internal,
        (state) => ({
          ...state,
          isClosed: true,
          isMinimized: false,
          isFocused: false
        }),
        options
      );
      if (focusedId === internal.id) {
        updateFocusFlags(null);
      }
    },
    reopen(options) {
      applyUpdate(
        internal,
        (state) => ({
          ...state,
          isClosed: false,
          isMinimized: false
        }),
        options
      );
      focusWindow(internal.id);
    }
  });

  onMount(() => {
    if (!container) {
      return;
    }

    const updateViewport = () => {
      viewportRect = container.getBoundingClientRect();
      applyViewportConstraint();
    };

    updateViewport();

    if (browser) {
      resizeObserver = new ResizeObserver(updateViewport);
      resizeObserver.observe(container);
      window.addEventListener('resize', updateViewport);
    }

    return () => {
      if (browser) {
        window.removeEventListener('resize', updateViewport);
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  onDestroy(() => {
    if (browser && flushHandle !== null) {
      window.cancelAnimationFrame(flushHandle);
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  const contextValue: WindowManagerContext = {
    registerWindow,
    unregisterWindow,
    focusWindow,
    bringToFront,
    getViewportBounds: () => viewportRect,
    clampToViewport,
    windows: { subscribe: windowList.subscribe },
    activateWindow,
    minimizeWindow
  };

  setContext(WINDOW_MANAGER_CONTEXT, contextValue);
</script>

<div class="window-manager" bind:this={container}>
  <slot />
</div>

<style>
  .window-manager {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 100vh;
    overflow: hidden;
    touch-action: none;
  }

</style>
