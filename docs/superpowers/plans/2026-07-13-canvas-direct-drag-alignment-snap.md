# Canvas Direct Drag And Alignment Snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selected orthogonal segments directly draggable and add zoom-stable node edge/center snapping with red dashed guides.

**Architecture:** Keep geometry in pure helpers and transient guide rendering in a focused canvas component. Reuse the existing route movement and node-change pipelines so persistence and undo behavior do not change.

**Tech Stack:** React 19, TypeScript, `@xyflow/react`, Zustand, Vitest, CSS.

## Global Constraints

- Limit product edits to canvas interaction files and their focused tests.
- Use an 8 screen px snap tolerance for routes and nodes.
- Keep long-segment handles at 10 px and hide them below 16 screen px.
- Do not change persisted node or edge schemas.
- Do not alter multi-node group dragging.

---

### Task 1: Alignment Geometry

**Files:**
- Create: `app/src/lib/alignmentSnap.ts`
- Create: `app/src/components/CanvasArea/alignmentSnap.test.ts`

**Interfaces:**
- Produces: `calculateAlignmentSnap(input: AlignmentSnapInput): AlignmentSnapResult`.
- Produces: `AlignmentRect`, `AlignmentGuide`, and `AlignmentSnapResult` types for the canvas layer.

- [ ] **Step 1: Write failing geometry tests**

Cover left/right/top/bottom and center matching, simultaneous x/y snap, nearest-candidate selection, matching-anchor tie priority, strict tolerance behavior, and padded guide bounds using plain rectangles.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run app/src/components/CanvasArea/alignmentSnap.test.ts`

Expected: FAIL because `alignmentSnap.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Define anchors from `{ id, x, y, width, height }`, evaluate candidates independently per axis, sort by distance then matching anchor kind then input order, and return the snapped top-left position plus guide coordinates and reference id.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd test -- --run app/src/components/CanvasArea/alignmentSnap.test.ts`

Expected: all alignment geometry tests PASS.

### Task 2: Node Drag Integration And Guides

**Files:**
- Create: `app/src/components/CanvasArea/AlignmentGuides.tsx`
- Modify: `app/src/components/CanvasArea.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Consumes: `calculateAlignmentSnap` and `AlignmentGuide` from Task 1.
- Produces: `<AlignmentGuides guides={guides} />` rendered inside the React Flow viewport.

- [ ] **Step 1: Add failing source-level integration assertions**

Extend the alignment test to assert the guide component renders vertical and horizontal descriptors and is non-interactive, and that the canvas clears guides at drag stop.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run app/src/components/CanvasArea/alignmentSnap.test.ts`

Expected: FAIL because the component and drag integration are absent.

- [ ] **Step 3: Integrate snapping into position changes**

Track the active dragged node id, bypass snapping when more than one node is being dragged, calculate `8 / getZoom()` tolerance and `20 / getZoom()` guide padding, replace only the active position change, and clear transient guides on stop or canvas change.

- [ ] **Step 4: Render and style guides**

Render viewport-positioned vertical/horizontal lines with `pointer-events: none`, a muted red 1 px dashed stroke, and no persistent state.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npm.cmd test -- --run app/src/components/CanvasArea/alignmentSnap.test.ts`

Expected: all alignment and guide tests PASS.

### Task 3: Direct Segment Dragging

**Files:**
- Modify: `app/src/lib/orthogonalRoute.ts`
- Modify: `app/src/components/CanvasArea/orthogonalRoute.test.ts`
- Modify: `app/src/components/CanvasArea/EditableOrthogonalEdge.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Extends: `RouteSegment` with `start`, `end`, and `length`.
- Consumes: the existing `moveRouteSegment`, `insertRouteDogleg`, and route normalization APIs.

- [ ] **Step 1: Write failing route-segment metadata tests**

Assert horizontal and vertical segments expose exact endpoints and lengths, including a segment shorter than 16 px.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run app/src/components/CanvasArea/orthogonalRoute.test.ts`

Expected: FAIL because segment endpoint and length metadata are missing.

- [ ] **Step 3: Add minimal segment metadata**

Return copied endpoints and Manhattan segment length from `routeSegments` without changing route normalization or persistence.

- [ ] **Step 4: Run the route test and verify GREEN**

Run: `npm.cmd test -- --run app/src/components/CanvasArea/orthogonalRoute.test.ts`

Expected: all orthogonal route tests PASS.

- [ ] **Step 5: Add direct SVG hit targets**

For selected edges, render one transparent 20 px hit path per segment, use orientation-specific cursors, call the existing drag handler on pointer down, and call dogleg insertion on double click. Render the square HTML handle only when `segment.length * zoom >= 16`.

- [ ] **Step 6: Style hover feedback**

Keep the default hit path transparent and apply a restrained accent stroke on hover without changing the visible base edge or layout.

- [ ] **Step 7: Run focused tests**

Run: `npm.cmd test -- --run app/src/components/CanvasArea/orthogonalRoute.test.ts app/src/components/CanvasArea/alignmentSnap.test.ts`

Expected: both test files PASS.

### Task 4: Regression And Browser Verification

**Files:**
- Verify only; no new product files expected.

**Interfaces:**
- Consumes all behavior from Tasks 1-3.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm.cmd test -- --run`

Expected: all test files PASS with no new warnings.

- [ ] **Step 2: Run static checks and production build**

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

Expected: both commands exit successfully; the existing bundle-size advisory may remain.

- [ ] **Step 3: Check patch integrity**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Verify the running UI**

At `http://127.0.0.1:5174/`, verify a selected short segment has no oversized square but remains draggable, long segments remain directly draggable, node edge and center approaches show red dashed guides and snap, guides clear after release, zoom does not change the screen-space threshold, and the console has no errors.
