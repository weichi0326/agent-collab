import type { Edge, Node } from '@xyflow/react';
import type { AgentNodeData } from './types';

export function recomputeDerived(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const arr = children.get(e.source);
    if (arr) arr.push(e.target);
    else children.set(e.source, [e.target]);
  }

  const isCollapsed = (n: Node) => !!(n.data as AgentNodeData)?.collapsed;

  const descCache = new Map<string, Set<string>>();
  const descendantsOf = (start: string): Set<string> => {
    const cached = descCache.get(start);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [...(children.get(start) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const c of children.get(id) ?? []) stack.push(c);
    }
    descCache.set(start, seen);
    return seen;
  };

  const hidden = new Set<string>();
  for (const n of nodes) {
    if (isCollapsed(n)) for (const d of descendantsOf(n.id)) hidden.add(d);
  }

  const outNodes = nodes.map((n) => {
    const collapsible = (children.get(n.id)?.length ?? 0) > 0;
    const hiddenCount = isCollapsed(n) ? descendantsOf(n.id).size : 0;
    return {
      ...n,
      hidden: hidden.has(n.id),
      data: { ...n.data, collapsible, hiddenCount },
    };
  });

  const outEdges = edges.map((e) => ({
    ...e,
    hidden: hidden.has(e.source) || hidden.has(e.target),
  }));

  return { nodes: outNodes, edges: outEdges };
}
