export interface GeometryParams {
  width: number; // CSS pixels
  height: number; // CSS pixels
  dpr: number;
  k1: number;
  k2: number;
  flipY?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const safeAspect = (width: number, height: number) => (height > 0 ? width / height : 1);

const distortNormalized = (px: number, py: number, k1: number, k2: number) => {
  const r2 = px * px + py * py;
  const r4 = r2 * r2;
  const factor = 1 + k1 * r2 + k2 * r4;
  return {
    x: px * factor,
    y: py * factor
  };
};

export const undistortNormalized = (px: number, py: number, k1: number, k2: number) => {
  let ux = px;
  let uy = py;
  for (let i = 0; i < 3; i += 1) {
    const r2 = ux * ux + uy * uy;
    const r4 = r2 * r2;
    const factor = Math.max(1 + k1 * r2 + k2 * r4, 1e-3);
    ux = px / factor;
    uy = py / factor;
  }
  return { x: ux, y: uy };
};

const maybeFlip = (value: number, flip: boolean | undefined) => (flip ? 1 - value : value);

export const mapDomToScreen = (x: number, y: number, params: GeometryParams) => {
  const { width, height, k1, k2, flipY } = params;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;

  if (safeWidth === 0 || safeHeight === 0) {
    return {
      x: clamp(x, 0, safeWidth),
      y: clamp(y, 0, safeHeight)
    };
  }

  const aspect = safeAspect(safeWidth, safeHeight);
  const uvX = clamp(x, 0, safeWidth) / safeWidth;
  const uvY = clamp(y, 0, safeHeight) / safeHeight;
  const flippedUvY = maybeFlip(uvY, flipY);
  const px = (uvX * 2 - 1) * aspect;
  const py = flippedUvY * 2 - 1;
  const distorted = distortNormalized(px, py, k1, k2);
  const undoesAspectX = distorted.x / aspect;
  const warpedUvX = clamp((undoesAspectX + 1) * 0.5, 0, 1);
  const warpedUvY = clamp((distorted.y + 1) * 0.5, 0, 1);
  const finalUvY = maybeFlip(warpedUvY, flipY);

  return {
    x: warpedUvX * safeWidth,
    y: finalUvY * safeHeight
  };
};

export const mapScreenToDom = (x: number, y: number, params: GeometryParams) => {
  const { width, height, k1, k2, flipY } = params;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;

  if (safeWidth === 0 || safeHeight === 0) {
    return {
      x: clamp(x, 0, safeWidth),
      y: clamp(y, 0, safeHeight)
    };
  }

  const aspect = safeAspect(safeWidth, safeHeight);
  const uvX = clamp(x, 0, safeWidth) / safeWidth;
  const uvY = clamp(y, 0, safeHeight) / safeHeight;
  const flippedUvY = maybeFlip(uvY, flipY);
  const px = (uvX * 2 - 1) * aspect;
  const py = flippedUvY * 2 - 1;
  const undistorted = undistortNormalized(px, py, k1, k2);
  const unscaledX = undistorted.x / aspect;
  const baseUvX = clamp((unscaledX + 1) * 0.5, 0, 1);
  const baseUvY = clamp((undistorted.y + 1) * 0.5, 0, 1);
  const finalUvY = maybeFlip(baseUvY, flipY);

  return {
    x: baseUvX * safeWidth,
    y: finalUvY * safeHeight
  };
};

export const warpScreenUvToDomCss = (uvX: number, uvY: number, params: GeometryParams) => {
  const { width, height } = params;
  const cssX = clamp(uvX, 0, 1) * width;
  const cssY = clamp(uvY, 0, 1) * height;
  return mapScreenToDom(cssX, cssY, params);
};

export const warpDomCssToScreenCss = (x: number, y: number, params: GeometryParams) =>
  mapDomToScreen(x, y, params);
