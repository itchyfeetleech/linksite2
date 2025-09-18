import { bilinearSample, type LutResult } from './geometryMath';

interface LutSample {
  width: number;
  height: number;
  data: Float32Array;
}

export interface CursorState {
  screenX: number;
  screenY: number;
  domX: number;
  domY: number;
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
  getLut: () => LutSample | null;
  onCursor?: (state: CursorState) => void;
  onActivity?: (state: PointerActivityState) => void;
  logLatency?: (value: number) => void;
}

export interface EventProxyController {
  updateLut(result: LutResult | null): void;
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
  getLut,
  onCursor,
  onActivity,
  logLatency
}: EventProxyOptions): EventProxyController => {
  let disposed = false;
  let lut: LutSample | null = null;

  const pointerTargets = new Map<number, EventTarget>();
  const pointerPositions = new Map<number, { x: number; y: number }>();
  const pointerButtons = new Map<number, number>();

  let pointerEventsDisabled = false;
  let restoreHandle = 0;

  const disableForHitTest = () => {
    if (pointerEventsDisabled) {
      return;
    }
    pointerEventsDisabled = true;
    canvas.style.pointerEvents = 'none';
    restoreHandle = window.requestAnimationFrame(() => {
      canvas.style.pointerEvents = '';
      pointerEventsDisabled = false;
      restoreHandle = 0;
    });
  };

  const cancelRestore = () => {
    if (restoreHandle) {
      window.cancelAnimationFrame(restoreHandle);
      restoreHandle = 0;
    }
  };

  const samplePoint = (x: number, y: number) => {
    const sample = lut ?? getLut();
    if (!sample) {
      return { x, y };
    }
    return bilinearSample(sample.data, sample.width, sample.height, x, y);
  };

  const updateCursor = (payload: CursorState) => {
    onCursor?.(payload);
  };

  const updateActivity = (state: PointerActivityState) => {
    onActivity?.(state);
  };

  const getTarget = (pointerId: number, coordinates: { x: number; y: number }) => {
    const captured = pointerTargets.get(pointerId);
    if (captured) {
      return captured;
    }
    disableForHitTest();
    const target = document.elementFromPoint(coordinates.x, coordinates.y) ?? document.body;
    return target;
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
    pageX: coords.x + window.scrollX,
    pageY: coords.y + window.scrollY,
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

  const dispatchPointer = (
    type: string,
    source: PointerEvent,
    coords: { x: number; y: number },
    preserveTarget = false
  ) => {
    const previous = pointerPositions.get(source.pointerId) ?? coords;
    const movement = { x: coords.x - previous.x, y: coords.y - previous.y };
    pointerPositions.set(source.pointerId, coords);

    const target = preserveTarget
      ? pointerTargets.get(source.pointerId) ?? getTarget(source.pointerId, coords)
      : getTarget(source.pointerId, coords);

    const init = buildPointerInit(source, coords, movement);
    const synthetic = new PointerEvent(type, init);
    const dispatched = target.dispatchEvent(synthetic);
    if (!dispatched && source.cancelable) {
      source.preventDefault();
    }
    return target;
  };

  const handlePointerDown = (event: PointerEvent) => {
    const start = performance.now();
    const coords = samplePoint(event.clientX, event.clientY);
    const target = dispatchPointer('pointerdown', event, coords);
    pointerTargets.set(event.pointerId, target);
    pointerButtons.set(event.pointerId, event.buttons);
    updateActivity({ pointerDown: true, pointerType: event.pointerType });
    focusElement(target);
    updateCursor({
      screenX: event.clientX,
      screenY: event.clientY,
      domX: coords.x,
      domY: coords.y,
      pointerType: event.pointerType,
      buttons: event.buttons,
      visible: true
    });
    logLatency?.(performance.now() - start);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const process = (source: PointerEvent) => {
      const start = performance.now();
      const coords = samplePoint(source.clientX, source.clientY);
      const target = dispatchPointer('pointermove', source, coords, true);
      pointerButtons.set(source.pointerId, source.buttons);
      updateCursor({
        screenX: source.clientX,
        screenY: source.clientY,
        domX: coords.x,
        domY: coords.y,
        pointerType: source.pointerType,
        buttons: source.buttons,
        visible: true
      });
      focusElement(source.buttons > 0 ? target : null);
      logLatency?.(performance.now() - start);
    };

    const coalesced = event.getCoalescedEvents?.();
    if (coalesced && coalesced.length > 0) {
      coalesced.forEach((coalescedEvent) => {
        process(coalescedEvent as PointerEvent);
      });
    } else {
      process(event);
    }
  };

  const finishPointer = (event: PointerEvent, type: 'pointerup' | 'pointercancel') => {
    const start = performance.now();
    const coords = samplePoint(event.clientX, event.clientY);
    dispatchPointer(type, event, coords, true);
    pointerTargets.delete(event.pointerId);
    pointerPositions.delete(event.pointerId);
    pointerButtons.delete(event.pointerId);
    updateActivity({ pointerDown: false, pointerType: event.pointerType });
    updateCursor({
      screenX: event.clientX,
      screenY: event.clientY,
      domX: coords.x,
      domY: coords.y,
      pointerType: event.pointerType,
      buttons: 0,
      visible: type === 'pointerup'
    });
    logLatency?.(performance.now() - start);
  };

  const handlePointerUp = (event: PointerEvent) => {
    finishPointer(event, 'pointerup');
  };

  const handlePointerCancel = (event: PointerEvent) => {
    finishPointer(event, 'pointercancel');
  };

  const handlePointerEnter = (event: PointerEvent) => {
    const coords = samplePoint(event.clientX, event.clientY);
    updateCursor({
      screenX: event.clientX,
      screenY: event.clientY,
      domX: coords.x,
      domY: coords.y,
      pointerType: event.pointerType,
      buttons: event.buttons,
      visible: true
    });
  };

  const handlePointerLeave = (event: PointerEvent) => {
    pointerTargets.delete(event.pointerId);
    pointerPositions.delete(event.pointerId);
    pointerButtons.delete(event.pointerId);
    updateCursor({
      screenX: event.clientX,
      screenY: event.clientY,
      domX: event.clientX,
      domY: event.clientY,
      pointerType: event.pointerType,
      buttons: 0,
      visible: false
    });
  };

  const handleWheel = (event: WheelEvent) => {
    const start = performance.now();
    const coords = samplePoint(event.clientX, event.clientY);
    const target = getTarget(-1, coords);
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
    const dispatched = target.dispatchEvent(synthetic);
    if (!dispatched && event.cancelable) {
      event.preventDefault();
    }
    logLatency?.(performance.now() - start);
  };

  const handleMouseLike = (event: MouseEvent) => {
    const start = performance.now();
    const coords = samplePoint(event.clientX, event.clientY);
    const target = getTarget(-1, coords);
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
    const dispatched = target.dispatchEvent(synthetic);
    if (!dispatched && event.cancelable) {
      event.preventDefault();
    }
    if (event.type === 'dblclick' || event.type === 'click') {
      focusElement(target);
    }
    logLatency?.(performance.now() - start);
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
    cancelRestore();
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
    pointerTargets.clear();
    pointerPositions.clear();
    pointerButtons.clear();
  };

  const updateLut = (result: LutResult | null) => {
    if (!result) {
      lut = null;
      return;
    }
    lut = {
      width: result.width,
      height: result.height,
      data: result.inverse
    } satisfies LutSample;
  };

  return { updateLut, destroy };
};
