# Jizi Foundation and Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate contradictory capability instructions and unsafe diagnosis defaults, then give Jizi a structured, testable view of the current project.

**Architecture:** Extract diagnosis parsing and project observation into pure modules. Runtime prompt formatting consumes the structured observation, while preflight and later verification stages retain the complete object.

**Tech Stack:** TypeScript 6, Zustand 5, Vitest 4, React 19.

## Global Constraints

- Read, analysis, and verification may run automatically; every write requires confirmation.
- Deletion requires a second confirmation.
- Existing canvases, agents, tools, sessions, skills, and memories must remain intact.
- Production behavior changes require a failing test first.
- Run every `npm.cmd` command in this plan from `app`.

---

### Task 1: Correct the default capability contract

**Files:**
- Modify: `app/src/stores/masterAgentStore.ts`
- Create: `app/src/stores/masterAgentStore.test.ts`

**Interfaces:**
- Produces: `DEFAULT_SYSTEM_PROMPT` that accurately describes controlled, confirmed actions.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT } from './masterAgentStore';

describe('DEFAULT_SYSTEM_PROMPT', () => {
  it('describes confirmed project actions without denying them', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('确认');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('画布');
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('还不能直接执行创建/修改画布');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- src/stores/masterAgentStore.test.ts`

Expected: FAIL because the old denial remains.

- [ ] **Step 3: Replace only the stale capability paragraph**

Use this contract in `DEFAULT_SYSTEM_PROMPT`:

```ts
'你可以把明确的项目内操作整理为受控计划；所有写操作必须先由用户确认，删除操作必须再次确认。不要声称未执行的操作已经完成。超出受控动作集时，说明限制并给出可执行建议。'
```

- [ ] **Step 4: Run the focused test and full frontend tests**

Run: `npm.cmd test -- src/stores/masterAgentStore.test.ts`

Expected: PASS.

Run: `npm.cmd test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/stores/masterAgentStore.ts app/src/stores/masterAgentStore.test.ts
git commit -m "fix(jizi): align default prompt with controlled actions"
```

### Task 2: Make failure diagnosis fail closed

**Files:**
- Create: `app/src/lib/orchestrator/diagnosisParser.ts`
- Create: `app/src/lib/orchestrator/diagnosisParser.test.ts`
- Modify: `app/src/stores/orchestratorStore.ts`
- Modify: `app/src/lib/orchestrator/diagnosis.ts`

**Interfaces:**
- Produces: `FailureCategory`, `FailureDiagnosis`, and `parseFailureDiagnosis(reply: string): FailureDiagnosis`.
- Consumes: `cleanJsonFence(reply)`.

- [ ] **Step 1: Write failing parser tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseFailureDiagnosis } from './diagnosisParser';

describe('parseFailureDiagnosis', () => {
  it('returns unknown when JSON is invalid', () => {
    expect(parseFailureDiagnosis('not-json').category).toBe('unknown');
  });

  it('requires evidence before accepting missing-tool', () => {
    const reply = JSON.stringify({ category: 'missing-tool', confidence: 0.9, evidence: '' });
    expect(parseFailureDiagnosis(reply).category).toBe('unknown');
  });

  it('accepts evidenced missing-tool diagnosis', () => {
    const reply = JSON.stringify({
      category: 'missing-tool',
      confidence: 0.9,
      evidence: 'No module named openpyxl',
      summary: '缺少 Excel 读取库',
      capability: '读取 Excel',
    });
    expect(parseFailureDiagnosis(reply).category).toBe('missing-tool');
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/orchestrator/diagnosisParser.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict parsing**

```ts
export type FailureCategory =
  | 'missing-tool'
  | 'tool-parameters'
  | 'node-configuration'
  | 'missing-input'
  | 'model-call'
  | 'network-or-service'
  | 'unknown';

export interface FailureDiagnosis {
  category: FailureCategory;
  confidence: number;
  evidence: string;
  summary: string;
  capability: string;
  suggestedQuery: string;
  consequence: string;
  nextStep: string;
}
```

Parsing rules: catch every parse/type failure; clamp confidence to `0..1`; accept `missing-tool` only when confidence is at least `0.7` and evidence is non-empty; otherwise return an `unknown` object preserving no untrusted fields.

- [ ] **Step 4: Replace permissive orchestrator defaults**

Remove `let needsTool = true` and the empty catch. Call `parseFailureDiagnosis`. Only `category === 'missing-tool'` may continue to search and tool generation. Every other category calls `finishFailed` with category, evidence, original error, and next step.

- [ ] **Step 5: Run focused and full tests**

Run: `npm.cmd test -- src/lib/orchestrator/diagnosisParser.test.ts`

Expected: PASS.

Run: `npm.cmd test`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/orchestrator/diagnosisParser.ts app/src/lib/orchestrator/diagnosisParser.test.ts app/src/lib/orchestrator/diagnosis.ts app/src/stores/orchestratorStore.ts
git commit -m "fix(jizi): fail closed on uncertain diagnoses"
```

### Task 3: Build the structured project observer

**Files:**
- Create: `app/src/lib/jiziProjectObservation.ts`
- Create: `app/src/lib/jiziProjectObservation.test.ts`
- Modify: `app/src/lib/jiziRuntimeContext.ts`

**Interfaces:**
- Produces: `observeJiziProject(): Promise<JiziProjectObservation>` and `formatJiziObservation(observation, budget?): string`.
- Consumes: canvas, agent, model, tool, search, UI, and Skill stores.

- [ ] **Step 1: Write failing observation tests**

The tests must reset stores, create two nodes and one edge, attach model/tool/output/run-state data, then assert that the observation retains stable IDs and the formatter contains the connection and failure evidence while excluding API keys.

```ts
expect(observation.activeCanvas?.edges[0]).toEqual({ sourceId: 'n1', targetId: 'n2' });
expect(observation.activeCanvas?.nodes[1].run.error).toBe('timeout');
expect(formatted).toContain('n1 -> n2');
expect(formatted).not.toContain('secret-key');
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziProjectObservation.test.ts`

Expected: FAIL because the observer does not exist.

- [ ] **Step 3: Implement observation types**

Define focused DTOs for canvas, node, edge, agent, tool, model, service, search, and Skill state. Copy arrays and nested fields so callers cannot mutate Store state. Store prompt text with a maximum per-field length, but retain IDs and full topology.

- [ ] **Step 4: Implement deterministic formatting**

Format active canvas first, then referenced Agents and tools. Default total budget is 16,000 characters. Truncate long prompts and output summaries, never IDs, edge topology, status, or error evidence. Never include API keys or attachment base64.

- [ ] **Step 5: Replace the old thin context builder**

`buildJiziRuntimeContext` becomes:

```ts
export async function buildJiziRuntimeContext(): Promise<string> {
  return formatJiziObservation(await observeJiziProject());
}
```

Keep `buildJiziHealthReport` behavior unchanged in this task.

- [ ] **Step 6: Run tests, lint, and build**

Run: `npm.cmd test -- src/lib/jiziProjectObservation.test.ts`

Run: `npm.cmd test`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

Expected: every command exits `0`.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/jiziProjectObservation.ts app/src/lib/jiziProjectObservation.test.ts app/src/lib/jiziRuntimeContext.ts
git commit -m "feat(jizi): add structured project observation"
```
