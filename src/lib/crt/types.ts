export type CRTRenderMode = 'webgpu' | 'webgl2' | 'css';

export interface UniformState {
  width: number;
  height: number;
  time: number;
  scanlines: number;
  slotMask: number;
  vignette: number;
  bloom: number;
  aberration: number;
  noise: number;
  dpr: number;
  bloomThreshold: number;
  bloomSoftness: number;
}

export interface CaptureFrame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  dpr: number;
}

export const UNIFORM_FLOAT_COUNT = 28;

export const UNIFORM_OFFSETS = {
  resolution: 0,
  invResolution: 2,
  time: 4,
  scanline: 5,
  slotMask: 6,
  vignette: 7,
  baseBloom: 8,
  aberration: 9,
  noise: 10,
  devicePixelRatio: 11,
  bloomThreshold: 12,
  bloomSoftness: 13,
  k1: 14,
  k2: 15,
  cssSize: 16,
  invCssSize: 18,
  cursorState: 20,
  cursorMeta: 24,
} as const;

export type UniformOffsets = typeof UNIFORM_OFFSETS;

export interface CRTGpuRenderer {
  readonly mode: Exclude<CRTRenderMode, 'css'>;
  init(canvas: HTMLCanvasElement): Promise<void>;
  render(uniforms: Float32Array): RendererTimings;
  resize(width: number, height: number, cssWidth: number, cssHeight: number): void;
  updateTexture(frame: CaptureFrame): Promise<void>;
  updateGeometry(params: {
    width: number;
    height: number;
    dpr: number;
    k1: number;
    k2: number;
  }): Promise<void>;
  destroy(): void;
}

export interface RendererTimings {
  gpuSubmitMs: number;
  gpuFrameMs: number;
  timestampAccurate: boolean;
  stages?: Record<string, number>;
}

