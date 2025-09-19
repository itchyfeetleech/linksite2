import vertSource from './shaders/crt.vert.glsl?raw';
import fragSource from './shaders/crt.frag.glsl?raw';
import type { CaptureFrame, CRTGpuRenderer } from './types';

interface TextureSize {
  width: number;
  height: number;
}

export class WebGl2Renderer implements CRTGpuRenderer {
  readonly mode = 'webgl2' as const;

  private picoGL: any = null;
  private app: any = null;
  private drawCall: any = null;
  private sceneTexture: any = null;
  private sceneSize: TextureSize | null = null;
  private canvas: HTMLCanvasElement | null = null;

  async init(canvas: HTMLCanvasElement) {
    if (!this.picoGL) {
      const module = await import('picogl');
      this.picoGL = (module as { default?: unknown }).default ?? module;
    }

    const PicoGL = this.picoGL;
    if (!PicoGL) {
      throw new Error('Unable to load PicoGL');
    }

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
    const app = PicoGL.createApp(canvas, { context });
    this.app = app.clearColor(0, 0, 0, 1);

    const program = this.app.createProgram(vertSource, fragSource);
    const vertexArray = this.app.createVertexArray();

    this.sceneTexture = this.app
      .createTexture2D(1, 1, {
        data: null,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
        wrapS: PicoGL.CLAMP_TO_EDGE,
        wrapT: PicoGL.CLAMP_TO_EDGE
      })
      .bind(0);

    this.drawCall = this.app
      .createDrawCall(program, vertexArray)
      .primitive(this.app.TRIANGLES)
      .texture('uScene', this.sceneTexture)
      .uniform('uResolution', [1, 1, 1, 1])
      .uniform('uTiming', [0, 0, 0, 0])
      .uniform('uEffects', [0, 0, 0, 1])
      .uniform('uBloomParams', [0.7, 0.6, 0, 0])
      .uniform('uCssMetrics', [1, 1, 1, 1])
      .uniform('uCursorState', [0, 0, 0, 0])
      .uniform('uCursorMeta', [0, 1, 0, 0]);
  }

  private ensureSceneTexture(width: number, height: number) {
    if (!this.app || !this.picoGL) {
      return;
    }

    if (this.sceneSize && this.sceneSize.width === width && this.sceneSize.height === height) {
      return;
    }

    this.sceneTexture?.delete();
    this.sceneTexture = this.app
      .createTexture2D(width, height, {
        data: null,
        minFilter: this.picoGL.NEAREST,
        magFilter: this.picoGL.NEAREST,
        wrapS: this.picoGL.CLAMP_TO_EDGE,
        wrapT: this.picoGL.CLAMP_TO_EDGE
      })
      .bind(0);
    this.drawCall?.texture('uScene', this.sceneTexture);
    this.sceneSize = { width, height };
  }

  async updateTexture(frame: CaptureFrame) {
    if (!this.app) {
      frame.bitmap.close();
      return;
    }

    this.ensureSceneTexture(frame.width, frame.height);

    if (!this.sceneTexture) {
      frame.bitmap.close();
      return;
    }

    const source = frame.bitmap as ImageBitmap;
    const gl = this.app.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.sceneTexture.data(source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    frame.bitmap.close();
  }

  async updateGeometry(_params: { width: number; height: number; dpr: number; k1: number; k2: number }) {}

  render(uniforms: Float32Array) {
    if (!this.app || !this.drawCall) {
      return;
    }

    const width = Math.max(1, Math.floor(uniforms[0]));
    const height = Math.max(1, Math.floor(uniforms[1]));

    this.app.viewport(0, 0, width, height);
    this.drawCall
      .uniform('uResolution', uniforms.subarray(0, 4))
      .uniform('uTiming', uniforms.subarray(4, 8))
      .uniform('uEffects', uniforms.subarray(8, 12))
      .uniform('uBloomParams', uniforms.subarray(12, 16))
      .uniform('uCssMetrics', uniforms.subarray(16, 20))
      .uniform('uCursorState', uniforms.subarray(20, 24))
      .uniform('uCursorMeta', uniforms.subarray(24, 28));

    this.app.clear();
    this.drawCall.draw();
  }

  resize(width: number, height: number, cssWidth: number, cssHeight: number) {
    if (!this.canvas) {
      return;
    }

    if (this.canvas.width !== width) {
      this.canvas.width = width;
    }
    if (this.canvas.height !== height) {
      this.canvas.height = height;
    }
    if (Number.isFinite(cssWidth) && cssWidth > 0) {
      this.canvas.style.width = `${cssWidth}px`;
    }
    if (Number.isFinite(cssHeight) && cssHeight > 0) {
      this.canvas.style.height = `${cssHeight}px`;
    }
  }

  destroy() {
    this.sceneTexture?.delete();
    this.drawCall?.delete();
    if (this.app) {
      this.app.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.sceneTexture = null;
    this.drawCall = null;
    this.app = null;
    this.sceneSize = null;
    this.canvas = null;
  }
}

export const createWebGl2Renderer = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGl2Renderer();
  await renderer.init(canvas);
  return renderer;
};
