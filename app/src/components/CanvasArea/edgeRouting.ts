import type { Connection, Edge, Node } from '@xyflow/react';

export type ConnectionValidationMessage =
  | '连接端点无效'
  | '节点不能连接自身'
  | '这两个节点已经连接'
  | '该连接会形成循环';

function nodeCenter(node: Node): { x: number; y: number } {
  return {
    x: node.position.x + (node.measured?.width ?? 0) / 2,
    y: node.position.y + (node.measured?.height ?? 0) / 2,
  };
}

export function routeEdgesForNodes(nodes: Node[], edges: Edge[]): Edge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return edges.map((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) return edge;

    const sourceCenter = nodeCenter(source);
    const targetCenter = nodeCenter(target);
    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0
        ? {
            ...edge,
            type: 'orthogonal',
            sourceHandle: 'port-right',
            targetHandle: 'port-left',
          }
        : {
            ...edge,
            type: 'orthogonal',
            sourceHandle: 'port-left',
            targetHandle: 'port-right',
          };
    }

    return dy >= 0
      ? {
          ...edge,
          type: 'orthogonal',
          sourceHandle: 'port-bottom',
          targetHandle: 'port-top',
        }
      : {
          ...edge,
          type: 'orthogonal',
          sourceHandle: 'port-top',
          targetHandle: 'port-bottom',
        };
  });
}

export function validateConnection(
  nodes: Node[],
  edges: Edge[],
  connection: Connection,
): ConnectionValidationMessage | null {
  const { source, target } = connection;
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
    return '连接端点无效';
  }
  if (source === target) return '节点不能连接自身';
  if (edges.some((edge) => edge.source === source && edge.target === target)) {
    return '这两个节点已经连接';
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const pending = [target];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === source) return '该连接会形成循环';
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }

  return null;
}
