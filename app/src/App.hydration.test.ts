import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('app hydration registry', () => {
  it('waits for persisted workflow policies before startup', () => {
    expect(appSource).toContain("import { useWorkflowPolicyStore } from './features/professionalTasks/workflowPolicyStore';");
    expect(appSource).toMatch(/const PERSISTED = \[[\s\S]*?useWorkflowPolicyStore,[\s\S]*?\];/);
    expect(appSource).not.toContain('systemWorkflowInitialization');
  });
});
