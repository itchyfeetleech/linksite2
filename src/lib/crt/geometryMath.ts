export interface GeometryParams {
  width: number; // CSS pixels
  height: number; // CSS pixels
  dpr: number;
  k1: number;
  k2: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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

export const mapDomToScreen = (x: number, y: number, params: GeometryParams) => {
  const { width, height, k1, k2 } = params;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;

  if (safeWidth === 0 || safeHeight === 0) {
    return {
      x: clamp(x, 0, safeWidth),
      y: clamp(y, 0, safeHeight)
    };
  }

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

export const mapScreenToDom = (x: number, y: number, params: GeometryParams) => {
  const { width, height, k1, k2 } = params;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;

  if (safeWidth === 0 || safeHeight === 0) {
    return {
      x: clamp(x, 0, safeWidth),
      y: clamp(y, 0, safeHeight)
    };
  }

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

export const warpScreenUvToDomCss = (uvX: number, uvY: number, params: GeometryParams) => {
  const { width, height } = params;
  const x = clamp(uvX, 0, 1) * width;
  const y = clamp(uvY, 0, 1) * height;
  return mapScreenToDom(x, y, params);
};

export const warpDomCssToScreenCss = (x: number, y: number, params: GeometryParams) =>
  mapDomToScreen(x, y, params);
