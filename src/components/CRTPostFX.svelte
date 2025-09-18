<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { crtEffects } from '../stores/crtEffects';
  import type { CRTEffectsState, CRTModePreference } from '../stores/crtEffects';
  import { logger } from '../lib/logger';
  import {
    createDomCapture,
    type CaptureStats,
    type DomCaptureController
  } from '../lib/crt/capture';
  import { createWebGpuRenderer } from '../lib/crt/webgpuRenderer';
  import { createWebGl2Renderer } from '../lib/crt/webgl2Renderer';
  import {
    createEventProxy,
    type CursorState,
    type EventProxyController,
    type PointerActivityState
  } from '../lib/crt/eventProxy';
  import { createLutController } from '../lib/crt/lutController';
  import type { CRTGpuRenderer, CRTRenderMode } from '../lib/crt/types';
  import type { LutResult } from '../lib/crt/geometryMath';
  import { UNIFORM_FLOAT_COUNT } from '../lib/crt/types';

  const BADGE_LABELS: Record<CRTRenderMode, string> = {
    webgpu: 'WebGPU',
    webgl2: 'WebGL2',
    css: 'CSS'
  };

  const RESOLUTION_OFFSET = 0;
  const TIMING_OFFSET = 4;
  const EFFECTS_OFFSET = 8;
  const BLOOM_OFFSET = 12;
  const CSS_OFFSET = 16;
  const CURSOR_STATE_OFFSET = 20;
  const CURSOR_META_OFFSET = 24;

  const POINTER_INDEX: Record<string, number> = {
    mouse: 0,
    touch: 1,
    pen: 2
  };

  let container: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;

  let renderMode: CRTRenderMode = 'css';
  let badgeLabel = BADGE_LABELS.css;
  let canvasHidden = true;
  let interactive = false;

  let effectState: CRTEffectsState | null = null;
  let renderer: CRTGpuRenderer | null = null;
  let domCapture: DomCaptureController | null = null;
  let eventProxy: EventProxyController | null = null;
  const lutController = createLutController();
  let currentLut: LutResult | null = null;

  const uniforms = new Float32Array(UNIFORM_FLOAT_COUNT);

  let reduceMotion = false;
  let reduceMotionQuery: MediaQueryList | null = null;
  let motionListener: ((event: MediaQueryListEvent) => void) | null = null;

  let hasTexture = false;
  let running = false;
  let rafId = 0;
  let lastFrame = 0;

  let dpr = 1;
  let cssWidth = 1;
  let cssHeight = 1;

  let pointerDown = false;

  let captureDurationAccumulator = 0;
  let captureSamples = 0;
  let proxyLatencyAccumulator = 0;
  let proxyLatencySamples = 0;
  let fpsAccumulator = 0;
  let fpsSamples = 0;

  let availableWebGPU = false;
  let availableWebGL2 = false;
  let detectionComplete = false;
  let requestedPreference: CRTModePreference = 'auto';
  let switchingMode = false;
  let pendingModeCheck = false;
  let destroyed = false;

  const geometryParams = { width: 1, height: 1, dpr: 1, k1: 0, k2: 0 };
  let geometryRevision = 0;
  let geometryDirty = true;

  const setVec4 = (offset: number, a: number, b: number, c: number, d: number) => {
    uniforms[offset] = a;
    uniforms[offset + 1] = b;
    uniforms[offset + 2] = c;
    uniforms[offset + 3] = d;
  };

  const pointerIndex = (type: string) => POINTER_INDEX[type] ?? 0;

  const getIdleThrottle = () => (reduceMotion ? 180 : 120);
  const getDragThrottle = () => (reduceMotion ? 34 : 24);

  const setCanvasInteractionEnabled = (enabled: boolean) => {
    if (!canvas) {
      return;
    }
    canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    canvas.style.cursor = enabled ? 'none' : '';
  };

  const updateBadge = () => {
    const base = BADGE_LABELS[renderMode] ?? renderMode.toUpperCase();
    badgeLabel = effectState?.plainMode ? `${base} · Plain` : base;
  };

  const applyBarrelCoefficients = () => {
    const state = effectState;
    const enabled = Boolean(state && !state.plainMode && state.barrel);
    let k1 = 0;
    let k2 = 0;
    if (enabled) {
      const intensity = state?.intensity.barrel ?? 0;
      const curvature = Math.min(1.25, intensity * 260);
      k1 = -0.22 * curvature;
      k2 = -0.09 * curvature * curvature;
    }
    geometryParams.k1 = k1;
    geometryParams.k2 = k2;
    uniforms[BLOOM_OFFSET + 2] = k1;
    uniforms[BLOOM_OFFSET + 3] = k2;
  };

  const scheduleGeometryUpdate = () => {
    if (!renderer || renderMode === 'css') {
      geometryDirty = true;
      return;
    }
    geometryDirty = false;
    const params = { ...geometryParams };
    const version = ++geometryRevision;

    const run = async () => {
      try {
        if (!renderer) {
          return;
        }
        if (renderer.mode === 'webgl2') {
          const lut = await lutController.request(params);
          if (geometryRevision !== version || !renderer || renderer.mode !== 'webgl2') {
            return;
          }
          currentLut = lut;
          eventProxy?.updateLut(lut);
          await renderer.updateGeometry(params, lut);
        } else {
          await renderer.updateGeometry(params);
          const lut = await lutController.request(params);
          if (geometryRevision !== version) {
            return;
          }
          currentLut = lut;
          eventProxy?.updateLut(lut);
        }
      } catch (error) {
        if (!destroyed) {
          logger.warn('CRT postFX LUT update failed', error);
        }
      }
    };

    void run();
  };

  const updateEffectUniforms = () => {
    const state = effectState;
    const plain = state?.plainMode ?? false;
    const scanlines = plain || !(state?.scanlines ?? false) ? 0 : state.intensity.scanlines;
    const glow = plain || !(state?.glow ?? false) ? 0 : state.intensity.glow;
    const aberration = plain || !(state?.aberration ?? false) ? 0 : state.intensity.aberration;
    const slotMask = scanlines > 0 ? Math.min(1, 0.35 + scanlines * 0.85) : 0;
    const vignette = plain ? 0 : 0.35;
    const baseBloom = plain ? 0 : glow;
    const noiseBase = plain ? 0 : 0.05;
    const noise = reduceMotion ? 0 : Math.min(0.18, noiseBase + scanlines * 0.08);
    const threshold = plain ? 1 : 0.7;
    const softness = plain ? 0.1 : 0.65;

    uniforms[TIMING_OFFSET + 1] = scanlines;
    uniforms[TIMING_OFFSET + 2] = slotMask;
    uniforms[TIMING_OFFSET + 3] = vignette;
    uniforms[EFFECTS_OFFSET + 0] = baseBloom;
    uniforms[EFFECTS_OFFSET + 1] = aberration;
    uniforms[EFFECTS_OFFSET + 2] = noise;
    uniforms[BLOOM_OFFSET + 0] = threshold;
    uniforms[BLOOM_OFFSET + 1] = softness;

    applyBarrelCoefficients();
    geometryDirty = true;
    if (renderer && renderMode !== 'css') {
      scheduleGeometryUpdate();
    }
    updateBadge();
  };

  const updateCanvasSize = () => {
    if (!canvas) {
      return;
    }
    const nextDpr = window.devicePixelRatio || 1;
    const nextCssWidth = Math.max(1, Math.round(window.innerWidth));
    const nextCssHeight = Math.max(1, Math.round(window.innerHeight));
    const deviceWidth = Math.max(1, Math.round(nextCssWidth * nextDpr));
    const deviceHeight = Math.max(1, Math.round(nextCssHeight * nextDpr));

    dpr = nextDpr;
    cssWidth = nextCssWidth;
    cssHeight = nextCssHeight;

    setVec4(RESOLUTION_OFFSET, deviceWidth, deviceHeight, 1 / deviceWidth, 1 / deviceHeight);
    uniforms[EFFECTS_OFFSET + 3] = dpr;
    setVec4(CSS_OFFSET, cssWidth, cssHeight, 1 / cssWidth, 1 / cssHeight);

    geometryParams.width = cssWidth;
    geometryParams.height = cssHeight;
    geometryParams.dpr = dpr;

    renderer?.resize(deviceWidth, deviceHeight, cssWidth, cssHeight);
    geometryDirty = true;
  };

  const logCaptureDuration = (duration: number) => {
    captureDurationAccumulator += duration;
    captureSamples += 1;
    if (captureSamples >= 15) {
      const average = captureDurationAccumulator / captureSamples;
      logger.debug('CRT postFX capture stats', {
        mode: renderMode,
        avgMs: Number(average.toFixed(2)),
        samples: captureSamples
      });
      captureDurationAccumulator = 0;
      captureSamples = 0;
    }
  };

  const logProxyLatency = (value: number) => {
    proxyLatencyAccumulator += value;
    proxyLatencySamples += 1;
    if (proxyLatencySamples >= 30) {
      const average = proxyLatencyAccumulator / proxyLatencySamples;
      logger.debug('CRT postFX proxy latency', {
        mode: renderMode,
        avgMs: Number(average.toFixed(2)),
        samples: proxyLatencySamples
      });
      proxyLatencyAccumulator = 0;
      proxyLatencySamples = 0;
    }
  };

  const logFrameTime = (delta: number) => {
    fpsAccumulator += delta;
    fpsSamples += 1;
    if (fpsAccumulator >= 1000 && fpsSamples > 0) {
      const average = fpsAccumulator / fpsSamples;
      const fps = 1000 / average;
      logger.debug('CRT postFX frame stats', {
        mode: renderMode,
        fps: Number(fps.toFixed(1)),
        frameMs: Number(average.toFixed(2))
      });
      fpsAccumulator = 0;
      fpsSamples = 0;
    }
  };

  const shouldRender = () =>
    renderMode !== 'css' &&
    renderer !== null &&
    hasTexture &&
    !(effectState?.plainMode ?? false) &&
    !(typeof document !== 'undefined' && document.hidden);

  const step = (now: number) => {
    if (!running) {
      return;
    }

    const delta = now - lastFrame;
    const minInterval = reduceMotion ? 1000 / 30 : 0;
    if (minInterval > 0 && delta < minInterval) {
      rafId = window.requestAnimationFrame(step);
      return;
    }

    lastFrame = now;
    uniforms[TIMING_OFFSET + 0] = now * 0.001;
    renderer?.render(uniforms);
    logFrameTime(delta);

    rafId = window.requestAnimationFrame(step);
  };

  const startLoop = () => {
    if (running || !renderer || !shouldRender()) {
      return;
    }
    running = true;
    lastFrame = performance.now();
    rafId = window.requestAnimationFrame(step);
  };

  const stopLoop = () => {
    if (!running) {
      return;
    }
    running = false;
    window.cancelAnimationFrame(rafId);
    fpsAccumulator = 0;
    fpsSamples = 0;
  };

  const updateRenderState = () => {
    updateBadge();
    const active = renderMode !== 'css' && !(effectState?.plainMode ?? false);
    interactive = active;
    canvasHidden = !active || !hasTexture;

    const pauseCapture = !active || (typeof document !== 'undefined' ? document.hidden : true);
    domCapture?.setPaused(pauseCapture);

    if (!active) {
      stopLoop();
      setCanvasInteractionEnabled(false);
      return;
    }

    setCanvasInteractionEnabled(true);

    if (!hasTexture) {
      domCapture?.trigger();
      stopLoop();
      return;
    }

    if (shouldRender()) {
      startLoop();
    }
  };

  const handlePointerActivity = (state: PointerActivityState) => {
    pointerDown = state.pointerDown;
    uniforms[CURSOR_META_OFFSET + 1] = pointerDown ? 0.55 : 1;
    domCapture?.updateThrottle(pointerDown ? getDragThrottle() : getIdleThrottle());
    if (pointerDown) {
      domCapture?.trigger();
    }
    updateRenderState();
  };

  const handleCursorUpdate = (state: CursorState) => {
    uniforms[CURSOR_STATE_OFFSET + 0] = state.domX;
    uniforms[CURSOR_STATE_OFFSET + 1] = state.domY;
    uniforms[CURSOR_STATE_OFFSET + 2] = state.visible ? 1 : 0;
    uniforms[CURSOR_STATE_OFFSET + 3] = state.buttons;
    uniforms[CURSOR_META_OFFSET + 0] = pointerIndex(state.pointerType);
    if (pointerDown) {
      domCapture?.trigger();
    }
  };

  const handleCapture = async (frame: CaptureFrame, stats: CaptureStats) => {
    logCaptureDuration(stats.duration);
    if (!renderer) {
      frame.bitmap.close();
      return;
    }

    try {
      await renderer.updateTexture(frame);
      hasTexture = true;

      const captureCssWidth = Math.max(1, Math.round(frame.width / (frame.dpr || 1)));
      const captureCssHeight = Math.max(1, Math.round(frame.height / (frame.dpr || 1)));
      if (captureCssWidth !== cssWidth || captureCssHeight !== cssHeight) {
        cssWidth = captureCssWidth;
        cssHeight = captureCssHeight;
        setVec4(CSS_OFFSET, cssWidth, cssHeight, 1 / cssWidth, 1 / cssHeight);
        geometryParams.width = cssWidth;
        geometryParams.height = cssHeight;
        const deviceWidth = Math.max(1, Math.round(cssWidth * dpr));
        const deviceHeight = Math.max(1, Math.round(cssHeight * dpr));
        renderer.resize(deviceWidth, deviceHeight, cssWidth, cssHeight);
        geometryDirty = true;
      }

      updateRenderState();
      if (shouldRender()) {
        startLoop();
      }
      if (geometryDirty) {
        scheduleGeometryUpdate();
      }
    } catch (error) {
      frame.bitmap.close();
      logger.warn('CRT postFX texture upload failed', error);
    }
  };

  const handleResize = () => {
    updateCanvasSize();
    scheduleGeometryUpdate();
    domCapture?.trigger();
  };

  const handleVisibility = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      domCapture?.setPaused(true);
      stopLoop();
      return;
    }
    updateRenderState();
    if (!hasTexture) {
      domCapture?.trigger();
    }
  };

  const teardownGpu = () => {
    domCapture?.destroy();
    domCapture = null;
    eventProxy?.destroy();
    eventProxy = null;
    stopLoop();
    renderer?.destroy();
    renderer = null;
    hasTexture = false;
    currentLut = null;
    geometryRevision += 1;
    geometryDirty = true;
    pointerDown = false;
    uniforms[CURSOR_STATE_OFFSET + 2] = 0;
    uniforms[CURSOR_META_OFFSET + 1] = 1;
    setCanvasInteractionEnabled(false);
  };

  const initializeGpu = async (mode: Exclude<CRTRenderMode, 'css'>) => {
    if (!canvas) {
      throw new Error('Canvas unavailable');
    }

    teardownGpu();

    renderer = mode === 'webgpu' ? await createWebGpuRenderer(canvas) : await createWebGl2Renderer(canvas);
    renderMode = mode;
    hasTexture = false;

    updateCanvasSize();
    updateEffectUniforms();
    scheduleGeometryUpdate();

    eventProxy = createEventProxy({
      canvas,
      getLut: () =>
        currentLut
          ? { width: currentLut.width, height: currentLut.height, data: currentLut.inverse }
          : null,
      onCursor: handleCursorUpdate,
      onActivity: handlePointerActivity,
      logLatency: (value) => logProxyLatency(value)
    });

    if (currentLut) {
      eventProxy.updateLut(currentLut);
    }

    domCapture = createDomCapture({
      root: document.documentElement,
      throttleMs: getIdleThrottle(),
      ignore: (element) =>
        element instanceof HTMLElement && element.dataset?.crtPostfxIgnore === 'true',
      onCapture: handleCapture
    });

    domCapture.updateThrottle(pointerDown ? getDragThrottle() : getIdleThrottle());
    domCapture.setPaused(typeof document !== 'undefined' ? document.hidden : true);

    canvasHidden = true;
    updateRenderState();

    if (typeof document !== 'undefined' && !document.hidden) {
      domCapture
        .captureImmediate()
        .catch((error) => logger.warn('CRT postFX initial capture failed', error));
    }
  };

  const chooseMode = (preference: CRTModePreference): CRTRenderMode => {
    if (preference === 'css') {
      return 'css';
    }
    if (preference === 'webgpu') {
      if (availableWebGPU) {
        return 'webgpu';
      }
      if (availableWebGL2) {
        return 'webgl2';
      }
      return 'css';
    }
    if (preference === 'webgl2') {
      return availableWebGL2 ? 'webgl2' : 'css';
    }
    if (availableWebGPU) {
      return 'webgpu';
    }
    if (availableWebGL2) {
      return 'webgl2';
    }
    return 'css';
  };

  const switchToMode = async (target: CRTRenderMode) => {
    if (target === renderMode) {
      if (geometryDirty && renderer && renderMode !== 'css') {
        scheduleGeometryUpdate();
      }
      updateRenderState();
      return;
    }

    if (target === 'css') {
      teardownGpu();
      renderMode = 'css';
      crtEffects.setRenderMode('css');
      canvasHidden = true;
      updateRenderState();
      return;
    }

    try {
      await initializeGpu(target);
      crtEffects.setRenderMode(target);
      logger.info('CRT postFX renderer ready', { mode: target });
      scheduleGeometryUpdate();
    } catch (error) {
      logger.error('CRT postFX failed to enable GPU mode', error);
      teardownGpu();
      renderMode = 'css';
      crtEffects.setRenderMode('css');
      canvasHidden = true;
    }

    updateRenderState();
  };

  const ensureMode = () => {
    if (!detectionComplete || !canvas || destroyed) {
      return;
    }
    const target = chooseMode(requestedPreference);
    if (target === renderMode && !(geometryDirty && renderer && renderMode !== 'css')) {
      updateRenderState();
      return;
    }
    if (switchingMode) {
      pendingModeCheck = true;
      return;
    }
    switchingMode = true;
    switchToMode(target)
      .catch((error) => logger.error('CRT postFX mode switch failed', error))
      .finally(() => {
        switchingMode = false;
        if (pendingModeCheck) {
          pendingModeCheck = false;
          ensureMode();
        }
      });
  };

  const detectCapabilities = async () => {
    availableWebGPU = false;
    availableWebGL2 = false;

    if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        availableWebGPU = Boolean(adapter);
      } catch (error) {
        logger.warn('CRT postFX WebGPU detection failed', error);
      }
    }

    if (typeof document !== 'undefined') {
      try {
        const testCanvas = document.createElement('canvas');
        const context = testCanvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
        if (context) {
          availableWebGL2 = true;
          context.getExtension('EXT_color_buffer_float');
          context.getExtension('OES_texture_float_linear');
        }
      } catch (error) {
        logger.warn('CRT postFX WebGL2 detection failed', error);
      }
    }

    detectionComplete = true;
    logger.info('CRT postFX capabilities', { webgpu: availableWebGPU, webgl2: availableWebGL2 });
  };

  const setupReduceMotion = () => {
    if (typeof window.matchMedia === 'function') {
      reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduceMotion = reduceMotionQuery.matches;
      motionListener = (event) => {
        reduceMotion = event.matches;
        domCapture?.updateThrottle(pointerDown ? getDragThrottle() : getIdleThrottle());
        updateEffectUniforms();
        if (running) {
          stopLoop();
          startLoop();
        }
      };
      if ('addEventListener' in reduceMotionQuery) {
        reduceMotionQuery.addEventListener('change', motionListener);
      } else if ('addListener' in reduceMotionQuery) {
        // @ts-expect-error Legacy Safari
        reduceMotionQuery.addListener(motionListener);
      }
    } else {
      reduceMotionQuery = null;
      reduceMotion = false;
    }
  };

  onMount(() => {
    setVec4(RESOLUTION_OFFSET, 1, 1, 1, 1);
    setVec4(TIMING_OFFSET, 0, 0, 0, 0);
    setVec4(EFFECTS_OFFSET, 0, 0, 0, 1);
    setVec4(BLOOM_OFFSET, 0.7, 0.6, 0, 0);
    setVec4(CSS_OFFSET, 1, 1, 1, 1);
    setVec4(CURSOR_STATE_OFFSET, 0, 0, 0, 0);
    setVec4(CURSOR_META_OFFSET, 0, 1, 0, 0);

    const unsubscribe = crtEffects.subscribe((value) => {
      effectState = value;
      requestedPreference = value.modePreference ?? 'auto';
      updateEffectUniforms();
      ensureMode();
      updateRenderState();
    });

    setupReduceMotion();
    if (canvas) {
      updateCanvasSize();
    }

    const setup = async () => {
      await detectCapabilities();
      if (destroyed) {
        return;
      }
      ensureMode();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibility);
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', handleResize);
      }
    };

    setup().catch((error) => {
      logger.error('CRT postFX failed to initialize', error);
      renderMode = 'css';
      canvasHidden = true;
      crtEffects.setRenderMode('css');
    });

    return () => {
      unsubscribe();
    };
  });

  onDestroy(() => {
    destroyed = true;
    teardownGpu();
    lutController.dispose();
    if (reduceMotionQuery && motionListener) {
      if ('removeEventListener' in reduceMotionQuery) {
        reduceMotionQuery.removeEventListener('change', motionListener);
      } else if ('removeListener' in reduceMotionQuery) {
        // @ts-expect-error Legacy Safari
        reduceMotionQuery.removeListener(motionListener);
      }
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize);
    }
  });
</script>

<div
  class="crt-postfx"
  bind:this={container}
  aria-hidden="true"
  data-mode={renderMode}
  data-hidden={canvasHidden}
  data-crt-postfx-ignore="true"
>
  <canvas
    class="crt-postfx__canvas"
    bind:this={canvas}
    data-crt-postfx-ignore="true"
    data-hidden={canvasHidden}
    data-interactive={interactive}
  ></canvas>
  <span class="crt-postfx__badge" data-mode={renderMode}>{badgeLabel}</span>
</div>

<style>
  .crt-postfx {
    position: fixed;
    inset: 0;
    z-index: 50;
    pointer-events: none;
    display: block;
  }

  .crt-postfx[data-hidden='true'] {
    visibility: hidden;
  }

  .crt-postfx__canvas {
    width: 100%;
    height: 100%;
    display: block;
    background-color: black;
    pointer-events: none;
  }

  .crt-postfx__canvas[data-hidden='true'] {
    opacity: 0;
  }

  .crt-postfx__canvas[data-interactive='true'] {
    pointer-events: auto;
    cursor: none;
  }

  .crt-postfx__badge {
    position: fixed;
    top: 1rem;
    right: 1rem;
    padding: 0.3rem 0.6rem;
    font-size: 0.65rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    border-radius: 9999px;
    background: rgba(16, 36, 26, 0.75);
    color: rgb(var(--accent));
    backdrop-filter: blur(6px);
    pointer-events: none;
    mix-blend-mode: screen;
  }

  @media (max-width: 640px) {
    .crt-postfx__badge {
      font-size: 0.58rem;
      top: 0.75rem;
      right: 0.75rem;
    }
  }
</style>
