import shaderSource from './shaders/crt.wgsl?raw';
import type { CaptureFrame, CRTGpuRenderer } from './types';
import { UNIFORM_FLOAT_COUNT } from './types';
import { logger } from '../logger';

class ShaderCompilationError extends Error {
  readonly label: string;
  readonly line: number;

  constructor(label: string, line: number, message: string) {
    super(`${label} line ${line}: ${message}`);
    this.name = 'ShaderCompilationError';
    this.label = label;
    this.line = line;
  }
}

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
  private renderBindGroupLayout: GPUBindGroupLayout | null = null;
  private renderPipelineLayout: GPUPipelineLayout | null = null;
  private sceneTexture: GPUTexture | null = null;
  private sceneTextureSize: TextureSize | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private format: GPUTextureFormat | null = null;
  private warnedCompilationInfoUnavailable = false;

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
          code: `fn cs_select_guard(flag: bool) -> f32 {
        return select(0.0, 1.0, flag);
      }

      @compute @workgroup_size(1, 1, 1) fn cs_self_test() {
        let value = cs_select_guard(true);
        if (value > 2.0) {
          return;
        }
      }`
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

    const first = errors[0];
    const lines = source.split('\n');
    const lineNumber = first.lineNum ?? 0;
    const start = Math.max(0, lineNumber - 2);
    const end = Math.min(lines.length, lineNumber + 1);
    const snippet = lines
      .slice(start, end)
      .map((content, index) => {
        const currentLine = start + index + 1;
        return `${currentLine.toString().padStart(4, ' ')} | ${content}`;
      })
      .join('\n');

    logger.error('CRT WebGPU shader compilation error', {
      label,
      line: first.lineNum,
      column: first.linePos,
      message: first.message,
      snippet
    });

    errors.slice(1).forEach((message) => {
      logger.error('CRT WebGPU shader compilation error (additional)', {
        label,
        line: message.lineNum,
        column: message.linePos,
        message: message.message
      });
    });

    throw new ShaderCompilationError(label, lineNumber, first.message);
  }

  async init(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU adapter not found');
    }

    const device = await adapter.requestDevice({
      label: 'crt-webgpu-device'
    });
    this.device = device;
    this.canvas = canvas;

    await this.runWgslSelfTest(device);

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

    logger.info('CRT WebGPU creating shader module', { label: 'crt-render-shader' });
    const renderModule = device.createShaderModule({ label: 'crt-render-shader', code: shaderSource });
    await this.validateShaderModule(renderModule, 'crt-render-shader', shaderSource);

    this.renderBindGroupLayout = device.createBindGroupLayout({
      label: 'crt-render-bind-group-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
      ]
    });

    this.renderPipelineLayout = device.createPipelineLayout({
      label: 'crt-render-pipeline-layout',
      bindGroupLayouts: [this.renderBindGroupLayout]
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

    this.uniformBuffer = device.createBuffer({
      label: 'crt-uniform-buffer',
      size: UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.sampler = device.createSampler({
      label: 'crt-main-sampler',
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    logger.info('CRT WebGPU renderer initialised', {
      format
    });
  }

  private updateRenderBindGroup() {
    if (!this.device || !this.renderBindGroupLayout || !this.uniformBuffer || !this.sampler || !this.sceneTexture) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      label: 'crt-render-bind-group',
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.sceneTexture.createView({ label: 'crt-scene-view' }) }
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

  async updateGeometry(_params: { width: number; height: number; dpr: number; k1: number; k2: number }) {}

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
    this.sceneTexture = null;
    this.sceneTextureSize = null;
    this.uniformBuffer?.destroy();
    this.uniformBuffer = null;
    (this.device as (GPUDevice & { destroy?: () => void }) | null)?.destroy?.();
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.sampler = null;
    this.renderBindGroupLayout = null;
    this.renderPipelineLayout = null;
    this.format = null;
    this.canvas = null;
  }
}

export const createWebGpuRenderer = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGpuRenderer();
  await renderer.init(canvas);
  return renderer;
};
