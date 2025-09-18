import html2canvas from 'html2canvas';
import { logger } from '../logger';
import type { CaptureFrame } from './types';

interface DomCaptureOptions {
  root: HTMLElement;
  ignore?: (element: Element) => boolean;
  throttleMs?: number;
  onCapture: (frame: CaptureFrame) => Promise<void> | void;
}

export interface DomCaptureController {
  trigger(): void;
  captureImmediate(): Promise<void>;
  setPaused(paused: boolean): void;
  updateThrottle(value: number): void;
  destroy(): void;
}

const DEFAULT_THROTTLE = 80;

export const createDomCapture = ({
  root,
  ignore,
  throttleMs = DEFAULT_THROTTLE,
  onCapture
}: DomCaptureOptions): DomCaptureController => {
  let disposed = false;
  let paused = false;
  let scheduled = false;
  let running = false;
  let lastCapture = 0;
  let throttle = throttleMs;
  let animationLoopHandle = 0;
  let activeAnimations = 0;

  const ignorePredicate = ignore ?? ((element: Element) => element instanceof HTMLElement && element.dataset.crtPostfxIgnore === 'true');

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

  const handleMutation: MutationCallback = () => {
    schedule();
  };

  const handleAnimationStart = () => {
    activeAnimations += 1;
    schedule();
    ensureAnimationLoop();
  };

  const handleAnimationStop = () => {
    activeAnimations = Math.max(0, activeAnimations - 1);
    schedule();
    if (activeAnimations === 0) {
      stopAnimationLoop();
    }
  };

  const handleResize = () => {
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
  document.addEventListener('animationiteration', schedule, true);
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
    if (!force && running) {
      return;
    }

    if (!force && now - lastCapture < throttle) {
      schedule();
      return;
    }

    running = true;

    try {
      const dpr = window.devicePixelRatio || 1;
      const canvas = await html2canvas(root, {
        backgroundColor: null,
        useCORS: true,
        logging: false,
        scale: dpr,
        ignoreElements: (element) => ignorePredicate(element)
      });

      const bitmap = await createImageBitmap(canvas);
      await onCapture({
        bitmap,
        width: canvas.width,
        height: canvas.height,
        dpr
      });
    } catch (error) {
      logger.warn('CRT postFX capture failed', error);
    } finally {
      lastCapture = performance.now();
      running = false;
    }
  };

  const trigger = () => {
    if (disposed) {
      return;
    }
    schedule();
  };

  const captureImmediate = async () => {
    await capture(true);
  };

  const setPaused = (value: boolean) => {
    if (disposed) {
      return;
    }
    paused = value;
    if (!paused) {
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
    document.removeEventListener('animationiteration', schedule, true);
    document.removeEventListener('animationend', handleAnimationStop, true);
    document.removeEventListener('animationcancel', handleAnimationStop, true);
    document.removeEventListener('transitionstart', handleAnimationStart, true);
    document.removeEventListener('transitionend', handleAnimationStop, true);
    document.removeEventListener('transitioncancel', handleAnimationStop, true);
    stopAnimationLoop();
  };

  return {
    trigger,
    captureImmediate,
    setPaused,
    updateThrottle,
    destroy
  };
};

