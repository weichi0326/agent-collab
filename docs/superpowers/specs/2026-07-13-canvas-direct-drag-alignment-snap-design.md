# Canvas Direct Drag And Alignment Snap Design

## Scope

This change is limited to canvas interaction:

- make every selected orthogonal edge segment directly draggable;
- hide the square handle when a segment is too short to contain it;
- snap a dragged node to nearby node edges or centers;
- show red dashed alignment guides while snapping.

It does not change node data, edge persistence, automatic layout, settings, or execution behavior.

## Orthogonal Edge Interaction

Each segment receives a transparent 20 px screen hit target. A horizontal segment moves only vertically and uses an `ns-resize` cursor; a vertical segment moves only horizontally and uses an `ew-resize` cursor. Direct dragging is enabled only after the edge is selected so an initial click still selects the edge without unexpectedly changing its route.

Segments at least 16 screen px long keep the existing 10 px square handle as a discoverability cue. Shorter segments hide the square, but retain the same direct-drag hit target. Hovering a draggable segment lightly highlights only that segment. Double-click dogleg insertion, 8 px route snapping, normalization, undo, reset, persistence, import, and export remain unchanged.

## Node Alignment Snap

During a single-node drag, compare the dragged node's left, horizontal center, right, top, vertical center, and bottom anchors with the same six anchors on every other visible node. Each axis selects the nearest candidate within 8 screen px. Horizontal and vertical snapping are independent, so a node may snap on both axes at once.

The snap tolerance is divided by the current canvas zoom so it remains 8 physical screen px. Exact nearest distance wins. Equal-distance ties prefer matching anchor kinds, such as left-to-left or center-to-center, then retain stable canvas order.

Multi-node group dragging is left unchanged in this iteration to avoid altering relative positions or producing surprising group-box behavior.

## Guides

An active vertical or horizontal snap renders a 1 px muted-red dashed guide in the React Flow viewport. The guide spans the union of the dragged and reference node bounds with 20 screen px padding at both ends. It is non-interactive, appears only while the corresponding snap is active, and clears on drag stop, cancellation, canvas change, or read-only mode.

## State And Data Flow

Pure geometry helpers accept node rectangles, zoom-adjusted tolerance, and padding, then return a snapped position plus zero, one, or two guide descriptors. `CanvasArea` transforms only the active single-node position change before passing it to the existing store. Guide descriptors remain transient React state and are never serialized.

The existing drag-start history snapshot remains the sole undo entry. Snapped positions therefore undo exactly like ordinary node moves.

## Tests

Pure tests cover edge, center, and two-axis snapping; nearest-candidate and tie priority; zoom-adjusted tolerance boundaries; no candidate; and guide extents. Orthogonal route tests cover segment length metadata used to hide short handles. Component-level verification covers direct segment hit targets and guide rendering, followed by the existing full test, lint, build, and browser checks.
