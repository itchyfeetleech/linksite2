import type { CRTRenderMode } from './types';

export const detectRenderMode = async (): Promise<CRTRenderMode> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'css';
  }

  if ('gpu' in navigator && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        return 'webgpu';
      }
    } catch (error) {
      console.warn('[CRTPostFX] WebGPU adapter request failed', error);
    }
  }

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { antialias: false, depth: false });
    if (context) {
      context.getExtension('EXT_color_buffer_float');
      context.getExtension('OES_texture_float_linear');
      context.getExtension('EXT_float_blend');
      return 'webgl2';
    }
  } catch (error) {
    console.warn('[CRTPostFX] WebGL2 context request failed', error);
  }

  return 'css';
};

