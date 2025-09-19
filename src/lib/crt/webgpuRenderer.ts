import lutShaderSource from './shaders/crtLut.wgsl?raw';
import shaderSource from './shaders/crt.wgsl?raw';
import type { CaptureFrame, CRTGpuRenderer, RendererCapabilities } from './types';
import { UNIFORM_FLOAT_COUNT } from './types';
import { logger } from '../logger';

interface TextureSize {
  width: number;
  height: number;
}

const LUT_WORKGROUP_SIZE = 8;
const FLOAT16_FILTERABLE_FEATURE = 'float16-filterable' as GPUFeatureName;
const FLOAT32_FILTERABLE_FEATURE = 'float32-filterable' as GPUFeatureName;

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
  private renderBindGroupLayout: GPUBindGroupLayout | null = null;
  private computeBindGroupLayout: GPUBindGroupLayout | null = null;
  private renderPipelineLayout: GPUPipelineLayout | null = null;
  private computePipelineLayout: GPUPipelineLayout | null = null;
  private sceneTexture: GPUTexture | null = null;
  private sceneTextureSize: TextureSize | null = null;
  private forwardLutTexture: GPUTexture | null = null;
  private inverseLutTexture: GPUTexture | null = null;
  private lutSize: TextureSize | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private format: GPUTextureFormat | null = null;
  private geometryUniforms = new Float32Array(8);
  private halfFloatFilterable = false;
  private warnedCompilationInfoUnavailable = false;

  getCapabilities(): RendererCapabilities {
    return {
      linearHalfFloatLut: this.halfFloatFilterable
    } satisfies RendererCapabilities;
  }

  private async getCompilationInfo(
    module: GPUShaderModule,
    label: string
  ): Promise<GPUCompilationInfo | null> {
    const moduleWithLegacy = module as GPUShaderModule & {
      compilationInfo?: () => Promise<GPUCompilationInfo>;
    };
    const getInfo =
      typeof module.getCompilationInfo === 'function'
        ? module.getCompilationInfo.bind(module)
        : typeof moduleWithLegacy.compilationInfo === 'function'
          ? moduleWithLegacy.compilationInfo.bind(module)
          : null;

    if (!getInfo) {
      if (!this.warnedCompilationInfoUnavailable) {
        logger.info('CRT WebGPU shader compilation info unavailable; skipping validation', {
          label,
          reason: 'unsupported'
        });
        this.warnedCompilationInfoUnavailable = true;
      }
      return null;
    }

    try {
      return await getInfo();
    } catch (error) {
      if (!this.warnedCompilationInfoUnavailable) {
        logger.warn('CRT WebGPU shader compilation info query failed; skipping validation', {
          label,
          error
        });
        this.warnedCompilationInfoUnavailable = true;
      }
      return null;
    }
  }

  private async runWgslSelfTest(device: GPUDevice) {
    const modules = [
      {
        module: device.createShaderModule({
          label: 'crt-selftest-vertex',
          code: `@vertex fn vs_self_test() -> @builtin(position) vec4<f32> {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
      }`
        }),
        label: 'crt-selftest-vertex'
      },
      {
        module: device.createShaderModule({
          label: 'crt-selftest-fragment',
          code: `@fragment fn fs_self_test() -> @location(0) vec4<f32> {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
      }`
        }),
        label: 'crt-selftest-fragment'
      },
      {
        module: device.createShaderModule({
          label: 'crt-selftest-compute',
          code: `@compute @workgroup_size(1, 1, 1) fn cs_self_test() {}`
        }),
        label: 'crt-selftest-compute'
      }
    ];

    const infos = await Promise.all(
      modules.map(({ module, label }) => this.getCompilationInfo(module, label))
    );
    const availableInfos = infos.filter((info): info is GPUCompilationInfo => info !== null);

    if (availableInfos.length === 0) {
      logger.info('CRT WebGPU WGSL self-test skipped; compilation info unavailable');
      return;
    }

    const errors = availableInfos.flatMap((info) =>
      info.messages.filter((message) => message.type === 'error')
    );
    if (errors.length > 0) {
      logger.warn('CRT WebGPU WGSL self-test reported errors', errors);
    } else {
      logger.info('CRT WebGPU WGSL self-test passed');
    }
  }

  private async validateShaderModule(module: GPUShaderModule, label: string, source: string) {
    const info = await this.getCompilationInfo(module, label);
    if (!info) {
      return;
    }

    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length === 0) {
      return;
    }

    errors.forEach((message) => {
      const lines = source.split('\n');
      const line = message.lineNum ?? 0;
      const start = Math.max(0, line - 2);
      const end = Math.min(lines.length, line + 1);
      const snippet = lines.slice(start, end).join('\n');
      logger.error('CRT WebGPU shader compilation error', {
        label,
        line: message.lineNum,
        column: message.linePos,
        message: message.message,
        snippet
      });
    });

    throw new Error(`${label} failed to compile`);
  }

  async init(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU adapter not found');
    }

    const adapterFeatures = new Set<GPUFeatureName>();
    adapter.features.forEach((feature) => {
      adapterFeatures.add(feature);
    });

    const requestedFeatures: GPUFeatureName[] = [];
    if (adapterFeatures.has(FLOAT16_FILTERABLE_FEATURE)) {
      requestedFeatures.push(FLOAT16_FILTERABLE_FEATURE);
    } else if (adapterFeatures.has(FLOAT32_FILTERABLE_FEATURE)) {
      requestedFeatures.push(FLOAT32_FILTERABLE_FEATURE);
    }

    const device = await adapter.requestDevice({
      label: 'crt-webgpu-device',
      requiredFeatures: requestedFeatures
    });
    this.device = device;
    this.canvas = canvas;

    await this.runWgslSelfTest(device);

    const deviceFeatures = new Set<GPUFeatureName>();
    device.features.forEach((feature) => {
      deviceFeatures.add(feature);
    });

    this.halfFloatFilterable =
      deviceFeatures.has(FLOAT16_FILTERABLE_FEATURE) ||
      deviceFeatures.has(FLOAT32_FILTERABLE_FEATURE);

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Unable to create WebGPU canvas context');
    }
    this.context = context;

    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: this.format,
      alphaMode: 'premultiplied',
      colorSpace: 'srgb',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
    });

    const renderModule = device.createShaderModule({ label: 'crt-render-shader', code: shaderSource });
    await this.validateShaderModule(renderModule, 'crt-render-shader', shaderSource);

    const lutModule = device.createShaderModule({ label: 'crt-lut-shader', code: lutShaderSource });
    await this.validateShaderModule(lutModule, 'crt-lut-shader', lutShaderSource);

    this.renderBindGroupLayout = device.createBindGroupLayout({
      label: 'crt-render-bind-group-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
      ]
    });

    this.computeBindGroupLayout = device.createBindGroupLayout({
      label: 'crt-lut-bind-group-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' }
        }
      ]
    });

    this.renderPipelineLayout = device.createPipelineLayout({
      label: 'crt-render-pipeline-layout',
      bindGroupLayouts: [this.renderBindGroupLayout]
    });

    this.computePipelineLayout = device.createPipelineLayout({
      label: 'crt-lut-pipeline-layout',
      bindGroupLayouts: [this.computeBindGroupLayout]
    });

    const format = this.format;
    if (!format) {
      throw new Error('Unable to determine canvas format');
    }

    const renderLayout = this.renderPipelineLayout;
    if (!renderLayout) {
      throw new Error('Render pipeline layout unavailable');
    }

    try {
      this.pipeline = device.createRenderPipeline({
        label: 'crt-render-pipeline',
        layout: renderLayout,
        vertex: { module: renderModule, entryPoint: 'vs_main' },
        fragment: {
          module: renderModule,
          entryPoint: 'fs_main',
          targets: [
            {
              format
            }
          ]
        }
      });
    } catch (error) {
      logger.error('CRT WebGPU render pipeline creation failed', error);
      const wrapped = new Error('WebGPU render pipeline creation failed');
      (wrapped as { cause?: unknown }).cause = error;
      throw wrapped;
    }

    const computeLayout = this.computePipelineLayout;
    if (!computeLayout) {
      throw new Error('Compute pipeline layout unavailable');
    }

    try {
      this.computePipeline = device.createComputePipeline({
        label: 'crt-lut-pipeline',
        layout: computeLayout,
        compute: { module: lutModule, entryPoint: 'cs_main' }
      });
    } catch (error) {
      logger.error('CRT WebGPU compute pipeline creation failed', error);
      const wrapped = new Error('WebGPU compute pipeline creation failed');
      (wrapped as { cause?: unknown }).cause = error;
      throw wrapped;
    }

    this.uniformBuffer = device.createBuffer({
      label: 'crt-uniform-buffer',
      size: UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.geometryUniformBuffer = device.createBuffer({
      label: 'crt-lut-uniform-buffer',
      size: this.geometryUniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.sampler = device.createSampler({
      label: 'crt-main-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    logger.info('CRT WebGPU renderer initialised', {
      format,
      halfFloatFilterable: this.halfFloatFilterable,
      adapterFeatures: Array.from(adapterFeatures).sort(),
      deviceFeatures: Array.from(deviceFeatures).sort(),
      requestedFeatures: requestedFeatures.slice()
    });
  }

  private updateRenderBindGroup() {
    if (!this.device || !this.renderBindGroupLayout || !this.uniformBuffer || !this.sampler || !this.sceneTexture || !this.forwardLutTexture) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      label: 'crt-render-bind-group',
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.sceneTexture.createView({ label: 'crt-scene-view' }) },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: this.forwardLutTexture.createView({ label: 'crt-forward-lut-view' }) }
      ]
    });
  }

  private updateComputeBindGroup() {
    if (!this.device || !this.computeBindGroupLayout || !this.geometryUniformBuffer || !this.forwardLutTexture || !this.inverseLutTexture) {
      return;
    }

    this.computeBindGroup = this.device.createBindGroup({
      label: 'crt-lut-bind-group',
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.geometryUniformBuffer } },
        { binding: 1, resource: this.forwardLutTexture.createView({ label: 'crt-forward-lut-storage' }) },
        { binding: 2, resource: this.inverseLutTexture.createView({ label: 'crt-inverse-lut-storage' }) }
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
        label: 'crt-scene-texture',
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
        label: 'crt-forward-lut-texture',
        size,
        format: 'rgba16float',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST
      });
      this.inverseLutTexture = this.device.createTexture({
        label: 'crt-inverse-lut-texture',
        size,
        format: 'rgba16float',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST
      });
      this.lutSize = size;
      this.updateRenderBindGroup();
      this.updateComputeBindGroup();
      logger.info('CRT WebGPU LUT textures resized', {
        width,
        height,
        format: 'rgba16float'
      });
    }

    if (!this.computePipeline || !this.geometryUniformBuffer || !this.device) {
      return;
    }

    if (!this.computeBindGroup) {
      this.updateComputeBindGroup();
    }

    if (!this.computeBindGroup) {
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
    this.renderBindGroupLayout = null;
    this.computeBindGroupLayout = null;
    this.renderPipelineLayout = null;
    this.computePipelineLayout = null;
    this.halfFloatFilterable = false;
    this.format = null;
    this.canvas = null;
  }
}

export const createWebGpuRenderer = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGpuRenderer();
  await renderer.init(canvas);
  return renderer;
};
