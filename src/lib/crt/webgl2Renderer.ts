import vertSource from './shaders/crt.vert.glsl?raw';
import fragSource from './shaders/crt.frag.glsl?raw';
import type { CaptureFrame, CRTGpuRenderer, RendererTimings } from './types';
import { UNIFORM_OFFSETS } from './types';
import { logger } from '../logger';

const {
  resolution: RESOLUTION_OFFSET,
  invResolution: INV_RESOLUTION_OFFSET,
  time: TIME_OFFSET,
  scanline: SCANLINE_OFFSET,
  slotMask: SLOT_MASK_OFFSET,
  vignette: VIGNETTE_OFFSET,
  baseBloom: BASE_BLOOM_OFFSET,
  aberration: ABERRATION_OFFSET,
  noise: NOISE_OFFSET,
  devicePixelRatio: DPR_OFFSET,
  bloomThreshold: BLOOM_THRESHOLD_OFFSET,
  bloomSoftness: BLOOM_SOFTNESS_OFFSET,
  k1: K1_OFFSET,
  k2: K2_OFFSET,
  cssSize: CSS_SIZE_OFFSET,
  invCssSize: INV_CSS_OFFSET,
  cursorState: CURSOR_STATE_OFFSET,
  cursorMeta: CURSOR_META_OFFSET,
} = UNIFORM_OFFSETS;

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
  private timerQueryExt: EXT_disjoint_timer_query_webgl2 | EXT_disjoint_timer_query | null = null;
  private pendingTimerQueries: WebGLQuery[] = [];
  private hasTimerResult = false;
  private lastGpuFrameMs = 0;
  private currentTimerQuery: WebGLQuery | null = null;

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

    this.timerQueryExt =
      context.getExtension('EXT_disjoint_timer_query_webgl2') ??
      context.getExtension('EXT_disjoint_timer_query');
    if (!this.timerQueryExt) {
      logger.info('CRT WebGL2 timer query extension unavailable; using CPU timings');
    }

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
      .uniform('uResolution', [1, 1])
      .uniform('uInvResolution', [1, 1])
      .uniform('uTime', 0)
      .uniform('uScanlineIntensity', 0)
      .uniform('uSlotMaskIntensity', 0)
      .uniform('uVignetteStrength', 0)
      .uniform('uBaseBloomIntensity', 0)
      .uniform('uAberrationStrength', 0)
      .uniform('uNoiseIntensity', 0)
      .uniform('uDevicePixelRatio', 1)
      .uniform('uBloomThreshold', 0.7)
      .uniform('uBloomSoftness', 0.6)
      .uniform('uK1', 0)
      .uniform('uK2', 0)
      .uniform('uCssSize', [1, 1])
      .uniform('uInvCssSize', [1, 1])
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

  private pollTimerQueries() {
    if (!this.timerQueryExt || !this.app) {
      return;
    }

    const gl = this.app.gl as WebGL2RenderingContext;
    const ext = this.timerQueryExt;

    while (this.pendingTimerQueries.length > 0) {
      const query = this.pendingTimerQueries[0];
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;

      if (!available) {
        break;
      }

      this.pendingTimerQueries.shift();

      if (disjoint) {
        gl.deleteQuery(query);
        continue;
      }

      const elapsedNs = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      if (Number.isFinite(elapsedNs) && elapsedNs >= 0) {
        this.lastGpuFrameMs = elapsedNs / 1_000_000;
        this.hasTimerResult = true;
      }
      gl.deleteQuery(query);
    }
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

  render(uniforms: Float32Array): RendererTimings {
    if (!this.app || !this.drawCall) {
      return {
        gpuSubmitMs: 0,
        gpuFrameMs: this.hasTimerResult ? this.lastGpuFrameMs : 0,
        timestampAccurate: this.hasTimerResult
      };
    }

    const cpuStart = performance.now();
    const width = Math.max(1, Math.floor(uniforms[RESOLUTION_OFFSET]));
    const height = Math.max(1, Math.floor(uniforms[RESOLUTION_OFFSET + 1]));

    this.app.viewport(0, 0, width, height);
    this.drawCall
      .uniform('uResolution', uniforms.subarray(RESOLUTION_OFFSET, RESOLUTION_OFFSET + 2))
      .uniform('uInvResolution', uniforms.subarray(INV_RESOLUTION_OFFSET, INV_RESOLUTION_OFFSET + 2))
      .uniform('uTime', uniforms[TIME_OFFSET])
      .uniform('uScanlineIntensity', uniforms[SCANLINE_OFFSET])
      .uniform('uSlotMaskIntensity', uniforms[SLOT_MASK_OFFSET])
      .uniform('uVignetteStrength', uniforms[VIGNETTE_OFFSET])
      .uniform('uBaseBloomIntensity', uniforms[BASE_BLOOM_OFFSET])
      .uniform('uAberrationStrength', uniforms[ABERRATION_OFFSET])
      .uniform('uNoiseIntensity', uniforms[NOISE_OFFSET])
      .uniform('uDevicePixelRatio', uniforms[DPR_OFFSET])
      .uniform('uBloomThreshold', uniforms[BLOOM_THRESHOLD_OFFSET])
      .uniform('uBloomSoftness', uniforms[BLOOM_SOFTNESS_OFFSET])
      .uniform('uK1', uniforms[K1_OFFSET])
      .uniform('uK2', uniforms[K2_OFFSET])
      .uniform('uCssSize', uniforms.subarray(CSS_SIZE_OFFSET, CSS_SIZE_OFFSET + 2))
      .uniform('uInvCssSize', uniforms.subarray(INV_CSS_OFFSET, INV_CSS_OFFSET + 2))
      .uniform('uCursorState', uniforms.subarray(CURSOR_STATE_OFFSET, CURSOR_STATE_OFFSET + 4))
      .uniform('uCursorMeta', uniforms.subarray(CURSOR_META_OFFSET, CURSOR_META_OFFSET + 4));

    if (this.timerQueryExt && !this.currentTimerQuery) {
      const gl = this.app.gl as WebGL2RenderingContext;
      this.currentTimerQuery = gl.createQuery();
      if (this.currentTimerQuery) {
        gl.beginQuery(this.timerQueryExt.TIME_ELAPSED_EXT, this.currentTimerQuery);
      }
    }

    this.app.clear();
    this.drawCall.draw();

    if (this.timerQueryExt && this.currentTimerQuery) {
      const gl = this.app.gl as WebGL2RenderingContext;
      gl.endQuery(this.timerQueryExt.TIME_ELAPSED_EXT);
      this.pendingTimerQueries.push(this.currentTimerQuery);
      this.currentTimerQuery = null;
    }

    const gpuSubmitMs = performance.now() - cpuStart;
    this.pollTimerQueries();

    const gpuFrameMs = this.hasTimerResult ? this.lastGpuFrameMs : gpuSubmitMs;

    return {
      gpuSubmitMs,
      gpuFrameMs,
      timestampAccurate: this.hasTimerResult
    };
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
    if (this.timerQueryExt && this.app) {
      const gl = this.app.gl as WebGL2RenderingContext;
      for (const query of this.pendingTimerQueries) {
        gl.deleteQuery(query);
      }
      if (this.currentTimerQuery) {
        gl.deleteQuery(this.currentTimerQuery);
      }
    }
    this.pendingTimerQueries = [];
    this.currentTimerQuery = null;
    this.timerQueryExt = null;
    this.hasTimerResult = false;
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
