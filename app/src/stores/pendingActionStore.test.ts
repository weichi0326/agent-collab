import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMasterAction } from '../lib/masterActions';
import { useMasterAgentStore } from './masterAgentStore';
import { usePendingActionStore } from './pendingActionStore';
import { createJiziTask } from '../lib/jiziAutonomy/reducer';
import { useJiziAutonomyStore } from './jiziAutonomyStore';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});

vi.mock('../lib/masterActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/masterActions')>();
  return { ...actual, executeMasterAction: vi.fn().mockResolvedValue('完成') };
});

const mockedExecute = vi.mocked(executeMasterAction);

describe('pending destructive confirmation', () => {
  beforeEach(() => {
    storage.clear();
    mockedExecute.mockClear();
    usePendingActionStore.setState({ pendingActions: {} });
    useJiziAutonomyStore.setState({ runs: {} });
  });

  it('requires two confirmations before executing deletion', async () => {
    const sessionId = useMasterAgentStore.getState().newSession();
    usePendingActionStore.getState().setPending(sessionId, {
      action: {
        type: 'plan',
        steps: [{ type: 'delete-canvas', canvasId: 'canvas-1' }],
      },
      choice: 'confirm',
      customValue: '',
      sessionId,
      confirmationStage: 'initial',
    });

    await usePendingActionStore.getState().runPending(sessionId, 'confirm');

    expect(mockedExecute).not.toHaveBeenCalled();
    expect(
      usePendingActionStore.getState().pendingActions[sessionId]
        .confirmationStage,
    ).toBe('destructive-final');

    await usePendingActionStore.getState().runPending(sessionId, 'confirm');

    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(usePendingActionStore.getState().pendingActions[sessionId]).toBeUndefined();
  });

  it('cancels autonomy instead of replanning when execution is aborted', async () => {
    const sessionId = useMasterAgentStore.getState().newSession();
    const action = {
      type: 'plan' as const,
      steps: [{ type: 'create-canvas' as const, name: '研究画布' }],
    };
    useJiziAutonomyStore.setState({
      runs: {
        [sessionId]: {
          task: { ...createJiziTask('创建研究画布'), status: 'executing' },
          steps: action.steps,
        },
      },
    });
    usePendingActionStore.getState().setPending(sessionId, {
      action,
      choice: 'confirm',
      customValue: '',
      sessionId,
      confirmationStage: 'initial',
    });
    mockedExecute.mockRejectedValueOnce(new DOMException('已取消', 'AbortError'));

    await usePendingActionStore.getState().runPending(sessionId, 'confirm');

    expect(useJiziAutonomyStore.getState().runs[sessionId].task.status).toBe(
      'cancelled',
    );
    expect(
      usePendingActionStore.getState().pendingActions[sessionId],
    ).toBeUndefined();
  });
});
