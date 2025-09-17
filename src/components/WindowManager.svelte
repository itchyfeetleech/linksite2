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
  export let dockLabel = 'Window dock';

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

    for (const internal of windows.values()) {
      if (!internal.needsPersist) {
        continue;
      }

      const state = get(internal.store);
      payload.windows[state.id] = {
        bounds: { ...state.bounds },
        isMaximized: state.isMaximized,
        isMinimized: state.isMinimized,
        isClosed: state.isClosed,
        restoreBounds: state.restoreBounds ?? null
      } satisfies WindowPersistentState;
      shouldWrite = true;
      internal.needsPersist = false;
    }

    if (!shouldWrite) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
      persisted = payload;
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

  const handleDockActivate = (id: string) => {
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
    clampToViewport
  };

  setContext(WINDOW_MANAGER_CONTEXT, contextValue);

  let dockWindows: WindowInstanceState[] = [];

  $: dockWindows = $windowList.filter((win) => (win.isMinimized || win.isClosed));
</script>

<div class="window-manager" bind:this={container}>
  <slot />
  {#if dockWindows.length}
    <div class="window-dock" role="toolbar" aria-label={dockLabel}>
      {#each dockWindows as win (win.id)}
        <button
          type="button"
          class="dock-item"
          data-state={win.isClosed ? 'closed' : 'minimized'}
          on:click={() => handleDockActivate(win.id)}
        >
          {#if win.isClosed}
            <span aria-hidden="true" class="dock-indicator">●</span>
          {/if}
          {win.title}
        </button>
      {/each}
    </div>
  {/if}
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

  .window-dock {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 999px;
    background: rgb(var(--surface-glare, 15 15 15) / 0.85);
    backdrop-filter: blur(10px);
    border: 1px solid rgb(var(--accent) / 0.35);
    box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.35);
    z-index: 9999;
  }

  .dock-item {
    appearance: none;
    border: none;
    outline: none;
    background: rgb(var(--accent) / 0.12);
    color: rgb(var(--accent));
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    padding: 0.35rem 0.8rem;
    border-radius: 999px;
    font-size: 0.65rem;
    cursor: pointer;
    transition: background 150ms ease, transform 150ms ease, color 150ms ease, box-shadow 150ms ease;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .dock-item:hover,
  .dock-item:focus-visible {
    background: rgb(var(--accent) / 0.2);
    color: rgb(var(--accent-soft, 180 255 180));
    transform: translateY(-1px);
  }

  .dock-item:focus-visible {
    box-shadow: 0 0 0 2px rgb(var(--accent) / 0.45);
  }

  .dock-item[data-state='closed'] {
    background: rgb(255 90 90 / 0.18);
    color: rgb(255 190 190 / 0.9);
  }

  .dock-item[data-state='closed']:hover,
  .dock-item[data-state='closed']:focus-visible {
    background: rgb(255 90 90 / 0.28);
    color: rgb(255 220 220);
  }

  .dock-indicator {
    font-size: 0.7rem;
    line-height: 1;
  }
</style>
