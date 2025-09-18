<script lang="ts">
  import { onMount } from 'svelte';
  import type { SvelteComponent } from 'svelte';
  import Window from './Window.svelte';
  import IframeSandbox from './IframeSandbox.svelte';
  import { logger } from '../lib/logger';
  import type { IslandPluginDefinition, PluginDefinition } from '../plugins/registry';
  import type { WindowPersistentState } from './windowing';

  const browser = typeof window !== 'undefined';

  export let plugin: PluginDefinition;

  let Component: typeof SvelteComponent | null = null;
  let isLoading = false;
  let loadError: string | null = null;
  let hasLoaded = false;
  let lastPluginId = plugin.id;

  let initialState: WindowPersistentState = {
    bounds: { ...plugin.defaultBounds },
    isClosed: !(plugin.startOpen ?? false),
    isMinimized: false,
    isMaximized: false,
    restoreBounds: null
  };

  $: initialState = {
    bounds: { ...plugin.defaultBounds },
    isClosed: !(plugin.startOpen ?? false),
    isMinimized: false,
    isMaximized: false,
    restoreBounds: null
  };

  $: if (plugin.id !== lastPluginId) {
    Component = null;
    loadError = null;
    hasLoaded = false;
    isLoading = false;
    lastPluginId = plugin.id;
  }

  const ensureComponent = async (definition: IslandPluginDefinition) => {
    if (!browser || hasLoaded || Component) {
      return;
    }

    isLoading = true;
    loadError = null;

    try {
      const module = await definition.load();
      if (!module || typeof module.default !== 'function') {
        throw new Error('Plugin module does not export a Svelte component.');
      }
      Component = module.default;
      hasLoaded = true;
      logger.info('Plugin module loaded', { pluginId: definition.id, module: definition.modulePath });
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Unknown plugin loading error.';
      logger.error('Failed to load plugin module', {
        pluginId: definition.id,
        module: definition.modulePath,
        error
      });
    } finally {
      isLoading = false;
    }
  };

  const handleActivate = () => {
    if (plugin.integration === 'island') {
      ensureComponent(plugin);
    }
  };

  onMount(() => {
    if (plugin.integration === 'island' && plugin.startOpen) {
      ensureComponent(plugin);
    }
  });
</script>

<Window
  id={plugin.id}
  title={plugin.title}
  initialBounds={plugin.defaultBounds}
  minWidth={plugin.minWidth ?? 280}
  minHeight={plugin.minHeight ?? 180}
  maxWidth={plugin.maxWidth ?? null}
  maxHeight={plugin.maxHeight ?? null}
  closeable={plugin.allowClose}
  minimizable={plugin.allowMinimize}
  maximizable={plugin.allowMaximize}
  restoreFocus={plugin.restoreFocus}
  initialState={initialState}
  on:activate={handleActivate}
>
  {#if plugin.integration === 'iframe'}
    <IframeSandbox pluginId={plugin.id} title={plugin.title} src={plugin.iframeSrc} sandbox={plugin.sandbox} />
  {:else}
    {#if loadError}
      <div class="plugin-error" role="alert">Failed to load plugin: {loadError}</div>
    {:else if Component}
      <svelte:component this={Component} />
    {:else if isLoading}
      <div class="plugin-loading" role="status">Loading {plugin.title}…</div>
    {:else}
      <div class="plugin-loading" role="status">Activate to launch {plugin.title}.</div>
    {/if}
  {/if}
</Window>

<style>
  .plugin-loading,
  .plugin-error {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 0.85rem;
    text-align: center;
    padding: 1.5rem;
  }

  .plugin-error {
    color: rgb(var(--accent, 160 80 80));
  }
</style>
