import { describe, expect, it } from 'vitest';
import { createJiziTask, reduceJiziTask } from './reducer';
import type { JiziAutonomyTask } from './types';

describe('Jizi autonomy reducer', () => {
  it('completes the observe, plan, confirm, execute, verify path', () => {
    let task = createJiziTask('创建研究画布');
    task = reduceJiziTask(task, { type: 'observed', fingerprint: 'state-1' });
    task = reduceJiziTask(task, { type: 'plan-ready', destructive: false });
    task = reduceJiziTask(task, { type: 'confirmed' });
    task = reduceJiziTask(task, { type: 'step-succeeded', evidence: '画布已创建' });
    task = reduceJiziTask(task, { type: 'verified', ok: true, evidence: '存在目标画布' });

    expect(task.status).toBe('completed');
    expect(task.executedSteps).toBe(1);
    expect(task.evidence).toContain('存在目标画布');
  });

  it('requires a separate destructive confirmation state', () => {
    let task = createJiziTask('删除旧画布');
    task = reduceJiziTask(task, { type: 'observed', fingerprint: 'state-1' });
    task = reduceJiziTask(task, { type: 'plan-ready', destructive: true });
    task = reduceJiziTask(task, { type: 'confirmed' });
    expect(task.status).toBe('awaiting-destructive-confirmation');
    task = reduceJiziTask(task, { type: 'confirmed' });
    expect(task.status).toBe('executing');
  });

  it('stops at step and replan limits', () => {
    let task: JiziAutonomyTask = { ...createJiziTask('复杂任务'), status: 'executing', executedSteps: 8 };
    task = reduceJiziTask(task, { type: 'step-succeeded', evidence: 'extra' });
    expect(task.status).toBe('failed');

    let replanning: JiziAutonomyTask = { ...createJiziTask('复杂任务'), status: 'verifying', replans: 2 };
    replanning = reduceJiziTask(replanning, { type: 'verified', ok: false, evidence: '未完成' });
    expect(replanning.status).toBe('failed');
  });

  it('allows one repair and stops after two unchanged observations', () => {
    let task: JiziAutonomyTask = { ...createJiziTask('修复任务'), status: 'executing' };
    task = reduceJiziTask(task, { type: 'step-failed', retryable: true, error: '临时错误' });
    expect(task.status).toBe('replanning');
    expect(task.currentStepRepairs).toBe(1);
    task = { ...task, status: 'executing' };
    task = reduceJiziTask(task, { type: 'step-failed', retryable: true, error: '仍失败' });
    expect(task.status).toBe('failed');

    let stalled = createJiziTask('停滞任务');
    stalled = reduceJiziTask(stalled, { type: 'observed', fingerprint: 'same' });
    stalled = { ...stalled, status: 'observing' };
    stalled = reduceJiziTask(stalled, { type: 'observed', fingerprint: 'same' });
    stalled = { ...stalled, status: 'observing' };
    stalled = reduceJiziTask(stalled, { type: 'observed', fingerprint: 'same' });
    expect(stalled.status).toBe('failed');
  });

  it('cancels from any active state', () => {
    const task = reduceJiziTask(
      { ...createJiziTask('任务'), status: 'executing' },
      { type: 'cancelled' },
    );
    expect(task.status).toBe('cancelled');
  });
});
