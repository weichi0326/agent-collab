import type { Edge, Node } from '@xyflow/react';
import type { AgentNodeData, Canvas, SavedCanvas } from './types';

export function isCanvasDirty(
  canvas: Canvas,
  saved: SavedCanvas[],
): boolean {
  if (canvas.readOnly) return false;
  const hasContent = canvas.nodes.length > 0 || canvas.edges.length > 0;
  if (!hasContent) return false;
  if (!canvas.savedId) return true;
  const sc = saved.find((x) => x.id === canvas.savedId);
  if (!sc) return true;
  return (
    JSON.stringify(canvas.nodes) !== JSON.stringify(sc.nodes) ||
    JSON.stringify(canvas.edges) !== JSON.stringify(sc.edges)
  );
}

export function upstreamNames(
  nodes: Node[],
  edges: Edge[],
  nodeId: string,
): string[] {
  const names: string[] = [];
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    const d = src.data as AgentNodeData;
    names.push((typeof d?.label === 'string' && d.label) || 'Agent');
  }
  return names;
}
