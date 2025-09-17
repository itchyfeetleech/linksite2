<script lang="ts">
  import { createEventDispatcher, getContext, onDestroy, onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import {
    WINDOW_MANAGER_CONTEXT,
    type Bounds,
    type WindowController,
    type WindowInstanceState,
    type WindowManagerContext,
    type WindowPersistentState,
    type WindowRegistration
  } from './windowing';

  type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

  const RESIZE_HANDLES: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

  const defaultPersistentState = (bounds: Bounds): WindowPersistentState => ({
    bounds,
    isMaximized: false,
    isMinimized: false,
    isClosed: false,
    restoreBounds: null
  });

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const manager = getContext<WindowManagerContext | undefined>(WINDOW_MANAGER_CONTEXT);

  if (!manager) {
    throw new Error('Window must be rendered inside a WindowManager.');
  }

  export let id: string;
  export let title: string;
  export let initialBounds: Bounds = {
    x: 80,
    y: 80,
    width: 420,
    height: 280
  };
  export let minWidth = 280;
  export let minHeight = 180;
  export let maxWidth: number | null = null;
  export let maxHeight: number | null = null;
  export let closeable = true;
  export let minimizable = true;
  export let maximizable = true;
  export let restoreFocus = true;
  export let initialState: Partial<WindowPersistentState> = {};

  const windowStore = writable<WindowInstanceState | null>(null);

  let controller: WindowController | null = null;
  let activePointerId: number | null = null;
  let interactionMode: 'drag' | 'resize' | null = null;
  let resizeDirection: ResizeDirection | null = null;
  let pointerOrigin = { x: 0, y: 0 };
  let startBounds: Bounds | null = null;

  let windowElement: HTMLElement | null = null;

  const dispatch = createEventDispatcher<{
    activate: void;
    close: void;
    minimize: boolean;
    maximize: boolean;
  }>();

  const register = () => {
    const persisted: WindowPersistentState = {
      ...defaultPersistentState(initialBounds),
      ...initialState
    };

    const viewport = manager.getViewportBounds();
    const maxWidthLimit = maxWidth ?? viewport?.width ?? Number.POSITIVE_INFINITY;
    const maxHeightLimit = maxHeight ?? viewport?.height ?? Number.POSITIVE_INFINITY;

    const mergedBounds: Bounds = {
      x: persisted.bounds?.x ?? initialBounds.x,
      y: persisted.bounds?.y ?? initialBounds.y,
      width: clamp(persisted.bounds?.width ?? initialBounds.width, minWidth, maxWidthLimit),
      height: clamp(persisted.bounds?.height ?? initialBounds.height, minHeight, maxHeightLimit)
    };

    persisted.bounds = mergedBounds;

    const registration: WindowRegistration = {
      id,
      title,
      initialState: persisted,
      constraints: {
        minWidth,
        minHeight,
        maxWidth,
        maxHeight
      },
      behaviors: {
        closeable,
        minimizable,
        maximizable
      },
      restoreFocus
    };

    controller = manager.registerWindow(registration);

    const unsubscribe = controller.state.subscribe((value) => {
      windowStore.set(value);
    });

    return () => {
      unsubscribe();
      manager.unregisterWindow(id);
    };
  };

  onMount(() => register());

  onDestroy(() => {
    if (activePointerId !== null) {
      windowElement?.releasePointerCapture(activePointerId);
    }
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  });

  const focusWindow = () => {
    controller?.focus();
    windowElement?.focus();
  };

  const handlePointerCleanup = () => {
    if (activePointerId !== null) {
      windowElement?.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    interactionMode = null;
    resizeDirection = null;
    startBounds = null;
    pointerOrigin = { x: 0, y: 0 };
    windowElement?.classList.remove('is-dragging');
    windowElement?.classList.remove('is-resizing');
  };

  const handlePointerUp = () => {
    const state = $windowStore;
    if (!state) {
      handlePointerCleanup();
      return;
    }

    if (interactionMode === 'drag' || interactionMode === 'resize') {
      controller?.updateState(
        (current) => ({
          ...current,
          bounds: manager.clampToViewport(current.bounds)
        }),
        {
          persist: true,
          interaction: interactionMode
        }
      );
    }

    handlePointerCleanup();
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const state = $windowStore;
    if (!state || activePointerId === null || event.pointerId !== activePointerId) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - pointerOrigin.x;
    const deltaY = event.clientY - pointerOrigin.y;

    if (interactionMode === 'drag' && startBounds) {
      const nextBounds = manager.clampToViewport({
        ...startBounds,
        x: startBounds.x + deltaX,
        y: startBounds.y + deltaY
      });

      controller?.update(
        { bounds: nextBounds },
        { persist: false, interaction: 'drag' }
      );

      return;
    }

    if (interactionMode === 'resize' && startBounds && resizeDirection) {
      applyResize(deltaX, deltaY, startBounds, resizeDirection, state);
    }
  };

  const startDrag = (event: PointerEvent) => {
    const state = $windowStore;
    if (!state || state.isMaximized || state.isMinimized || state.isClosed) {
      return;
    }

    event.preventDefault();
    focusWindow();

    activePointerId = event.pointerId;
    interactionMode = 'drag';
    startBounds = { ...state.bounds };
    pointerOrigin = { x: event.clientX, y: event.clientY };

    windowElement?.setPointerCapture(activePointerId);
    windowElement?.classList.add('is-dragging');

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const startResize = (event: PointerEvent, direction: ResizeDirection) => {
    const state = $windowStore;
    if (!state || state.isMaximized || state.isMinimized || state.isClosed) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    focusWindow();

    activePointerId = event.pointerId;
    interactionMode = 'resize';
    resizeDirection = direction;
    startBounds = { ...state.bounds };
    pointerOrigin = { x: event.clientX, y: event.clientY };

    windowElement?.setPointerCapture(activePointerId);
    windowElement?.classList.add('is-resizing');

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const applyResize = (
    deltaX: number,
    deltaY: number,
    initial: Bounds,
    direction: ResizeDirection,
    snapshot: WindowInstanceState
  ) => {
    const viewport = manager.getViewportBounds();

    let left = initial.x;
    let right = initial.x + initial.width;
    let top = initial.y;
    let bottom = initial.y + initial.height;

    if (direction.includes('e')) {
      right = initial.x + initial.width + deltaX;
    }
    if (direction.includes('w')) {
      left = initial.x + deltaX;
    }
    if (direction.includes('s')) {
      bottom = initial.y + initial.height + deltaY;
    }
    if (direction.includes('n')) {
      top = initial.y + deltaY;
    }

    let width = right - left;
    let height = bottom - top;

    const maxWidthLimit = Math.min(snapshot.maxWidth ?? Number.POSITIVE_INFINITY, viewport?.width ?? Number.POSITIVE_INFINITY);
    const maxHeightLimit = Math.min(snapshot.maxHeight ?? Number.POSITIVE_INFINITY, viewport?.height ?? Number.POSITIVE_INFINITY);

    width = clamp(width, snapshot.minWidth, maxWidthLimit);
    height = clamp(height, snapshot.minHeight, maxHeightLimit);

    if (direction.includes('w') && !direction.includes('e')) {
      left = right - width;
    } else {
      right = left + width;
    }

    if (direction.includes('n') && !direction.includes('s')) {
      top = bottom - height;
    } else {
      bottom = top + height;
    }

    if (viewport) {
      const maxX = viewport.width - width;
      const maxY = viewport.height - height;
      left = clamp(left, 0, Math.max(0, maxX));
      top = clamp(top, 0, Math.max(0, maxY));
      right = left + width;
      bottom = top + height;
    }

    const next: Bounds = manager.clampToViewport({
      x: left,
      y: top,
      width,
      height
    });

    controller?.update(
      { bounds: next },
      { persist: false, interaction: 'resize' }
    );
  };

  const toggleMinimize = () => {
    const state = $windowStore;
    if (!controller || !state || !minimizable) {
      return;
    }

    controller.minimize(!state.isMinimized, { persist: true, interaction: 'programmatic' });
    dispatch('minimize', !state.isMinimized);
  };

  const toggleMaximize = () => {
    const state = $windowStore;
    if (!controller || !state || !maximizable) {
      return;
    }

    controller.maximize(!state.isMaximized, { persist: true, interaction: 'programmatic' });
    dispatch('maximize', !state.isMaximized);
  };

  const closeWindow = () => {
    if (!controller || !closeable) {
      return;
    }

    controller.close({ persist: true, interaction: 'programmatic' });
    dispatch('close');
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const state = $windowStore;
    if (!state || event.defaultPrevented) {
      return;
    }

    if (event.target !== windowElement) {
      return;
    }

    if (state.isClosed || state.isMinimized) {
      return;
    }

    const key = event.key;

    if (key.startsWith('Arrow')) {
      event.preventDefault();
      const baseStep = 16;
      const fineStep = 4;
      const coarseStep = 48;
      const step = event.shiftKey ? fineStep : event.altKey ? coarseStep : baseStep;

      if (event.ctrlKey || event.metaKey) {
        let width = state.bounds.width;
        let height = state.bounds.height;
        const viewport = manager.getViewportBounds();
        const widthMax = Math.min(state.maxWidth ?? Number.POSITIVE_INFINITY, viewport?.width ?? Number.POSITIVE_INFINITY);
        const heightMax = Math.min(state.maxHeight ?? Number.POSITIVE_INFINITY, viewport?.height ?? Number.POSITIVE_INFINITY);

        if (key === 'ArrowLeft') {
          width = Math.max(state.minWidth, width - step);
        } else if (key === 'ArrowRight') {
          width = Math.min(widthMax, width + step);
        } else if (key === 'ArrowUp') {
          height = Math.max(state.minHeight, height - step);
        } else if (key === 'ArrowDown') {
          height = Math.min(heightMax, height + step);
        }

        controller?.updateState(
          (current) => ({
            ...current,
            bounds: manager.clampToViewport({
              ...current.bounds,
              width,
              height
            })
          }),
          { persist: true, interaction: 'keyboard' }
        );
      } else {
        let { x, y } = state.bounds;
        if (key === 'ArrowLeft') {
          x -= step;
        } else if (key === 'ArrowRight') {
          x += step;
        } else if (key === 'ArrowUp') {
          y -= step;
        } else if (key === 'ArrowDown') {
          y += step;
        }

        controller?.updateState(
          (current) => ({
            ...current,
            bounds: manager.clampToViewport({
              ...current.bounds,
              x,
              y
            })
          }),
          { persist: true, interaction: 'keyboard' }
        );
      }
      return;
    }

    if (key === 'Enter') {
      dispatch('activate');
      return;
    }

    if (key === 'Escape') {
      event.preventDefault();
      closeWindow();
      return;
    }
  };

  const handleTitleDoubleClick = () => {
    if (!maximizable) {
      return;
    }
    toggleMaximize();
  };
</script>

{#if $windowStore && !$windowStore.isClosed}
  <section
    bind:this={windowElement}
    class="window"
    class:is-focused={$windowStore.isFocused}
    class:is-maximized={$windowStore.isMaximized}
    class:is-minimized={$windowStore.isMinimized}
    style={`--window-z:${$windowStore.zIndex}; top:${$windowStore.bounds.y}px; left:${$windowStore.bounds.x}px; width:${$windowStore.bounds.width}px; height:${$windowStore.bounds.height}px;`}
    tabindex={0}
    role="dialog"
    aria-modal="false"
    aria-label={title}
    on:pointerdown={focusWindow}
    on:keydown={handleKeyDown}
  >
    <header
      class="titlebar"
      on:pointerdown={startDrag}
      on:dblclick={handleTitleDoubleClick}
      role="toolbar"
      aria-label={`Window controls for ${title}`}
    >
      <span class="title-text">{title}</span>
      <div class="title-actions">
        {#if minimizable}
          <button type="button" class="control-button" aria-label="Minimize window" on:click={toggleMinimize}>
            <span aria-hidden="true">_</span>
          </button>
        {/if}
        {#if maximizable}
          <button
            type="button"
            class="control-button"
            aria-label={$windowStore.isMaximized ? 'Restore window' : 'Maximize window'}
            on:click={toggleMaximize}
          >
            <span aria-hidden="true">{$windowStore.isMaximized ? '❐' : '▢'}</span>
          </button>
        {/if}
        {#if closeable}
          <button type="button" class="control-button close" aria-label="Close window" on:click={closeWindow}>
            <span aria-hidden="true">×</span>
          </button>
        {/if}
      </div>
    </header>
    <div class="window-body" tabindex={-1}>
      <slot />
    </div>
    {#if !$windowStore.isMaximized}
      {#each RESIZE_HANDLES as handle}
        <div
          class={`resize-handle resize-${handle}`}
          data-handle={handle}
          on:pointerdown={(event) => startResize(event, handle)}
        />
      {/each}
    {/if}
  </section>
{/if}

<style>
  .window {
    position: absolute;
    z-index: var(--window-z, 1);
    background: rgb(var(--surface-glare, 18 18 18) / 0.92);
    border: 1px solid rgb(var(--accent) / 0.35);
    backdrop-filter: blur(12px);
    border-radius: 1rem;
    box-shadow: 0 1.2rem 2.4rem rgb(0 0 0 / 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: box-shadow 180ms ease;
  }

  .window:focus {
    outline: none;
  }

  .window.is-focused {
    box-shadow: 0 1.6rem 3rem rgb(var(--accent, 120 200 120) / 0.35);
    border-color: rgb(var(--accent) / 0.5);
  }

  .window.is-minimized {
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
  }

  .window.is-maximized {
    border-radius: 0.6rem;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.65rem 0.9rem;
    background: linear-gradient(120deg, rgb(var(--accent) / 0.12), rgb(var(--accent-soft, 160 220 160) / 0.08));
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.24em;
    font-size: 0.7rem;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .window.is-dragging .titlebar,
  .window.is-resizing .titlebar {
    cursor: grabbing;
  }

  .title-text {
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .control-button {
    appearance: none;
    border: 1px solid transparent;
    background: rgb(var(--accent) / 0.18);
    color: rgb(var(--accent));
    width: 1.65rem;
    height: 1.25rem;
    border-radius: 0.45rem;
    font-size: 0.8rem;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    touch-action: manipulation;
  }

  .control-button:hover,
  .control-button:focus-visible {
    background: rgb(var(--accent) / 0.3);
    border-color: rgb(var(--accent) / 0.6);
    outline: none;
  }

  .control-button.close {
    background: rgb(255 80 80 / 0.2);
    color: rgb(255 140 140 / 0.9);
  }

  .control-button.close:hover,
  .control-button.close:focus-visible {
    background: rgb(255 80 80 / 0.35);
    border-color: rgb(255 150 150 / 0.6);
  }

  .window-body {
    flex: 1;
    padding: 1rem;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    background: rgb(var(--surface, 10 10 10) / 0.65);
  }

  .resize-handle {
    position: absolute;
    width: 12px;
    height: 12px;
    background: transparent;
    touch-action: none;
  }

  .resize-n {
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .resize-s {
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .resize-e {
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .resize-w {
    left: -6px;
    top: 50%;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .resize-ne {
    right: -6px;
    top: -6px;
    cursor: nesw-resize;
  }

  .resize-se {
    right: -6px;
    bottom: -6px;
    cursor: nwse-resize;
  }

  .resize-sw {
    left: -6px;
    bottom: -6px;
    cursor: nesw-resize;
  }

  .resize-nw {
    left: -6px;
    top: -6px;
    cursor: nwse-resize;
  }

  @media (max-width: 600px) {
    .window {
      border-radius: 0.75rem;
    }

    .titlebar {
      letter-spacing: 0.18em;
      font-size: 0.65rem;
      padding: 0.55rem 0.75rem;
    }

    .window-body {
      padding: 0.8rem;
    }
  }
</style>
