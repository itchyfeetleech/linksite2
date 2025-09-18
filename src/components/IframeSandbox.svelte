<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { logger } from '../lib/logger';
  import type { PluginSandboxOptions } from '../plugins/registry';

  const browser = typeof window !== 'undefined';

  export let pluginId: string;
  export let title: string;
  export let src: string;
  export let sandbox: PluginSandboxOptions = {
    allow: null,
    permissions: [],
    allowedOrigins: [],
    initialHeight: null
  };

  let iframeEl: HTMLIFrameElement | null = null;
  let status: 'loading' | 'ready' | 'error' = 'loading';
  let statusMessage = 'Loading plugin…';
  let frameHeight: string | null = null;
  let hasDynamicHeight = false;
  let handshakeTimer: ReturnType<typeof window.setTimeout> | null = null;
  let targetOrigin = '*';
  const originWhitelist = new Set<string>();

  const MIN_HEIGHT = 120;
  const HANDSHAKE_TIMEOUT = 8000;

  const clearHandshakeTimer = () => {
    if (handshakeTimer !== null && browser) {
      window.clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  };

  const scheduleHandshakeTimeout = () => {
    if (!browser) {
      return;
    }
    clearHandshakeTimer();
    handshakeTimer = window.setTimeout(() => {
      if (status === 'ready') {
        return;
      }
      status = 'error';
      statusMessage = 'Plugin did not acknowledge host handshake.';
      logger.warn('Plugin handshake timed out', { pluginId, src });
    }, HANDSHAKE_TIMEOUT);
  };

  const applyInitialHeight = (options: PluginSandboxOptions) => {
    if (hasDynamicHeight) {
      return;
    }
    if (typeof options.initialHeight === 'number' && Number.isFinite(options.initialHeight)) {
      frameHeight = `${Math.max(options.initialHeight, MIN_HEIGHT)}px`;
    } else {
      frameHeight = null;
    }
  };

  const resolveOrigins = (options: PluginSandboxOptions, moduleSrc: string) => {
    if (!browser) {
      return;
    }

    originWhitelist.clear();

    for (const origin of options.allowedOrigins ?? []) {
      if (origin === 'self') {
        originWhitelist.add(window.location.origin);
        continue;
      }
      try {
        const resolved = new URL(origin, window.location.origin);
        originWhitelist.add(resolved.origin);
      } catch (error) {
        logger.warn('Ignoring invalid sandbox origin', { pluginId, origin, error });
      }
    }

    try {
      const resolved = new URL(moduleSrc, window.location.origin);
      targetOrigin = resolved.origin;
      originWhitelist.add(resolved.origin);
    } catch (error) {
      targetOrigin = '*';
      logger.warn('Failed to resolve plugin iframe origin', { pluginId, src: moduleSrc, error });
    }
  };

  const postInitMessage = () => {
    if (!browser || !iframeEl?.contentWindow) {
      return;
    }
    iframeEl.contentWindow.postMessage(
      {
        type: 'biolink-host:init',
        pluginId
      },
      targetOrigin
    );
  };

  const handleMessage = (event: MessageEvent) => {
    if (!iframeEl || event.source !== iframeEl.contentWindow) {
      return;
    }

    if (originWhitelist.size > 0 && !originWhitelist.has(event.origin)) {
      logger.warn('Discarding message from unexpected origin', {
        pluginId,
        origin: event.origin
      });
      return;
    }

    const payload = event.data;
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const type = (payload as { type?: unknown }).type;
    if (typeof type !== 'string') {
      return;
    }

    switch (type) {
      case 'biolink-plugin:ready': {
        clearHandshakeTimer();
        status = 'ready';
        statusMessage = '';
        logger.info('Sandbox plugin ready', { pluginId });
        break;
      }
      case 'biolink-plugin:error': {
        clearHandshakeTimer();
        status = 'error';
        statusMessage =
          typeof (payload as { message?: unknown }).message === 'string'
            ? ((payload as { message?: string }).message ?? 'Plugin reported an error.')
            : 'Plugin reported an error.';
        logger.error('Sandbox plugin reported an error', { pluginId, message: statusMessage });
        break;
      }
      case 'biolink-plugin:resize': {
        const height = (payload as { height?: unknown }).height;
        if (typeof height === 'number' && Number.isFinite(height)) {
          frameHeight = `${Math.max(height, MIN_HEIGHT)}px`;
          hasDynamicHeight = true;
        }
        break;
      }
      default:
        logger.debug('Unhandled sandbox message', { pluginId, type });
        break;
    }
  };

  const handleLoad = () => {
    status = 'loading';
    statusMessage = 'Waiting for plugin…';
    hasDynamicHeight = false;
    applyInitialHeight(sandbox);
    scheduleHandshakeTimeout();
    postInitMessage();
  };

  onMount(() => {
    if (!browser) {
      return;
    }
    resolveOrigins(sandbox, src);
    applyInitialHeight(sandbox);
    window.addEventListener('message', handleMessage);
  });

  onDestroy(() => {
    if (!browser) {
      return;
    }
    clearHandshakeTimer();
    window.removeEventListener('message', handleMessage);
  });

  $: if (browser) {
    resolveOrigins(sandbox, src);
  }

  $: applyInitialHeight(sandbox);

  $: const allowAttr = sandbox.allow?.trim();
  $: const permissionAttr = sandbox.permissions?.length
    ? sandbox.permissions.join('; ')
    : undefined;
</script>

<div class="sandbox" data-state={status}>
  <iframe
    bind:this={iframeEl}
    title={`${title} plugin`}
    src={src}
    sandbox={allowAttr ?? 'allow-scripts allow-same-origin'}
    allow={permissionAttr}
    referrerpolicy="no-referrer"
    loading="lazy"
    on:load={handleLoad}
    style:height={frameHeight ?? '100%'}
  ></iframe>
  {#if status !== 'ready'}
    <div class="sandbox__status" role="status">{statusMessage}</div>
  {/if}
</div>

<style>
  .sandbox {
    position: relative;
    height: 100%;
    width: 100%;
    display: flex;
    align-items: stretch;
  }

  iframe {
    flex: 1;
    border: none;
    background: transparent;
  }

  .sandbox__status {
    position: absolute;
    inset: 0.5rem;
    display: grid;
    place-items: center;
    font-size: 0.85rem;
    color: rgb(var(--muted, 180 180 180));
    background: linear-gradient(145deg, rgb(var(--surface) / 0.9), rgb(var(--surface-glare, 25 25 25) / 0.9));
    border: 1px dashed rgb(var(--accent) / 0.45);
    border-radius: 0.75rem;
    text-align: center;
    padding: 1rem;
    pointer-events: none;
  }
</style>
