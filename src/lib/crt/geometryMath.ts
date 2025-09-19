export interface GeometryParams {
  width: number; // CSS pixels
  height: number; // CSS pixels
  dpr: number;
  k1: number;
  k2: number;
}

export interface LutResult {
  forward: Float32Array;
  inverse: Float32Array;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const clamp01 = (value: number) => clamp(value, 0, 1);

const solveRadius = (distorted: number, k1: number, k2: number) => {
  if (distorted === 0) {
    return 0;
  }

  let radius = distorted;
  for (let i = 0; i < 8; i += 1) {
    const r2 = radius * radius;
    const r4 = r2 * r2;
    const factor = 1 + k1 * r2 + k2 * r4;
    const value = radius * factor - distorted;
    const derivative = factor + radius * (2 * k1 * radius + 4 * k2 * r2 * radius);
    if (Math.abs(derivative) < 1e-6) {
      break;
    }
    radius -= value / derivative;
  }
  return radius;
};

const normalize = (coord: number, size: number) => (coord / size) * 2 - 1;

const denormalize = (value: number, size: number) => ((value + 1) * 0.5) * size;

const mapDomToScreen = (x: number, y: number, params: GeometryParams) => {
  const { width, height, k1, k2 } = params;
  const aspect = width / height;

  const normX = normalize(x, width);
  const normY = normalize(y, height);
  let px = normX * aspect;
  let py = normY;
  const r2 = px * px + py * py;
  const r4 = r2 * r2;
  const factor = 1 + k1 * r2 + k2 * r4;
  px *= factor;
  py *= factor;

  const distortedX = px / aspect;
  const distortedY = py;

  return {
    x: clamp(denormalize(distortedX, width), 0, width),
    y: clamp(denormalize(distortedY, height), 0, height)
  };
};

const mapScreenToDom = (x: number, y: number, params: GeometryParams) => {
  const { width, height, k1, k2 } = params;
  const aspect = width / height;

  const normX = normalize(x, width);
  const normY = normalize(y, height);
  let px = normX * aspect;
  let py = normY;
  const radiusPrime = Math.sqrt(px * px + py * py);

  if (radiusPrime === 0) {
    return { x: width * 0.5, y: height * 0.5 };
  }

  const radius = solveRadius(radiusPrime, k1, k2);
  const scale = radius / radiusPrime;
  px *= scale;
  py *= scale;

  const undistortedX = px / aspect;
  const undistortedY = py;

  return {
    x: clamp(denormalize(undistortedX, width), 0, width),
    y: clamp(denormalize(undistortedY, height), 0, height)
  };
};

export const generateLuts = (params: GeometryParams): LutResult => {
  const width = Math.max(1, Math.round(params.width));
  const height = Math.max(1, Math.round(params.height));
  const forward = new Float32Array(width * height * 2);
  const inverse = new Float32Array(width * height * 2);

  let index = 0;
  for (let y = 0; y < height; y += 1) {
    const sampleY = y + 0.5;
    for (let x = 0; x < width; x += 1) {
      const sampleX = x + 0.5;
      const forwardPoint = mapDomToScreen(sampleX, sampleY, params);
      const inversePoint = mapScreenToDom(sampleX, sampleY, params);

      forward[index] = forwardPoint.x;
      forward[index + 1] = forwardPoint.y;
      inverse[index] = inversePoint.x;
      inverse[index + 1] = inversePoint.y;
      index += 2;
    }
  }

  return { forward, inverse, width, height };
};

export const sampleLut = (
  data: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number
) => {
  if (width <= 0 || height <= 0) {
    return { x: u, y: v };
  }

  const maxX = Math.max(0, width - 1);
  const maxY = Math.max(0, height - 1);
  const scaledX = clamp01(u) * maxX;
  const scaledY = clamp01(v) * maxY;
  const x0 = Math.floor(scaledX);
  const x1 = Math.min(width - 1, x0 + 1);
  const y0 = Math.floor(scaledY);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = scaledX - x0;
  const ty = scaledY - y0;

  const sample = (sx: number, sy: number) => {
    const idx = (sy * width + sx) * 2;
    return { x: data[idx], y: data[idx + 1] };
  };

  const s00 = sample(x0, y0);
  const s10 = sample(x1, y0);
  const s01 = sample(x0, y1);
  const s11 = sample(x1, y1);

  const ix0 = {
    x: s00.x + (s10.x - s00.x) * tx,
    y: s00.y + (s10.y - s00.y) * tx
  };
  const ix1 = {
    x: s01.x + (s11.x - s01.x) * tx,
    y: s01.y + (s11.y - s01.y) * tx
  };

  return {
    x: ix0.x + (ix1.x - ix0.x) * ty,
    y: ix0.y + (ix1.y - ix0.y) * ty
  };
};

export const geometryDefaults = {
  forward: mapDomToScreen,
  inverse: mapScreenToDom
};
