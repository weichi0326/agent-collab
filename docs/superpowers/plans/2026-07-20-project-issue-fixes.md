# Project Issue Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按性价比从高到低，用最小改动修复本轮审计发现的 15 个问题，并在修完后再次自检。

**Architecture:** 优先修用户会真实踩坑的问题：卡死、数据丢失、列表加载失败、存储膨胀、运行态误删。每个任务只改对应文件，不顺手重构；低优先问题只做小型去重或日志补齐。最终用 `tsc`、`lint`、`vitest`、Rust `cargo check` 以及一次只读复扫验收。

**Tech Stack:** React 19 + TypeScript + Zustand + Vitest + Tauri Rust。

---

## File Structure

- Modify: `app/src/stores/jiziAutonomyStore.ts` — 修复姬子自主循环验证失败后卡在 verifying。
- Modify: `app/src-tauri/src/storage.rs` — skill 覆盖前备份；skill 列表读取单文件容错；批量写入覆盖同样备份。
- Modify: `app/src/stores/masterAgentStore.ts` — 删除会话跳过诊断会话；限制 `memoryRecords` 增长；整理记忆时同步淘汰孤儿记录。
- Modify: `app/src/stores/canvasStore.ts` — 删除已保存画布时不强关运行中的打开 tab。
- Modify: `app/src/stores/orchestratorStore.ts` — 自愈流程 await 后检查 incident 是否仍存在；调整 persist merge/migrate 风险点。
- Modify: `app/src/components/MasterAgentPanel/ImportSkillModal.tsx` — 新分析开始前 abort 旧分析；避免烧 token 和污染新结果。
- Modify: `app/src/components/JiziCommandCenter.tsx` — 后台标签页暂停轮询服务状态。
- Modify: `app/src/components/ServiceStatusDot.tsx` — 后台标签页暂停轮询服务状态。
- Modify: `app/src/components/MasterAgentPanel.tsx` — 总规划器失败补 `console.warn`。
- Modify: `app/src/stores/agentStore.ts` — 删除未使用 `TOOL_TAGS`。
- Modify: `app/src/lib/jiziIntentPlanner.ts` — 导出复用 `normalizeChoiceOptions`；使用共享 JSON guard。
- Modify: `app/src/lib/jiziTurnPlanner.ts` — 复用 `normalizeChoiceOptions` 和共享 `asObject` / `textValue`。
- Create: `app/src/lib/jsonGuards.ts` — 统一 `asObject`。
- Modify: `app/src/lib/jiziSearchQuality.ts`、`app/src/lib/jiziSearchPlanner.ts`、`app/src/lib/jiziSkills.ts`、`app/src/lib/toolSmokeTest.ts`、`app/src/lib/toolGenerator.ts` — 改用共享 `asObject`。
- Modify: `app/src/App.tsx` — Tauri event listener promise 补 `.catch`。
- Test: 优先补/改现有测试；没有现成单测覆盖的 Rust 存储问题用 `cargo check` + 前端全量测试兜底，不新建大量集成测试。

---

### Task 1: Fix autonomy verification failure lock-up

**Files:**
- Modify: `app/src/stores/jiziAutonomyStore.ts:67-80`
- Test: `app/src/lib/jiziAutonomy/reducer.test.ts` 或现有 autonomy 相关测试；若没有 store 测试，只跑全量 vitest。

- [ ] **Step 1: Inspect reducer accepted events**

Read `app/src/lib/jiziAutonomy/reducer.ts` and confirm which event transitions are valid from `verifying`.

- [ ] **Step 2: Add failing test if store/reducer has existing coverage**

If `jiziAutonomyStore` has a test file, add this behavior:

```ts
it('marks a succeeded action as failed when verification throws', async () => {
  // arrange a running plan action, mock observeJiziProject to reject
  // act: await finishAction(sessionId, { type: 'plan', steps }, true)
  // assert: task.status is failed (or equivalent terminal failure state), not verifying
});
```

Expected before fix: state remains `verifying` or the promise rejects.

- [ ] **Step 3: Minimal implementation**

Wrap the success verification section only:

```ts
} else {
  get().dispatch(sessionId, {
    type: 'step-succeeded',
    count: run.steps.length,
    evidence: `事务已执行 ${run.steps.length} 个步骤。`,
  });
  try {
    observation = await observeJiziProject();
    const checks = run.steps.map((step) => verifyPlanStep(step, observation!));
    get().dispatch(sessionId, {
      type: 'verified',
      ok: checks.every((check) => check.ok),
      evidence: checks.map((check) => check.evidence).join('；'),
    });
  } catch (verifyError) {
    get().dispatch(sessionId, {
      type: 'verified',
      ok: false,
      evidence: verifyError instanceof Error ? verifyError.message : '验证失败',
    });
  }
}
```

- [ ] **Step 4: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx vitest run app/src/lib/jiziAutonomy
```

Expected: autonomy tests pass. If path has no tests, run `npx vitest run` at final verification.

---

### Task 2: Back up skill files before overwrite

**Files:**
- Modify: `app/src-tauri/src/storage.rs:882-895`
- Test: `cargo check`

- [ ] **Step 1: Reuse existing backup style**

Search in `storage.rs` for the existing backup logic used by `storage_set`.

- [ ] **Step 2: Minimal implementation**

Before `atomic_write(&skill_path, &content)?;`, add backup only when the file already exists:

```rust
if skill_path.exists() {
    let backup_path = skill_path.with_extension("md.bak");
    fs::copy(&skill_path, &backup_path).map_err(|e| e.to_string())?;
}
atomic_write(&skill_path, &content)?;
```

Apply the same backup logic to any batch overwrite path inside `write_jizi_skill_files` if that path writes over an existing `SKILL.md` without calling `overwrite_jizi_skill_file`.

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app/src-tauri && cargo check
```

Expected: Rust compile check passes.

---

### Task 3: Make list_jizi_skill_files tolerant of bad encoding per file

**Files:**
- Modify: `app/src-tauri/src/storage.rs:828-838`
- Test: `cargo check`

- [ ] **Step 1: Minimal implementation**

Replace:

```rust
let content = fs::read_to_string(&skill_path).map_err(|e| e.to_string())?;
```

with:

```rust
let bytes = match fs::read(&skill_path) {
    Ok(bytes) => bytes,
    Err(_) => continue,
};
let content = String::from_utf8_lossy(&bytes).into_owned();
```

This keeps the rest of the list working even if one file is odd.

- [ ] **Step 2: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app/src-tauri && cargo check
```

Expected: Rust compile check passes.

---

### Task 4: Cap master memoryRecords growth

**Files:**
- Modify: `app/src/stores/masterAgentStore.ts:549-607`
- Test: existing master store tests if present; otherwise final full vitest.

- [ ] **Step 1: Add local constant**

Near existing memory constants, add:

```ts
const MEMORY_RECORD_CAP = 200;
```

- [ ] **Step 2: Cap addMemory output**

Replace the array append branch with capped output:

```ts
memoryRecords:
  !content || exists
    ? s.memoryRecords
    : [
        ...s.memoryRecords,
        {
          id: uid('mem'),
          kind: mappedKind,
          content,
          source: { origin: 'conversation' },
          createdAt: now,
          updatedAt: now,
          confidence: 0.8,
          scope: 'global',
          status: 'active',
        },
      ].slice(-MEMORY_RECORD_CAP),
```

- [ ] **Step 3: Keep organizeMemory in sync**

After organizing `memory`, mark records not present in the organized lists as `superseded` or cap the array. Minimal safe version:

```ts
organizeMemory: () =>
  set((s) => ({
    memory: {
      profile: organizeMemoryList(s.memory.profile),
      preferences: organizeMemoryList(s.memory.preferences),
      resources: organizeMemoryList(s.memory.resources),
    },
    memoryRecords: s.memoryRecords.slice(-MEMORY_RECORD_CAP),
  })),
```

- [ ] **Step 4: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 5: Avoid selecting diagnosis session after deleting current session

**Files:**
- Modify: `app/src/stores/masterAgentStore.ts:371-378`
- Test: existing master store tests if present; otherwise final full vitest.

- [ ] **Step 1: Minimal implementation**

Replace:

```ts
const activeId =
  s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId;
```

with:

```ts
const fallback = sessions.find((x) => x.id !== DIAGNOSIS_SESSION_ID);
const activeId = s.activeId === id ? (fallback?.id ?? null) : s.activeId;
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 6: Prevent deleting saved canvas from closing a running tab

**Files:**
- Modify: `app/src/stores/canvasStore.ts:665-680`
- Test: existing canvas store tests if present; otherwise final full vitest.

- [ ] **Step 1: Find running tab marker**

Read `removeCanvas` / `deleteRun` in `canvasStore.ts` and reuse its existing condition. Do not invent a new running-state model.

- [ ] **Step 2: Minimal implementation**

Inside `deleteSaved`, after `openTab` is found and before removing it, add the same guard used elsewhere. Example if the project uses `runId`:

```ts
if (openTab.runId) return s;
```

If existing guard checks `runHistory`, copy that exact check instead.

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 7: Stop orphan self-healing updates after incident is ignored

**Files:**
- Modify: `app/src/stores/orchestratorStore.ts:166-317` and ignore-related helper area.
- Test: existing orchestrator tests if present; otherwise final full vitest.

- [ ] **Step 1: Add tiny helper inside store module**

Add a local helper near `diagnose` logic:

```ts
const hasIncident = (incidents: Incident[], id: string) =>
  incidents.some((incident) => incident.id === id);
```

Use the actual `Incident` type name already defined/imported in this file.

- [ ] **Step 2: Guard after awaits**

After each awaited operation in `diagnose` before writing pending actions or diagnosis messages, add:

```ts
if (!hasIncident(get().incidents, incident.id)) return;
```

Apply after LLM diagnosis await and after any repair/retry await before writing back.

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 8: Abort previous skill import analysis before starting a new one

**Files:**
- Modify: `app/src/components/MasterAgentPanel/ImportSkillModal.tsx:125-130`
- Test: final full vitest.

- [ ] **Step 1: Minimal implementation**

Before creating the new controller, add:

```ts
analysisController.current?.abort();
const controller = new AbortController();
analysisController.current = controller;
```

- [ ] **Step 2: Ignore abort as user-driven cancellation**

In the catch block for analysis, if it currently displays every error, keep abort quiet:

```ts
if (err instanceof DOMException && err.name === 'AbortError') return;
```

If fetch/chat throws plain Error with message containing `aborted`, ignore that too.

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 9: Pause service-status polling when document is hidden

**Files:**
- Modify: `app/src/components/JiziCommandCenter.tsx:197`
- Modify: `app/src/components/ServiceStatusDot.tsx:27`
- Test: final full vitest.

- [ ] **Step 1: Minimal implementation in each poll function**

In each interval callback, before calling `getServiceStatus`, add:

```ts
if (document.hidden) return;
```

Keep the initial foreground fetch behavior unchanged.

- [ ] **Step 2: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 10: Log master turn planning failures

**Files:**
- Modify: `app/src/components/MasterAgentPanel.tsx:742-744`
- Test: final full vitest.

- [ ] **Step 1: Minimal implementation**

Replace the empty catch/comment with:

```ts
} catch (err) {
  console.warn('[planJiziTurnWithLLM]', err);
}
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 11: Delete unused TOOL_TAGS export

**Files:**
- Modify: `app/src/stores/agentStore.ts:31`
- Test: final `tsc`.

- [ ] **Step 1: Confirm no imports**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && grep -R "TOOL_TAGS" -n src --exclude-dir=node_modules
```

Expected: only declaration/comment references.

- [ ] **Step 2: Remove export**

Delete:

```ts
export const TOOL_TAGS = BUILTIN_TOOL_TAGS;
```

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 12: Share normalizeChoiceOptions between planners

**Files:**
- Modify: `app/src/lib/jiziIntentPlanner.ts:32-57`
- Modify: `app/src/lib/jiziTurnPlanner.ts:192-217`
- Test: existing planner tests, especially `jiziTurnPlanner.test.ts`.

- [ ] **Step 1: Export from intent planner**

Change:

```ts
function normalizeChoiceOptions(value: unknown): ChoiceOption[] {
```

to:

```ts
export function normalizeChoiceOptions(value: unknown): ChoiceOption[] {
```

- [ ] **Step 2: Import and delete duplicate in turn planner**

In `jiziTurnPlanner.ts`, import it from `./jiziIntentPlanner` and delete the local duplicate function.

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx vitest run src/lib/jiziTurnPlanner.test.ts
```

Expected: planner tests pass.

---

### Task 13: Share asObject guard across LLM JSON parsers

**Files:**
- Create: `app/src/lib/jsonGuards.ts`
- Modify: `app/src/lib/jiziIntentPlanner.ts`
- Modify: `app/src/lib/jiziSearchQuality.ts`
- Modify: `app/src/lib/jiziSearchPlanner.ts`
- Modify: `app/src/lib/jiziSkills.ts`
- Modify: `app/src/lib/jiziTurnPlanner.ts`
- Modify: `app/src/lib/toolSmokeTest.ts`
- Modify: `app/src/lib/toolGenerator.ts`
- Test: final full vitest.

- [ ] **Step 1: Create shared guard**

Create `app/src/lib/jsonGuards.ts`:

```ts
export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
```

- [ ] **Step 2: Replace local copies**

In each listed file, delete local `asObject` and add:

```ts
import { asObject } from './jsonGuards';
```

Use relative path appropriate to file location; all listed files are in `src/lib`, so `./jsonGuards` is correct.

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 14: Catch Tauri event listener setup failures

**Files:**
- Modify: `app/src/App.tsx:123-128`
- Test: final full vitest.

- [ ] **Step 1: Minimal implementation**

Where `listen(...).then(...)` is called with `void`, append:

```ts
.catch((err) => console.warn('[tauri listen]', err));
```

If there are multiple `listen` calls, apply the same pattern to each unhandled promise in that effect.

- [ ] **Step 2: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 15: Make orchestrator persist merge future-safe

**Files:**
- Modify: `app/src/stores/orchestratorStore.ts:576-583`
- Test: final full vitest.

- [ ] **Step 1: Inspect current persist config**

Read the full persist block and confirm whether `migrate` exists. Current risk is custom `merge` hiding future defaults.

- [ ] **Step 2: Minimal implementation**

Do not redesign persistence. Keep custom merge but ensure it preserves current initial fields explicitly. If current merge is:

```ts
merge: (persisted, current) => ({
  ...current,
  ...(persisted as Partial<OrchestratorState>),
  volatileField: current.volatileField,
}),
```

add a short comment and keep volatile fields from `current`. If there is no actual migration today, do not add one. The goal is to prevent future contributors from assuming default merge semantics.

- [ ] **Step 3: Verify**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit
```

Expected: no TS errors.

---

### Task 16: Final verification and self-audit

**Files:**
- No production changes unless self-audit finds a concrete regression.

- [ ] **Step 1: Frontend checks**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit && npm run lint && npx vitest run
```

Expected:
- `tsc` exits 0.
- `oxlint` exits 0.
- Vitest reports all test files passed.

- [ ] **Step 2: Rust checks**

Run:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app/src-tauri && cargo check
```

Expected: exits 0.

- [ ] **Step 3: Self-audit pass**

Run read-only scans:

```bash
cd /c/Users/Admin/Desktop/agent-collab/app && grep -R "function asObject\|const asObject" -n src/lib && grep -R "TOOL_TAGS" -n src
```

Expected:
- `asObject` local duplicates are gone except `jsonGuards.ts`.
- `TOOL_TAGS` declaration is gone; only comments remain or no hits.

- [ ] **Step 4: Report**

Return a concise Chinese summary with:
- Fixed items grouped by high/mid/low priority.
- Verification commands and results.
- Any item intentionally left unchanged with reason. The target for this plan is none intentionally left unchanged.

---

## Self-Review

- Spec coverage: all 15 reported issues map to Tasks 1-15; final self-check is Task 16.
- Placeholder scan: no TBD/TODO/later placeholders; steps specify exact files and commands.
- Type consistency: shared `asObject` path is `src/lib/jsonGuards.ts`; `normalizeChoiceOptions` remains typed with `ChoiceOption[]`; no new public store field is introduced.
- Scope control: no UI redesign, no persistence rewrite, no broad refactor beyond the two explicitly requested duplicate-code cleanups.
- Commit policy: this plan does not include commit steps because user has not explicitly requested a commit.
