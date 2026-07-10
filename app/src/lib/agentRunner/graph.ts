import type { Edge, Node } from '@xyflow/react';

export function topoSort(nodes: Node[], edges: Edge[]): Node[] {
  const ids = new Set(nodes.map((n) => n.id));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const children = new Map<string, string[]>();

  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const sorted: Node[] = [];

  while (queue.length) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const child of children.get(node.id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        const childNode = byId.get(child);
        if (childNode) queue.push(childNode);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('画布存在循环连线，暂无法执行。请先调整为无环流程。');
  }
  return sorted;
}

export function incomingSources(edges: Edge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    map.set(edge.target, [...(map.get(edge.target) ?? []), edge.source]);
  }
  return map;
}

export function outgoingTargets(edges: Edge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    map.set(edge.source, [...(map.get(edge.source) ?? []), edge.target]);
  }
  return map;
}
