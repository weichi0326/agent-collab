import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  useReactFlow,
  useViewport,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { UndoOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import { useCanvasStore } from '../../stores/canvasStore';
import {
  createOrthogonalRoute,
  insertRouteDogleg,
  moveRouteSegment,
  normalizeRoute,
  readRoutePoints,
  routeSegments,
  routeToPath,
  syncManualRoute,
  type OrthogonalEdgeData,
} from '../../lib/orthogonalRoute';

type OrthogonalEdge = Edge<OrthogonalEdgeData, 'orthogonal'>;

export function EditableOrthogonalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
  markerEnd,
  style,
  data,
  selected,
}: EdgeProps<OrthogonalEdge>) {
  const activeId = useCanvasStore((state) => state.activeId);
  const pushHistory = useCanvasStore((state) => state.pushHistory);
  const setEdgeRoute = useCanvasStore((state) => state.setEdgeRoute);
  const { getZoom, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const source = useMemo(() => ({ x: sourceX, y: sourceY }), [sourceX, sourceY]);
  const target = useMemo(() => ({ x: targetX, y: targetY }), [targetX, targetY]);
  const manualPoints = readRoutePoints(data?.routePoints);
  const points = normalizeRoute(
    manualPoints
      ? syncManualRoute(
          manualPoints,
          source,
          target,
          sourcePosition,
          targetPosition,
        )
      : createOrthogonalRoute(source, target, sourcePosition, targetPosition),
  );
  const path = routeToPath(points);
  const segments = routeSegments(points);

  const startSegmentDrag = (
    segmentIndex: number,
    event: React.PointerEvent<SVGPathElement | HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const initialPoints = points.map((point) => ({ ...point }));
    let historyPushed = false;

    const move = (pointerEvent: PointerEvent) => {
      if (!historyPushed) {
        pushHistory(activeId);
        historyPushed = true;
      }
      const pointer = screenToFlowPosition({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      });
      setEdgeRoute(
        activeId,
        id,
        normalizeRoute(
          syncManualRoute(
            moveRouteSegment(initialPoints, segmentIndex, pointer, 8 / getZoom()),
            source,
            target,
            sourcePosition,
            targetPosition,
          ),
        ),
      );
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };

  const addSegmentBends = (
    segmentIndex: number,
    event: React.MouseEvent<SVGPathElement | HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const next = insertRouteDogleg(points, segmentIndex, pointer);
    if (next === points) return;
    pushHistory(activeId);
    setEdgeRoute(
      activeId,
      id,
      normalizeRoute(
        syncManualRoute(next, source, target, sourcePosition, targetPosition),
      ),
    );
  };

  const restoreAutomaticRoute = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    pushHistory(activeId);
    setEdgeRoute(activeId, id, undefined);
  };

  const resetPoint = points[Math.floor(points.length / 2)] ?? source;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={20}
        style={{
          ...style,
          strokeWidth: selected ? 2.2 : style?.strokeWidth,
        }}
      />
      {selected &&
        segments.map((segment) => {
          const segmentPath = `M ${segment.start.x} ${segment.start.y} L ${segment.end.x} ${segment.end.y}`;
          return (
            <g
              key={`hit-${segment.index}`}
              className="orthogonal-edge__segment"
            >
              <path
                d={segmentPath}
                className="orthogonal-edge__segment-feedback"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={segmentPath}
                className={`orthogonal-edge__segment-hit ${
                  segment.horizontal
                    ? 'orthogonal-edge__segment-hit--horizontal'
                    : 'orthogonal-edge__segment-hit--vertical'
                }`}
                vectorEffect="non-scaling-stroke"
                onPointerDown={(event) => startSegmentDrag(segment.index, event)}
                onDoubleClick={(event) => addSegmentBends(segment.index, event)}
              >
                <title>拖动调整线段，双击增加折点</title>
              </path>
            </g>
          );
        })}
      {selected && (
        <EdgeLabelRenderer>
          {segments.filter((segment) => segment.length * zoom >= 16).map((segment) => (
            <button
              key={segment.index}
              type="button"
              className={`orthogonal-edge__handle nodrag nopan ${
                segment.horizontal
                  ? 'orthogonal-edge__handle--horizontal'
                  : 'orthogonal-edge__handle--vertical'
              }`}
              style={{
                transform: `translate(-50%, -50%) translate(${segment.midpoint.x}px, ${segment.midpoint.y}px)`,
              }}
              title="拖动调整线段，双击增加折点"
              aria-label="拖动调整线段，双击增加折点"
              onPointerDown={(event) => startSegmentDrag(segment.index, event)}
              onDoubleClick={(event) => addSegmentBends(segment.index, event)}
            />
          ))}
          {manualPoints && (
            <button
              type="button"
              className="orthogonal-edge__reset nodrag nopan"
              style={{
                transform: `translate(-50%, -50%) translate(${resetPoint.x + 22}px, ${
                  resetPoint.y - 22
                }px)`,
              }}
              title="恢复自动路线"
              aria-label="恢复自动路线"
              onClick={restoreAutomaticRoute}
            >
              <UndoOutlined />
            </button>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
