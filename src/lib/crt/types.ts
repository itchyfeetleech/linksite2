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

export interface CRTGpuRenderer {
  readonly mode: Exclude<CRTRenderMode, 'css'>;
  init(canvas: HTMLCanvasElement): Promise<void>;
  render(uniforms: Float32Array): void;
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

