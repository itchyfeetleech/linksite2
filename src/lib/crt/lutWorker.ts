import { generateLuts, type GeometryParams } from './geometryMath';

interface WorkerRequest {
  id: number;
  params: GeometryParams;
}

interface WorkerResponse {
  id: number;
  error?: string;
  forward?: Float32Array;
  inverse?: Float32Array;
  width?: number;
  height?: number;
}

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

const respond = (message: WorkerResponse) => {
  const transfers: ArrayBuffer[] = [];
  if (message.forward) {
    transfers.push(message.forward.buffer);
  }
  if (message.inverse) {
    transfers.push(message.inverse.buffer);
  }
  ctx.postMessage(message, transfers);
};

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, params } = event.data;

  try {
    const { forward, inverse, width, height } = generateLuts(params);
    respond({ id, forward, inverse, width, height });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown LUT error';
    respond({ id, error: message });
  }
};
