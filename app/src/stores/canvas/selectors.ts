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
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }

  const names: string[] = [];
  const visited = new Set<string>();
  const collectSourceName = (sourceId: string) => {
    if (visited.has(sourceId)) return;
    visited.add(sourceId);

    const src = nodesById.get(sourceId);
    if (!src) return;
    const d = src.data as AgentNodeData;

    // 门控节点只负责控制与透传，不是真正的数据生产者。
    if (d.gateType) {
      const parents = incoming.get(src.id) ?? [];
      if (parents.length > 0) {
        parents.forEach(collectSourceName);
        return;
      }
    }

    names.push((typeof d?.label === 'string' && d.label) || 'Agent');
  };

  (incoming.get(nodeId) ?? []).forEach(collectSourceName);
  return names;
}
