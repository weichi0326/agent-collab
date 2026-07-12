# Unified Node Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every node four bidirectional spatial ports that appear on hover or selection.

**Architecture:** Define four shared handles, enable React Flow loose connections, and make dynamic routing target the same ids. Keep visibility entirely in CSS so all three node components inherit one rule.

**Tech Stack:** React 19, TypeScript, `@xyflow/react`, Vitest, CSS.

## Global Constraints

- Ports represent position only; drag direction determines source and target.
- Keep cycle and duplicate-edge validation unchanged.
- Do not change persisted node or edge schemas.
- Limit product edits to node ports, canvas connection mode, routing ids, and port styles.

---

### Task 1: Four Unified Ports

**Files:**
- Modify: `app/src/components/CanvasArea/NodeRoutingHandles.tsx`
- Create: `app/src/components/CanvasArea/nodePorts.ts`
- Create: `app/src/components/CanvasArea/nodePorts.test.ts`

**Interfaces:**
- Produces: `NODE_PORTS`, containing `port-left`, `port-right`, `port-top`, and `port-bottom`.

- [ ] Write a failing test asserting four unique port ids and four React Flow positions.
- [ ] Run `npm.cmd test -- --run src/components/CanvasArea/nodePorts.test.ts` and verify failure.
- [ ] Replace duplicated routing handles with four handles generated from `NODE_PORTS`.
- [ ] Run the focused test and verify success.

### Task 2: Loose Connections And Dynamic Routing

**Files:**
- Modify: `app/src/components/CanvasArea.tsx`
- Modify: `app/src/components/CanvasArea/edgeRouting.ts`
- Modify: `app/src/components/CanvasArea/edgeRouting.test.ts`

**Interfaces:**
- Consumes: unified `port-*` ids from Task 1.
- Produces: loose source/target behavior and geometry-selected endpoint ids.

- [ ] Update routing tests first to expect `port-left/right/top/bottom`.
- [ ] Run the routing test and verify failure.
- [ ] Enable `ConnectionMode.Loose` and update dynamic routing ids.
- [ ] Run node-port and routing tests and verify success.

### Task 3: Hover And Selection Visibility

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/components/CanvasArea/nodePorts.test.ts`

**Interfaces:**
- Consumes: `.agent-node__handle` on all four unified handles.

- [ ] Add failing source assertions for hidden default state and hover/selected visible selectors.
- [ ] Run the focused test and verify failure.
- [ ] Add shared hidden, hover, selected, top, and bottom styles for agent, gate, and timer nodes.
- [ ] Run the focused tests and verify success.

### Task 4: Regression Verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes all behavior from Tasks 1-3.

- [ ] Run `npm.cmd test -- --run` and require all tests to pass.
- [ ] Run `npm.cmd run lint` and require exit code 0.
- [ ] Run `npm.cmd run build` and require exit code 0.
- [ ] Run `git diff --check` and require no whitespace errors.
- [ ] Verify the local page loads without console errors and port visibility behaves correctly.
