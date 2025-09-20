import { logger } from '../logger';
import type { SceneTextureTarget, SceneUpdate } from './sceneTypes';

const GRID_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position : vec4<f32>;
  @location(0) uv : vec2<f32>;
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );
  var output : VertexOutput;
  let pos = positions[vertexIndex];
  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.uv = pos * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return output;
}

@fragment
fn fs_grid(input : VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let grid = vec2<f32>(uv.x * 20.0, uv.y * 12.0);
  let cell = abs(fract(grid - 0.5) - 0.5) / fwidth(grid);
  let line = step(0.0, 1.0 - min(cell.x, cell.y));
  let baseColor = vec3<f32>(0.08, 0.18, 0.12);
  let lineColor = vec3<f32>(0.35, 0.85, 0.65);
  let vignette = pow(1.0 - distance(uv, vec2<f32>(0.5, 0.5)), 1.5);
  let color = mix(baseColor, lineColor, line * 0.65) * vignette;
  return vec4<f32>(color, 1.0);
`;

export class WebGpuSceneRenderer {
  private device: GPUDevice | null = null;
  private queue: GPUQueue | null = null;
  private texture: GPUTexture | null = null;
  private textureView: GPUTextureView | null = null;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private format: GPUTextureFormat = 'rgba16float';
  private targetWidth = 1;
  private targetHeight = 1;
  private readonly contextDescription = 'crt-scene-renderer';

  async init(textureFormat?: GPUTextureFormat) {
    if (this.device) {
      return;
    }
    if (!('gpu' in navigator) || !navigator.gpu) {
      throw new Error('WebGPU not supported');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU adapter unavailable');
    }
    this.device = await adapter.requestDevice();
    this.queue = this.device.queue;
    if (textureFormat) {
      this.format = textureFormat;
    }
    this.createPipeline();
  }

  private createPipeline() {
    if (!this.device) {
      return;
    }
    const module = this.device.createShaderModule({
      label: `${this.contextDescription}-grid-shader`,
      code: GRID_SHADER
    });
    this.pipeline = this.device.createRenderPipeline({
      label: `${this.contextDescription}-pipeline`,
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_fullscreen'
      },
      fragment: {
        module,
        entryPoint: 'fs_grid',
        targets: [
          {
            format: this.format
          }
        ]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
  }

  resize(width: number, height: number) {
    if (!this.device) {
      throw new Error('Renderer not initialised');
    }
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    if (safeWidth === this.targetWidth && safeHeight === this.targetHeight) {
      return;
    }
    this.allocateTargets(safeWidth, safeHeight);
  }

  private allocateTargets(width: number, height: number) {
    if (!this.device) {
      return;
    }
    this.texture?.destroy();
    this.depthTexture?.destroy();

    this.targetWidth = width;
    this.targetHeight = height;

    this.texture = this.device.createTexture({
      label: `${this.contextDescription}-color`,
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.textureView = this.texture.createView({ label: `${this.contextDescription}-color-view` });

    this.depthTexture = this.device.createTexture({
      label: `${this.contextDescription}-depth`,
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthView = this.depthTexture.createView({ label: `${this.contextDescription}-depth-view` });
  }

  getRenderTarget(): SceneTextureTarget | null {
    if (!this.texture || !this.textureView) {
      return null;
    }
    return {
      kind: 'webgpu',
      texture: this.texture,
      view: this.textureView,
      width: this.targetWidth,
      height: this.targetHeight,
      format: this.format
    };
  }

  async render(update: SceneUpdate | null) {
    if (!this.device || !this.queue || !this.pipeline) {
      throw new Error('Renderer not initialised');
    }
    if (!this.texture || !this.textureView || !this.depthView) {
      logger.warn('Scene renderer missing target texture; call resize before render');
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: `${this.contextDescription}-encoder` });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.textureView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }
      ],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard'
      }
    });
    pass.setPipeline(this.pipeline);
    pass.draw(6, 1, 0, 0);
    pass.end();
    this.queue.submit([encoder.finish()]);

    if (update && update.uploads.length) {
      for (const upload of update.uploads) {
        try {
          await upload();
        } catch (error) {
          logger.warn('Scene renderer upload task failed', error);
        }
      }
    }
  }

  destroy() {
    this.texture?.destroy();
    this.depthTexture?.destroy();
    this.texture = null;
    this.depthTexture = null;
    this.textureView = null;
    this.depthView = null;
    this.pipeline = null;
    this.targetWidth = 1;
    this.targetHeight = 1;
    (this.device as (GPUDevice & { destroy?: () => void }) | null)?.destroy?.();
    this.device = null;
    this.queue = null;
  }
}

export const createWebGpuSceneRenderer = async (textureFormat?: GPUTextureFormat) => {
  const renderer = new WebGpuSceneRenderer();
  await renderer.init(textureFormat);
  return renderer;
};
