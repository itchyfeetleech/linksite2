import vertSource from './shaders/crt.vert.glsl?raw';
import fragSource from './shaders/crt.frag.glsl?raw';
import { encodeFloat32To16 } from './float16';
import type { CaptureFrame, CRTGpuRenderer } from './types';

import type PicoGLModule from 'picogl';
import type { App as PicoApp, DrawCall as PicoDrawCall, Texture as PicoTexture } from 'picogl';

type TextureSource = Parameters<PicoTexture['data']>[0];

interface TextureSize {
  width: number;
  height: number;
}

export class WebGl2Renderer implements CRTGpuRenderer {
  readonly mode = 'webgl2' as const;

  private picoGL: PicoGLModule | null = null;
  private app: PicoApp | null = null;
  private drawCall: PicoDrawCall | null = null;
  private sceneTexture: PicoTexture | null = null;
  private forwardLutTexture: PicoTexture | null = null;
  private sceneSize: TextureSize | null = null;
  private lutSize: TextureSize | null = null;
  private canvas: HTMLCanvasElement | null = null;

  async init(canvas: HTMLCanvasElement) {
    if (!this.picoGL) {
      const module = await import('picogl');
      this.picoGL = (module as { default?: PicoGLModule }).default ?? (module as PicoGLModule);
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
    const app = PicoGL.createApp(canvas, { context }) as PicoApp;
    this.app = app.clearColor(0, 0, 0, 1);

    const program = this.app.createProgram(vertSource, fragSource);
    const vertexArray = this.app.createVertexArray();

    this.sceneTexture = this.app
      .createTexture2D(1, 1, {
        data: null,
        minFilter: PicoGL.LINEAR,
        magFilter: PicoGL.LINEAR,
        wrapS: PicoGL.CLAMP_TO_EDGE,
        wrapT: PicoGL.CLAMP_TO_EDGE
      })
      .bind(0);

    this.forwardLutTexture = this.app
      .createTexture2D(1, 1, {
        data: null,
        internalFormat: context.RG16F,
        type: PicoGL.HALF_FLOAT,
        minFilter: PicoGL.LINEAR,
        magFilter: PicoGL.LINEAR,
        wrapS: PicoGL.CLAMP_TO_EDGE,
        wrapT: PicoGL.CLAMP_TO_EDGE
      })
      .bind(1);

    this.forwardLutTexture.data(new Uint16Array([0, 0]));

    this.drawCall = this.app
      .createDrawCall(program, vertexArray)
      .primitive(this.app.TRIANGLES)
      .texture('uScene', this.sceneTexture)
      .texture('uForwardLut', this.forwardLutTexture)
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
        minFilter: this.picoGL.LINEAR,
        magFilter: this.picoGL.LINEAR,
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

    const source = frame.bitmap as unknown as TextureSource;
    const gl = this.app.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.sceneTexture.data(source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    frame.bitmap.close();
  }

  async updateGeometry(
    _params: { width: number; height: number; dpr: number; k1: number; k2: number },
    lutData?: { forward: Float32Array; inverse: Float32Array; width: number; height: number }
  ) {
    if (!this.app || !this.picoGL) {
      return;
    }

    if (!lutData) {
      return;
    }

    const { width, height, forward } = lutData;
    const PicoGL = this.picoGL;
    const gl = this.app.gl;

    const needsResize = !this.lutSize || this.lutSize.width !== width || this.lutSize.height !== height;
    if (needsResize) {
      this.forwardLutTexture?.delete();
      this.forwardLutTexture = this.app
        .createTexture2D(width, height, {
          data: null,
          internalFormat: gl.RG16F,
          type: PicoGL.HALF_FLOAT,
          minFilter: PicoGL.LINEAR,
          magFilter: PicoGL.LINEAR,
          wrapS: PicoGL.CLAMP_TO_EDGE,
          wrapT: PicoGL.CLAMP_TO_EDGE
        })
        .bind(1);
      this.drawCall?.texture('uForwardLut', this.forwardLutTexture);
      this.lutSize = { width, height };
    }

    if (!this.forwardLutTexture) {
      return;
    }

    const encoded = encodeFloat32To16(forward);
    this.forwardLutTexture.data(encoded);
  }

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
    this.forwardLutTexture?.delete();
    this.drawCall?.delete();
    if (this.app) {
      this.app.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.sceneTexture = null;
    this.forwardLutTexture = null;
    this.drawCall = null;
    this.app = null;
    this.sceneSize = null;
    this.lutSize = null;
    this.canvas = null;
  }
}

export const createWebGl2Renderer = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGl2Renderer();
  await renderer.init(canvas);
  return renderer;
};
