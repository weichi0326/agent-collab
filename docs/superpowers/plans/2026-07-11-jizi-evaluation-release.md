# Jizi Evaluation and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the upgraded behavior with deterministic integration tests, a 60-case intelligence corpus, and full frontend/Rust/Python verification.

**Architecture:** A fixture-driven evaluator exercises pure planning, preflight, transaction, verification, memory, and search boundaries without live paid model calls. A small manually runnable suite records model-dependent quality separately.

**Tech Stack:** Vitest, React Testing Library, Cargo test, Python unittest/pytest-compatible tests, JSON fixtures.

## Global Constraints

- Automated CI tests cannot require paid API keys or public network access.
- Model-dependent evaluations must record model/config and never affect deterministic release gates.
- Release gates match the approved design exactly.
- Run every focused frontend `npm.cmd` command in Tasks 1-3 from `app`.

---

### Task 1: Build the deterministic intelligence corpus

**Files:**
- Create: `app/src/lib/jiziEvaluation/types.ts`
- Create: `app/src/lib/jiziEvaluation/cases.ts`
- Create: `app/src/lib/jiziEvaluation/cases.test.ts`

**Interfaces:**
- Produces at least 60 `JiziEvaluationCase` fixtures grouped by canvas, Agent, tool, recovery, search, memory, correction, cancellation, and rollback.

- [ ] **Step 1: Write the failing corpus contract test**

```ts
expect(JIZI_EVALUATION_CASES.length).toBeGreaterThanOrEqual(60);
expect(new Set(JIZI_EVALUATION_CASES.map((item) => item.id)).size).toBe(JIZI_EVALUATION_CASES.length);
for (const required of ['canvas', 'agent', 'tool', 'recovery', 'search', 'memory', 'correction', 'cancellation', 'rollback']) {
  expect(JIZI_EVALUATION_CASES.some((item) => item.category === required)).toBe(true);
}
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziEvaluation/cases.test.ts`

- [ ] **Step 3: Add typed fixtures**

Each fixture includes initial observation, user goal, planned response fixture, confirmations, injected failures, expected terminal state, expected state diff, and expected evidence codes. Do not use placeholder assertions.

- [ ] **Step 4: Run and commit**

Run: `npm.cmd test -- src/lib/jiziEvaluation/cases.test.ts`

```bash
git add app/src/lib/jiziEvaluation/types.ts app/src/lib/jiziEvaluation/cases.ts app/src/lib/jiziEvaluation/cases.test.ts
git commit -m "test(jizi): add intelligence evaluation corpus"
```

### Task 2: Add the end-to-end harness

**Files:**
- Create: `app/src/lib/jiziEvaluation/harness.ts`
- Create: `app/src/lib/jiziEvaluation/harness.test.ts`
- Create: `app/src/lib/jiziEvaluation/report.ts`

**Interfaces:**
- Produces: `runJiziEvaluationCase(caseDef, dependencies)` and aggregate metrics.

- [ ] **Step 1: Write failing harness tests**

Run one successful multi-step case, one rollback case, one destructive confirmation case, one diagnosis rejection, and one user cancellation. Assert terminal state and exact state diff.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziEvaluation/harness.test.ts`

- [ ] **Step 3: Implement dependency-injected harness**

Use real reducers, preflight, transaction journal, and verifiers with in-memory Store adapters. Inject planner replies and tool/search outcomes. Never mock the state-transition logic under evaluation.

- [ ] **Step 4: Add aggregate release metrics**

Report simple success, multi-step success, erroneous tool generation, rollback success, and unconfirmed risky writes. A gate fails when any approved threshold is missed.

- [ ] **Step 5: Run all corpus cases and commit**

Run: `npm.cmd test -- src/lib/jiziEvaluation`

```bash
git add app/src/lib/jiziEvaluation/harness.ts app/src/lib/jiziEvaluation/harness.test.ts app/src/lib/jiziEvaluation/report.ts
git commit -m "test(jizi): add end-to-end intelligence harness"
```

### Task 3: Add integration regression tests for the user workflow

**Files:**
- Create: `app/src/components/MasterAgentPanel/JiziAutonomyFlow.test.tsx`
- Modify: `app/src/components/MasterAgentPanel/MessageList.tsx` only if accessibility selectors are missing.

**Interfaces:**
- Exercises the visible confirmation, progress, deletion confirmation, cancellation, rollback, and evidence states.

- [ ] **Step 1: Write failing UI flow tests**

Use accessible role/name queries. Verify that first delete confirmation does not execute, second confirmation does, cancellation stops queued work, and rollback details remain visible after failure.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/components/MasterAgentPanel/JiziAutonomyFlow.test.tsx`

- [ ] **Step 3: Add only missing accessibility hooks**

Do not duplicate state logic in the component. Add labels or testable semantic structure only where the real UI lacks an accessible selector.

- [ ] **Step 4: Run and commit**

Run: `npm.cmd test -- src/components/MasterAgentPanel/JiziAutonomyFlow.test.tsx`

```bash
git add app/src/components/MasterAgentPanel/JiziAutonomyFlow.test.tsx app/src/components/MasterAgentPanel/MessageList.tsx
git commit -m "test(jizi): cover autonomous confirmation workflow"
```

### Task 4: Run complete release verification

**Files:**
- Modify: `JIZI_INTELLIGENCE_REVIEW.md`
- Create: `JIZI_INTELLIGENCE_UPGRADE_REPORT.md`

**Interfaces:**
- Produces a factual before/after report with command evidence and unresolved limitations.

- [ ] **Step 1: Run frontend verification**

Run from `app`:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run Rust verification**

Run from `app/src-tauri`:

```powershell
cargo test
cargo check
cargo clippy -- -D warnings
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run Python verification**

Run from project root using the configured virtual environment Python:

```powershell
.venv\Scripts\python.exe -m unittest discover -s python/tests -p "test_*.py"
```

Expected: all tests PASS.

- [ ] **Step 4: Run the release-gate evaluator**

Run: `npm.cmd test -- src/lib/jiziEvaluation`

Expected gates: simple success at least 95%, multi-step success at least 80%, erroneous tool generation below 3%, rollback 100% for rollback-capable cases, and zero unconfirmed high-risk writes.

- [ ] **Step 5: Write the evidence report**

Record exact test counts, command exit status, remaining non-rollbackable effects, model-dependent gaps, and the revised intelligence score. Do not claim capabilities not covered by tests.

- [ ] **Step 6: Commit**

```bash
git add JIZI_INTELLIGENCE_REVIEW.md JIZI_INTELLIGENCE_UPGRADE_REPORT.md
git commit -m "docs: report Jizi intelligence upgrade verification"
```
