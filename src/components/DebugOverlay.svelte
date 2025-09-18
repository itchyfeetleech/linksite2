<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { crtEffects, defaultEffectsState, type CRTToggle } from '../stores/crtEffects';
  import { logger, logs } from '../lib/logger';
  import type { PluginLoadError } from '../plugins/registry';

  export let open = false;
  export let pluginErrors: PluginLoadError[] = [];

  type EffectsState = typeof defaultEffectsState;

  const effectLabels: Record<CRTToggle, string> = {
    scanlines: 'Scanlines',
    glow: 'Glow',
    aberration: 'Aberration',
    barrel: 'Distortion'
  };

  const intensityConfig: Record<CRTToggle, { min: number; max: number; step: number }> = {
    scanlines: { min: 0, max: 1, step: 0.05 },
    glow: { min: 0, max: 1, step: 0.05 },
    aberration: { min: 0, max: 1, step: 0.05 },
    barrel: { min: 0, max: 0.01, step: 0.0005 }
  };

  const storageKeys = [
    'biolink-crt-effects',
    'biolink-desktop-state',
    'biolink-window-state',
    'biolink-profile-cache'
  ];

  const cloneState = (): EffectsState => ({
    ...defaultEffectsState,
    intensity: { ...defaultEffectsState.intensity }
  });

  let state: EffectsState = cloneState();
  $: state = $crtEffects;

  let adjustmentsDisabled = Boolean(state?.plainMode);
  $: adjustmentsDisabled = Boolean(state?.plainMode);

  let showGrid = false;
  let showSafeArea = false;
  let showHitOutlines = false;
  let showFps = true;

  let pluginErrorCount = 0;

  const browser = typeof window !== 'undefined';
  let mounted = false;

  let fps = 0;
  let fpsLabel = '--';

  let fpsRaf = 0;
  let fpsLoopActive = false;
  let fpsPrev = 0;
  let fpsElapsed = 0;
  let fpsFrames = 0;

  const fpsStep = (now: number) => {
    if (!fpsLoopActive) {
      return;
    }
    if (fpsPrev === 0) {
      fpsPrev = now;
      fpsRaf = window.requestAnimationFrame(fpsStep);
      return;
    }
    const delta = now - fpsPrev;
    fpsPrev = now;
    fpsElapsed += delta;
    fpsFrames += 1;

    if (fpsElapsed >= 500) {
      if (fpsElapsed > 0 && fpsFrames > 0) {
        fps = Math.round((fpsFrames / fpsElapsed) * 1000);
      } else {
        fps = 0;
      }
      fpsElapsed = 0;
      fpsFrames = 0;
    }

    fpsRaf = window.requestAnimationFrame(fpsStep);
  };

  const startFpsLoop = () => {
    if (!browser || fpsLoopActive) {
      return;
    }
    fpsLoopActive = true;
    fpsPrev = 0;
    fpsElapsed = 0;
    fpsFrames = 0;
    fpsRaf = window.requestAnimationFrame(fpsStep);
  };

  const stopFpsLoop = () => {
    if (!browser || !fpsLoopActive) {
      return;
    }
    fpsLoopActive = false;
    if (fpsRaf) {
      window.cancelAnimationFrame(fpsRaf);
      fpsRaf = 0;
    }
    fps = 0;
  };

  $: if (mounted) {
    if (showFps) {
      startFpsLoop();
    } else {
      stopFpsLoop();
    }
  }

  $: fpsLabel = fps > 0 ? Math.round(fps).toString() : '--';
  $: pluginErrorCount = pluginErrors.length;

  const shouldIgnoreKeyTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.code === 'KeyD' && event.altKey) {
      if (shouldIgnoreKeyTarget(event.target)) {
        return;
      }
      event.preventDefault();
      open = !open;
      return;
    }

    if (open && event.key === 'Escape') {
      event.preventDefault();
      open = false;
    }
  };

  const setRootFlag = (flag: string, enabled: boolean) => {
    if (!mounted || !browser) {
      return;
    }
    const root = document.documentElement;
    if (enabled) {
      root.dataset[flag] = 'true';
    } else {
      delete root.dataset[flag];
    }
  };

  $: if (mounted) {
    setRootFlag('debugHit', showHitOutlines);
  }

  const formatIntensity = (key: CRTToggle, value: number) => {
    if (key === 'barrel') {
      return `${(value * 1000).toFixed(1)}e-3`;
    }
    return `${Math.round(value * 100)}%`;
  };

  const handleIntensityInput = (key: CRTToggle, event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) {
      return;
    }
    const parsed = Number.parseFloat(target.value);
    if (Number.isNaN(parsed)) {
      return;
    }
    crtEffects.setIntensity(key, parsed);
  };

  const handleEffectToggle = (key: CRTToggle) => {
    crtEffects.toggleEffect(key);
  };

  const handlePlainModeToggle = () => {
    crtEffects.togglePlainMode();
  };

  const resetEffects = () => {
    crtEffects.reset();
    logger.info('CRT effects reset to defaults');
  };

  const handleStateReset = () => {
    if (!browser) {
      logger.warn('State reset ignored outside browser');
      return;
    }

    storageKeys.forEach((key) => {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        logger.warn('Failed to remove stored key', { key, error });
      }
    });

    crtEffects.reset();
    logger.warn('Local state cleared. Reloading…', { keys: storageKeys });
    window.setTimeout(() => window.location.reload(), 200);
  };

  const formatTimestamp = (value: number) =>
    new Date(value).toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

  const stringifyDetail = (detail: unknown): string => {
    if (detail instanceof Error) {
      return detail.stack ?? detail.message;
    }
    if (typeof detail === 'string') {
      return detail;
    }
    if (typeof detail === 'number' || typeof detail === 'boolean') {
      return String(detail);
    }
    if (detail === null) {
      return 'null';
    }
    if (detail === undefined) {
      return 'undefined';
    }
    try {
      return JSON.stringify(detail, null, 2);
    } catch (error) {
      return String(detail);
    }
  };

  const effectKeys: CRTToggle[] = ['scanlines', 'glow', 'aberration', 'barrel'];

  onMount(() => {
    mounted = true;
    window.addEventListener('keydown', handleKeydown);
    if (showFps) {
      startFpsLoop();
    }

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  onDestroy(() => {
    stopFpsLoop();
    setRootFlag('debugHit', false);
  });

  let lastOpen = open;
  $: if (mounted && open !== lastOpen) {
    lastOpen = open;
    logger.debug('Debug overlay toggled', { open });
  }
</script>

<div class="debug-overlay" data-open={open}>
  {#if showGrid}
    <div class="debug-grid" aria-hidden="true"></div>
  {/if}
  {#if showSafeArea}
    <div class="debug-safe-area" aria-hidden="true">
      <div class="debug-safe-box"></div>
    </div>
  {/if}
  {#if showFps}
    <div class="debug-fps" role="status" aria-live="polite">
      <span class="debug-fps__value">{fpsLabel}</span>
      <span class="debug-fps__suffix">FPS</span>
    </div>
  {/if}
  {#if open}
    <section class="debug-panel" role="dialog" aria-modal="false" aria-label="Debug controls">
      <header class="debug-panel__header">
        <h2>Debug Overlay</h2>
        <div class="debug-panel__meta">
          <span class="debug-panel__fps">Live FPS: {fpsLabel}</span>
          <button type="button" class="debug-button subtle" on:click={() => (open = false)}>
            Close
          </button>
        </div>
      </header>

      <div class="debug-section">
        <h3>CRT Effects</h3>
        <label class="debug-checkbox">
          <input type="checkbox" checked={state?.plainMode} on:change={handlePlainModeToggle} />
          <span>Plain mode</span>
        </label>
        {#each effectKeys as key (key)}
          <div class="debug-effect" data-disabled={adjustmentsDisabled}>
            <div class="debug-effect__toggle">
              <label class="debug-checkbox">
                <input
                  type="checkbox"
                  checked={state?.[key]}
                  disabled={adjustmentsDisabled}
                  on:change={() => handleEffectToggle(key)}
                />
                <span>{effectLabels[key]}</span>
              </label>
              <span class="debug-effect__value">{formatIntensity(key, state?.intensity?.[key] ?? 0)}</span>
            </div>
            <input
              class="debug-slider"
              type="range"
              min={intensityConfig[key].min}
              max={intensityConfig[key].max}
              step={intensityConfig[key].step}
              value={state?.intensity?.[key] ?? intensityConfig[key].min}
              disabled={adjustmentsDisabled || !(state?.[key] ?? false)}
              on:input={(event) => handleIntensityInput(key, event)}
            />
          </div>
        {/each}
        <button class="debug-button" type="button" on:click={resetEffects}>Reset effects</button>
      </div>

      <div class="debug-section">
        <h3>Overlays</h3>
        <label class="debug-checkbox">
          <input type="checkbox" bind:checked={showHitOutlines} />
          <span>Hit-test outlines</span>
        </label>
        <label class="debug-checkbox">
          <input type="checkbox" bind:checked={showGrid} />
          <span>Grid overlay</span>
        </label>
        <label class="debug-checkbox">
          <input type="checkbox" bind:checked={showSafeArea} />
          <span>Safe-area overlay</span>
        </label>
        <label class="debug-checkbox">
          <input type="checkbox" bind:checked={showFps} />
          <span>FPS meter</span>
        </label>
      </div>

      <div class="debug-section">
        <h3>State</h3>
        <button class="debug-button destructive" type="button" on:click={handleStateReset}>
          Reset &amp; reload
        </button>
      </div>

      <div class="debug-section">
        <h3>Plugins</h3>
        {#if pluginErrorCount === 0}
          <p class="debug-empty">All plugin manifests loaded successfully.</p>
        {:else}
          <p class="debug-note">Detected {pluginErrorCount} plugin {pluginErrorCount === 1 ? 'issue' : 'issues'}.</p>
          <ul class="debug-plugin-list">
            {#each pluginErrors as error (error.manifestPath)}
              <li class="debug-plugin-list__item">
                <div class="debug-plugin-list__header">
                  <span class="debug-plugin-list__path">{error.manifestPath}</span>
                  <span class="debug-plugin-list__summary">{error.summary}</span>
                </div>
                {#if error.issues.length}
                  <ul class="debug-plugin-list__issues">
                    {#each error.issues as issue, issueIndex (`${error.manifestPath}-${issueIndex}`)}
                      <li>{issue}</li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="debug-section">
        <div class="debug-section__header">
          <h3>Logs</h3>
          <button class="debug-button subtle" type="button" on:click={logger.clear}>
            Clear
          </button>
        </div>
        {#if $logs.length === 0}
          <p class="debug-empty">No log entries yet.</p>
        {:else}
          <ul class="debug-log">
            {#each $logs as entry (entry.id)}
              <li class="debug-log__item" data-level={entry.level}>
                <div class="debug-log__meta">
                  <span class="debug-log__time">{formatTimestamp(entry.timestamp)}</span>
                  <span class="debug-log__level">{entry.level}</span>
                </div>
                <div class="debug-log__message">{entry.message}</div>
                {#if entry.details.length}
                  <div class="debug-log__details">
                    {#each entry.details as detail, index (`${entry.id}-${index}`)}
                      <pre>{stringifyDetail(detail)}</pre>
                    {/each}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .debug-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 90;
    font-family: var(--font-mono);
  }

  .debug-panel {
    position: absolute;
    top: calc(1rem + var(--safe-area-top));
    right: calc(1rem + var(--safe-area-right));
    width: min(360px, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    border-radius: 1rem;
    border: 1px solid rgb(var(--accent) / 0.35);
    background: rgb(var(--bg-glare) / 0.88);
    backdrop-filter: blur(18px);
    box-shadow: 0 18px 48px rgb(var(--accent) / 0.25);
    padding: 1rem;
    display: grid;
    gap: 1.2rem;
    pointer-events: auto;
    color: rgb(var(--accent-soft));
  }

  .debug-panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  .debug-panel__header h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: rgb(var(--accent));
  }

  .debug-panel__meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .debug-panel__fps {
    color: rgb(var(--accent-soft));
  }

  .debug-section {
    display: grid;
    gap: 0.75rem;
  }

  .debug-section h3 {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.28em;
    color: rgb(var(--accent));
  }

  .debug-section__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .debug-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.72rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: inherit;
  }

  .debug-checkbox input {
    accent-color: rgb(var(--accent));
  }

  .debug-effect {
    display: grid;
    gap: 0.5rem;
    padding: 0.6rem;
    border-radius: 0.85rem;
    background: rgb(var(--accent) / 0.08);
  }

  .debug-effect[data-disabled='true'] {
    opacity: 0.55;
  }

  .debug-effect__toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .debug-effect__value {
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .debug-slider {
    width: 100%;
    accent-color: rgb(var(--accent));
  }

  .debug-button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.9rem;
    border-radius: 9999px;
    border: 1px solid rgb(var(--accent) / 0.6);
    background: rgb(var(--bg) / 0.4);
    color: rgb(var(--accent));
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
    pointer-events: auto;
  }

  .debug-button:hover,
  .debug-button:focus-visible {
    border-color: rgb(var(--accent));
    background: rgb(var(--accent) / 0.2);
    outline: none;
  }

  .debug-button.destructive {
    border-color: rgb(255 120 120 / 0.65);
    color: rgb(255 150 150);
    background: rgb(80 0 0 / 0.25);
  }

  .debug-button.destructive:hover,
  .debug-button.destructive:focus-visible {
    background: rgb(255 80 80 / 0.35);
    border-color: rgb(255 160 160 / 0.8);
  }

  .debug-button.subtle {
    border-color: rgb(var(--accent) / 0.3);
    background: rgb(var(--bg) / 0.3);
    color: rgb(var(--accent-soft));
  }

  .debug-button.subtle:hover,
  .debug-button.subtle:focus-visible {
    border-color: rgb(var(--accent) / 0.5);
    background: rgb(var(--accent) / 0.15);
  }

  .debug-empty {
    margin: 0;
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgb(var(--accent-soft) / 0.7);
  }

  .debug-note {
    margin: 0 0 0.6rem 0;
    font-size: 0.65rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgb(var(--accent-soft) / 0.8);
  }

  .debug-plugin-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }

  .debug-plugin-list__item {
    border: 1px solid rgb(var(--accent) / 0.25);
    border-radius: 0.8rem;
    padding: 0.6rem 0.75rem;
    background: rgb(var(--bg) / 0.35);
    color: rgb(var(--accent-soft));
    display: grid;
    gap: 0.4rem;
  }

  .debug-plugin-list__header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .debug-plugin-list__path {
    font-size: 0.68rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 600;
  }

  .debug-plugin-list__summary {
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgb(var(--accent-soft) / 0.75);
  }

  .debug-plugin-list__issues {
    margin: 0;
    padding-left: 1rem;
    display: grid;
    gap: 0.25rem;
    font-size: 0.7rem;
    line-height: 1.4;
    list-style: disc;
  }

  .debug-log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
    max-height: 220px;
    overflow-y: auto;
  }

  .debug-log__item {
    display: grid;
    gap: 0.4rem;
    padding: 0.5rem 0.65rem;
    border-radius: 0.75rem;
    border: 1px solid rgb(var(--accent) / 0.2);
    background: rgb(var(--bg) / 0.35);
    color: rgb(var(--accent-soft));
  }

  .debug-log__item[data-level='warn'] {
    border-color: rgb(255 197 110 / 0.55);
  }

  .debug-log__item[data-level='error'] {
    border-color: rgb(255 120 120 / 0.65);
  }

  .debug-log__meta {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .debug-log__level {
    font-weight: 600;
  }

  .debug-log__message {
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .debug-log__details {
    display: grid;
    gap: 0.35rem;
  }

  .debug-log__details pre {
    margin: 0;
    padding: 0.4rem;
    border-radius: 0.5rem;
    background: rgb(0 0 0 / 0.45);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .debug-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: linear-gradient(
        to right,
        rgb(0 255 180 / 0.08) 1px,
        transparent 1px
      ),
      linear-gradient(to bottom, rgb(0 255 180 / 0.08) 1px, transparent 1px);
    background-size: 80px 80px;
    mix-blend-mode: screen;
    z-index: 0;
  }

  .debug-safe-area {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: block;
    z-index: 0;
  }

  .debug-safe-box {
    position: absolute;
    top: var(--safe-area-top);
    right: var(--safe-area-right);
    bottom: var(--safe-area-bottom);
    left: var(--safe-area-left);
    border: 1px dashed rgb(0 255 200 / 0.75);
    border-radius: 1rem;
    background: rgb(0 255 200 / 0.08);
  }

  .debug-fps {
    position: absolute;
    top: calc(1rem + var(--safe-area-top));
    left: calc(1rem + var(--safe-area-left));
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    border-radius: 9999px;
    border: 1px solid rgb(var(--accent) / 0.4);
    background: rgb(var(--bg) / 0.4);
    color: rgb(var(--accent));
    font-size: 0.75rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    pointer-events: none;
    z-index: 1;
  }

  .debug-fps__value {
    font-size: 1.1rem;
    letter-spacing: 0.1em;
  }

  .debug-fps__suffix {
    font-size: 0.7rem;
    letter-spacing: 0.28em;
  }

  :global(:root[data-debug-hit] a),
  :global(:root[data-debug-hit] button),
  :global(:root[data-debug-hit] [role='button']),
  :global(:root[data-debug-hit] input:not([type='hidden'])),
  :global(:root[data-debug-hit] textarea),
  :global(:root[data-debug-hit] select),
  :global(:root[data-debug-hit] summary),
  :global(:root[data-debug-hit] .window) {
    outline: 1px dashed rgb(0 255 200 / 0.7) !important;
    outline-offset: 2px !important;
  }

  :global(:root[data-debug-hit] .window:focus-within) {
    outline-width: 2px !important;
  }

  @media (max-width: 600px) {
    .debug-panel {
      left: calc(1rem + var(--safe-area-left));
      width: calc(100vw - 2rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .debug-button {
      transition-duration: 0ms;
    }
  }
</style>
