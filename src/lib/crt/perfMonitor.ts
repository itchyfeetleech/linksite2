export interface FrameTimings {
  captureMs: number;
  gpuSubmitMs: number;
  gpuFrameMs: number;
  proxyMs: number;
  totalMs: number;
  timestamp: number;
  stages?: Record<string, number>;
  fps?: number;
  mode?: string;
  dpr?: number;
  internalScale?: number;
}

export interface PerfSnapshot {
  latest: FrameTimings;
  average: FrameTimings;
  p95: FrameTimings;
  samples: number;
  stageAverage: Record<string, number>;
  stageP95: Record<string, number>;
}

const createEmptyTimings = (): FrameTimings => ({
  captureMs: 0,
  gpuSubmitMs: 0,
  gpuFrameMs: 0,
  proxyMs: 0,
  totalMs: 0,
  timestamp: 0,
  fps: 0
});

const computePercentile = (values: number[], percentile: number) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(percentile * (sorted.length - 1))));
  return sorted[index];
};

const buildTimingsFromExtractor = (history: FrameTimings[], extractor: (item: FrameTimings) => number, percentile: number) =>
  computePercentile(history.map(extractor), percentile);

const sumTimings = (base: FrameTimings, delta: FrameTimings, sign: 1 | -1) => {
  base.captureMs += delta.captureMs * sign;
  base.gpuSubmitMs += delta.gpuSubmitMs * sign;
  base.gpuFrameMs += delta.gpuFrameMs * sign;
  base.proxyMs += delta.proxyMs * sign;
  base.totalMs += delta.totalMs * sign;
  if (typeof delta.fps === 'number') {
    base.fps = (base.fps ?? 0) + delta.fps * sign;
  }
};

export const createPerfMonitor = (capacity = 240) => {
  const history: FrameTimings[] = [];
  const sums = createEmptyTimings();
  const stageHistory: Record<string, number>[] = [];
  let snapshot: PerfSnapshot = {
    latest: createEmptyTimings(),
    average: createEmptyTimings(),
    p95: createEmptyTimings(),
    samples: 0,
    stageAverage: {},
    stageP95: {}
  };

  const computeAverage = () => {
    if (history.length === 0) {
      return createEmptyTimings();
    }
    return {
      captureMs: sums.captureMs / history.length,
      gpuSubmitMs: sums.gpuSubmitMs / history.length,
      gpuFrameMs: sums.gpuFrameMs / history.length,
      proxyMs: sums.proxyMs / history.length,
      totalMs: sums.totalMs / history.length,
      timestamp: history[history.length - 1]?.timestamp ?? performance.now(),
      fps: typeof sums.fps === 'number' ? sums.fps / history.length : 0
    } satisfies FrameTimings;
  };

  const computeP95 = () => {
    if (history.length === 0) {
      return createEmptyTimings();
    }
    return {
      captureMs: buildTimingsFromExtractor(history, (item) => item.captureMs, 0.95),
      gpuSubmitMs: buildTimingsFromExtractor(history, (item) => item.gpuSubmitMs, 0.95),
      gpuFrameMs: buildTimingsFromExtractor(history, (item) => item.gpuFrameMs, 0.95),
      proxyMs: buildTimingsFromExtractor(history, (item) => item.proxyMs, 0.95),
      totalMs: buildTimingsFromExtractor(history, (item) => item.totalMs, 0.95),
      timestamp: history[history.length - 1]?.timestamp ?? performance.now(),
      fps: buildTimingsFromExtractor(history, (item) => item.fps ?? 0, 0.95)
    } satisfies FrameTimings;
  };

  const collectStageKeys = () => {
    const keys = new Set<string>();
    for (const entry of stageHistory) {
      for (const key of Object.keys(entry)) {
        keys.add(key);
      }
    }
    return keys;
  };

  const computeStageAverage = () => {
    const keys = collectStageKeys();
    const result: Record<string, number> = {};
    if (stageHistory.length === 0) {
      return result;
    }
    keys.forEach((key) => {
      let sum = 0;
      stageHistory.forEach((entry) => {
        sum += entry[key] ?? 0;
      });
      result[key] = sum / stageHistory.length;
    });
    return result;
  };

  const computeStagePercentile = (percentile: number) => {
    const keys = collectStageKeys();
    const result: Record<string, number> = {};
    keys.forEach((key) => {
      const values = stageHistory.map((entry) => entry[key] ?? 0);
      result[key] = computePercentile(values, percentile);
    });
    return result;
  };

  const buildSnapshot = () => {
    snapshot = {
      latest: history[history.length - 1] ?? createEmptyTimings(),
      average: computeAverage(),
      p95: computeP95(),
      samples: history.length,
      stageAverage: computeStageAverage(),
      stageP95: computeStagePercentile(0.95)
    } satisfies PerfSnapshot;
    return snapshot;
  };

  const record = (timings: FrameTimings) => {
    const stageEntry = timings.stages ? { ...timings.stages } : {};
    history.push(timings);
    stageHistory.push(stageEntry);
    sumTimings(sums, timings, 1);
    if (history.length > capacity) {
      const removed = history.shift();
      if (removed) {
        sumTimings(sums, removed, -1);
      }
      stageHistory.shift();
    }
    return buildSnapshot();
  };

  const getSnapshot = () => snapshot;

  const reset = () => {
    history.splice(0, history.length);
    stageHistory.splice(0, stageHistory.length);
    const empty = createEmptyTimings();
    sums.captureMs = 0;
    sums.gpuSubmitMs = 0;
    sums.gpuFrameMs = 0;
    sums.proxyMs = 0;
    sums.totalMs = 0;
    sums.fps = 0;
    snapshot = {
      latest: empty,
      average: empty,
      p95: empty,
      samples: 0,
      stageAverage: {},
      stageP95: {}
    } satisfies PerfSnapshot;
  };

  return {
    record,
    getSnapshot,
    reset
  };
};
