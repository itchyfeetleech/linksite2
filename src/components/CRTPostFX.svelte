<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { crtEffects } from '../stores/crtEffects';
  import type { CRTEffectsState } from '../stores/crtEffects';
  import { logger } from '../lib/logger';
  import { detectRenderMode } from '../lib/crt/detectMode';
  import {
    createDomCapture,
    type DomCaptureController
  } from '../lib/crt/capture';
  import { createWebGpuRenderer } from '../lib/crt/webgpuRenderer';
  import { createWebGl2Renderer } from '../lib/crt/webgl2Renderer';
  import type { CRTGpuRenderer, CRTRenderMode } from '../lib/crt/types';
  import { UNIFORM_FLOAT_COUNT } from '../lib/crt/types';

  const BADGE_LABELS: Record<CRTRenderMode, string> = {
    webgpu: 'WebGPU',
    webgl2: 'WebGL2',
    css: 'CSS'
  };

  let container: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let renderMode: CRTRenderMode = 'css';
  let badgeLabel = BADGE_LABELS.css;
  let canvasHidden = true;

  let effectState: CRTEffectsState | null = null;
  let renderer: CRTGpuRenderer | null = null;
  let domCapture: DomCaptureController | null = null;
  let reduceMotion = false;
  let reduceMotionQuery: MediaQueryList | null = null;
  let motionListener: ((event: MediaQueryListEvent) => void) | null = null;

  const uniforms = new Float32Array(UNIFORM_FLOAT_COUNT);

  let hasTexture = false;
  let running = false;
  let rafId = 0;
  let lastFrame = 0;
  let frameAccumulator = 0;
  let frameSamples = 0;
  let dpr = 1;
  let viewportWidth = 0;
  let viewportHeight = 0;

  const updateBadge = () => {
    const base = BADGE_LABELS[renderMode] ?? renderMode.toUpperCase();
    badgeLabel = effectState?.plainMode ? `${base} · Plain` : base;
  };

  const updateCanvasSize = () => {
    if (!canvas) {
      return;
    }
    dpr = window.devicePixelRatio || 1;
    viewportWidth = Math.max(1, Math.round(window.innerWidth * dpr));
    viewportHeight = Math.max(1, Math.round(window.innerHeight * dpr));
    canvas.width = viewportWidth;
    canvas.height = viewportHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    uniforms[0] = viewportWidth;
    uniforms[1] = viewportHeight;
    uniforms[2] = 1 / viewportWidth;
    uniforms[3] = 1 / viewportHeight;
    uniforms[11] = dpr;
    renderer?.resize(viewportWidth, viewportHeight);
  };

  const updateEffectUniforms = () => {
    const state = effectState;
    const plain = state?.plainMode ?? false;
    const scanlines = plain || !(state?.scanlines ?? false) ? 0 : state?.intensity.scanlines ?? 0;
    const glow = plain || !(state?.glow ?? false) ? 0 : state?.intensity.glow ?? 0;
    const aberration = plain || !(state?.aberration ?? false) ? 0 : state?.intensity.aberration ?? 0;
    const slotMask = scanlines > 0 ? Math.min(1, 0.35 + scanlines * 0.8) : 0;
    const vignette = plain ? 0 : 0.35;
    const noiseBase = plain ? 0 : 0.05;
    const noise = reduceMotion ? 0 : Math.min(0.18, noiseBase + scanlines * 0.08);
    const bloomThreshold = plain ? 1 : 0.72;
    const bloomSoftness = plain ? 0 : 0.65;

    uniforms[5] = scanlines;
    uniforms[6] = slotMask;
    uniforms[7] = vignette;
    uniforms[8] = glow;
    uniforms[9] = aberration;
    uniforms[10] = noise;
    uniforms[12] = bloomThreshold;
    uniforms[13] = bloomSoftness;
    updateBadge();
  };

  const shouldRender = () =>
    renderMode !== 'css' &&
    !(effectState?.plainMode ?? false) &&
    typeof document !== 'undefined' &&
    !document.hidden &&
    hasTexture;

  const step = (now: number) => {
    if (!running) {
      return;
    }

    const delta = now - lastFrame;
    const targetInterval = reduceMotion ? 1000 / 30 : 0;
    if (targetInterval > 0 && delta < targetInterval) {
      rafId = window.requestAnimationFrame(step);
      return;
    }

    lastFrame = now;
    uniforms[4] = now * 0.001;
    renderer?.render(uniforms);

    frameAccumulator += delta;
    frameSamples += 1;
    if (frameAccumulator >= 1000) {
      const average = frameAccumulator / Math.max(1, frameSamples);
      logger.debug('CRT postFX frame stats', {
        mode: renderMode,
        averageMs: Number(average.toFixed(2))
      });
      frameAccumulator = 0;
      frameSamples = 0;
    }

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
    frameAccumulator = 0;
    frameSamples = 0;
  };

  const updateRenderState = () => {
    updateBadge();
    const active = renderMode !== 'css' && !(effectState?.plainMode ?? false);
    canvasHidden = !active || !hasTexture;
    const pauseCapture =
      !active || (typeof document !== 'undefined' ? document.hidden : true);
    domCapture?.setPaused(pauseCapture);

    if (!active) {
      stopLoop();
      return;
    }

    if (!hasTexture) {
      domCapture?.trigger();
      stopLoop();
      return;
    }

    if (shouldRender()) {
      startLoop();
    }
  };

  const handleResize = () => {
    updateCanvasSize();
    domCapture?.trigger();
  };

  const handleVisibility = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      domCapture?.setPaused(true);
      stopLoop();
      return;
    }
    updateRenderState();
  };

  const initializeRenderer = async () => {
    if (!canvas) {
      return;
    }
    updateCanvasSize();
    renderer =
      renderMode === 'webgpu' ? await createWebGpuRenderer(canvas) : await createWebGl2Renderer(canvas);
    renderer.resize(viewportWidth, viewportHeight);
  };

  onMount(() => {
    const effectsUnsubscribe = crtEffects.subscribe((value) => {
      effectState = value;
      updateEffectUniforms();
      updateRenderState();
    });

    const setup = async () => {
      const detected = await detectRenderMode();
      renderMode = detected;
      updateBadge();
      crtEffects.setRenderMode(detected);

      if (detected === 'css') {
        canvasHidden = true;
        logger.info('CRT postFX using CSS/SVG overlays');
        return;
      }

      if (typeof window.matchMedia === 'function') {
        reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        reduceMotion = reduceMotionQuery.matches;
      } else {
        reduceMotionQuery = null;
        reduceMotion = false;
      }

      logger.info('CRT postFX renderer initialized', { mode: detected });

      await initializeRenderer();
      updateEffectUniforms();

      const throttle = reduceMotion ? 160 : 80;
      domCapture = createDomCapture({
        root: document.documentElement,
        throttleMs: throttle,
        ignore: (element) =>
          element instanceof HTMLElement && element.dataset?.crtPostfxIgnore === 'true',
        onCapture: async (frame) => {
          if (!renderer) {
            frame.bitmap.close();
            return;
          }
          try {
            await renderer.updateTexture(frame);
            hasTexture = true;
            updateRenderState();
            if (shouldRender()) {
              startLoop();
            }
          } catch (error) {
            frame.bitmap.close();
            logger.warn('CRT postFX texture upload failed', error);
          }
        }
      });

      if (reduceMotionQuery) {
        domCapture.updateThrottle(reduceMotion ? 160 : 80);
        updateEffectUniforms();
        motionListener = (event) => {
          reduceMotion = event.matches;
          domCapture?.updateThrottle(reduceMotion ? 160 : 80);
          updateEffectUniforms();
          const wasRunning = running;
          stopLoop();
          if (wasRunning && shouldRender()) {
            startLoop();
          }
        };
        if ('addEventListener' in reduceMotionQuery) {
          reduceMotionQuery.addEventListener('change', motionListener);
        } else if ('addListener' in reduceMotionQuery) {
          // @ts-expect-error Safari <16
          reduceMotionQuery.addListener(motionListener);
        }
      } else {
        updateEffectUniforms();
      }

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibility);
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', handleResize);
      }

      updateRenderState();
      if (typeof document !== 'undefined' && !document.hidden) {
        domCapture.captureImmediate().catch((error) => {
          logger.warn('CRT postFX initial capture failed', error);
        });
      }
    };

    setup().catch((error) => {
      logger.error('CRT postFX failed to initialize', error);
      domCapture?.destroy();
      domCapture = null;
      renderer?.destroy();
      renderer = null;
      hasTexture = false;
      renderMode = 'css';
      badgeLabel = BADGE_LABELS.css;
      canvasHidden = true;
      crtEffects.setRenderMode('css');
    });

    return () => {
      effectsUnsubscribe();
    };
  });

  onDestroy(() => {
    stopLoop();
    domCapture?.destroy();
    domCapture = null;
    renderer?.destroy();
    renderer = null;
    if (reduceMotionQuery && motionListener) {
      if ('removeEventListener' in reduceMotionQuery) {
        reduceMotionQuery.removeEventListener('change', motionListener);
      } else if ('removeListener' in reduceMotionQuery) {
        // @ts-expect-error Safari <16
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
    pointer-events: none;
    background-color: black;
  }

  .crt-postfx__canvas[data-hidden='true'] {
    opacity: 0;
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

