/// <reference path="../.astro/types.d.ts" />
/// <reference types='astro/client' />
/// <reference types='@webgpu/types' />

declare module '*.wgsl' {
  const source: string;
  export default source;
}

declare module '*.wgsl?raw' {
  const source: string;
  export default source;
}

declare module '*.glsl' {
  const source: string;
  export default source;
}

declare module '*.glsl?raw' {
  const source: string;
  export default source;
}

