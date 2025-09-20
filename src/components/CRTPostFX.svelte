<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { crtEffects } from '../stores/crtEffects';
  import type { CRTEffectsState, CRTModePreference } from '../stores/crtEffects';
  import { logger } from '../lib/logger';
  import {
    createDomCapture,
    type CaptureStats,
    type DomCaptureController,
    FLIP_Y_CAPTURE
  } from '../lib/crt/capture';
  import { createWebGpuRenderer } from '../lib/crt/webgpuRenderer';
  import { createWebGl2Renderer } from '../lib/crt/webgl2Renderer';
  import {
    createEventProxy,
    type CursorState,
    type EventProxyController,
    type PointerActivityState
  } from '../lib/crt/eventProxy';
  import type { CRTGpuRenderer, CRTRenderMode, RendererTimings } from '../lib/crt/types';
  import { mapDomToScreen, undistortNormalized } from '../lib/crt/geometryMath';
  import { UNIFORM_FLOAT_COUNT, UNIFORM_OFFSETS } from '../lib/crt/types';
  import { createCoordSpace } from '../lib/crt/coordSpace';
  import { createPerfMonitor, type FrameTimings, type PerfSnapshot } from '../lib/crt/perfMonitor';

  const BADGE_LABELS: Record<CRTRenderMode, string> = {
    webgpu: 'WebGPU',
    webgl2: 'WebGL2',
    css: 'CSS'
  };

  const {
    resolution: RESOLUTION_OFFSET,
    invResolution: INV_RESOLUTION_OFFSET,
    time: TIME_OFFSET,
    scanline: SCANLINE_OFFSET,
    slotMask: SLOT_MASK_OFFSET,
    vignette: VIGNETTE_OFFSET,
    baseBloom: BASE_BLOOM_OFFSET,
    aberration: ABERRATION_OFFSET,
    noise: NOISE_OFFSET,
    devicePixelRatio: DPR_OFFSET,
    bloomThreshold: BLOOM_THRESHOLD_OFFSET,
    bloomSoftness: BLOOM_SOFTNESS_OFFSET,
    k1: K1_OFFSET,
    k2: K2_OFFSET,
    cssSize: CSS_SIZE_OFFSET,
    invCssSize: INV_CSS_OFFSET,
    cursorState: CURSOR_STATE_OFFSET,
    cursorMeta: CURSOR_META_OFFSET
  } = UNIFORM_OFFSETS;

  const POINTER_INDEX: Record<string, number> = {
    mouse: 0,
    touch: 1,
    pen: 2
  };

  type HealthMetricKey = 'captureMs' | 'gpuSubmitMs' | 'gpuFrameMs' | 'proxyMs' | 'totalMs';

  const HEALTH_METRICS: Array<{ key: HealthMetricKey; label: string }> = [
    { key: 'captureMs', label: 'Capture' },
    { key: 'gpuSubmitMs', label: 'GPU Submit' },
    { key: 'gpuFrameMs', label: 'GPU Frame' },
    { key: 'proxyMs', label: 'Proxy' },
    { key: 'totalMs', label: 'Total' }
  ];

  const formatMs = (value: number) => `${value.toFixed(2)}ms`;
  const roundRecord = (record: Record<string, number>) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Number(value.toFixed(2))]));

  const DEFAULT_BARREL_K1 = -0.006;
  const DEFAULT_BARREL_K2 = 0.0;
  const MAX_BARREL_K1 = 0.02;
  const MAX_BARREL_K2 = 0.005;
  const WARP_SAMPLE_POINTS = [0.1, 0.5, 0.9];
  const INTERNAL_SCALE_MIN = 0.4;
  const INTERNAL_SCALE_MAX = 1;
  const INTERNAL_SCALE_DECAY = 0.9;
  const INTERNAL_SCALE_GROWTH = 1.05;
  const CAPTURE_SPIKE_THRESHOLD = 20;
  const CAPTURE_SPIKE_LOG_THRESHOLD = 15;
  const CAPTURE_RECOVERY_THRESHOLD = 12;
  const CAPTURE_RECOVERY_FRAMES = 240;

  const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

  const FLIP_Y_SHADER_WEBGPU = true;
  const UNPACK_FLIP_Y_WEBGL = true;

  let container: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const coordSpace = createCoordSpace();
  let coordSnapshot = coordSpace.getSnapshot();

  let renderMode: CRTRenderMode = 'css';
  let badgeLabel = BADGE_LABELS.css;
  let canvasHidden = true;
  let interactive = false;

  let effectState: CRTEffectsState | null = null;
  let renderer: CRTGpuRenderer | null = null;
  let domCapture: DomCaptureController | null = null;
  let eventProxy: EventProxyController | null = null;
  const uniforms = new Float32Array(UNIFORM_FLOAT_COUNT);

  let reduceMotion = false;
  let reduceMotionQuery: MediaQueryList | null = null;
  let motionListener: ((event: MediaQueryListEvent) => void) | null = null;

  let hasTexture = false;
  let running = false;
  let rafId = 0;
  let lastFrame = 0;

  let dpr = coordSnapshot.dpr;
  let cssWidth = coordSnapshot.cssWidth;
  let cssHeight = coordSnapshot.cssHeight;

  let pointerDown = false;
  let toastMessage: string | null = null;
  let toastTimer = 0;

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

  let warpDisabled = false;
  let showWarpGrid = false;
  let stageAverage: Record<string, number> = {};
  let stageP95: Record<string, number> = {};
  let stageKeys: string[] = [];
  let avgFps = 0;
  let latestFps = 0;

  let warpMode = 'shader';
  if (typeof document !== 'undefined') {
    const declared = document.documentElement.dataset.crtWarpMode;
    if (declared) {
      warpMode = declared;
    }
  }

  const geometryParams = {
    width: cssWidth,
    height: cssHeight,
    dpr,
    k1: DEFAULT_BARREL_K1,
    k2: DEFAULT_BARREL_K2,
    flipY: false
  };

  const perfMonitor = createPerfMonitor();
  let healthSnapshot: PerfSnapshot = perfMonitor.getSnapshot();
  let pendingCaptureMs = 0;
  let pendingUploadMs = 0;
  let pendingProxyMs = 0;
  let gpuTimingAccurate = false;
  const PERF_LOG_INTERVAL = 180;
  let perfLogCounter = 0;
  let internalScale = 0.8;
  let qualityTier: 'Ultra' | 'High' | 'Balanced' | 'Low' = 'Balanced';
  let steadyCaptureFrames = 0;

  $: stageAverage = healthSnapshot.stageAverage ?? {};
  $: stageP95 = healthSnapshot.stageP95 ?? {};
  $: stageKeys = Array.from(new Set([...Object.keys(stageAverage), ...Object.keys(stageP95)])).filter((key) => {
    const average = stageAverage[key] ?? 0;
    const percentile = stageP95[key] ?? 0;
    return average > 0.0001 || percentile > 0.0001;
  }).sort();
  $: avgFps = healthSnapshot.average?.fps ?? (healthSnapshot.average.totalMs > 0 ? 1000 / healthSnapshot.average.totalMs : 0);
  $: latestFps = healthSnapshot.latest?.fps ?? (healthSnapshot.latest.totalMs > 0 ? 1000 / healthSnapshot.latest.totalMs : 0);

  const clampInternalScale = (value: number) => Math.max(INTERNAL_SCALE_MIN, Math.min(INTERNAL_SCALE_MAX, value));

  const applyInternalScale = (value: number, reason: string) => {
    const clamped = Number(clampInternalScale(value).toFixed(3));
    if (Math.abs(clamped - internalScale) < 1e-3) {
      return;
    }
    internalScale = clamped;
    logger.info('CRT postFX internal scale adjusted', { reason, internalScale });
    domCapture?.trigger();
  };

  const adjustInternalScaleForCapture = (duration: number) => {
    if (qualityTier !== 'Balanced') {
      return;
    }

    if (duration > CAPTURE_SPIKE_THRESHOLD && internalScale > INTERNAL_SCALE_MIN) {
      steadyCaptureFrames = 0;
      applyInternalScale(internalScale * INTERNAL_SCALE_DECAY, 'capture-spike');
      return;
    }

    if (duration < CAPTURE_RECOVERY_THRESHOLD && internalScale < INTERNAL_SCALE_MAX) {
      steadyCaptureFrames += 1;
      if (steadyCaptureFrames >= CAPTURE_RECOVERY_FRAMES) {
        applyInternalScale(internalScale * INTERNAL_SCALE_GROWTH, 'capture-recovery');
        steadyCaptureFrames = 0;
      }
    } else {
      steadyCaptureFrames = 0;
    }
  };

  const matrixHash = (matrix: Float32Array) => {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < matrix.length; i += 1) {
      const value = Math.round(matrix[i] * 1e6);
      hash ^= (value + 0x9e3779b9 + ((hash << 6) >>> 0) + (hash >>> 2)) >>> 0;
      hash >>>= 0;
    }
    return hash.toString(16);
  };

  const formatMatrix = (matrix: number[]) => {
    const rows = [matrix.slice(0, 3), matrix.slice(3, 6), matrix.slice(6, 9)];
    return rows.map((row) => row.map((value) => value.toFixed(4)).join('  '));
  };

  const formatFlipPath = (config: { flipYShader: boolean; unpackFlipY: boolean; flipYCapture: boolean }) =>
    `{flipYShader:${config.flipYShader ? 'true' : 'false'}, unpackFlipY:${config.unpackFlipY ? 'true' : 'false'}, flipYCapture:${config.flipYCapture ? 'true' : 'false'}}`;

  let orientationInfo = {
    flipYCapture: FLIP_Y_CAPTURE,
    flipYShader: false,
    unpackFlipY: false,
    flipPath: formatFlipPath({ flipYCapture: FLIP_Y_CAPTURE, flipYShader: false, unpackFlipY: false }),
    dpr: coordSnapshot.dpr,
    cssToUv: Array.from(coordSnapshot.cssToUv),
    uvToCss: Array.from(coordSnapshot.uvToCss),
    cssToTexture: Array.from(coordSnapshot.cssToTexture),
    textureToCss: Array.from(coordSnapshot.textureToCss)
  } satisfies {
    flipYCapture: boolean;
    flipYShader: boolean;
    unpackFlipY: boolean;
    flipPath: string;
    dpr: number;
    cssToUv: number[];
    uvToCss: number[];
    cssToTexture: number[];
    textureToCss: number[];
  };

  let lastOrientationFingerprint = '';

  const updateOrientationInfo = () => {
    const flipYShader = renderer?.mode === 'webgpu' ? FLIP_Y_SHADER_WEBGPU : false;
    const unpackFlipY = renderer?.mode === 'webgl2' ? UNPACK_FLIP_Y_WEBGL : false;
    geometryParams.flipY = flipYShader;
    orientationInfo = {
      flipYCapture: FLIP_Y_CAPTURE,
      flipYShader,
      unpackFlipY,
      flipPath: formatFlipPath({ flipYCapture: FLIP_Y_CAPTURE, flipYShader, unpackFlipY }),
      dpr: coordSnapshot.dpr,
      cssToUv: Array.from(coordSnapshot.cssToUv),
      uvToCss: Array.from(coordSnapshot.uvToCss),
      cssToTexture: Array.from(coordSnapshot.cssToTexture),
      textureToCss: Array.from(coordSnapshot.textureToCss)
    };
  };

  const logOrientationState = (reason: string) => {
    const fingerprint = `${renderMode}:${matrixHash(coordSnapshot.cssToUv)}:${matrixHash(coordSnapshot.cssToTexture)}:${coordSnapshot.dpr.toFixed(4)}`;
    if (fingerprint === lastOrientationFingerprint) {
      return;
    }
    lastOrientationFingerprint = fingerprint;
    logger.info('CRT postFX orientation', {
      reason,
      mode: renderMode,
      flipYCapture: FLIP_Y_CAPTURE,
      flipYShader: renderer?.mode === 'webgpu' ? FLIP_Y_SHADER_WEBGPU : false,
      unpackFlipY: renderer?.mode === 'webgl2' ? UNPACK_FLIP_Y_WEBGL : false,
      flipPath: orientationInfo.flipPath,
      cssToUv: matrixHash(coordSnapshot.cssToUv),
      cssToTexture: matrixHash(coordSnapshot.cssToTexture),
      dpr: coordSnapshot.dpr
    });
  };

  updateOrientationInfo();

  const setScalar = (offset: number, value: number) => {
    uniforms[offset] = value;
  };

  const setVec2 = (offset: number, a: number, b: number) => {
    uniforms[offset] = a;
    uniforms[offset + 1] = b;
  };

  const setVec4 = (offset: number, a: number, b: number, c: number, d: number) => {
    uniforms[offset] = a;
    uniforms[offset + 1] = b;
    uniforms[offset + 2] = c;
    uniforms[offset + 3] = d;
  };

  const pointerIndex = (type: string) => POINTER_INDEX[type] ?? 0;

  const getIdleThrottle = () => (reduceMotion ? 120 : 40);
  const getDragThrottle = () => (reduceMotion ? 34 : 24);

  const setCanvasInteractionEnabled = (enabled: boolean) => {
    if (!canvas) {
      return;
    }
    canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    canvas.style.cursor = enabled ? 'none' : '';
  };

  const showToast = (message: string) => {
    toastMessage = message;
    if (typeof window !== 'undefined') {
      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = window.setTimeout(() => {
        toastMessage = null;
        toastTimer = 0;
      }, 4000);
    }
  };

  const updateBadge = () => {
    const base = BADGE_LABELS[renderMode] ?? renderMode.toUpperCase();
    badgeLabel = effectState?.plainMode ? `${base} - Plain` : base;
  };

  const logWarpSamples = (k1: number, k2: number) => {
    const width = geometryParams.width;
    const height = geometryParams.height;

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }

    const aspect = height > 0 ? width / height : 1;
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    for (const sampleY of WARP_SAMPLE_POINTS) {
      for (const sampleX of WARP_SAMPLE_POINTS) {
        const uvDisplayX = sampleX;
        const uvDisplayY = geometryParams.flipY ? 1 - sampleY : sampleY;
        const px = (uvDisplayX * 2 - 1) * aspect;
        const py = uvDisplayY * 2 - 1;
        const undistorted = undistortNormalized(px, py, k1, k2);
        const sampleUvX = (undistorted.x / aspect + 1) * 0.5;
        const sampleUvY = (undistorted.y + 1) * 0.5;
        minX = Math.min(minX, sampleUvX);
        minY = Math.min(minY, sampleUvY);
        maxX = Math.max(maxX, sampleUvX);
        maxY = Math.max(maxY, sampleUvY);
      }
    }

    const bounds = {
      min: { x: Number(minX.toFixed(4)), y: Number(minY.toFixed(4)) },
      max: { x: Number(maxX.toFixed(4)), y: Number(maxY.toFixed(4)) }
    };

    const withinBounds =
      bounds.min.x >= -0.02 &&
      bounds.min.y >= -0.02 &&
      bounds.max.x <= 1.02 &&
      bounds.max.y <= 1.02;

    if (withinBounds) {
      logger.debug('CRT postFX warp samples', bounds);
    } else {
      logger.warn('CRT postFX warp samples clamped', bounds);
    }
  };

  const applyBarrelCoefficients = () => {
    const state = effectState;
    const enabled = Boolean(state && !state.plainMode && state.barrel);
    const slider = clamp01(state?.intensity.barrel ?? 0.5);
    let k1 = DEFAULT_BARREL_K1;
    let k2 = DEFAULT_BARREL_K2;

    if (state) {
      if (enabled) {
        k1 = -0.012 * slider;
        k2 = 0.004 * slider;
      } else {
        k1 = 0;
        k2 = 0;
      }
    }

    if (warpDisabled) {
      k1 = 0;
      k2 = 0;
    }

    if (Math.abs(k1) > MAX_BARREL_K1 || Math.abs(k2) > MAX_BARREL_K2) {
      logger.warn('CRT postFX barrel coefficients clamped', { slider, k1, k2 });
      k1 = 0;
      k2 = 0;
    }

    geometryParams.k1 = k1;
    geometryParams.k2 = k2;
    setScalar(K1_OFFSET, k1);
    setScalar(K2_OFFSET, k2);
    logWarpSamples(k1, k2);
  };

  const setWarpDisabledState = (value: boolean) => {
    warpDisabled = value;
    applyBarrelCoefficients();
  };

  const handleWarpToggleChange = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) {
      return;
    }
    setWarpDisabledState(target.checked);
  };

  const handleWarpGridToggleChange = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) {
      return;
    }
    showWarpGrid = target.checked;
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

    setScalar(SCANLINE_OFFSET, scanlines);
    setScalar(SLOT_MASK_OFFSET, slotMask);
    setScalar(VIGNETTE_OFFSET, vignette);
    setScalar(BASE_BLOOM_OFFSET, baseBloom);
    setScalar(ABERRATION_OFFSET, aberration);
    setScalar(NOISE_OFFSET, noise);
    setScalar(BLOOM_THRESHOLD_OFFSET, threshold);
    setScalar(BLOOM_SOFTNESS_OFFSET, softness);

    applyBarrelCoefficients();
    void renderer?.updateGeometry(geometryParams);
    updateBadge();
  };

  const updateCanvasSize = () => {
    if (!canvas) {
      return;
    }
    const nextDpr = window.devicePixelRatio || 1;
    const nextCssWidth = Math.max(1, Math.round(window.innerWidth));
    const nextCssHeight = Math.max(1, Math.round(window.innerHeight));
    const deviceWidth = Math.max(1, Math.floor(nextCssWidth * nextDpr));
    const deviceHeight = Math.max(1, Math.floor(nextCssHeight * nextDpr));

    coordSnapshot = coordSpace.update({
      cssWidth: nextCssWidth,
      cssHeight: nextCssHeight,
      dpr: nextDpr,
      textureWidth: deviceWidth,
      textureHeight: deviceHeight
    });

    dpr = coordSnapshot.dpr;
    cssWidth = coordSnapshot.cssWidth;
    cssHeight = coordSnapshot.cssHeight;

    setVec2(RESOLUTION_OFFSET, coordSnapshot.textureWidth, coordSnapshot.textureHeight);
    setVec2(INV_RESOLUTION_OFFSET, 1 / coordSnapshot.textureWidth, 1 / coordSnapshot.textureHeight);
    setScalar(DPR_OFFSET, dpr);
    setVec2(CSS_SIZE_OFFSET, cssWidth, cssHeight);
    setVec2(INV_CSS_OFFSET, 1 / cssWidth, 1 / cssHeight);

    geometryParams.width = cssWidth;
   geometryParams.height = cssHeight;
   geometryParams.dpr = dpr;

    applyBarrelCoefficients();

    renderer?.resize(coordSnapshot.textureWidth, coordSnapshot.textureHeight, cssWidth, cssHeight);
    void renderer?.updateGeometry(geometryParams);
    updateOrientationInfo();
    logOrientationState('resize');
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
    pendingProxyMs += value;
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

    const frameCpuStart = performance.now();
    const delta = now - lastFrame;
    const minInterval = reduceMotion ? 1000 / 30 : 0;
    if (minInterval > 0 && delta < minInterval) {
      rafId = window.requestAnimationFrame(step);
      return;
    }

    lastFrame = now;
    setScalar(TIME_OFFSET, now * 0.001);

    if (renderer) {
      const renderTimings: RendererTimings = renderer.render(uniforms);
      const captureMs = pendingCaptureMs;
      const uploadMs = pendingUploadMs;
      const proxyMs = pendingProxyMs;

      pendingCaptureMs = 0;
      pendingUploadMs = 0;
      pendingProxyMs = 0;

      const gpuSubmitMs = renderTimings.gpuSubmitMs + uploadMs;
      const gpuFrameMs = renderTimings.gpuFrameMs;
      const cpuFrameMs = performance.now() - frameCpuStart;
      const frameInterval = delta > 0 ? delta : cpuFrameMs;
      const gpuCost = Math.max(gpuFrameMs, gpuSubmitMs);
      const totalMsWork = captureMs + Math.max(gpuCost, cpuFrameMs) + proxyMs;
      const totalMs = Math.max(totalMsWork, frameInterval);
      const fps = frameInterval > 0 ? 1000 / frameInterval : 0;

      const frameTimings: FrameTimings = {
        captureMs,
        gpuSubmitMs,
        gpuFrameMs,
        proxyMs,
        totalMs,
        timestamp: now,
        stages: renderTimings.stages ? { ...renderTimings.stages } : undefined,
        fps,
        mode: renderer.mode,
        dpr: coordSnapshot.dpr,
        internalScale
      };

      gpuTimingAccurate = renderTimings.timestampAccurate;
      healthSnapshot = perfMonitor.record(frameTimings);

      perfLogCounter += 1;
      if (healthSnapshot.samples >= 60 && perfLogCounter >= PERF_LOG_INTERVAL) {
        perfLogCounter = 0;
        logger.info('CRT postFX health summary', {
          tier: qualityTier,
          internalScale: Number(internalScale.toFixed(3)),
          mode: healthSnapshot.latest.mode ?? renderMode,
          dpr: Number((healthSnapshot.latest.dpr ?? coordSnapshot.dpr).toFixed(2)),
          gpuTimer: gpuTimingAccurate ? 'timestamp' : 'cpu',
          fps: {
            latest: Number(latestFps.toFixed(2)),
            average: Number(avgFps.toFixed(2))
          },
          avg: {
            captureMs: Number(healthSnapshot.average.captureMs.toFixed(2)),
            gpuSubmitMs: Number(healthSnapshot.average.gpuSubmitMs.toFixed(2)),
            gpuFrameMs: Number(healthSnapshot.average.gpuFrameMs.toFixed(2)),
            proxyMs: Number(healthSnapshot.average.proxyMs.toFixed(2)),
            totalMs: Number(healthSnapshot.average.totalMs.toFixed(2))
          },
          p95: {
            captureMs: Number(healthSnapshot.p95.captureMs.toFixed(2)),
            gpuSubmitMs: Number(healthSnapshot.p95.gpuSubmitMs.toFixed(2)),
            gpuFrameMs: Number(healthSnapshot.p95.gpuFrameMs.toFixed(2)),
            proxyMs: Number(healthSnapshot.p95.proxyMs.toFixed(2)),
            totalMs: Number(healthSnapshot.p95.totalMs.toFixed(2))
          },
          stages: {
            average: roundRecord(stageAverage),
            p95: roundRecord(stageP95)
          }
        });
      }
    } else {
      pendingCaptureMs = 0;
      pendingUploadMs = 0;
      pendingProxyMs = 0;
    }

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
    const mapped = mapDomToScreen(state.domX, state.domY, geometryParams);
    let cursorCssX = mapped.x;
    let cursorCssY = mapped.y;
    uniforms[CURSOR_STATE_OFFSET + 0] = cursorCssX;
    uniforms[CURSOR_STATE_OFFSET + 1] = cursorCssY;
    uniforms[CURSOR_STATE_OFFSET + 2] = state.visible ? 1 : 0;
    uniforms[CURSOR_STATE_OFFSET + 3] = state.buttons;
    uniforms[CURSOR_META_OFFSET + 0] = pointerIndex(state.pointerType);
    if (pointerDown) {
      domCapture?.trigger();
    }
  };

  const handleCapture = async (frame: CaptureFrame, stats: CaptureStats) => {
    logCaptureDuration(stats.duration);
    pendingCaptureMs += stats.duration;
    if (stats.duration > CAPTURE_SPIKE_LOG_THRESHOLD) {
      logger.warn('CRT postFX capture spike', { duration: Number(stats.duration.toFixed(2)) });
    }
    adjustInternalScaleForCapture(stats.duration);
    if (!renderer) {
      frame.bitmap.close();
      return;
    }

    try {
      const uploadStart = performance.now();
      await renderer.updateTexture(frame);
      pendingUploadMs += performance.now() - uploadStart;
      hasTexture = true;

      const captureDpr = frame.dpr || dpr;
      const captureCssWidth = Math.max(1, Math.round(frame.width / (captureDpr || 1)));
      const captureCssHeight = Math.max(1, Math.round(frame.height / (captureDpr || 1)));

      coordSnapshot = coordSpace.update({
        cssWidth: captureCssWidth,
        cssHeight: captureCssHeight,
        dpr: captureDpr,
        textureWidth: frame.width,
        textureHeight: frame.height
      });

      dpr = coordSnapshot.dpr;
      cssWidth = coordSnapshot.cssWidth;
      cssHeight = coordSnapshot.cssHeight;

      setVec2(RESOLUTION_OFFSET, coordSnapshot.textureWidth, coordSnapshot.textureHeight);
      setVec2(INV_RESOLUTION_OFFSET, 1 / coordSnapshot.textureWidth, 1 / coordSnapshot.textureHeight);
      setScalar(DPR_OFFSET, dpr);
      setVec2(CSS_SIZE_OFFSET, cssWidth, cssHeight);
      setVec2(INV_CSS_OFFSET, 1 / cssWidth, 1 / cssHeight);

      geometryParams.width = cssWidth;
      geometryParams.height = cssHeight;
      geometryParams.dpr = dpr;

      renderer.resize(coordSnapshot.textureWidth, coordSnapshot.textureHeight, cssWidth, cssHeight);
      void renderer.updateGeometry(geometryParams);
      updateOrientationInfo();
      logOrientationState('capture');

      updateRenderState();
      if (shouldRender()) {
        startLoop();
      }
    } catch (error) {
      frame.bitmap.close();
      logger.warn('CRT postFX texture upload failed', error);
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
    pointerDown = false;
    uniforms[CURSOR_STATE_OFFSET + 2] = 0;
    uniforms[CURSOR_META_OFFSET + 1] = 1;
    uniforms[CURSOR_META_OFFSET + 2] = 0;
    setCanvasInteractionEnabled(false);
    updateOrientationInfo();
    logOrientationState('teardown');
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

    eventProxy = createEventProxy({
      canvas,
      getWarpParams: () => geometryParams,
      getCoordSpace: () => coordSnapshot,
      onCursor: handleCursorUpdate,
      onActivity: handlePointerActivity,
      logLatency: (value) => logProxyLatency(value)
    });

    domCapture = createDomCapture({
      root: document.documentElement,
      throttleMs: getIdleThrottle(),
      ignore: (element) =>
        element instanceof HTMLElement && element.dataset?.crtPostfxIgnore === 'true',
      onCapture: handleCapture,
      getScale: () => (window.devicePixelRatio || 1) * internalScale
    });

    domCapture.updateThrottle(pointerDown ? getDragThrottle() : getIdleThrottle());
    domCapture.setPaused(typeof document !== 'undefined' ? document.hidden : true);

    canvasHidden = true;
    updateRenderState();
    updateOrientationInfo();
    logOrientationState('mode-init');

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
      updateRenderState();
      return;
    }

    if (target === 'css') {
      teardownGpu();
      renderMode = 'css';
      crtEffects.setRenderMode('css');
      canvasHidden = true;
      updateOrientationInfo();
      logOrientationState('css-mode');
      updateRenderState();
      return;
    }

    if (target !== 'css' && warpMode !== 'shader') {
      showToast(`GPU disabled: warp mode "${warpMode}"`);
      teardownGpu();
      renderMode = 'css';
      crtEffects.setRenderMode('css');
      canvasHidden = true;
      updateOrientationInfo();
      logOrientationState('warp-fallback');
      updateRenderState();
      return;
    }

    try {
      await initializeGpu(target);
      crtEffects.setRenderMode(target);
      logger.info('CRT postFX renderer ready', { mode: target });
    } catch (error) {
      logger.error('CRT postFX failed to enable GPU mode', error);
      const reason = error instanceof Error ? error.message : String(error);
      showToast(`GPU disabled: ${reason}`);
      teardownGpu();
      renderMode = 'css';
      crtEffects.setRenderMode('css');
      canvasHidden = true;
      updateOrientationInfo();
      logOrientationState('css-fallback');
    }

    updateRenderState();
  };

  const ensureMode = () => {
    if (!detectionComplete || !canvas || destroyed) {
      return;
    }
    const target = chooseMode(requestedPreference);
    if (target === renderMode) {
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
    setVec2(RESOLUTION_OFFSET, 1, 1);
    setVec2(INV_RESOLUTION_OFFSET, 1, 1);
    setScalar(TIME_OFFSET, 0);
    setScalar(SCANLINE_OFFSET, 0);
    setScalar(SLOT_MASK_OFFSET, 0);
    setScalar(VIGNETTE_OFFSET, 0);
    setScalar(BASE_BLOOM_OFFSET, 0);
    setScalar(ABERRATION_OFFSET, 0);
    setScalar(NOISE_OFFSET, 0);
    setScalar(DPR_OFFSET, 1);
    setScalar(BLOOM_THRESHOLD_OFFSET, 0.7);
    setScalar(BLOOM_SOFTNESS_OFFSET, 0.6);
    setScalar(K1_OFFSET, 0);
    setScalar(K2_OFFSET, 0);
    setVec2(CSS_SIZE_OFFSET, 1, 1);
    setVec2(INV_CSS_OFFSET, 1, 1);
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
      updateOrientationInfo();
      logOrientationState('init-error');
    });

    return () => {
      unsubscribe();
    };
  });

  onDestroy(() => {
    destroyed = true;
    teardownGpu();
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
    if (toastTimer && typeof window !== 'undefined') {
      window.clearTimeout(toastTimer);
      toastTimer = 0;
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
  {#if toastMessage}
    <div class="crt-postfx__toast" aria-live="polite">{toastMessage}</div>
  {/if}
  <div class="crt-postfx__orientation-panel" aria-hidden="true">
    <h2>Orientation</h2>
    <dl>
      <div>
        <dt>flipY_capture</dt>
        <dd>{orientationInfo.flipYCapture ? 'true' : 'false'}</dd>
      </div>
      <div>
        <dt>flipY_shader</dt>
        <dd>{orientationInfo.flipYShader ? 'true' : 'false'}</dd>
      </div>
      <div>
        <dt>unpackFlipY</dt>
        <dd>{orientationInfo.unpackFlipY ? 'true' : 'false'}</dd>
      </div>
      <div>
        <dt>flipPath</dt>
        <dd>{orientationInfo.flipPath}</dd>
      </div>
      <div>
        <dt>DPR</dt>
        <dd>{orientationInfo.dpr.toFixed(3)}</dd>
      </div>
    </dl>
    <div class="crt-postfx__matrix-list">
      <div class="crt-postfx__matrix">
        <h3>CSS → UV</h3>
        <pre>{formatMatrix(orientationInfo.cssToUv).join('\n')}</pre>
      </div>
      <div class="crt-postfx__matrix">
        <h3>UV → CSS</h3>
        <pre>{formatMatrix(orientationInfo.uvToCss).join('\n')}</pre>
      </div>
      <div class="crt-postfx__matrix">
        <h3>CSS → Texture</h3>
        <pre>{formatMatrix(orientationInfo.cssToTexture).join('\n')}</pre>
      </div>
      <div class="crt-postfx__matrix">
        <h3>Texture → CSS</h3>
        <pre>{formatMatrix(orientationInfo.textureToCss).join('\n')}</pre>
      </div>
    </div>
  </div>
  <div class="crt-postfx__health-panel" aria-hidden="true">
    <h2>Health</h2>
    <dl class="crt-postfx__health-meta">
      <div>
        <dt>tier</dt>
        <dd>{qualityTier}</dd>
      </div>
      <div>
        <dt>mode</dt>
        <dd>{healthSnapshot.latest.mode ?? renderMode}</dd>
      </div>
      <div>
        <dt>dpr</dt>
        <dd>{(healthSnapshot.latest.dpr ?? coordSnapshot.dpr).toFixed(2)}</dd>
      </div>
      <div>
        <dt>internalScale</dt>
        <dd>{(healthSnapshot.latest.internalScale ?? internalScale).toFixed(2)}</dd>
      </div>
      <div>
        <dt>samples</dt>
        <dd>{healthSnapshot.samples}</dd>
      </div>
      <div>
        <dt>gpuTimer</dt>
        <dd>{gpuTimingAccurate ? 'timestamp' : 'cpu'}</dd>
      </div>
      <div>
        <dt>fps(avg)</dt>
        <dd>{avgFps.toFixed(1)}</dd>
      </div>
      <div>
        <dt>fps(latest)</dt>
        <dd>{latestFps.toFixed(1)}</dd>
      </div>
    </dl>
    <div class="crt-postfx__health-grid">
      <div class="crt-postfx__health-column">
        <h3>Latest</h3>
        <dl>
          {#each HEALTH_METRICS as metric}
            <div>
              <dt>{metric.label}</dt>
              <dd>{formatMs(healthSnapshot.latest[metric.key])}</dd>
            </div>
          {/each}
        </dl>
      </div>
      <div class="crt-postfx__health-column">
        <h3>Average</h3>
        <dl>
          {#each HEALTH_METRICS as metric}
            <div>
              <dt>{metric.label}</dt>
              <dd>{formatMs(healthSnapshot.average[metric.key])}</dd>
            </div>
          {/each}
        </dl>
      </div>
      <div class="crt-postfx__health-column">
        <h3>P95</h3>
        <dl>
          {#each HEALTH_METRICS as metric}
            <div>
              <dt>{metric.label}</dt>
              <dd>{formatMs(healthSnapshot.p95[metric.key])}</dd>
            </div>
          {/each}
        </dl>
      </div>
    </div>
    {#if stageKeys.length}
      <div class="crt-postfx__health-stages">
        <h3>GPU Stages (ms)</h3>
        <div class="crt-postfx__health-stage-grid">
          {#each stageKeys as key}
            <div class="crt-postfx__health-stage">
              <span class="crt-postfx__health-stage-label">{key}</span>
              <span class="crt-postfx__health-stage-value">avg {formatMs(stageAverage[key] ?? 0)}</span>
              <span class="crt-postfx__health-stage-value">p95 {formatMs(stageP95[key] ?? 0)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <div class="crt-postfx__debug-controls" aria-hidden="true">
    <label class="crt-postfx__debug-toggle">
      <input type="checkbox" checked={warpDisabled} on:change={handleWarpToggleChange} />
      <span>Warp off</span>
    </label>
    <label class="crt-postfx__debug-toggle">
      <input type="checkbox" checked={showWarpGrid} on:change={handleWarpGridToggleChange} />
      <span>Show warp grid</span>
    </label>
  </div>
  <div class="crt-postfx__warp-grid-overlay" data-visible={showWarpGrid} aria-hidden="true"></div>
  <div class="crt-postfx__debug-grid" aria-hidden="true">
    {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as cell}
      <span class="crt-postfx__debug-cell">{cell}</span>
    {/each}
  </div>
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

  .crt-postfx__toast {
    position: fixed;
    left: 50%;
    bottom: 2.75rem;
    transform: translateX(-50%);
    padding: 0.75rem 1.5rem;
    font-size: 0.75rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    border-radius: 9999px;
    background: rgba(10, 24, 18, 0.88);
    color: rgba(226, 255, 242, 0.95);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    z-index: 55;
    backdrop-filter: blur(12px);
  }

  @media (max-width: 640px) {
    .crt-postfx__badge {
      font-size: 0.58rem;
      top: 0.75rem;
      right: 0.75rem;
    }
  }

  .crt-postfx__orientation-panel {
    position: fixed;
    left: 1rem;
    bottom: 1rem;
    width: min(320px, 90vw);
    padding: 0.75rem 0.85rem;
    border-radius: 0.75rem;
    background: rgba(10, 24, 18, 0.82);
    color: rgba(214, 255, 235, 0.92);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.05em;
    line-height: 1.35;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(12, 48, 34, 0.45);
    backdrop-filter: blur(10px);
  }

  .crt-postfx__orientation-panel h2 {
    margin: 0 0 0.5rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: rgba(166, 255, 208, 0.9);
  }

  .crt-postfx__orientation-panel dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 0.5rem;
    margin: 0 0 0.65rem;
  }

  .crt-postfx__orientation-panel dt {
    font-weight: 600;
    text-transform: uppercase;
    color: rgba(137, 235, 193, 0.9);
  }

  .crt-postfx__orientation-panel dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: rgba(214, 255, 235, 0.88);
  }

  .crt-postfx__matrix-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
  }

  .crt-postfx__matrix h3 {
    margin: 0 0 0.25rem;
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: rgba(154, 255, 210, 0.86);
  }

  .crt-postfx__matrix pre {
    margin: 0;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    line-height: 1.4;
    color: rgba(214, 255, 235, 0.9);
  }

  .crt-postfx__health-panel {
    position: fixed;
    top: 4.5rem;
    right: 1rem;
    width: min(320px, 90vw);
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: rgba(10, 24, 18, 0.82);
    color: rgba(214, 255, 235, 0.92);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.05em;
    line-height: 1.35;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(12, 48, 34, 0.45);
    backdrop-filter: blur(10px);
    z-index: 52;
  }

  .crt-postfx__health-panel h2 {
    margin: 0 0 0.5rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: rgba(166, 255, 208, 0.9);
  }

  .crt-postfx__health-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem 0.6rem;
    margin: 0 0 0.65rem;
  }

  .crt-postfx__health-meta dt {
    text-transform: uppercase;
    font-weight: 600;
    color: rgba(137, 235, 193, 0.9);
  }

  .crt-postfx__health-meta dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: rgba(214, 255, 235, 0.88);
  }

  .crt-postfx__health-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .crt-postfx__health-column h3 {
    margin: 0 0 0.35rem;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(154, 255, 210, 0.86);
  }

  .crt-postfx__health-column dl {
    display: grid;
    gap: 0.35rem;
  }

  .crt-postfx__health-column dt {
    text-transform: uppercase;
    color: rgba(137, 235, 193, 0.8);
  }

  .crt-postfx__health-column dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    color: rgba(214, 255, 235, 0.85);
  }

  .crt-postfx__health-stages {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .crt-postfx__health-stage-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.45rem;
  }

  .crt-postfx__health-stage {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.45rem 0.55rem;
    border-radius: 0.5rem;
    background: rgba(6, 24, 16, 0.65);
    box-shadow: inset 0 0 0 1px rgba(120, 220, 180, 0.18);
  }

  .crt-postfx__health-stage-label {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: rgba(154, 255, 210, 0.86);
  }

  .crt-postfx__health-stage-value {
    font-variant-numeric: tabular-nums;
    color: rgba(214, 255, 235, 0.88);
    font-size: 0.58rem;
  }

  .crt-postfx__debug-controls {
    position: fixed;
    top: 1rem;
    left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.55rem 0.75rem;
    border-radius: 0.6rem;
    background: rgba(10, 24, 18, 0.78);
    color: rgba(214, 255, 235, 0.9);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    pointer-events: auto;
    box-shadow: 0 0 0 1px rgba(12, 48, 34, 0.35);
    z-index: 52;
  }

  .crt-postfx__debug-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    text-transform: uppercase;
  }

  .crt-postfx__debug-toggle input {
    accent-color: rgba(137, 235, 193, 0.9);
  }

  .crt-postfx__debug-toggle span {
    color: rgba(166, 255, 208, 0.9);
  }

  .crt-postfx__warp-grid-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(120, 220, 180, 0.22) 0px, rgba(120, 220, 180, 0.22) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(120, 220, 180, 0.22) 0px, rgba(120, 220, 180, 0.22) 1px, transparent 1px),
      linear-gradient(to right, transparent 0, transparent calc(50% - 0.5px), rgba(120, 220, 180, 0.32) calc(50% - 0.5px), rgba(120, 220, 180, 0.32) calc(50% + 0.5px), transparent calc(50% + 0.5px)),
      linear-gradient(to bottom, transparent 0, transparent calc(50% - 0.5px), rgba(120, 220, 180, 0.32) calc(50% - 0.5px), rgba(120, 220, 180, 0.32) calc(50% + 0.5px), transparent calc(50% + 0.5px));
    background-size:
      calc(100% / 20) 100%,
      100% calc(100% / 12),
      100% 100%,
      100% 100%;
    opacity: 0;
    transition: opacity 120ms ease-in-out;
    mix-blend-mode: screen;
    z-index: 51;
  }

  .crt-postfx__warp-grid-overlay[data-visible='true'] {
    opacity: 0.42;
  }

  .crt-postfx__debug-grid {
    position: fixed;
    top: 1rem;
    left: 1rem;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    width: 96px;
    height: 96px;
    padding: 4px;
    border-radius: 0.5rem;
    background-image:
      linear-gradient(45deg, rgba(120, 220, 180, 0.22) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(120, 220, 180, 0.22) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(120, 220, 180, 0.22) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(120, 220, 180, 0.22) 75%);
    background-size: 24px 24px;
    background-position: 0 0, 0 12px, 12px -12px, -12px 0;
    color: rgba(18, 48, 36, 0.92);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    font-weight: 600;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(12, 48, 34, 0.45), 0 8px 18px rgba(0, 0, 0, 0.28);
  }

  .crt-postfx__debug-cell {
    display: grid;
    place-items: center;
    background: rgba(214, 255, 235, 0.82);
    border-radius: 0.35rem;
    color: rgba(6, 24, 16, 0.92);
    text-shadow: none;
  }
</style>
