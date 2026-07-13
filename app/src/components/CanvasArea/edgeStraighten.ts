import type { Edge, Node, NodeChange } from '@xyflow/react';

export interface StraightenInput {
  draggedId: string | null;
  nodes: Node[];
  edges: Edge[];
  threshold: number;
}

interface Center {
  x: number;
  y: number;
}

function nodeCenter(node: Node): Center | undefined {
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { x: node.position.x + width / 2, y: node.position.y + height / 2 };
}

interface Proposal {
  moverId: string;
  axis: 'x' | 'y';
  position: { x: number; y: number };
}

// 拖拽结束时，对被拖节点直接相连的边做「中心对齐拉直」：竖直连线移下方节点的 x、
// 水平连线移右侧节点的 y，使连线端口共线、消除几像素的小台阶。阈值为几何偏移(与缩放无关)。
export function straightenConnectedNodes({
  draggedId,
  nodes,
  edges,
  threshold,
}: StraightenInput): NodeChange[] {
  if (!draggedId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(draggedId)) return [];

  const proposals: Proposal[] = [];
  for (const edge of edges) {
    if (edge.source !== draggedId && edge.target !== draggedId) continue;
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;
    const ca = nodeCenter(a);
    const cb = nodeCenter(b);
    if (!ca || !cb) continue;
    const dx = Math.abs(ca.x - cb.x);
    const dy = Math.abs(ca.y - cb.y);

    if (dx >= dy) {
      // 水平连接：对齐 y，移动 center.x 较大者(右侧节点)
      if (dy <= 0 || dy >= threshold) continue;
      const moverIsA = ca.x >= cb.x;
      const mover = moverIsA ? a : b;
      const cMover = moverIsA ? ca : cb;
      const cOther = moverIsA ? cb : ca;
      proposals.push({
        moverId: mover.id,
        axis: 'y',
        position: { x: mover.position.x, y: mover.position.y + (cOther.y - cMover.y) },
      });
    } else {
      // 竖直连接：对齐 x，移动 center.y 较大者(下方节点)
      if (dx <= 0 || dx >= threshold) continue;
      const moverIsA = ca.y >= cb.y;
      const mover = moverIsA ? a : b;
      const cMover = moverIsA ? ca : cb;
      const cOther = moverIsA ? cb : ca;
      proposals.push({
        moverId: mover.id,
        axis: 'x',
        position: { x: mover.position.x + (cOther.x - cMover.x), y: mover.position.y },
      });
    }
  }

  // 冲突去重：同一节点同一轴被多条边拉向不同坐标 → 顾此失彼，整组丢弃
  const grouped = new Map<string, Proposal | null>();
  for (const proposal of proposals) {
    const key = `${proposal.moverId}:${proposal.axis}`;
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, proposal);
      continue;
    }
    if (existing === null) continue;
    const target = proposal.axis === 'x' ? proposal.position.x : proposal.position.y;
    const existingTarget =
      existing.axis === 'x' ? existing.position.x : existing.position.y;
    if (target !== existingTarget) grouped.set(key, null);
  }

  const changes: NodeChange[] = [];
  for (const proposal of grouped.values()) {
    if (!proposal) continue;
    changes.push({
      id: proposal.moverId,
      type: 'position',
      position: proposal.position,
      dragging: false,
    });
  }
  return changes;
}
