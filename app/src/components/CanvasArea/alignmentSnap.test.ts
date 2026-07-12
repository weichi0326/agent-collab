import { describe, expect, it } from 'vitest';
import type { Node, NodeChange } from '@xyflow/react';
import {
  calculateAlignmentSnap,
  snapNodeChangesToAlignment,
} from '../../lib/alignmentSnap';

const dragged = { id: 'dragged', x: 93, y: 187, width: 100, height: 60 };

describe('calculateAlignmentSnap', () => {
  it('snaps node edges independently on both axes and returns padded guides', () => {
    const result = calculateAlignmentSnap({
      dragged,
      others: [{ id: 'reference', x: 200, y: 100, width: 120, height: 80 }],
      tolerance: 8,
      padding: 20,
    });

    expect(result.position).toEqual({ x: 100, y: 180 });
    expect(result.guides).toEqual([
      {
        axis: 'x',
        coordinate: 200,
        from: 80,
        to: 260,
        referenceId: 'reference',
        draggedAnchor: 'end',
        referenceAnchor: 'start',
      },
      {
        axis: 'y',
        coordinate: 180,
        from: 80,
        to: 340,
        referenceId: 'reference',
        draggedAnchor: 'start',
        referenceAnchor: 'end',
      },
    ]);
  });

  it('supports horizontal and vertical center alignment', () => {
    const result = calculateAlignmentSnap({
      dragged: { id: 'dragged', x: 147, y: 143, width: 100, height: 60 },
      others: [{ id: 'reference', x: 100, y: 100, width: 200, height: 140 }],
      tolerance: 8,
      padding: 0,
    });

    expect(result.position).toEqual({ x: 150, y: 140 });
    expect(result.guides.map((guide) => [guide.axis, guide.draggedAnchor])).toEqual([
      ['x', 'center'],
      ['y', 'center'],
    ]);
  });

  it('selects the nearest alignment candidate on each axis', () => {
    const result = calculateAlignmentSnap({
      dragged: { id: 'dragged', x: 94, y: 400, width: 100, height: 60 },
      others: [
        { id: 'far', x: 200, y: 0, width: 100, height: 80 },
        { id: 'near', x: 198, y: 100, width: 100, height: 80 },
      ],
      tolerance: 8,
      padding: 0,
    });

    expect(result.position.x).toBe(98);
    expect(result.guides[0]?.referenceId).toBe('near');
  });

  it('prefers matching anchor kinds when candidate distances are equal', () => {
    const result = calculateAlignmentSnap({
      dragged: { id: 'dragged', x: 105, y: 400, width: 100, height: 60 },
      others: [
        { id: 'cross-kind', x: 10, y: 0, width: 100, height: 80 },
        { id: 'same-kind', x: 100, y: 100, width: 100, height: 80 },
      ],
      tolerance: 8,
      padding: 0,
    });

    expect(result.position.x).toBe(100);
    expect(result.guides[0]).toMatchObject({
      referenceId: 'same-kind',
      draggedAnchor: 'start',
      referenceAnchor: 'start',
    });
  });

  it('snaps at the tolerance boundary and ignores candidates beyond it', () => {
    const atBoundary = calculateAlignmentSnap({
      dragged: { id: 'dragged', x: 92, y: 300, width: 100, height: 60 },
      others: [{ id: 'reference', x: 200, y: 0, width: 100, height: 80 }],
      tolerance: 8,
      padding: 0,
    });
    const outside = calculateAlignmentSnap({
      dragged: { id: 'dragged', x: 91.9, y: 300, width: 100, height: 60 },
      others: [{ id: 'reference', x: 200, y: 0, width: 100, height: 80 }],
      tolerance: 8,
      padding: 0,
    });

    expect(atBoundary.position.x).toBe(100);
    expect(atBoundary.guides).toHaveLength(1);
    expect(outside.position).toEqual({ x: 91.9, y: 300 });
    expect(outside.guides).toEqual([]);
  });
});

describe('snapNodeChangesToAlignment', () => {
  const nodes: Node[] = [
    {
      id: 'dragged',
      position: { x: 90, y: 180 },
      measured: { width: 100, height: 60 },
      data: {},
    },
    {
      id: 'reference',
      position: { x: 200, y: 100 },
      measured: { width: 120, height: 80 },
      data: {},
    },
  ];

  it('replaces a single active drag position with its snapped position', () => {
    const changes: NodeChange[] = [
      {
        id: 'dragged',
        type: 'position',
        position: { x: 93, y: 187 },
        positionAbsolute: { x: 93, y: 187 },
        dragging: true,
      },
    ];

    const result = snapNodeChangesToAlignment({
      changes,
      nodes,
      activeNodeId: 'dragged',
      tolerance: 8,
      padding: 20,
    });

    expect(result.changes).toEqual([
      {
        id: 'dragged',
        type: 'position',
        position: { x: 100, y: 180 },
        positionAbsolute: { x: 100, y: 180 },
        dragging: true,
      },
    ]);
    expect(result.guides).toHaveLength(2);
  });

  it('leaves group dragging unchanged and does not show guides', () => {
    const changes: NodeChange[] = [
      {
        id: 'dragged',
        type: 'position',
        position: { x: 93, y: 187 },
        dragging: true,
      },
      {
        id: 'reference',
        type: 'position',
        position: { x: 203, y: 107 },
        dragging: true,
      },
    ];

    const result = snapNodeChangesToAlignment({
      changes,
      nodes,
      activeNodeId: 'dragged',
      tolerance: 8,
      padding: 20,
    });

    expect(result.changes).toBe(changes);
    expect(result.guides).toEqual([]);
  });
});
