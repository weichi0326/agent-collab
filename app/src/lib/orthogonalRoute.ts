import { Position } from '@xyflow/react';

export interface RoutePoint {
  x: number;
  y: number;
}

export interface OrthogonalEdgeData extends Record<string, unknown> {
  routePoints?: RoutePoint[];
}

export interface RouteSegment {
  index: number;
  start: RoutePoint;
  end: RoutePoint;
  midpoint: RoutePoint;
  horizontal: boolean;
  length: number;
}

const MAX_ROUTE_POINTS = 64;
const TERMINAL_STUB = 24;
const DOGLEG_OFFSET = 40;

interface SegmentConstraint {
  segmentIndex: number;
  axis: 'x' | 'y';
  minimum?: number;
  maximum?: number;
}

function directedStub(delta: number): number {
  const direction = Math.sign(delta) || 1;
  return direction * Math.min(TERMINAL_STUB, Math.max(1, Math.abs(delta) / 2));
}

function terminalConstraint(
  point: RoutePoint,
  position: Position,
  segmentIndex: number,
): SegmentConstraint {
  if (position === Position.Bottom) {
    return { segmentIndex, axis: 'y', minimum: point.y + TERMINAL_STUB };
  }
  if (position === Position.Top) {
    return { segmentIndex, axis: 'y', maximum: point.y - TERMINAL_STUB };
  }
  if (position === Position.Right) {
    return { segmentIndex, axis: 'x', minimum: point.x + TERMINAL_STUB };
  }
  return {
    segmentIndex,
    axis: 'x',
    maximum: point.x - TERMINAL_STUB,
  };
}

function constrainTerminalApproach(
  points: RoutePoint[],
  source: RoutePoint,
  target: RoutePoint,
  sourcePosition: Position,
  targetPosition: Position,
): RoutePoint[] {
  if (points.length < 4) return points;
  const constraints = [
    terminalConstraint(source, sourcePosition, 1),
    terminalConstraint(target, targetPosition, points.length - 3),
  ];
  const grouped = new Map<string, SegmentConstraint>();

  for (const constraint of constraints) {
    const key = `${constraint.segmentIndex}:${constraint.axis}`;
    const current = grouped.get(key);
    grouped.set(key, {
      segmentIndex: constraint.segmentIndex,
      axis: constraint.axis,
      minimum: Math.max(
        current?.minimum ?? Number.NEGATIVE_INFINITY,
        constraint.minimum ?? Number.NEGATIVE_INFINITY,
      ),
      maximum: Math.min(
        current?.maximum ?? Number.POSITIVE_INFINITY,
        constraint.maximum ?? Number.POSITIVE_INFINITY,
      ),
    });
  }

  const next = points.map((point) => ({ ...point }));
  for (const constraint of grouped.values()) {
    const start = next[constraint.segmentIndex];
    const end = next[constraint.segmentIndex + 1];
    const current = constraint.axis === 'x' ? start.x : start.y;
    const minimum = constraint.minimum ?? Number.NEGATIVE_INFINITY;
    const maximum = constraint.maximum ?? Number.POSITIVE_INFINITY;
    const coordinate =
      minimum <= maximum
        ? Math.min(maximum, Math.max(minimum, current))
        : (minimum + maximum) / 2;
    if (constraint.axis === 'x') {
      start.x = coordinate;
      end.x = coordinate;
    } else {
      start.y = coordinate;
      end.y = coordinate;
    }
  }
  return next;
}

function snapToParallelSegment(
  points: RoutePoint[],
  segmentIndex: number,
  horizontal: boolean,
  coordinate: number,
  tolerance: number,
): number {
  let snapped = coordinate;
  let closestDistance = Math.max(0, tolerance) + Number.EPSILON;
  for (let index = 0; index < points.length - 1; index += 1) {
    if (index === segmentIndex) continue;
    const start = points[index];
    const end = points[index + 1];
    const parallel = horizontal ? start.y === end.y : start.x === end.x;
    if (!parallel) continue;
    const candidate = horizontal ? start.y : start.x;
    const distance = Math.abs(coordinate - candidate);
    if (distance <= tolerance && distance < closestDistance) {
      snapped = candidate;
      closestDistance = distance;
    }
  }
  return snapped;
}

function finitePoint(value: unknown): value is RoutePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<RoutePoint>;
  return (
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

export function readRoutePoints(value: unknown): RoutePoint[] | undefined {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_ROUTE_POINTS) {
    return undefined;
  }
  if (!value.every(finitePoint)) return undefined;
  return value.map(({ x, y }) => ({ x, y }));
}

export function createOrthogonalRoute(
  source: RoutePoint,
  target: RoutePoint,
  sourcePosition: Position,
  _targetPosition: Position,
): RoutePoint[] {
  const horizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right;

  if (horizontal) {
    const middleX = (source.x + target.x) / 2;
    return [
      { ...source },
      { x: middleX, y: source.y },
      { x: middleX, y: target.y },
      { ...target },
    ];
  }

  const middleY = (source.y + target.y) / 2;
  return [
    { ...source },
    { x: source.x, y: middleY },
    { x: target.x, y: middleY },
    { ...target },
  ];
}

export function syncManualRoute(
  points: RoutePoint[],
  source: RoutePoint,
  target: RoutePoint,
  sourcePosition: Position,
  targetPosition: Position,
): RoutePoint[] {
  if (points.length < 2) return [{ ...source }, { ...target }];
  const firstWasHorizontal = points[0].y === points[1].y;
  const lastIndex = points.length - 1;
  const lastWasHorizontal = points[lastIndex - 1].y === points[lastIndex].y;
  const sourceIsHorizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right;
  const targetIsHorizontal =
    targetPosition === Position.Left || targetPosition === Position.Right;
  if (
    firstWasHorizontal !== sourceIsHorizontal ||
    lastWasHorizontal !== targetIsHorizontal
  ) {
    return createOrthogonalRoute(source, target, sourcePosition, targetPosition);
  }

  const next = points.map((point) => ({ ...point }));

  next[0] = { ...source };
  next[lastIndex] = { ...target };
  if (sourceIsHorizontal) next[1].y = source.y;
  else next[1].x = source.x;
  if (targetIsHorizontal) next[lastIndex - 1].y = target.y;
  else next[lastIndex - 1].x = target.x;
  return constrainTerminalApproach(
    next,
    source,
    target,
    sourcePosition,
    targetPosition,
  );
}

export function moveRouteSegment(
  points: RoutePoint[],
  segmentIndex: number,
  pointer: RoutePoint,
  snapTolerance = 8,
): RoutePoint[] {
  if (points.length === 2 && segmentIndex === 0) {
    const [source, target] = points;
    if (source.y === target.y) {
      const firstX = source.x + (target.x - source.x) / 3;
      const secondX = source.x + ((target.x - source.x) * 2) / 3;
      return [
        { ...source },
        { x: firstX, y: source.y },
        { x: firstX, y: pointer.y },
        { x: secondX, y: pointer.y },
        { x: secondX, y: target.y },
        { ...target },
      ];
    }
    const firstY = source.y + (target.y - source.y) / 3;
    const secondY = source.y + ((target.y - source.y) * 2) / 3;
    return [
      { ...source },
      { x: source.x, y: firstY },
      { x: pointer.x, y: firstY },
      { x: pointer.x, y: secondY },
      { x: target.x, y: secondY },
      { ...target },
    ];
  }
  if (
    points.length > 2 &&
    points.length + 2 > MAX_ROUTE_POINTS &&
    (segmentIndex === 0 || segmentIndex === points.length - 2)
  ) {
    return points;
  }
  if (segmentIndex === 0 && points.length > 2) {
    const [source, end] = points;
    if (source.y === end.y) {
      const stubX = source.x + directedStub(end.x - source.x);
      const nextY = snapToParallelSegment(
        points,
        segmentIndex,
        true,
        pointer.y,
        snapTolerance,
      );
      return [
        { ...source },
        { x: stubX, y: source.y },
        { x: stubX, y: nextY },
        { x: end.x, y: nextY },
        ...points.slice(2).map((point) => ({ ...point })),
      ];
    }
    const stubY = source.y + directedStub(end.y - source.y);
    const nextX = snapToParallelSegment(
      points,
      segmentIndex,
      false,
      pointer.x,
      snapTolerance,
    );
    return [
      { ...source },
      { x: source.x, y: stubY },
      { x: nextX, y: stubY },
      { x: nextX, y: end.y },
      ...points.slice(2).map((point) => ({ ...point })),
    ];
  }
  if (segmentIndex === points.length - 2 && points.length > 2) {
    const start = points[segmentIndex];
    const target = points[segmentIndex + 1];
    const prefix = points.slice(0, segmentIndex).map((point) => ({ ...point }));
    if (start.y === target.y) {
      const stubX = target.x - directedStub(target.x - start.x);
      const nextY = snapToParallelSegment(
        points,
        segmentIndex,
        true,
        pointer.y,
        snapTolerance,
      );
      return [
        ...prefix,
        { x: start.x, y: nextY },
        { x: stubX, y: nextY },
        { x: stubX, y: target.y },
        { ...target },
      ];
    }
    const stubY = target.y - directedStub(target.y - start.y);
    const nextX = snapToParallelSegment(
      points,
      segmentIndex,
      false,
      pointer.x,
      snapTolerance,
    );
    return [
      ...prefix,
      { x: nextX, y: start.y },
      { x: nextX, y: stubY },
      { x: target.x, y: stubY },
      { ...target },
    ];
  }
  if (segmentIndex <= 0 || segmentIndex >= points.length - 2) return points;
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return points;

  const next = points.map((point) => ({ ...point }));
  if (start.y === end.y) {
    const nextY = snapToParallelSegment(
      points,
      segmentIndex,
      true,
      pointer.y,
      snapTolerance,
    );
    next[segmentIndex].y = nextY;
    next[segmentIndex + 1].y = nextY;
  } else {
    const nextX = snapToParallelSegment(
      points,
      segmentIndex,
      false,
      pointer.x,
      snapTolerance,
    );
    next[segmentIndex].x = nextX;
    next[segmentIndex + 1].x = nextX;
  }
  return next;
}

export function insertRouteDogleg(
  points: RoutePoint[],
  segmentIndex: number,
  pointer: RoutePoint,
): RoutePoint[] {
  if (
    points.length + 4 > MAX_ROUTE_POINTS ||
    segmentIndex < 0 ||
    segmentIndex >= points.length - 1
  ) {
    return points;
  }
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  const prefix = points.slice(0, segmentIndex + 1).map((point) => ({ ...point }));
  const suffix = points.slice(segmentIndex + 1).map((point) => ({ ...point }));

  if (start.y === end.y) {
    const direction = Math.sign(end.x - start.x) || 1;
    const halfSpan = Math.min(TERMINAL_STUB, Math.abs(end.x - start.x) / 4);
    const minimum = Math.min(start.x, end.x) + halfSpan;
    const maximum = Math.max(start.x, end.x) - halfSpan;
    const center = Math.min(maximum, Math.max(minimum, pointer.x));
    const firstX = center - direction * halfSpan;
    const secondX = center + direction * halfSpan;
    return [
      ...prefix,
      { x: firstX, y: start.y },
      { x: firstX, y: start.y + DOGLEG_OFFSET },
      { x: secondX, y: start.y + DOGLEG_OFFSET },
      { x: secondX, y: start.y },
      ...suffix,
    ];
  }

  const direction = Math.sign(end.y - start.y) || 1;
  const halfSpan = Math.min(TERMINAL_STUB, Math.abs(end.y - start.y) / 4);
  const minimum = Math.min(start.y, end.y) + halfSpan;
  const maximum = Math.max(start.y, end.y) - halfSpan;
  const center = Math.min(maximum, Math.max(minimum, pointer.y));
  const firstY = center - direction * halfSpan;
  const secondY = center + direction * halfSpan;
  return [
    ...prefix,
    { x: start.x, y: firstY },
    { x: start.x + DOGLEG_OFFSET, y: firstY },
    { x: start.x + DOGLEG_OFFSET, y: secondY },
    { x: start.x, y: secondY },
    ...suffix,
  ];
}

export function normalizeRoute(points: RoutePoint[]): RoutePoint[] {
  const compact: RoutePoint[] = [];
  for (const point of points) {
    const previous = compact[compact.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      compact.push({ ...point });
    }
  }

  let index = 1;
  while (index < compact.length - 1) {
    const previous = compact[index - 1];
    const current = compact[index];
    const next = compact[index + 1];
    const collinear =
      (previous.x === current.x && current.x === next.x) ||
      (previous.y === current.y && current.y === next.y);
    if (collinear) compact.splice(index, 1);
    else index += 1;
  }
  return compact;
}

export function routeToPath(points: RoutePoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return [`M ${first.x} ${first.y}`, ...rest.map((point) => `L ${point.x} ${point.y}`)].join(
    ' ',
  );
}

export function routeSegments(points: RoutePoint[]): RouteSegment[] {
  return points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1];
    if (start.x === end.x && start.y === end.y) return [];
    return [
      {
        index,
        start: { ...start },
        end: { ...end },
        midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        horizontal: start.y === end.y,
        length: Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
      },
    ];
  });
}
