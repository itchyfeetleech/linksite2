import { mapScreenToDom, type GeometryParams } from './geometryMath';
import { applyMat3, type CoordSpaceSnapshot } from './coordSpace';
import { logger } from '../logger';

export interface CursorState {
  screenX: number;
  screenY: number;
  domX: number;
  domY: number;
  uvX: number;
  uvY: number;
  pointerType: string;
  buttons: number;
  visible: boolean;
}

export interface PointerActivityState {
  pointerDown: boolean;
  pointerType: string;
}

export interface EventProxyOptions {
  canvas: HTMLCanvasElement;
  getWarpParams: () => GeometryParams | null;
  getCoordSpace: () => CoordSpaceSnapshot | null;
  onCursor?: (state: CursorState) => void;
  onActivity?: (state: PointerActivityState) => void;
  logLatency?: (value: number) => void;
}

export interface EventProxyController {
  destroy(): void;
}

const focusElement = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const focusable =
    target.tabIndex >= 0 ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  if (focusable) {
    target.focus({ preventScroll: true });
  }
};

export const createEventProxy = ({
  canvas,
  getWarpParams,
  getCoordSpace,
  onCursor,
  onActivity,
  logLatency
}: EventProxyOptions): EventProxyController => {
  let disposed = false;

  const pointerTargets = new Map<number, EventTarget>();
  const pointerPositions = new Map<number, { x: number; y: number }>();
  const pointerButtons = new Map<number, number>();
  const forwardingPointers = new Set<number>();
  const SYNTHETIC_EVENT = Symbol('crtProxySynthetic');

  let pointerEventsDisabled = false;

  const withHitTest = async <T>(callback: () => T): Promise<T> => {
    if (pointerEventsDisabled) {
      return callback();
    }
    pointerEventsDisabled = true;
    const previous = canvas.style.pointerEvents;
    canvas.style.pointerEvents = 'none';
    await Promise.resolve();
    try {
      return callback();
    } finally {
      canvas.style.pointerEvents = previous;
      pointerEventsDisabled = false;
    }
  };

  const runSafely = (task: () => Promise<void>) => {
    void task().catch((error) => {
      logger.warn('CRT event proxy handler error', error);
    });
  };

  const samplePoint = (x: number, y: number) => {
    const coordSpace = getCoordSpace();
    const params = getWarpParams();
    if (!coordSpace) {
      return {
        domX: x,
        domY: y,
        uvX: 0,
        uvY: 0
      };
    }

    const rawUv = applyMat3(coordSpace.cssToUv, x, y);
    if (!params) {
      return {
        domX: x,
        domY: y,
        uvX: rawUv.x,
        uvY: rawUv.y
      };
    }

    const mapped = mapScreenToDom(x, y, params);
    const domUv = applyMat3(coordSpace.cssToUv, mapped.x, mapped.y);
    return {
      domX: mapped.x,
      domY: mapped.y,
      uvX: domUv.x,
      uvY: domUv.y
    };
  };

  const updateCursor = (payload: CursorState) => {
    onCursor?.(payload);
  };

  const updateActivity = (state: PointerActivityState) => {
    onActivity?.(state);
  };

  const getTarget = async (pointerId: number, coordinates: { x: number; y: number }) => {
    const captured = pointerTargets.get(pointerId);
    if (captured) {
      return captured;
    }
    return withHitTest(() => document.elementFromPoint(coordinates.x, coordinates.y) ?? document.body);
  };

  const buildPointerInit = (
    event: PointerEvent,
    coords: { x: number; y: number },
    movement: { x: number; y: number }
  ): PointerEventInit => ({
    bubbles: true,
    cancelable: event.cancelable,
    composed: event.composed,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    width: event.width,
    height: event.height,
    clientX: coords.x,
    clientY: coords.y,
    screenX: event.screenX + (coords.x - event.clientX),
    screenY: event.screenY + (coords.y - event.clientY),
    movementX: movement.x,
    movementY: movement.y,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  });

  const dispatchPointer = async (
    type: string,
    source: PointerEvent,
    coords: { x: number; y: number },
    preserveTarget = false
  ) => {
    const previous = pointerPositions.get(source.pointerId) ?? coords;
    const movement = { x: coords.x - previous.x, y: coords.y - previous.y };
    pointerPositions.set(source.pointerId, coords);

    const target = preserveTarget
      ? pointerTargets.get(source.pointerId) ?? (await getTarget(source.pointerId, coords))
      : await getTarget(source.pointerId, coords);

    const init = buildPointerInit(source, coords, movement);
    const synthetic = new PointerEvent(type, init);
    Reflect.set(synthetic, SYNTHETIC_EVENT, true);

    const pointerId = source.pointerId;
    if (pointerId >= 0) {
      forwardingPointers.add(pointerId);
    }
    try {
      const dispatched = target.dispatchEvent(synthetic);
      if (!dispatched && source.cancelable) {
        source.preventDefault();
      }
    } finally {
      if (pointerId >= 0) {
        forwardingPointers.delete(pointerId);
      }
    }
    return target;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || forwardingPointers.has(event.pointerId)) {
      return;
    }

    event.stopImmediatePropagation();
    event.stopPropagation();

    runSafely(async () => {
      const start = performance.now();
      const sample = samplePoint(event.clientX, event.clientY);
      const coords = { x: sample.domX, y: sample.domY };
      const target = await dispatchPointer('pointerdown', event, coords);
      pointerTargets.set(event.pointerId, target);
      pointerButtons.set(event.pointerId, event.buttons);
      updateActivity({ pointerDown: true, pointerType: event.pointerType });
      focusElement(target);
      updateCursor({
        screenX: event.clientX,
        screenY: event.clientY,
        domX: sample.domX,
        domY: sample.domY,
        uvX: sample.uvX,
        uvY: sample.uvY,
        pointerType: event.pointerType,
        buttons: event.buttons,
        visible: true
      });
      logLatency?.(performance.now() - start);
    });
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!event.isTrusted || forwardingPointers.has(event.pointerId)) {
      return;
    }

    event.stopImmediatePropagation();
    event.stopPropagation();

    const processEvent = async (source: PointerEvent) => {
      const start = performance.now();
      const sample = samplePoint(source.clientX, source.clientY);
      const coords = { x: sample.domX, y: sample.domY };
      const target = await dispatchPointer('pointermove', source, coords, true);
      pointerButtons.set(source.pointerId, source.buttons);
      updateCursor({
        screenX: source.clientX,
        screenY: source.clientY,
        domX: sample.domX,
        domY: sample.domY,
        uvX: sample.uvX,
        uvY: sample.uvY,
        pointerType: source.pointerType,
        buttons: source.buttons,
        visible: true
      });
      focusElement(source.buttons > 0 ? target : null);
      logLatency?.(performance.now() - start);
    };

    const coalesced = event.getCoalescedEvents?.();
    if (coalesced && coalesced.length > 0) {
      runSafely(async () => {
        for (const item of coalesced) {
          await processEvent(item as PointerEvent);
        }
      });
    } else {
      runSafely(() => processEvent(event));
    }
  };

  const finishPointer = async (event: PointerEvent, type: 'pointerup' | 'pointercancel') => {
    const start = performance.now();
    const sample = samplePoint(event.clientX, event.clientY);
    const coords = { x: sample.domX, y: sample.domY };
    await dispatchPointer(type, event, coords, true);
    pointerTargets.delete(event.pointerId);
    pointerPositions.delete(event.pointerId);
    pointerButtons.delete(event.pointerId);
    updateActivity({ pointerDown: false, pointerType: event.pointerType });
    updateCursor({
      screenX: event.clientX,
      screenY: event.clientY,
      domX: sample.domX,
      domY: sample.domY,
      uvX: sample.uvX,
      uvY: sample.uvY,
      pointerType: event.pointerType,
      buttons: 0,
      visible: type === 'pointerup'
    });
    logLatency?.(performance.now() - start);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (!event.isTrusted || forwardingPointers.has(event.pointerId)) {
      return;
    }
    event.stopImmediatePropagation();
    event.stopPropagation();
    runSafely(() => finishPointer(event, 'pointerup'));
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (!event.isTrusted || forwardingPointers.has(event.pointerId)) {
      return;
    }
    event.stopImmediatePropagation();
    event.stopPropagation();
    runSafely(() => finishPointer(event, 'pointercancel'));
  };

  const handlePointerEnter = (event: PointerEvent) => {
    if (!event.isTrusted) {
      return;
    }
    const sample = samplePoint(event.clientX, event.clientY);
    updateCursor({
      screenX: event.clientX,
      screenY: event.clientY,
      domX: sample.domX,
      domY: sample.domY,
      uvX: sample.uvX,
      uvY: sample.uvY,
      pointerType: event.pointerType,
      buttons: event.buttons,
      visible: true
    });
  };

  const handlePointerLeave = (event: PointerEvent) => {
    if (!event.isTrusted) {
      return;
    }
    pointerTargets.delete(event.pointerId);
    pointerPositions.delete(event.pointerId);
    pointerButtons.delete(event.pointerId);
    const sample = samplePoint(event.clientX, event.clientY);
    updateCursor({
      screenX: event.clientX,
      screenY: event.clientY,
      domX: sample.domX,
      domY: sample.domY,
      uvX: sample.uvX,
      uvY: sample.uvY,
      pointerType: event.pointerType,
      buttons: 0,
      visible: false
    });
  };

  const handleWheel = (event: WheelEvent) => {
    if (!event.isTrusted) {
      return;
    }
    event.stopImmediatePropagation();
    event.stopPropagation();

    runSafely(async () => {
      const start = performance.now();
      const sample = samplePoint(event.clientX, event.clientY);
      const coords = { x: sample.domX, y: sample.domY };
      const target = await getTarget(-1, coords);
      const synthetic = new WheelEvent(event.type, {
        bubbles: true,
        cancelable: event.cancelable,
        composed: event.composed,
        deltaMode: event.deltaMode,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        clientX: coords.x,
        clientY: coords.y,
        screenX: event.screenX + (coords.x - event.clientX),
        screenY: event.screenY + (coords.y - event.clientY),
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey
      });
      Reflect.set(synthetic, SYNTHETIC_EVENT, true);
      const dispatched = target.dispatchEvent(synthetic);
      if (!dispatched && event.cancelable) {
        event.preventDefault();
      }
      logLatency?.(performance.now() - start);
    });
  };

  const handleMouseLike = (event: MouseEvent) => {
    if (!event.isTrusted) {
      return;
    }
    event.stopImmediatePropagation();
    event.stopPropagation();

    runSafely(async () => {
      const start = performance.now();
      const sample = samplePoint(event.clientX, event.clientY);
      const coords = { x: sample.domX, y: sample.domY };
      const target = await getTarget(-1, coords);
      const synthetic = new MouseEvent(event.type, {
        bubbles: true,
        cancelable: event.cancelable,
        composed: event.composed,
        clientX: coords.x,
        clientY: coords.y,
        screenX: event.screenX + (coords.x - event.clientX),
        screenY: event.screenY + (coords.y - event.clientY),
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey
      });
      Reflect.set(synthetic, SYNTHETIC_EVENT, true);
      const dispatched = target.dispatchEvent(synthetic);
      if (!dispatched && event.cancelable) {
        event.preventDefault();
      }
      if (event.type === 'dblclick' || event.type === 'click') {
        focusElement(target);
      }
      logLatency?.(performance.now() - start);
    });
  };

  const handleContextMenu = (event: MouseEvent) => {
    handleMouseLike(event);
  };

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerCancel);
  canvas.addEventListener('pointerenter', handlePointerEnter);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('click', handleMouseLike, true);
  canvas.addEventListener('dblclick', handleMouseLike, true);
  canvas.addEventListener('contextmenu', handleContextMenu, true);

  const destroy = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerCancel);
    canvas.removeEventListener('pointerenter', handlePointerEnter);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('click', handleMouseLike, true);
    canvas.removeEventListener('dblclick', handleMouseLike, true);
    canvas.removeEventListener('contextmenu', handleContextMenu, true);
    canvas.style.pointerEvents = '';
    pointerEventsDisabled = false;
    pointerTargets.clear();
    pointerPositions.clear();
    pointerButtons.clear();
    forwardingPointers.clear();
  };

  return { destroy };
};
