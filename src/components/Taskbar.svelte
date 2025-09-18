<script lang="ts">
  import { createEventDispatcher, getContext, onDestroy, onMount, tick } from 'svelte';
  import {
    WINDOW_MANAGER_CONTEXT,
    type WindowInstanceState,
    type WindowManagerContext
  } from './windowing';
  import type { IconKind, PluginDefinition } from '../plugins/registry';

  const manager = getContext<WindowManagerContext | undefined>(WINDOW_MANAGER_CONTEXT);
  if (!manager) {
    throw new Error('Taskbar must be rendered inside a WindowManager.');
  }

  export let linksWindowId = 'links';
  export let plugins: PluginDefinition[] = [];

  const windowsStore = manager.windows;

  let windowEntries: WindowInstanceState[] = [];
  $: windowEntries = $windowsStore.filter((win) => !win.isClosed);

  let minimizedIds = new Set<string>();
  $: minimizedIds = new Set(windowEntries.filter((win) => win.isMinimized).map((win) => win.id));

  let activeWindowId: string | null = null;
  $: activeWindowId = $windowsStore.find((win) => win.isFocused)?.id ?? null;

  let rovingIndex = 0;
  let lastActiveId: string | null = null;

  $: {
    if (windowEntries.length === 0) {
      rovingIndex = 0;
      lastActiveId = null;
    } else if (rovingIndex > windowEntries.length - 1) {
      rovingIndex = windowEntries.length - 1;
    }
  }

  $: if (activeWindowId !== lastActiveId) {
    if (activeWindowId) {
      const nextIndex = windowEntries.findIndex((win) => win.id === activeWindowId);
      if (nextIndex !== -1) {
        rovingIndex = nextIndex;
      }
    }
    lastActiveId = activeWindowId;
  }

  interface LauncherItem {
    id: string;
    label: string;
    description: string;
    icon: string;
    iconKind: IconKind;
  }

  let startItems: LauncherItem[] = [];
  let pinnedApps: LauncherItem[] = [];
  let pluginStartEntries: LauncherItem[] = [];
  let pluginPinnedEntries: LauncherItem[] = [];

  const baseLauncher = (): LauncherItem => ({
    id: linksWindowId,
    label: 'Links',
    description: 'Launch the Links app',
    icon: '🔗',
    iconKind: 'glyph'
  });

  const createLauncherFromPlugin = (plugin: PluginDefinition): LauncherItem => ({
    id: plugin.id,
    label: plugin.title,
    description: plugin.description?.length ? plugin.description : `Launch ${plugin.title}`,
    icon: plugin.icon,
    iconKind: plugin.iconKind
  });

  $: pluginStartEntries = plugins
    .filter((plugin) => plugin.showInStart)
    .map(createLauncherFromPlugin);

  $: pluginPinnedEntries = plugins.filter((plugin) => plugin.pinned).map(createLauncherFromPlugin);

  $: startItems = [baseLauncher(), ...pluginStartEntries];

  $: pinnedApps = [baseLauncher(), ...pluginPinnedEntries];

  const dispatch = createEventDispatcher<{ longpress: void }>();

  let startOpen = false;
  const startMenuId = 'taskbar-start-menu';

  let startButton: HTMLButtonElement | null = null;
  let startMenu: HTMLDivElement | null = null;
  let startMenuItems: (HTMLButtonElement | null)[] = [];
  let windowButtons: (HTMLButtonElement | null)[] = [];

  const LONG_PRESS_DELAY = 600;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  let currentTime = new Date();
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  const updateTime = () => {
    currentTime = new Date();
  };

  const beginLongPress = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') {
      return;
    }
    cancelLongPress();
    longPressTimer = window.setTimeout(() => {
      dispatch('longpress');
      longPressTimer = null;
    }, LONG_PRESS_DELAY);
  };

  const cancelLongPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const toggleStartMenu = () => {
    startOpen = !startOpen;
    if (!startOpen) {
      startMenuItems = [];
    }
  };

  const closeStartMenu = () => {
    if (!startOpen) {
      return;
    }
    startOpen = false;
    startMenuItems = [];
    startButton?.focus();
  };

  $: if (startOpen) {
    tick().then(() => {
      startMenuItems[0]?.focus();
    });
  }

  const handleGlobalPointerDown = (event: PointerEvent) => {
    if (!startOpen) {
      return;
    }
    const target = event.target as Node | null;
    if (startMenu?.contains(target) || startButton?.contains(target)) {
      return;
    }
    startOpen = false;
    startMenuItems = [];
  };

  const handleGlobalKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && startOpen) {
      event.preventDefault();
      closeStartMenu();
    }
  };

  onMount(() => {
    updateTime();
    clockTimer = window.setInterval(updateTime, 1000);
    window.addEventListener('pointerdown', handleGlobalPointerDown);
    window.addEventListener('keydown', handleGlobalKeydown);

    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown);
      window.removeEventListener('keydown', handleGlobalKeydown);
      if (clockTimer !== null) {
        window.clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  });

  onDestroy(() => {
    cancelLongPress();
  });

  $: timeLabel = currentTime.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  $: isoTime = currentTime.toISOString();

  const launchApp = (id: string) => {
    if (!id) {
      return;
    }
    manager.activateWindow(id);
    startOpen = false;
    startMenuItems = [];
  };

  const focusWindowButton = (index: number) => {
    if (!windowEntries.length) {
      return;
    }
    const normalized = (index + windowEntries.length) % windowEntries.length;
    rovingIndex = normalized;
    windowButtons[normalized]?.focus();
  };

  const handleWindowClick = (win: WindowInstanceState) => {
    if (win.isMinimized) {
      manager.activateWindow(win.id);
      return;
    }
    if (win.isFocused) {
      manager.minimizeWindow(win.id, true);
      return;
    }
    manager.focusWindow(win.id);
  };

  const handleWindowKeydown = (event: KeyboardEvent, index: number, win: WindowInstanceState) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        focusWindowButton(index + 1);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        focusWindowButton(index - 1);
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusWindowButton(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        focusWindowButton(windowEntries.length - 1);
        break;
      }
      case 'Enter':
      case ' ': // Space key
      case 'Spacebar': {
        event.preventDefault();
        handleWindowClick(win);
        break;
      }
      default:
        break;
    }
  };

  const handleStartMenuKeydown = (event: KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight': {
        event.preventDefault();
        focusStartMenuItem(index + 1);
        break;
      }
      case 'ArrowUp':
      case 'ArrowLeft': {
        event.preventDefault();
        focusStartMenuItem(index - 1);
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusStartMenuItem(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        focusStartMenuItem(startItems.length - 1);
        break;
      }
      case 'Escape': {
        event.preventDefault();
        closeStartMenu();
        break;
      }
      case 'Enter':
      case ' ': // Space key
      case 'Spacebar': {
        event.preventDefault();
        const item = startItems[index];
        if (item) {
          launchApp(item.id);
        }
        break;
      }
      default:
        break;
    }
  };

  const focusStartMenuItem = (index: number) => {
    if (!startItems.length) {
      return;
    }
    const normalized = (index + startItems.length) % startItems.length;
    const target = startMenuItems[normalized];
    target?.focus();
  };

  const handleWindowFocus = (index: number) => {
    rovingIndex = index;
  };
</script>

<nav
  class="pointer-events-auto fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 flex w-[min(100%-1rem,64rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-surface/80 px-3 py-2 text-xs text-text backdrop-blur supports-[backdrop-filter]:bg-surface/60 sm:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:w-[min(100%-1.5rem,72rem)] sm:flex-nowrap sm:gap-3"
  aria-label="Desktop taskbar"
  on:pointerdown={beginLongPress}
  on:pointerup={cancelLongPress}
  on:pointercancel={cancelLongPress}
  on:pointerleave={cancelLongPress}
>
  <div class="flex items-center gap-2 sm:gap-3">
    <button
      bind:this={startButton}
      type="button"
      class="inline-flex min-h-10 min-w-10 items-center gap-2 rounded-xl border border-transparent bg-accent/20 px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-text transition hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-[0.75rem]"
      aria-haspopup="true"
      aria-expanded={startOpen}
      aria-controls={startMenuId}
      on:click={toggleStartMenu}
    >
      <span aria-hidden="true" class="text-base">▤</span>
      <span class="hidden sm:inline">Start</span>
      <span class="sr-only">Open start menu</span>
    </button>

    <div class="flex items-center gap-1 sm:gap-2" role="toolbar" aria-label="Pinned apps">
      {#each pinnedApps as app (app.id)}
        <button
          type="button"
          class="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-transparent bg-accent/10 px-2 text-base transition hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label={`Launch ${app.label}`}
          title={app.description}
          on:click={() => launchApp(app.id)}
        >
          {#if app.iconKind === 'image'}
            <img src={app.icon} alt="" class="h-6 w-6" loading="lazy" decoding="async" />
          {:else}
            <span aria-hidden="true">{app.icon}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div
    class="flex min-h-10 flex-1 items-center gap-1 overflow-x-auto rounded-xl border border-accent/25 bg-surface/70 px-2 py-1 text-[0.75rem] text-text supports-[backdrop-filter]:bg-surface/40"
    role="listbox"
    aria-label="Open windows"
  >
    {#if windowEntries.length === 0}
      <span class="px-2 py-1 text-muted">No windows open</span>
    {:else}
      {#each windowEntries as win, index (win.id)}
        <button
          bind:this={windowButtons[index]}
          type="button"
          class="flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.75rem] text-text transition data-[state=active]:bg-accent/30 data-[state=active]:text-text data-[state=minimized]:opacity-70 hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          role="option"
          aria-selected={win.isFocused}
          data-state={win.isFocused ? 'active' : win.isMinimized ? 'minimized' : 'inactive'}
          tabindex={index === rovingIndex ? 0 : -1}
          on:click={() => handleWindowClick(win)}
          on:keydown={(event) => handleWindowKeydown(event, index, win)}
          on:focus={() => handleWindowFocus(index)}
        >
          <span class="inline-flex h-2 w-2 rounded-full bg-accent/40 data-[state=active]:bg-accent-soft" data-state={win.isFocused ? 'active' : win.isMinimized ? 'minimized' : 'inactive'}></span>
          <span class="max-w-[10rem] truncate sm:max-w-[14rem]">
            {win.title}
            {#if minimizedIds.has(win.id)}
              <span class="ml-1 text-[0.6rem] uppercase tracking-[0.2em] text-muted">min</span>
            {/if}
          </span>
        </button>
      {/each}
    {/if}
  </div>

  <div class="flex w-full flex-col items-stretch gap-1 text-right sm:w-auto sm:flex-row sm:items-center sm:gap-3">
    <div class="flex h-10 items-center justify-end gap-2 rounded-xl border border-accent/25 bg-surface/60 px-3 text-[0.65rem] uppercase tracking-[0.3em] text-muted supports-[backdrop-filter]:bg-surface/40">
      <span>Status</span>
      <span aria-hidden="true" class="font-mono text-[0.7rem] tracking-[0.15em] text-accent">--</span>
    </div>
    <time
      class="flex h-10 items-center justify-end rounded-xl border border-accent/30 bg-accent/10 px-3 font-mono text-sm tracking-[0.2em] text-text shadow-sm supports-[backdrop-filter]:bg-accent/15"
      datetime={isoTime}
    >
      {timeLabel}
    </time>
  </div>

{#if startOpen}
  <div
    bind:this={startMenu}
    id={startMenuId}
    role="menu"
    aria-label="Start menu"
    class="absolute bottom-full left-3 z-50 mb-2 w-56 rounded-2xl border border-accent/35 bg-surface/90 p-3 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-surface/75"
  >
    <h2 class="mb-2 font-mono text-[0.7rem] uppercase tracking-[0.3em] text-muted">Apps</h2>
    <div class="flex flex-col gap-2">
      {#each startItems as item, index (item.id)}
        <button
          bind:this={startMenuItems[index]}
          type="button"
          class="flex items-start gap-3 rounded-xl border border-transparent bg-accent/10 px-3 py-2 text-left text-sm text-text transition hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          role="menuitem"
          on:click={() => launchApp(item.id)}
          on:keydown={(event) => handleStartMenuKeydown(event, index)}
        >
          {#if item.iconKind === 'image'}
            <img src={item.icon} alt="" class="start-icon" loading="lazy" decoding="async" />
          {:else}
            <span aria-hidden="true" class="start-icon start-icon--glyph">{item.icon}</span>
          {/if}
          <span class="flex flex-col">
            <span class="font-semibold tracking-[0.08em]">{item.label}</span>
            <span class="text-[0.75rem] text-muted">{item.description}</span>
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}
</nav>

<style>
  .start-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.4rem;
    object-fit: contain;
  }

  .start-icon--glyph {
    font-size: 1.1rem;
    line-height: 1;
  }

  .start-icon:not(.start-icon--glyph) {
    background: rgb(var(--surface, 12 12 12) / 0.5);
    border: 1px solid rgb(var(--accent, 150 200 150) / 0.25);
    padding: 0.15rem;
  }
</style>
