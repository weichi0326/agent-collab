import type { Node, NodeChange, NodePositionChange } from '@xyflow/react';

export type AlignmentAnchor = 'start' | 'center' | 'end';

export interface AlignmentRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignmentGuide {
  axis: 'x' | 'y';
  coordinate: number;
  from: number;
  to: number;
  referenceId: string;
  draggedAnchor: AlignmentAnchor;
  referenceAnchor: AlignmentAnchor;
}

export interface AlignmentSnapInput {
  dragged: AlignmentRect;
  others: AlignmentRect[];
  tolerance: number;
  padding: number;
}

export interface AlignmentSnapResult {
  position: { x: number; y: number };
  guides: AlignmentGuide[];
}

export interface SnapNodeChangesInput {
  changes: NodeChange[];
  nodes: Node[];
  activeNodeId: string | null;
  tolerance: number;
  padding: number;
}

export interface SnapNodeChangesResult {
  changes: NodeChange[];
  guides: AlignmentGuide[];
}

interface SnapCandidate {
  distance: number;
  delta: number;
  coordinate: number;
  reference: AlignmentRect;
  draggedAnchor: AlignmentAnchor;
  referenceAnchor: AlignmentAnchor;
  order: number;
}

const ANCHORS: AlignmentAnchor[] = ['start', 'center', 'end'];

function anchorCoordinate(
  rect: AlignmentRect,
  axis: 'x' | 'y',
  anchor: AlignmentAnchor,
): number {
  const origin = axis === 'x' ? rect.x : rect.y;
  const size = axis === 'x' ? rect.width : rect.height;
  if (anchor === 'start') return origin;
  if (anchor === 'center') return origin + size / 2;
  return origin + size;
}

function findCandidate(
  dragged: AlignmentRect,
  others: AlignmentRect[],
  axis: 'x' | 'y',
  tolerance: number,
): SnapCandidate | undefined {
  let best: SnapCandidate | undefined;
  let order = 0;

  for (const reference of others) {
    for (const draggedAnchor of ANCHORS) {
      const draggedCoordinate = anchorCoordinate(dragged, axis, draggedAnchor);
      for (const referenceAnchor of ANCHORS) {
        const coordinate = anchorCoordinate(reference, axis, referenceAnchor);
        const delta = coordinate - draggedCoordinate;
        const candidate: SnapCandidate = {
          distance: Math.abs(delta),
          delta,
          coordinate,
          reference,
          draggedAnchor,
          referenceAnchor,
          order,
        };
        order += 1;
        if (candidate.distance > tolerance) continue;

        const candidateMatches = draggedAnchor === referenceAnchor;
        const bestMatches = best?.draggedAnchor === best?.referenceAnchor;
        if (
          !best ||
          candidate.distance < best.distance ||
          (candidate.distance === best.distance && candidateMatches && !bestMatches) ||
          (candidate.distance === best.distance &&
            candidateMatches === bestMatches &&
            candidate.order < best.order)
        ) {
          best = candidate;
        }
      }
    }
  }

  return best;
}

export function calculateAlignmentSnap({
  dragged,
  others,
  tolerance,
  padding,
}: AlignmentSnapInput): AlignmentSnapResult {
  const safeTolerance = Math.max(0, tolerance);
  const safePadding = Math.max(0, padding);
  const xCandidate = findCandidate(dragged, others, 'x', safeTolerance);
  const yCandidate = findCandidate(dragged, others, 'y', safeTolerance);
  const position = {
    x: dragged.x + (xCandidate?.delta ?? 0),
    y: dragged.y + (yCandidate?.delta ?? 0),
  };
  const snappedRect = { ...dragged, ...position };
  const guides: AlignmentGuide[] = [];

  if (xCandidate) {
    guides.push({
      axis: 'x',
      coordinate: xCandidate.coordinate,
      from: Math.min(snappedRect.y, xCandidate.reference.y) - safePadding,
      to:
        Math.max(
          snappedRect.y + snappedRect.height,
          xCandidate.reference.y + xCandidate.reference.height,
        ) + safePadding,
      referenceId: xCandidate.reference.id,
      draggedAnchor: xCandidate.draggedAnchor,
      referenceAnchor: xCandidate.referenceAnchor,
    });
  }

  if (yCandidate) {
    guides.push({
      axis: 'y',
      coordinate: yCandidate.coordinate,
      from: Math.min(snappedRect.x, yCandidate.reference.x) - safePadding,
      to:
        Math.max(
          snappedRect.x + snappedRect.width,
          yCandidate.reference.x + yCandidate.reference.width,
        ) + safePadding,
      referenceId: yCandidate.reference.id,
      draggedAnchor: yCandidate.draggedAnchor,
      referenceAnchor: yCandidate.referenceAnchor,
    });
  }

  return { position, guides };
}

function nodeRect(node: Node, position = node.position): AlignmentRect | undefined {
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return undefined;
  }
  return { id: node.id, x: position.x, y: position.y, width, height };
}

function isDraggingPositionChange(change: NodeChange): change is NodePositionChange {
  return change.type === 'position' && !!change.dragging && !!change.position;
}

export function snapNodeChangesToAlignment({
  changes,
  nodes,
  activeNodeId,
  tolerance,
  padding,
}: SnapNodeChangesInput): SnapNodeChangesResult {
  const draggingChanges = changes.filter(isDraggingPositionChange);
  if (draggingChanges.length !== 1 || draggingChanges[0].id !== activeNodeId) {
    return { changes, guides: [] };
  }

  const positionChange = draggingChanges[0];
  const draggedNode = nodes.find((node) => node.id === activeNodeId);
  if (!draggedNode || !positionChange.position) return { changes, guides: [] };
  const dragged = nodeRect(draggedNode, positionChange.position);
  if (!dragged) return { changes, guides: [] };

  const others = nodes.flatMap((node) => {
    if (node.id === activeNodeId || node.hidden) return [];
    const rect = nodeRect(node);
    return rect ? [rect] : [];
  });
  const result = calculateAlignmentSnap({ dragged, others, tolerance, padding });
  const delta = {
    x: result.position.x - positionChange.position.x,
    y: result.position.y - positionChange.position.y,
  };

  const snappedChanges = changes.map((change) => {
    if (change !== positionChange || change.type !== 'position') return change;
    return {
      ...change,
      position: result.position,
      positionAbsolute: change.positionAbsolute
        ? {
            x: change.positionAbsolute.x + delta.x,
            y: change.positionAbsolute.y + delta.y,
          }
        : undefined,
    };
  });
  return { changes: snappedChanges, guides: result.guides };
}
