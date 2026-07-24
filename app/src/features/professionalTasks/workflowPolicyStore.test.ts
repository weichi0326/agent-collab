import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

let isWorkflowFallbackEnabled: typeof import('./workflowPolicyStore').isWorkflowFallbackEnabled;
let useWorkflowPolicyStore: typeof import('./workflowPolicyStore').useWorkflowPolicyStore;

beforeEach(async () => {
  memory.clear();
  vi.resetModules();
  ({ isWorkflowFallbackEnabled, useWorkflowPolicyStore } = await import('./workflowPolicyStore'));
});

describe('professional workflow fallback policy', () => {
  it('defaults to disabled and persists an explicit package workflow choice', () => {
    expect(isWorkflowFallbackEnabled('fictionist', 'fictionist.chapter-draft')).toBe(false);

    useWorkflowPolicyStore.getState().setFallbackEnabled(
      'fictionist',
      'fictionist.chapter-draft',
      true,
    );

    expect(isWorkflowFallbackEnabled('fictionist', 'fictionist.chapter-draft')).toBe(true);
    expect(isWorkflowFallbackEnabled('fictionist', 'fictionist.chapter-continue')).toBe(false);
  });

  it('removes only settings owned by the selected package', () => {
    const state = useWorkflowPolicyStore.getState();
    state.setFallbackEnabled('fictionist', 'draft', true);
    state.setFallbackEnabled('translator', 'translate', true);

    state.removePackagePolicies('fictionist');

    expect(isWorkflowFallbackEnabled('fictionist', 'draft')).toBe(false);
    expect(isWorkflowFallbackEnabled('translator', 'translate')).toBe(true);
  });
});
