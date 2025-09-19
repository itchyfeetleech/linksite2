import lutShaderSource from './shaders/crtLut.wgsl?raw';
import shaderSource from './shaders/crt.wgsl?raw';
import type { CaptureFrame, CRTGpuRenderer } from './types';
import { UNIFORM_FLOAT_COUNT } from './types';

interface TextureSize {
  width: number;
  height: number;
}

const LUT_WORKGROUP_SIZE = 8;

export class WebGpuRenderer implements CRTGpuRenderer {
  readonly mode = 'webgpu' as const;

  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private sampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private geometryUniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private sceneTexture: GPUTexture | null = null;
  private sceneTextureSize: TextureSize | null = null;
  private forwardLutTexture: GPUTexture | null = null;
  private inverseLutTexture: GPUTexture | null = null;
  private lutSize: TextureSize | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private format: GPUTextureFormat | null = null;
  private geometryUniforms = new Float32Array(8);

  async init(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU adapter not found');
    }

    this.device = await adapter.requestDevice();
    this.canvas = canvas;
    this.context = canvas.getContext('webgpu');

    if (!this.context) {
      throw new Error('Unable to create WebGPU canvas context');
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
      colorSpace: 'srgb',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
    });

    const device = this.device;
    const module = device.createShaderModule({ code: shaderSource });
    this.pipeline = device.createRenderPipeline({
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

    const lutModule = device.createShaderModule({ code: lutShaderSource });
    this.computePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: lutModule, entryPoint: 'cs_main' }
    });

    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.geometryUniformBuffer = device.createBuffer({
      size: this.geometryUniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
  }

  private updateRenderBindGroup() {
    if (!this.device || !this.pipeline || !this.uniformBuffer || !this.sampler || !this.sceneTexture || !this.forwardLutTexture) {
      return;
    }

    const layout = this.pipeline.getBindGroupLayout(0);
    this.bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.sceneTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: this.forwardLutTexture.createView() }
      ]
    });
  }

  private updateComputeBindGroup() {
    if (!this.device || !this.computePipeline || !this.geometryUniformBuffer || !this.forwardLutTexture || !this.inverseLutTexture) {
      return;
    }

    const layout = this.computePipeline.getBindGroupLayout(0);
    this.computeBindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.geometryUniformBuffer } },
        { binding: 1, resource: this.forwardLutTexture.createView() },
        { binding: 2, resource: this.inverseLutTexture.createView() }
      ]
    });
  }

  async updateTexture(frame: CaptureFrame) {
    if (!this.device) {
      frame.bitmap.close();
      return;
    }

    const needsResize = !this.sceneTextureSize ||
      this.sceneTextureSize.width !== frame.width ||
      this.sceneTextureSize.height !== frame.height;

    if (needsResize) {
      this.sceneTexture?.destroy();
      this.sceneTexture = this.device.createTexture({
        size: { width: frame.width, height: frame.height },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT
      });
      this.sceneTextureSize = { width: frame.width, height: frame.height };
      this.updateRenderBindGroup();
    }

    if (!this.sceneTexture) {
      frame.bitmap.close();
      return;
    }

    this.device.queue.copyExternalImageToTexture(
      { source: frame.bitmap },
      { texture: this.sceneTexture },
      { width: frame.width, height: frame.height }
    );

    frame.bitmap.close();
  }

  async updateGeometry(
    params: { width: number; height: number; dpr: number; k1: number; k2: number },
    _lutData?: unknown
  ) {
    if (!this.device) {
      return;
    }

    const width = Math.max(1, Math.round(params.width));
    const height = Math.max(1, Math.round(params.height));
    const needsLutResize = !this.lutSize || this.lutSize.width !== width || this.lutSize.height !== height;

    if (needsLutResize) {
      this.forwardLutTexture?.destroy();
      this.inverseLutTexture?.destroy();
      const size = { width, height };
      this.forwardLutTexture = this.device.createTexture({
        size,
        format: 'rg16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
      });
      this.inverseLutTexture = this.device.createTexture({
        size,
        format: 'rg16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
      });
      this.lutSize = size;
      this.updateRenderBindGroup();
      this.updateComputeBindGroup();
    }

    if (!this.computePipeline || !this.computeBindGroup || !this.geometryUniformBuffer || !this.device) {
      return;
    }

    this.geometryUniforms[0] = width;
    this.geometryUniforms[1] = height;
    this.geometryUniforms[2] = width > 0 ? 1 / width : 0;
    this.geometryUniforms[3] = height > 0 ? 1 / height : 0;
    this.geometryUniforms[4] = height > 0 ? width / height : 1;
    this.geometryUniforms[5] = params.k1;
    this.geometryUniforms[6] = params.k2;
    this.geometryUniforms[7] = params.dpr;

    this.device.queue.writeBuffer(
      this.geometryUniformBuffer,
      0,
      this.geometryUniforms.buffer,
      this.geometryUniforms.byteOffset,
      this.geometryUniforms.byteLength
    );

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.computeBindGroup);
    const groupX = Math.ceil(width / LUT_WORKGROUP_SIZE);
    const groupY = Math.ceil(height / LUT_WORKGROUP_SIZE);
    pass.dispatchWorkgroups(groupX, groupY, 1);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
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
    this.sceneTexture?.destroy();
    this.forwardLutTexture?.destroy();
    this.inverseLutTexture?.destroy();
    this.sceneTexture = null;
    this.forwardLutTexture = null;
    this.inverseLutTexture = null;
    this.sceneTextureSize = null;
    this.lutSize = null;
    this.uniformBuffer?.destroy();
    this.geometryUniformBuffer?.destroy();
    this.uniformBuffer = null;
    this.geometryUniformBuffer = null;
    (this.device as (GPUDevice & { destroy?: () => void }) | null)?.destroy?.();
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.computePipeline = null;
    this.bindGroup = null;
    this.computeBindGroup = null;
    this.sampler = null;
    this.canvas = null;
  }
}

export const createWebGpuRenderer = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGpuRenderer();
  await renderer.init(canvas);
  return renderer;
};
