# Jizi Transactions and Limited Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add expanded controlled actions, deterministic preflight, rollback, destructive confirmation, and an eight-step autonomous state machine.

**Architecture:** Extend the discriminated action union with stable-ID operations. A pure preflight layer normalizes risk before confirmation, a transaction layer owns snapshots and compensation, and a state machine advances only from observed evidence.

**Tech Stack:** TypeScript, Zustand, Vitest, React, Ant Design.

## Global Constraints

- Every write requires confirmation; canvas/tool deletion requires a second confirmation.
- Models never call Stores directly.
- Maximum 8 executed steps, 1 repair per step, and 2 replans per task.
- Built-in tools cannot be overwritten or deleted.
- Run every `npm.cmd` command in this plan from `app`.

---

### Task 1: Extend the controlled action schema and descriptions

**Files:**
- Modify: `app/src/lib/masterActions/types.ts`
- Modify: `app/src/lib/jiziTurnPlanner.ts`
- Modify: `app/src/lib/masterActions/descriptions.ts`
- Modify: `app/src/components/MasterAgentPanel/actionCustomization.ts`
- Modify: `app/src/lib/jiziTurnPlanner.test.ts`

**Interfaces:**
- Produces new `MasterPlanStep` variants: `update-agent`, `update-node-agent-config`, `delete-canvas`, `overwrite-tool`, and `delete-tool`.

- [ ] **Step 1: Add failing parser tests**

Test stable-ID parsing, field normalization, unknown-action rejection, and prevention of name-only delete targets.

```ts
expect(plan.action.steps[0]).toEqual({ type: 'delete-canvas', canvasId: 'canvas-1' });
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziTurnPlanner.test.ts`

- [ ] **Step 3: Add exact action types**

`update-agent` and `update-node-agent-config` carry IDs plus a patch limited to name/description/systemPrompt/modelRef/toolTags. `delete-canvas` carries `canvasId`; `delete-tool` carries `toolName`; `overwrite-tool` carries a complete install payload.

- [ ] **Step 4: Extend parser, descriptions, customization, and risk text**

Reject delete actions without stable IDs. Descriptions must name the target and show every changed field. Delete descriptions must contain `删除后需要再次确认`.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd test -- src/lib/jiziTurnPlanner.test.ts`

Run: `npm.cmd test`

```bash
git add app/src/lib/masterActions/types.ts app/src/lib/jiziTurnPlanner.ts app/src/lib/masterActions/descriptions.ts app/src/components/MasterAgentPanel/actionCustomization.ts app/src/lib/jiziTurnPlanner.test.ts
git commit -m "feat(jizi): expand controlled project actions"
```

### Task 2: Add deterministic preflight and risk classification

**Files:**
- Create: `app/src/lib/masterActions/preflight.ts`
- Create: `app/src/lib/masterActions/preflight.test.ts`

**Interfaces:**
- Produces: `preflightMasterPlan(steps, observation): JiziPlanValidation`.
- Consumes: `JiziProjectObservation` from the foundation plan.

- [ ] **Step 1: Write failing preflight tests**

Cover missing targets, read-only canvases, invalid model references, unavailable tool tags, canvas limit, duplicate edge, built-in tool protection, destructive classification, and a valid mixed plan.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/masterActions/preflight.test.ts`

- [ ] **Step 3: Implement validation result**

Return normalized steps, indexed issues, highest risk, `requiresConfirmation`, and `requiresSecondConfirmation`. Simulate plan effects in memory so a later step may reference an object created earlier in the same plan.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm.cmd test -- src/lib/masterActions/preflight.test.ts`

```bash
git add app/src/lib/masterActions/preflight.ts app/src/lib/masterActions/preflight.test.ts
git commit -m "feat(jizi): preflight plans and classify risk"
```

### Task 3: Add snapshot and compensating transactions

**Files:**
- Create: `app/src/lib/masterActions/transaction.ts`
- Create: `app/src/lib/masterActions/transaction.test.ts`
- Modify: `app/src/stores/canvasStore.ts`
- Modify: `app/src/stores/agentStore.ts`
- Modify: `app/src/lib/masterActions/planExecutor.ts`
- Modify: `app/src/lib/masterActions/executor.ts`

**Interfaces:**
- Produces: `executeMasterTransaction(plan, dependencies, signal): Promise<JiziTransactionResult>`.
- Adds Store actions `replaceWorkspaceCanvases(snapshot)` and `replaceAgents(snapshot)` for atomic restoration.

- [ ] **Step 1: Write failing rollback tests**

Inject executors so step two throws after step one changes state. Assert exact restoration of canvases, active ID, saved canvases, and Agents. Test tool overwrite compensation by asserting the previous payload is reinstalled after failure.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/masterActions/transaction.test.ts`

- [ ] **Step 3: Add atomic Store restoration actions**

Restoration must deep-clone arrays and preserve unrelated run history. It must reject restoring while a targeted canvas is actively running.

- [ ] **Step 4: Implement transaction journal**

Journal local snapshots before the first write. Before tool overwrite/delete, fetch and retain complete custom tool metadata/code; register compensation in reverse order. Return rollback status and details without hiding the original error.

- [ ] **Step 5: Route plan execution through transactions**

Keep direct read/run-only actions unchanged. All mutating `plan` actions call preflight, then transaction execution. Place `run-active-canvas` last; reject plans that put it before writes.

- [ ] **Step 6: Run focused and full verification**

Run: `npm.cmd test -- src/lib/masterActions/transaction.test.ts`

Run: `npm.cmd test`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/masterActions/transaction.ts app/src/lib/masterActions/transaction.test.ts app/src/stores/canvasStore.ts app/src/stores/agentStore.ts app/src/lib/masterActions/planExecutor.ts app/src/lib/masterActions/executor.ts
git commit -m "feat(jizi): execute plans with rollback"
```

### Task 4: Enforce destructive second confirmation

**Files:**
- Modify: `app/src/components/MasterAgentPanel/types.ts`
- Modify: `app/src/stores/pendingActionStore.ts`
- Modify: `app/src/components/MasterAgentPanel/MessageList.tsx`
- Create: `app/src/stores/pendingActionStore.test.ts`

**Interfaces:**
- Extends `PendingActionView` with `confirmationStage: 'initial' | 'destructive-final'` and preflight details.

- [ ] **Step 1: Write failing Store tests**

Assert that confirming a destructive plan once advances the card but does not call the executor; confirming twice executes; cancelling at either stage resets without execution.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/stores/pendingActionStore.test.ts`

- [ ] **Step 3: Implement the two-stage transition**

The final card must list only destructive steps and use explicit `确认删除` copy. The executor remains unreachable until the final stage.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test -- src/stores/pendingActionStore.test.ts`

Run: `npm.cmd test`

```bash
git add app/src/components/MasterAgentPanel/types.ts app/src/stores/pendingActionStore.ts app/src/components/MasterAgentPanel/MessageList.tsx app/src/stores/pendingActionStore.test.ts
git commit -m "feat(jizi): require second confirmation for deletion"
```

### Task 5: Implement the limited autonomy state machine

**Files:**
- Create: `app/src/lib/jiziAutonomy/types.ts`
- Create: `app/src/lib/jiziAutonomy/reducer.ts`
- Create: `app/src/lib/jiziAutonomy/reducer.test.ts`
- Create: `app/src/lib/jiziAutonomy/verifier.ts`
- Create: `app/src/lib/jiziAutonomy/verifier.test.ts`
- Create: `app/src/stores/jiziAutonomyStore.ts`
- Modify: `app/src/components/MasterAgentPanel.tsx`

**Interfaces:**
- Produces explicit states from the design and `advanceJiziTask(event)` transitions.
- Consumes structured observations, preflight, pending confirmations, and transaction results.

- [ ] **Step 1: Write failing reducer boundary tests**

Test the happy path, new-write replan confirmation, 8-step cap, one repair per step, two-replan cap, cancellation, and two consecutive no-change observations.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziAutonomy/reducer.test.ts`

- [ ] **Step 3: Implement pure state transitions**

Reducer events must carry observations or transaction evidence. Invalid transitions return the same state plus a recorded invariant error; they never execute side effects.

- [ ] **Step 4: Write and implement deterministic verification tests**

Verify canvas existence, names, node fields, edges, Agent fields, tool presence, and run status from observations. Return `{ ok, evidence, retryable }`. Use model-assisted verification only when deterministic checks return `unsupported`.

- [ ] **Step 5: Add the orchestration Store and panel wiring**

The Store owns task state and cancellation controllers. `MasterAgentPanel` starts a task after turn planning, presents pending actions through the existing card, observes after each result, and advances the reducer. It must not embed state-machine rules in JSX.

- [ ] **Step 6: Run full verification and commit**

Run: `npm.cmd test`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

```bash
git add app/src/lib/jiziAutonomy app/src/stores/jiziAutonomyStore.ts app/src/components/MasterAgentPanel.tsx
git commit -m "feat(jizi): add limited autonomous execution loop"
```
