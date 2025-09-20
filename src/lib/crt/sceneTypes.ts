export type ScenePrimitiveType =
  | 'roundedRect'
  | 'imageQuad'
  | 'textRun'
  | 'vectorPath'
  | 'patternFill'
  | 'externalSurface';

export interface ScenePrimitiveBase {
  id: string;
  type: ScenePrimitiveType;
  zIndex: number;
  blendMode?: 'normal' | 'screen' | 'multiply' | 'add' | 'overlay';
  clipRadius?: number;
}

export interface SceneRoundedRect extends ScenePrimitiveBase {
  type: 'roundedRect';
  width: number;
  height: number;
  cornerRadius: number;
  fill: {
    kind: 'solid' | 'linearGradient';
    color?: [number, number, number, number];
    gradientStops?: Array<{ offset: number; color: [number, number, number, number] }>;
    gradientDirection?: [number, number];
  };
  stroke?: {
    thickness: number;
    color: [number, number, number, number];
  };
  dropShadow?: {
    offset: [number, number];
    blur: number;
    color: [number, number, number, number];
  };
  innerShadow?: {
    offset: [number, number];
    blur: number;
    color: [number, number, number, number];
  };
  backdropBlur?: number;
}

export interface SceneImageQuad extends ScenePrimitiveBase {
  type: 'imageQuad';
  width: number;
  height: number;
  sourceId: string;
  uvRect?: [number, number, number, number];
  tint?: [number, number, number, number];
}

export interface SceneTextGlyphInstance {
  glyphId: number;
  atlasPage: number;
  position: [number, number];
  uvRect: [number, number, number, number];
  advance: number;
}

export interface SceneTextRun extends ScenePrimitiveBase {
  type: 'textRun';
  fontId: string;
  fontSize: number;
  lineHeight: number;
  color: [number, number, number, number];
  shadow?: {
    offset: [number, number];
    blur: number;
    color: [number, number, number, number];
  };
  glyphs: SceneTextGlyphInstance[];
}

export interface SceneVectorPath extends ScenePrimitiveBase {
  type: 'vectorPath';
  pathId: string;
  fillColor?: [number, number, number, number];
  strokeColor?: [number, number, number, number];
  strokeWidth?: number;
}

export interface ScenePatternFill extends ScenePrimitiveBase {
  type: 'patternFill';
  width: number;
  height: number;
  patternId: string;
  opacity: number;
}

export interface SceneExternalSurface extends ScenePrimitiveBase {
  type: 'externalSurface';
  surfaceId: string;
  width: number;
  height: number;
}

export type ScenePrimitive =
  | SceneRoundedRect
  | SceneImageQuad
  | SceneTextRun
  | SceneVectorPath
  | ScenePatternFill
  | SceneExternalSurface;

export interface SceneNode {
  id: string;
  primitives: ScenePrimitive[];
  transform: [number, number, number, number, number, number];
  opacity: number;
}

export interface SceneFrame {
  frameId: number;
  nodes: SceneNode[];
  removedNodeIds: string[];
}

export interface SceneUpdate {
  frame: SceneFrame;
  uploads: Array<() => Promise<void>>;
}

export interface SceneComposerHooks {
  onNodeRegistered?: (nodeId: string) => void;
  onNodeRemoved?: (nodeId: string) => void;
}

export interface SceneTextureTarget {
  kind: 'webgpu';
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  format: GPUTextureFormat;
}

