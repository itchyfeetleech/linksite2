import { logger } from '../logger';
import type { SceneComposerHooks, SceneFrame, SceneNode, ScenePrimitive, SceneUpdate } from './sceneTypes';

const IDENTITY_TRANSFORM: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

export class SceneComposer {
  private readonly nodes = new Map<string, SceneNode>();
  private readonly dirtyNodes = new Set<string>();
  private readonly removedNodes = new Set<string>();
  private readonly uploads: Array<() => Promise<void>> = [];
  private frameBudgetUploads: number | null = null;
  private frameCounter = 0;
  private openFrame = false;

  constructor(private readonly hooks: SceneComposerHooks = {}) {}

  beginFrame(options?: { uploadBudget?: number }) {
    if (this.openFrame) {
      logger.warn('SceneComposer beginFrame called while frame still open');
      return;
    }
    this.openFrame = true;
    this.uploads.length = 0;
    this.frameBudgetUploads = options?.uploadBudget ?? null;
  }

  updateNode(nodeId: string, primitives: ScenePrimitive[], params?: { opacity?: number; transform?: [number, number, number, number, number, number] }) {
    if (!this.openFrame) {
      this.beginFrame();
    }
    const existing = this.nodes.get(nodeId);
    const node: SceneNode = {
      id: nodeId,
      primitives,
      transform: params?.transform ?? existing?.transform ?? IDENTITY_TRANSFORM,
      opacity: params?.opacity ?? existing?.opacity ?? 1
    };
    this.nodes.set(nodeId, node);
    this.dirtyNodes.add(nodeId);
    this.removedNodes.delete(nodeId);
    if (!existing) {
      this.hooks.onNodeRegistered?.(nodeId);
    }
  }

  queueUpload(task: () => Promise<void>) {
    if (!this.openFrame) {
      this.beginFrame();
    }
    if (this.frameBudgetUploads !== null && this.uploads.length >= this.frameBudgetUploads) {
      logger.warn('SceneComposer upload budget exceeded; deferring upload');
      return;
    }
    this.uploads.push(task);
  }

  removeNode(nodeId: string) {
    if (!this.nodes.has(nodeId)) {
      return;
    }
    this.nodes.delete(nodeId);
    this.dirtyNodes.delete(nodeId);
    this.removedNodes.add(nodeId);
    this.hooks.onNodeRemoved?.(nodeId);
  }

  endFrame(): SceneUpdate | null {
    if (!this.openFrame) {
      return null;
    }
    this.openFrame = false;
    if (!this.dirtyNodes.size && !this.removedNodes.size && !this.uploads.length) {
      return null;
    }

    const updatedNodes: SceneNode[] = [];
    for (const nodeId of this.dirtyNodes) {
      const node = this.nodes.get(nodeId);
      if (!node) {
        continue;
      }
      updatedNodes.push(node);
    }

    const frame: SceneFrame = {\n      frameId: ++this.frameCounter,\n      nodes: updatedNodes,\n      removedNodeIds: Array.from(this.removedNodes)\n    };

    this.dirtyNodes.clear();
    this.removedNodes.clear();

    return {\n      frame,\n      uploads: [...this.uploads]\n    } as SceneUpdate;
  }

  reset() {
    this.nodes.clear();
    this.dirtyNodes.clear();
    this.removedNodes.clear();
    this.uploads.length = 0;
    this.frameCounter = 0;
    this.openFrame = false;
  }
}


