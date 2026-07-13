import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { straightenConnectedNodes } from './edgeStraighten';

function agentNode(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 60,
): Node {
  return { id, position: { x, y }, measured: { width, height }, data: {} };
}

const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
});

describe('straightenConnectedNodes', () => {
  it('moves the lower node in x to align centers on a near-vertical connection', () => {
    // upper center x = 150, lower center x = 155 → offset 5 (<8)
    const nodes = [agentNode('a', 100, 0), agentNode('b', 105, 200)];
    const changes = straightenConnectedNodes({
      draggedId: 'a',
      nodes,
      edges: [edge('e', 'a', 'b')],
      threshold: 8,
    });
    expect(changes).toEqual([
      { id: 'b', type: 'position', position: { x: 100, y: 200 }, dragging: false },
    ]);
  });

  it('moves the dragged lower node itself when it is the one dragged', () => {
    const nodes = [agentNode('a', 100, 0), agentNode('b', 105, 200)];
    const changes = straightenConnectedNodes({
      draggedId: 'b',
      nodes,
      edges: [edge('e', 'a', 'b')],
      threshold: 8,
    });
    expect(changes).toEqual([
      { id: 'b', type: 'position', position: { x: 100, y: 200 }, dragging: false },
    ]);
  });

  it('moves the right node in y to align centers on a near-horizontal connection', () => {
    // left center y = 130, right center y = 133 → offset 3 (<8)
    const nodes = [agentNode('a', 0, 100), agentNode('b', 200, 103)];
    const changes = straightenConnectedNodes({
      draggedId: 'a',
      nodes,
      edges: [edge('e', 'a', 'b')],
      threshold: 8,
    });
    expect(changes).toEqual([
      { id: 'b', type: 'position', position: { x: 200, y: 100 }, dragging: false },
    ]);
  });

  it('does not move when the offset reaches the threshold', () => {
    // lower center x = 158 → offset 8 (not < 8)
    const nodes = [agentNode('a', 100, 0), agentNode('b', 108, 200)];
    const changes = straightenConnectedNodes({
      draggedId: 'a',
      nodes,
      edges: [edge('e', 'a', 'b')],
      threshold: 8,
    });
    expect(changes).toEqual([]);
  });

  it('does nothing when centers are already aligned', () => {
    const nodes = [agentNode('a', 100, 0), agentNode('b', 100, 200)];
    const changes = straightenConnectedNodes({
      draggedId: 'a',
      nodes,
      edges: [edge('e', 'a', 'b')],
      threshold: 8,
    });
    expect(changes).toEqual([]);
  });

  it('skips a node pulled toward two different coordinates by two parents', () => {
    // c center x = 150; parent a center x = 148, parent b center x = 154 (both <8, differ)
    const nodes = [
      agentNode('a', 98, 0),
      agentNode('b', 104, 0),
      agentNode('c', 100, 200),
    ];
    const changes = straightenConnectedNodes({
      draggedId: 'c',
      nodes,
      edges: [edge('e1', 'a', 'c'), edge('e2', 'b', 'c')],
      threshold: 8,
    });
    expect(changes).toEqual([]);
  });

  it('skips edges whose endpoints are not measured yet', () => {
    const nodes: Node[] = [
      { id: 'a', position: { x: 100, y: 0 }, data: {} },
      agentNode('b', 105, 200),
    ];
    const changes = straightenConnectedNodes({
      draggedId: 'b',
      nodes,
      edges: [edge('e', 'a', 'b')],
      threshold: 8,
    });
    expect(changes).toEqual([]);
  });

  it('returns nothing when there is no active drag node', () => {
    const nodes = [agentNode('a', 100, 0), agentNode('b', 105, 200)];
    expect(
      straightenConnectedNodes({
        draggedId: null,
        nodes,
        edges: [edge('e', 'a', 'b')],
        threshold: 8,
      }),
    ).toEqual([]);
  });

  it('ignores edges not connected to the dragged node', () => {
    const nodes = [
      agentNode('a', 100, 0),
      agentNode('b', 105, 200),
      agentNode('c', 500, 0),
    ];
    const changes = straightenConnectedNodes({
      draggedId: 'c',
      nodes,
      edges: [edge('e', 'a', 'b')],
      threshold: 8,
    });
    expect(changes).toEqual([]);
  });
});
