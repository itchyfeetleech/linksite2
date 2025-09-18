import type { GeometryParams, LutResult } from './geometryMath';

interface PendingRequest {
  resolve: (value: LutResult) => void;
  reject: (error: Error) => void;
}

export interface LutController {
  request(params: GeometryParams): Promise<LutResult>;
  dispose(): void;
}

export const createLutController = (): LutController => {
  let worker: Worker | null = null;
  let requestId = 0;
  const pending = new Map<number, PendingRequest>();

  const ensureWorker = () => {
    if (worker) {
      return;
    }
    worker = new Worker(new URL('./lutWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<{ id: number; error?: string } & LutResult>) => {
      const { id, error, ...rest } = event.data;
      const handle = pending.get(id);
      if (!handle) {
        return;
      }
      pending.delete(id);
      if (error) {
        handle.reject(new Error(error));
        return;
      }
      if (!rest.forward || !rest.inverse || !rest.width || !rest.height) {
        handle.reject(new Error('Malformed LUT payload'));
        return;
      }
      handle.resolve({
        forward: rest.forward,
        inverse: rest.inverse,
        width: rest.width,
        height: rest.height
      });
    });
    worker.addEventListener('error', (error) => {
      pending.forEach((entry) => entry.reject(error instanceof Error ? error : new Error('LUT worker error')));
      pending.clear();
    });
  };

  const request = (params: GeometryParams) => {
    ensureWorker();
    if (!worker) {
      return Promise.reject(new Error('LUT worker unavailable'));
    }

    const id = ++requestId;
    return new Promise<LutResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker?.postMessage({ id, params });
    });
  };

  const dispose = () => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    pending.forEach((entry) => entry.reject(new Error('LUT controller disposed')));
    pending.clear();
  };

  return { request, dispose };
};
