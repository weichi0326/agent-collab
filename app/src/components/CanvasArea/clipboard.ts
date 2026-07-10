import type { Edge, Node } from '@xyflow/react';

export type Clip = {
  nodes: Node[];
  edges: Edge[];
  sourceCanvasId?: string;
} | null;

export const getClipboard = (): Clip =>
  (window as unknown as { __agentClipboard?: Clip }).__agentClipboard ?? null;

export const setClipboard = (clip: Clip): void => {
  (window as unknown as { __agentClipboard?: Clip }).__agentClipboard = clip;
};
