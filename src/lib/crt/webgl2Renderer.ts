import PicoGL from 'picogl';
import vertSource from './shaders/crt.vert.glsl?raw';
import fragSource from './shaders/crt.frag.glsl?raw';
import type { CaptureFrame, CRTGpuRenderer } from './types';

type PicoUniformValue = number | readonly number[];

interface PicoTexture {
  bind(unit: number): PicoTexture;
  data(source: TexImageSource): void;
  delete(): void;
}

interface PicoDrawCall {
  primitive(mode: number): PicoDrawCall;
  texture(name: string, texture: PicoTexture): PicoDrawCall;
  uniform(name: string, value: PicoUniformValue): PicoDrawCall;
  draw(): void;
  delete(): void;
}

interface PicoTextureOptions {
  data: TexImageSource | ArrayBufferView | null;
  minFilter: number;
  magFilter: number;
  wrapS: number;
  wrapT: number;
}

interface PicoApp {
  clearColor(r: number, g: number, b: number, a: number): PicoApp;
  createProgram(vertexSource: string, fragmentSource: string): unknown;
  createVertexArray(): unknown;
  createTexture2D(width: number, height: number, options: PicoTextureOptions): PicoTexture;
  createDrawCall(program: unknown, vertexArray: unknown): PicoDrawCall;
  viewport(x: number, y: number, width: number, height: number): PicoApp;
  clear(): void;
  gl: WebGL2RenderingContext;
  TRIANGLES: number;
}

export class WebGl2Renderer implements CRTGpuRenderer {
  readonly mode = 'webgl2' as const;

  private app: PicoApp | null = null;
  private drawCall: PicoDrawCall | null = null;
  private texture: PicoTexture | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private width = 0;
  private height = 0;

  async init(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: true
    });

    if (!context) {
      throw new Error('Unable to create WebGL2 context');
    }

    this.canvas = canvas;
    const app = PicoGL.createApp(canvas, { context }) as PicoApp;
    this.app = app.clearColor(0, 0, 0, 1);

    const program = this.app.createProgram(vertSource, fragSource);
    const vertexArray = this.app.createVertexArray();
    this.texture = this.app
      .createTexture2D(1, 1, {
        data: null,
        minFilter: PicoGL.LINEAR,
        magFilter: PicoGL.LINEAR,
        wrapS: PicoGL.CLAMP_TO_EDGE,
        wrapT: PicoGL.CLAMP_TO_EDGE
      })
      .bind(0);

    this.drawCall = this.app
      .createDrawCall(program, vertexArray)
      .primitive(this.app.TRIANGLES)
      .texture('uScene', this.texture)
      .uniform('uResolution', [1, 1])
      .uniform('uInvResolution', [1, 1])
      .uniform('uTime', 0)
      .uniform('uScanlineIntensity', 0)
      .uniform('uSlotMaskIntensity', 0)
      .uniform('uVignetteStrength', 0)
      .uniform('uBloomIntensity', 0)
      .uniform('uAberrationStrength', 0)
      .uniform('uNoiseIntensity', 0)
      .uniform('uDevicePixelRatio', 1)
      .uniform('uBloomThreshold', 0.7)
      .uniform('uBloomSoftness', 0.6);
  }

  async updateTexture(frame: CaptureFrame) {
    if (!this.app || !this.texture) {
      frame.bitmap.close();
      return;
    }

    const needsResize = this.width !== frame.width || this.height !== frame.height;
    if (needsResize) {
      this.texture = this.app
        .createTexture2D(frame.width, frame.height, {
          data: null,
          minFilter: PicoGL.LINEAR,
          magFilter: PicoGL.LINEAR,
          wrapS: PicoGL.CLAMP_TO_EDGE,
          wrapT: PicoGL.CLAMP_TO_EDGE
        })
        .bind(0);
      this.drawCall?.texture('uScene', this.texture);
      this.width = frame.width;
      this.height = frame.height;
    }

    this.texture.data(frame.bitmap);
    frame.bitmap.close();
  }

  render(uniforms: Float32Array) {
    if (!this.app || !this.drawCall || !this.canvas) {
      return;
    }

    const width = uniforms[0];
    const height = uniforms[1];

    this.app.viewport(0, 0, width, height);
    this.drawCall
      .uniform('uResolution', [uniforms[0], uniforms[1]])
      .uniform('uInvResolution', [uniforms[2], uniforms[3]])
      .uniform('uTime', uniforms[4])
      .uniform('uScanlineIntensity', uniforms[5])
      .uniform('uSlotMaskIntensity', uniforms[6])
      .uniform('uVignetteStrength', uniforms[7])
      .uniform('uBloomIntensity', uniforms[8])
      .uniform('uAberrationStrength', uniforms[9])
      .uniform('uNoiseIntensity', uniforms[10])
      .uniform('uDevicePixelRatio', uniforms[11])
      .uniform('uBloomThreshold', uniforms[12])
      .uniform('uBloomSoftness', uniforms[13]);

    this.app.clear();
    this.drawCall.draw();
  }

  resize(width: number, height: number) {
    if (!this.canvas) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
  }

  destroy() {
    if (this.texture) {
      this.texture.delete();
      this.texture = null;
    }
    if (this.drawCall) {
      this.drawCall.delete();
      this.drawCall = null;
    }
    if (this.app) {
      this.app.gl.getExtension('WEBGL_lose_context')?.loseContext();
      this.app = null;
    }
    this.canvas = null;
  }
}

export const createWebGl2Renderer = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGl2Renderer();
  await renderer.init(canvas);
  return renderer;
};

