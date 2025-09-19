export type Mat3 = Float32Array;

export interface CoordSpaceSnapshot {
  cssWidth: number;
  cssHeight: number;
  textureWidth: number;
  textureHeight: number;
  dpr: number;
  cssToUv: Mat3;
  uvToCss: Mat3;
  cssToTexture: Mat3;
  textureToCss: Mat3;
}

export interface CoordSpaceController {
  update(params: {
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    textureWidth?: number;
    textureHeight?: number;
  }): CoordSpaceSnapshot;
  getSnapshot(): CoordSpaceSnapshot;
  applyCssToUv(x: number, y: number): { x: number; y: number };
  applyUvToCss(u: number, v: number): { x: number; y: number };
  applyCssToTexture(x: number, y: number): { x: number; y: number };
  applyTextureToCss(x: number, y: number): { x: number; y: number };
}

const createIdentity = (): Mat3 =>
  new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);

const writeScaleMatrix = (matrix: Mat3, scaleX: number, scaleY: number) => {
  matrix[0] = scaleX;
  matrix[1] = 0;
  matrix[2] = 0;
  matrix[3] = 0;
  matrix[4] = scaleY;
  matrix[5] = 0;
  matrix[6] = 0;
  matrix[7] = 0;
  matrix[8] = 1;
};

export const applyMat3 = (matrix: Mat3, x: number, y: number) => {
  const nx = matrix[0] * x + matrix[1] * y + matrix[2];
  const ny = matrix[3] * x + matrix[4] * y + matrix[5];
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  const invW = w !== 0 ? 1 / w : 1;
  return { x: nx * invW, y: ny * invW };
};

export const createCoordSpace = (initial?: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  textureWidth?: number;
  textureHeight?: number;
}): CoordSpaceController => {
  let cssWidth = Math.max(1, Math.floor(initial?.cssWidth ?? 1));
  let cssHeight = Math.max(1, Math.floor(initial?.cssHeight ?? 1));
  let dpr = initial?.dpr && initial.dpr > 0 ? initial.dpr : 1;
  let textureWidth = Math.max(1, Math.floor(initial?.textureWidth ?? cssWidth * dpr));
  let textureHeight = Math.max(1, Math.floor(initial?.textureHeight ?? cssHeight * dpr));

  const cssToUv = createIdentity();
  const uvToCss = createIdentity();
  const cssToTexture = createIdentity();
  const textureToCss = createIdentity();

  const snapshot: CoordSpaceSnapshot = {
    cssWidth,
    cssHeight,
    textureWidth,
    textureHeight,
    dpr,
    cssToUv,
    uvToCss,
    cssToTexture,
    textureToCss
  };

  const updateMatrices = () => {
    const invCssWidth = cssWidth > 0 ? 1 / cssWidth : 0;
    const invCssHeight = cssHeight > 0 ? 1 / cssHeight : 0;
    writeScaleMatrix(cssToUv, invCssWidth, invCssHeight);
    writeScaleMatrix(uvToCss, cssWidth, cssHeight);

    const scaleX = cssWidth > 0 ? textureWidth / cssWidth : 0;
    const scaleY = cssHeight > 0 ? textureHeight / cssHeight : 0;
    writeScaleMatrix(cssToTexture, scaleX, scaleY);

    const texToCssScaleX = textureWidth > 0 ? cssWidth / textureWidth : 0;
    const texToCssScaleY = textureHeight > 0 ? cssHeight / textureHeight : 0;
    writeScaleMatrix(textureToCss, texToCssScaleX, texToCssScaleY);
  };

  updateMatrices();

  const update = ({ cssWidth: nextCssWidth, cssHeight: nextCssHeight, dpr: nextDpr, textureWidth: nextTextureWidth, textureHeight: nextTextureHeight }: {
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    textureWidth?: number;
    textureHeight?: number;
  }) => {
    cssWidth = Math.max(1, Math.floor(nextCssWidth));
    cssHeight = Math.max(1, Math.floor(nextCssHeight));
    dpr = nextDpr > 0 ? nextDpr : 1;
    textureWidth = Math.max(1, Math.floor(nextTextureWidth ?? cssWidth * dpr));
    textureHeight = Math.max(1, Math.floor(nextTextureHeight ?? cssHeight * dpr));

    snapshot.cssWidth = cssWidth;
    snapshot.cssHeight = cssHeight;
    snapshot.dpr = dpr;
    snapshot.textureWidth = textureWidth;
    snapshot.textureHeight = textureHeight;

    updateMatrices();
    return snapshot;
  };

  const getSnapshot = () => snapshot;

  const applyCssToUv = (x: number, y: number) => applyMat3(cssToUv, x, y);
  const applyUvToCss = (u: number, v: number) => applyMat3(uvToCss, u, v);
  const applyCssToTexture = (x: number, y: number) => applyMat3(cssToTexture, x, y);
  const applyTextureToCss = (x: number, y: number) => applyMat3(textureToCss, x, y);

  return {
    update,
    getSnapshot,
    applyCssToUv,
    applyUvToCss,
    applyCssToTexture,
    applyTextureToCss
  } satisfies CoordSpaceController;
};
