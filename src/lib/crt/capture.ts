import html2canvas from 'html2canvas';
import type { Options as Html2CanvasOptions } from 'html2canvas';
import { logger } from '../logger';
import type { CaptureFrame } from './types';

// html2canvas renders with CSS-top-left origin. We keep the bitmap unflipped and
// flip in the GPU/WebGL pipelines for consistency across renderers.
export const FLIP_Y_CAPTURE = false;

export interface CaptureStats {
  duration: number;
}

type BufferCanvas = HTMLCanvasElement | OffscreenCanvas;
type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = { x: number; y: number; width: number; height: number };

interface DomCaptureOptions {
  root: HTMLElement;
  ignore?: (element: Element) => boolean;
  throttleMs?: number;
  onCapture: (frame: CaptureFrame, stats: CaptureStats) => Promise<void> | void;
  getScale?: () => number;
}

export interface DomCaptureController {
  trigger(): void;
  captureImmediate(): Promise<void>;
  setPaused(paused: boolean): void;
  updateThrottle(value: number): void;
  destroy(): void;
}

const DEFAULT_THROTTLE = 40;
const MAX_PARTIAL_RATIO = 0.85;
const EXPAND_PADDING = 6;
const CAPTURE_COOLDOWN_MULTIPLIER = 1.4;
const MAX_DYNAMIC_THROTTLE = 260;

const rectArea = (rect: Rect) => rect.width * rect.height;

const unionRects = (a: Rect, b: Rect): Rect => {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
};

const intersectRect = (rect: Rect, bounds: Rect): Rect => {
  const x = Math.max(rect.x, bounds.x);
  const y = Math.max(rect.y, bounds.y);
  const maxX = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const maxY = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  return {
    x,
    y,
    width: Math.max(0, maxX - x),
    height: Math.max(0, maxY - y)
  };
};

const expandRect = (rect: Rect, padding: number) => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2
});

const rectFromDomRect = (domRect: DOMRect): Rect => ({
  x: domRect.left,
  y: domRect.top,
  width: domRect.width,
  height: domRect.height
});

const viewportRect = (): Rect => ({
  x: 0,
  y: 0,
  width: Math.max(1, Math.round(window.innerWidth)),
  height: Math.max(1, Math.round(window.innerHeight))
});

const isOffscreenCanvas = (canvas: BufferCanvas): canvas is OffscreenCanvas =>
  typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas;

const createBufferCanvas = (width: number, height: number): BufferCanvas => {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const getCanvasContext = (canvas: BufferCanvas): Canvas2DContext | null => {
  const ctx = canvas.getContext('2d');
  if (ctx && 'imageSmoothingEnabled' in ctx) {
    (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = false;
  }
  return ctx;
};

const releaseCanvas = (canvas: BufferCanvas | null) => {
  if (!canvas) {
    return;
  }
  if (!isOffscreenCanvas(canvas)) {
    canvas.width = 0;
    canvas.height = 0;
  }
};

export const createDomCapture = ({
  root,
  ignore,
  throttleMs = DEFAULT_THROTTLE,
  onCapture,
  getScale
}: DomCaptureOptions): DomCaptureController => {
  let disposed = false;
  let paused = false;
  let scheduled = false;
  let running = false;
  let lastCapture = 0;
  let throttle = throttleMs;
  let animationLoopHandle = 0;
  let activeAnimations = 0;

  let captureCanvas: BufferCanvas | null = null;
  let captureCtx: Canvas2DContext | null = null;
  let cachedScale = 1;
  let canvasPixelWidth = 0;
  let canvasPixelHeight = 0;
  let dirtyRect: Rect | null = null;
  let fullDirty = true;
  let captureCooldownUntil = 0;

  const ignorePredicate =
    ignore ?? ((element: Element) => element instanceof HTMLElement && element.dataset.crtPostfxIgnore === 'true');

  const markDirtyFull = () => {
    fullDirty = true;
    dirtyRect = null;
  };

  const markDirtyRect = (rect: Rect | null) => {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      markDirtyFull();
      return;
    }
    const viewport = viewportRect();
    const clamped = intersectRect(rect, viewport);
    if (clamped.width <= 0 || clamped.height <= 0) {
      return;
    }
    if (fullDirty) {
      return;
    }
    dirtyRect = dirtyRect ? unionRects(dirtyRect, clamped) : clamped;
  };

  const shouldIgnoreNode = (node: Node | null): boolean => {
    if (!node) {
      return false;
    }
    let current: Element | null = node instanceof Element ? node : node.parentElement;
    while (current) {
      if (ignorePredicate(current)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };

  const schedule = () => {
    if (disposed || paused) {
      return;
    }
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.requestAnimationFrame(async () => {
      scheduled = false;
      await capture();
    });
  };

  const stopAnimationLoop = () => {
    if (animationLoopHandle) {
      window.cancelAnimationFrame(animationLoopHandle);
      animationLoopHandle = 0;
    }
  };

  const animationTick = () => {
    if (disposed || paused || activeAnimations === 0) {
      stopAnimationLoop();
      return;
    }

    schedule();
    animationLoopHandle = window.requestAnimationFrame(animationTick);
  };

  const ensureAnimationLoop = () => {
    if (animationLoopHandle || activeAnimations === 0 || disposed || paused) {
      return;
    }
    animationLoopHandle = window.requestAnimationFrame(animationTick);
  };

  const handleAnimationIteration = () => {
    markDirtyFull();
    schedule();
  };

  const elementRect = (node: Node): Rect | null => {
    if (node instanceof Element) {
      return rectFromDomRect(node.getBoundingClientRect());
    }
    if (node.parentElement) {
      return rectFromDomRect(node.parentElement.getBoundingClientRect());
    }
    return null;
  };

  const considerNode = (node: Node, viewport: Rect): boolean => {
    if (shouldIgnoreNode(node)) {
      return false;
    }
    if (node instanceof Element && ignorePredicate(node)) {
      return false;
    }
    const rect = elementRect(node);
    if (!rect) {
      return false;
    }
    markDirtyRect(intersectRect(expandRect(rect, EXPAND_PADDING), viewport));
    return true;
  };

  const handleMutation: MutationCallback = (mutations) => {
    if (disposed) {
      return;
    }
    const viewport = viewportRect();
    let mutated = false;

    for (const mutation of mutations) {
      if (!shouldIgnoreNode(mutation.target) && considerNode(mutation.target, viewport)) {
        mutated = true;
      }
      mutation.addedNodes?.forEach((node) => {
        if (!shouldIgnoreNode(node) && considerNode(node, viewport)) {
          mutated = true;
        }
      });
      mutation.removedNodes?.forEach((node) => {
        if (!shouldIgnoreNode(node) && considerNode(node, viewport)) {
          mutated = true;
        }
      });
    }

    if (mutated) {
      schedule();
    }
  };

  const handleAnimationStart = (event: Event) => {
    if (shouldIgnoreNode(event.target as Node | null)) {
      return;
    }
    activeAnimations += 1;
    markDirtyFull();
    schedule();
    ensureAnimationLoop();
  };

  const handleAnimationStop = (event: Event) => {
    if (shouldIgnoreNode(event.target as Node | null)) {
      return;
    }
    activeAnimations = Math.max(0, activeAnimations - 1);
    markDirtyFull();
    schedule();
    if (activeAnimations === 0) {
      stopAnimationLoop();
    }
  };

  const handleResize = () => {
    markDirtyFull();
    schedule();
  };

  const observer = new MutationObserver(handleMutation);
  observer.observe(root, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });

  window.addEventListener('resize', handleResize);
  document.addEventListener('animationstart', handleAnimationStart, true);
  document.addEventListener('animationiteration', handleAnimationIteration, true);
  document.addEventListener('animationend', handleAnimationStop, true);
  document.addEventListener('animationcancel', handleAnimationStop, true);
  document.addEventListener('transitionstart', handleAnimationStart, true);
  document.addEventListener('transitionend', handleAnimationStop, true);
  document.addEventListener('transitioncancel', handleAnimationStop, true);

  const capture = async (force = false) => {
    if (disposed || paused) {
      return;
    }

    const now = performance.now();
    if (!force && now < captureCooldownUntil) {
      schedule();
      return;
    }
    if (!force && running) {
      return;
    }

    if (!force && now - lastCapture < throttle) {
      schedule();
      return;
    }

    running = true;

    try {
      const viewport = viewportRect();
      const requestedScale = getScale?.() ?? window.devicePixelRatio ?? 1;
      const scale = Math.max(0.1, requestedScale);
      const pixelWidth = Math.max(1, Math.round(viewport.width * scale));
      const pixelHeight = Math.max(1, Math.round(viewport.height * scale));
      const sizeChanged = pixelWidth !== canvasPixelWidth || pixelHeight !== canvasPixelHeight;
      const scaleChanged = Math.abs(scale - cachedScale) > 1e-3;

      if (!captureCanvas || !captureCtx || sizeChanged || scaleChanged) {
        releaseCanvas(captureCanvas);
        captureCanvas = createBufferCanvas(pixelWidth, pixelHeight);
        captureCtx = getCanvasContext(captureCanvas);
        canvasPixelWidth = pixelWidth;
        canvasPixelHeight = pixelHeight;
        cachedScale = scale;
        markDirtyFull();
      }

      if (!captureCanvas || !captureCtx) {
        logger.warn('CRT capture: Unable to obtain 2D context');
        return;
      }

      const needsCapture = force || fullDirty || dirtyRect !== null;
      if (!needsCapture) {
        return;
      }

      const effectiveViewport = viewportRect();
      const targetRect =
        fullDirty || !dirtyRect
          ? effectiveViewport
          : intersectRect(expandRect(dirtyRect, EXPAND_PADDING), effectiveViewport);

      const areaRatio = rectArea(targetRect) / rectArea(effectiveViewport);
      const captureFull = fullDirty || areaRatio >= MAX_PARTIAL_RATIO;
      const captureRegion = captureFull ? effectiveViewport : targetRect;

      const docX = Math.max(0, Math.floor(captureRegion.x + window.scrollX));
      const docY = Math.max(0, Math.floor(captureRegion.y + window.scrollY));
      const regionWidth = Math.max(1, Math.ceil(captureRegion.width));
      const regionHeight = Math.max(1, Math.ceil(captureRegion.height));

      const baseOptions = {
        backgroundColor: null,
        useCORS: true,
        logging: false,
        scale,
        ignoreElements: (element: Element) => ignorePredicate(element),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        windowWidth: effectiveViewport.width,
        windowHeight: effectiveViewport.height
      } satisfies Html2CanvasOptions;

      const partialOptions = captureFull
        ? {}
        : {
            width: regionWidth,
            height: regionHeight,
            x: docX,
            y: docY
          } satisfies Partial<Html2CanvasOptions>;

      const captureStart = performance.now();
      const snapshot = await html2canvas(root, { ...baseOptions, ...partialOptions });
      const renderDuration = performance.now() - captureStart;

      if (captureFull) {
        captureCtx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight);
        captureCtx.drawImage(snapshot, 0, 0);
      } else {
        const destX = Math.round(captureRegion.x * scale);
        const destY = Math.round(captureRegion.y * scale);
        captureCtx.clearRect(destX, destY, snapshot.width, snapshot.height);
        captureCtx.drawImage(snapshot, destX, destY);
      }

      if (snapshot instanceof HTMLCanvasElement) {
        snapshot.width = 0;
        snapshot.height = 0;
      }

      dirtyRect = null;
      fullDirty = false;

      const bitmapOptions: ImageBitmapOptions = {
        imageOrientation: FLIP_Y_CAPTURE ? 'flipY' : 'none',
        premultiplyAlpha: 'premultiply'
      };

      const bitmapStart = performance.now();
      const imageBitmap = await createImageBitmap(captureCanvas as unknown as ImageBitmapSource, bitmapOptions);
      const bitmapDuration = performance.now() - bitmapStart;

      const totalDuration = renderDuration + bitmapDuration;

      await onCapture(
        {
          bitmap: imageBitmap,
          width: canvasPixelWidth,
          height: canvasPixelHeight,
          dpr: scale
        },
        { duration: totalDuration }
      );

      if (!force && totalDuration > CAPTURE_SPIKE_THRESHOLD) {
        captureCooldownUntil = performance.now() + totalDuration * CAPTURE_COOLDOWN_MULTIPLIER;
        const suggestedThrottle = Math.floor(totalDuration * CAPTURE_COOLDOWN_MULTIPLIER);
        throttle = Math.min(MAX_DYNAMIC_THROTTLE, Math.max(throttle, suggestedThrottle));
      }
    } catch (error) {
      logger.warn('CRT postFX capture failed', error);
    } finally {
      running = false;
      lastCapture = performance.now();
    }
  };

  const trigger = () => {
    if (disposed) {
      return;
    }
    markDirtyFull();
    schedule();
  };

  const captureImmediate = async () => {
    markDirtyFull();
    await capture(true);
  };

  const setPaused = (value: boolean) => {
    if (disposed) {
      return;
    }
    paused = value;
    if (!paused) {
      markDirtyFull();
      schedule();
      ensureAnimationLoop();
    } else {
      stopAnimationLoop();
    }
  };

  const updateThrottle = (value: number) => {
    throttle = Math.max(16, Math.floor(value));
  };

  const destroy = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    observer.disconnect();
    window.removeEventListener('resize', handleResize);
    document.removeEventListener('animationstart', handleAnimationStart, true);
    document.removeEventListener('animationiteration', handleAnimationIteration, true);
    document.removeEventListener('animationend', handleAnimationStop, true);
    document.removeEventListener('animationcancel', handleAnimationStop, true);
    document.removeEventListener('transitionstart', handleAnimationStart, true);
    document.removeEventListener('transitionend', handleAnimationStop, true);
    document.removeEventListener('transitioncancel', handleAnimationStop, true);
    stopAnimationLoop();
    releaseCanvas(captureCanvas);
    captureCanvas = null;
    captureCtx = null;
  };

  markDirtyFull();

  return {
    trigger,
    captureImmediate,
    setPaused,
    updateThrottle,
    destroy
  };
};
