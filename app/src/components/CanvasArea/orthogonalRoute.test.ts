import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import {
  createOrthogonalRoute,
  insertRouteDogleg,
  moveRouteSegment,
  normalizeRoute,
  routeSegments,
  routeToPath,
  syncManualRoute,
} from '../../lib/orthogonalRoute';

describe('createOrthogonalRoute', () => {
  it('creates a horizontal-vertical-horizontal route for side ports', () => {
    expect(
      createOrthogonalRoute(
        { x: 100, y: 80 },
        { x: 400, y: 240 },
        Position.Right,
        Position.Left,
      ),
    ).toEqual([
      { x: 100, y: 80 },
      { x: 250, y: 80 },
      { x: 250, y: 240 },
      { x: 400, y: 240 },
    ]);
  });

  it('creates a vertical-horizontal-vertical route for top and bottom ports', () => {
    expect(
      createOrthogonalRoute(
        { x: 120, y: 100 },
        { x: 360, y: 500 },
        Position.Bottom,
        Position.Top,
      ),
    ).toEqual([
      { x: 120, y: 100 },
      { x: 120, y: 300 },
      { x: 360, y: 300 },
      { x: 360, y: 500 },
    ]);
  });
});

describe('manual orthogonal routes', () => {
  it('moves only the perpendicular coordinate of an internal segment', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ];

    expect(moveRouteSegment(points, 1, { x: 180, y: 999 })).toEqual([
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 200 },
      { x: 300, y: 200 },
    ]);
  });

  it('keeps manual bends while reconnecting moved endpoints orthogonally', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 200 },
      { x: 300, y: 200 },
    ];

    expect(
      syncManualRoute(
        points,
        { x: 20, y: 40 },
        { x: 360, y: 260 },
        Position.Right,
        Position.Left,
      ),
    ).toEqual([
      { x: 20, y: 40 },
      { x: 180, y: 40 },
      { x: 180, y: 260 },
      { x: 360, y: 260 },
    ]);
  });

  it('prevents a manual route from entering a top target from below', () => {
    expect(
      syncManualRoute(
        [
          { x: 100, y: 100 },
          { x: 100, y: 500 },
          { x: 300, y: 500 },
          { x: 300, y: 300 },
        ],
        { x: 100, y: 100 },
        { x: 300, y: 300 },
        Position.Bottom,
        Position.Top,
      ),
    ).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 276 },
      { x: 300, y: 276 },
      { x: 300, y: 300 },
    ]);
  });

  it('prevents a manual route from entering a left target from the right', () => {
    expect(
      syncManualRoute(
        [
          { x: 100, y: 100 },
          { x: 500, y: 100 },
          { x: 500, y: 300 },
          { x: 300, y: 300 },
        ],
        { x: 100, y: 100 },
        { x: 300, y: 300 },
        Position.Right,
        Position.Left,
      ),
    ).toEqual([
      { x: 100, y: 100 },
      { x: 276, y: 100 },
      { x: 276, y: 300 },
      { x: 300, y: 300 },
    ]);
  });

  it('rebuilds an orthogonal backbone when dynamic ports change axis', () => {
    const horizontalPoints = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 200 },
      { x: 300, y: 200 },
    ];

    expect(
      syncManualRoute(
        horizontalPoints,
        { x: 20, y: 40 },
        { x: 360, y: 260 },
        Position.Bottom,
        Position.Top,
      ),
    ).toEqual([
      { x: 20, y: 40 },
      { x: 20, y: 150 },
      { x: 360, y: 150 },
      { x: 360, y: 260 },
    ]);
  });

  it('renders an SVG path without curves', () => {
    expect(
      routeToPath([
        { x: 0, y: 10 },
        { x: 80, y: 10 },
        { x: 80, y: 120 },
      ]),
    ).toBe('M 0 10 L 80 10 L 80 120');
  });

  it('turns a straight segment into an adjustable orthogonal dogleg', () => {
    expect(
      moveRouteSegment(
        [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
        0,
        { x: 150, y: 80 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 200, y: 80 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ]);
  });

  it('moves the first segment by inserting bends while keeping the source fixed', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ];

    expect(moveRouteSegment(points, 0, { x: 50, y: 60 })).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ]);
  });

  it('moves the last segment by inserting bends while keeping the target fixed', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ];

    expect(moveRouteSegment(points, 2, { x: 200, y: 260 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 260 },
      { x: 276, y: 260 },
      { x: 276, y: 200 },
      { x: 300, y: 200 },
    ]);
  });

  it('adds a draggable dogleg to any segment', () => {
    expect(
      insertRouteDogleg(
        [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
        0,
        { x: 150, y: 0 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 126, y: 0 },
      { x: 126, y: 40 },
      { x: 174, y: 40 },
      { x: 174, y: 0 },
      { x: 300, y: 0 },
    ]);
  });

  it('does not add bends beyond the route point limit', () => {
    const points = Array.from({ length: 62 }, (_, index) => ({
      x: index,
      y: index % 2,
    }));
    expect(insertRouteDogleg(points, 30, points[30])).toBe(points);
  });

  it('does not split a terminal segment beyond the route point limit', () => {
    const points = Array.from({ length: 64 }, (_, index) => ({
      x: index < 2 ? index * 40 : 40 + Math.floor(index / 2),
      y: index < 2 ? 0 : index % 2,
    }));
    expect(moveRouteSegment(points, 0, { x: 20, y: 60 })).toBe(points);
  });

  it('creates one editable descriptor for every non-empty segment', () => {
    expect(
      routeSegments([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 80 },
        { x: 200, y: 80 },
        { x: 200, y: 240 },
        { x: 260, y: 240 },
      ]).map((segment) => segment.index),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('describes segment endpoints and length for adaptive drag handles', () => {
    expect(
      routeSegments([
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 30 },
      ]),
    ).toEqual([
      {
        index: 0,
        start: { x: 0, y: 0 },
        end: { x: 8, y: 0 },
        midpoint: { x: 4, y: 0 },
        horizontal: true,
        length: 8,
      },
      {
        index: 1,
        start: { x: 8, y: 0 },
        end: { x: 8, y: 30 },
        midpoint: { x: 8, y: 15 },
        horizontal: false,
        length: 30,
      },
    ]);
  });

  it('snaps a dragged segment to parallel neighbors and collapses five controls to one', () => {
    const fiveSegments = [
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 150, y: 100 },
      { x: 150, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 500 },
    ];

    const collapsed = normalizeRoute(
      moveRouteSegment(fiveSegments, 2, { x: 294, y: 200 }, 8),
    );

    expect(collapsed).toEqual([
      { x: 300, y: 0 },
      { x: 300, y: 500 },
    ]);
    expect(routeSegments(collapsed)).toHaveLength(1);
  });

  it('does not snap or remove controls outside the tolerance', () => {
    const fiveSegments = [
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 150, y: 100 },
      { x: 150, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 500 },
    ];

    const unchangedShape = normalizeRoute(
      moveRouteSegment(fiveSegments, 2, { x: 290, y: 200 }, 8),
    );

    expect(routeSegments(unchangedShape)).toHaveLength(5);
    expect(unchangedShape[2].x).toBe(290);
    expect(unchangedShape[3].x).toBe(290);
  });

  it('removes zero-length route segments', () => {
    expect(
      normalizeRoute([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });
});
