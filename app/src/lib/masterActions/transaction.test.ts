import { describe, expect, it } from 'vitest';
import { executeStepTransaction } from './transaction';

describe('executeStepTransaction', () => {
  it('restores the exact snapshot when a later step fails', async () => {
    let state = { canvases: ['original'], agents: ['agent-original'] };
    const snapshot = structuredClone(state);

    const result = await executeStepTransaction({
      steps: ['change-canvas', 'fail-agent'],
      capture: () => structuredClone(state),
      execute: async (step) => {
        if (step === 'change-canvas') state.canvases.push('new');
        if (step === 'fail-agent') throw new Error('agent update failed');
      },
      restore: async (saved) => {
        state = structuredClone(saved);
      },
    });

    expect(state).toEqual(snapshot);
    expect(result).toMatchObject({
      ok: false,
      completedSteps: 1,
      failedStep: 1,
      error: 'agent update failed',
      rollback: 'succeeded',
    });
  });

  it('reports rollback failure without hiding the original error', async () => {
    const result = await executeStepTransaction({
      steps: ['fail'],
      capture: () => ({ value: 1 }),
      execute: async () => {
        throw new Error('execution failed');
      },
      restore: async () => {
        throw new Error('restore failed');
      },
    });

    expect(result.error).toBe('execution failed');
    expect(result.rollback).toBe('failed');
    expect(result.rollbackDetails).toContain('restore failed');
  });
});
