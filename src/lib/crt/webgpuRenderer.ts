import shaderSource from './shaders/crt.wgsl?raw';
import type { CaptureFrame, CRTGpuRenderer } from './types';
import { UNIFORM_FLOAT_COUNT } from './types';

interface TextureSize {
  width: number;
  height: number;
}

export class WebGpuRenderer implements CRTGpuRenderer {
  readonly mode = 'webgpu' as const;

  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private texture: GPUTexture | null = null;
  private textureSize: TextureSize | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private format: GPUTextureFormat | null = null;

  async init(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }

    this.canvas = canvas;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU adapter not found');
    }

    this.device = await adapter.requestDevice();
    this.context = canvas.getContext('webgpu');

    if (!this.context) {
      throw new Error('Unable to create WebGPU canvas context');
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied'
    });

    const module = this.device.createShaderModule({ code: shaderSource });
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format
          }
        ]
      }
    });

    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
  }

  private updateBindGroup() {
    if (!this.device || !this.pipeline || !this.uniformBuffer || !this.sampler || !this.texture) {
      return;
    }

    const layout = this.pipeline.getBindGroupLayout(0);
    this.bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        {
          binding: 0,
          resource: this.sampler
        },
        {
          binding: 1,
          resource: this.texture.createView()
        },
        {
          binding: 2,
          resource: { buffer: this.uniformBuffer }
        }
      ]
    });
  }

  async updateTexture(frame: CaptureFrame) {
    if (!this.device) {
      return;
    }

    const needsResize = !this.textureSize ||
      this.textureSize.width !== frame.width ||
      this.textureSize.height !== frame.height;

    if (needsResize) {
      this.texture?.destroy();
      this.texture = this.device.createTexture({
        size: { width: frame.width, height: frame.height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.textureSize = { width: frame.width, height: frame.height };
      this.updateBindGroup();
    }

    if (!this.texture) {
      frame.bitmap.close();
      return;
    }

    this.device.queue.copyExternalImageToTexture(
      { source: frame.bitmap },
      { texture: this.texture },
      { width: frame.width, height: frame.height }
    );

    frame.bitmap.close();
  }

  render(uniforms: Float32Array) {
    if (!this.device || !this.context || !this.pipeline || !this.uniformBuffer || !this.bindGroup || !this.format) {
      return;
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength);

    const currentTexture = this.context.getCurrentTexture();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: currentTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }
      ]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  resize(width: number, height: number) {
    if (!this.canvas) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
  }

  destroy() {
    this.texture?.destroy();
    this.texture = null;
    this.textureSize = null;
    this.uniformBuffer?.destroy();
    this.uniformBuffer = null;
    (this.device as (GPUDevice & { destroy?: () => void }) | null)?.destroy?.();
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.sampler = null;
  }
}

export const createWebGpuRenderer = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGpuRenderer();
  await renderer.init(canvas);
  return renderer;
};

