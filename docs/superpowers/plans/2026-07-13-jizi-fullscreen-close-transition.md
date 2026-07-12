# Jizi Fullscreen Close Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close fullscreen Jizi without a white frame or apparent workspace reload.

**Architecture:** Add a transient local closing state that keeps the drawer fullscreen and its chat content mounted after the persisted expanded flag turns off. Animate only the drawer clip boundary, then switch to the existing half-layout class when the exit animation ends.

**Tech Stack:** React 19, TypeScript, Zustand, CSS animations, Vitest.

## Global Constraints

- Keep Jizi sessions and the workspace mounted throughout the transition.
- Do not transform the workspace or React Flow canvas.
- Use the existing Pearl motion duration and easing variables.
- Preserve the five-minute delayed unmount behavior after closing.
- Limit product edits to the drawer display helper, drawer component, stylesheet, and focused tests.

---

### Task 1: Closing Display State

**Files:**
- Modify: `app/src/components/masterDrawerDisplay.ts`
- Modify: `app/src/components/MasterAgentDrawer.test.tsx`

**Interfaces:**
- Extends: `masterDrawerClassName(expanded, fullscreen, fullscreenClosing)`.
- Produces: `shouldKeepDrawerContentOpen(expanded, fullscreenClosing)`.

- [ ] Add failing tests proving the closing state retains fullscreen classes and mounted/open content.
- [ ] Run `npm.cmd test -- --run src/components/MasterAgentDrawer.test.tsx` and verify failure.
- [ ] Implement the minimal display helpers.
- [ ] Run the focused test and verify success.

### Task 2: Two-Phase Close Lifecycle

**Files:**
- Modify: `app/src/components/MasterAgentDrawer.tsx`
- Modify: `app/src/components/MasterAgentDrawer.test.tsx`

**Interfaces:**
- Consumes: display helpers from Task 1.
- Produces: fullscreen close request, closing animation completion, and reopen cancellation behavior.

- [ ] Add failing source assertions for the transient closing state and root animation-end handler.
- [ ] Run the focused test and verify failure.
- [ ] Keep the root fullscreen and content open while closing; clear closing on root animation end or reopen.
- [ ] Run the focused test and verify success.

### Task 3: Pearl Exit Animation

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/components/MasterAgentDrawer.test.tsx`

**Interfaces:**
- Consumes: `.master-drawer--fullscreen-closing` from Task 2.

- [ ] Add failing assertions for a clip-path exit animation using Pearl motion variables.
- [ ] Run the focused test and verify failure.
- [ ] Animate the fullscreen drawer from fully visible to clipped at the top while retaining absolute positioning.
- [ ] Run focused tests and verify success.

### Task 4: Regression And Visual Verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes all behavior from Tasks 1-3.

- [ ] Run `npm.cmd test -- --run` and require all tests to pass.
- [ ] Run `npm.cmd run lint` and require exit code 0 without new warnings.
- [ ] Run `npm.cmd run build` and require exit code 0.
- [ ] Run `git diff --check` and require no whitespace errors.
- [ ] Verify fullscreen close in the local page has no white frame or console error.
