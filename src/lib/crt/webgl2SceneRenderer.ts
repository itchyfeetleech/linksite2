import { logger } from '../logger';
import type { SceneUpdate } from './sceneTypes';

export interface WebGl2SceneTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export class WebGl2SceneRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private program: WebGLProgram | null = null;
  private width = 1;
  private height = 1;

  init(canvas?: HTMLCanvasElement) {
    if (this.gl) {
      return;
    }
    let context: WebGL2RenderingContext | null = null;
    if (canvas) {
      context = canvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true
      });
    }
    if (!context) {
      const offscreen = document.createElement('canvas');
      context = offscreen.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true
      });
    }
    if (!context) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = context;
    this.setupResources();
  }

  private setupResources() {
    if (!this.gl) {
      return;
    }
    const gl = this.gl;

    const vertexShaderSource = `#version 300 es\nin vec2 aPosition;\nout vec2 vUv;\nvoid main() {\n  vUv = aPosition * vec2(0.5, -0.5) + vec2(0.5, 0.5);\n  gl_Position = vec4(aPosition, 0.0, 1.0);\n}`;

    const fragmentShaderSource = `#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nvoid main() {\n  vec2 grid = vec2(vUv.x * 20.0, vUv.y * 12.0);\n  vec2 cell = abs(fract(grid - 0.5) - 0.5) / fwidth(grid);
  float line = step(0.0, 1.0 - min(cell.x, cell.y));\n  vec3 baseColor = vec3(0.08, 0.18, 0.12);\n  vec3 lineColor = vec3(0.35, 0.85, 0.65);\n  float vignette = pow(1.0 - distance(vUv, vec2(0.5)), 1.5);\n  vec3 color = mix(baseColor, lineColor, line * 0.65) * vignette;\n  fragColor = vec4(color, 1.0);\n}`;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    if (!program) {
      throw new Error('Unable to create shader program');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`WebGL program failed to link: ${info ?? 'unknown error'}`);
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    this.program = program;
    this.vertexBuffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    if (!this.vertexBuffer || !this.vao) {
      throw new Error('Failed to create vertex resources');
    }

    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const location = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.createTarget(1, 1);
  }

  resize(width: number, height: number) {
    if (!this.gl) {
      throw new Error('Renderer not initialised');
    }
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    if (safeWidth === this.width && safeHeight === this.height) {
      return;
    }
    this.createTarget(safeWidth, safeHeight);
  }

  private createTarget(width: number, height: number) {
    if (!this.gl) {
      return;
    }
    const gl = this.gl;
    this.width = width;
    this.height = height;

    this.texture && gl.deleteTexture(this.texture);
    this.framebuffer && gl.deleteFramebuffer(this.framebuffer);

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      throw new Error('Failed to create render target');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete: ${status.toString(16)}`);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.texture = texture;
    this.framebuffer = framebuffer;
  }

  getRenderTarget(): WebGl2SceneTarget | null {
    if (!this.texture || !this.framebuffer) {
      return null;
    }
    return {
      texture: this.texture,
      framebuffer: this.framebuffer,
      width: this.width,
      height: this.height
    };
  }

  render(update: SceneUpdate | null) {
    if (!this.gl || !this.program || !this.vertexBuffer || !this.vao || !this.texture || !this.framebuffer) {
      throw new Error('Renderer not initialised');
    }
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (update && update.uploads.length) {
      for (const task of update.uploads) {
        task().catch((error) => logger.warn('WebGL scene renderer upload failed', error));
      }
    }
  }

  destroy() {
    if (!this.gl) {
      return;
    }
    const gl = this.gl;
    if (this.texture) {
      gl.deleteTexture(this.texture);
    }
    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
    }
    if (this.vertexBuffer) {
      gl.deleteBuffer(this.vertexBuffer);
    }
    if (this.vao) {
      gl.deleteVertexArray(this.vao);
    }
    if (this.program) {
      gl.deleteProgram(this.program);
    }
    this.texture = null;
    this.framebuffer = null;
    this.vertexBuffer = null;
    this.vao = null;
    this.program = null;
    this.width = 1;
    this.height = 1;
  }
}

export const createWebGl2SceneRenderer = () => {
  const renderer = new WebGl2SceneRenderer();
  renderer.init();
  return renderer;
};
