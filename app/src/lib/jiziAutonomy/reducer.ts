import type {
  JiziAutonomyEvent,
  JiziAutonomyTask,
} from './types';

const MAX_STEPS = 8;
const MAX_REPAIRS_PER_STEP = 1;
const MAX_REPLANS = 2;
const MAX_UNCHANGED_OBSERVATIONS = 2;

export function createJiziTask(goal: string): JiziAutonomyTask {
  return {
    goal: goal.trim(),
    status: 'observing',
    executedSteps: 0,
    currentStepRepairs: 0,
    replans: 0,
    destructivePlan: false,
    lastObservationFingerprint: null,
    unchangedObservations: 0,
    evidence: [],
  };
}

function fail(task: JiziAutonomyTask, error: string): JiziAutonomyTask {
  return { ...task, status: 'failed', error };
}

export function reduceJiziTask(
  task: JiziAutonomyTask,
  event: JiziAutonomyEvent,
): JiziAutonomyTask {
  if (event.type === 'cancelled') return { ...task, status: 'cancelled' };
  if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;

  if (event.type === 'observed') {
    const unchanged =
      task.lastObservationFingerprint === event.fingerprint
        ? task.unchangedObservations + 1
        : 0;
    if (unchanged >= MAX_UNCHANGED_OBSERVATIONS) {
      return fail(task, '连续两次观察不到项目状态变化，任务已停止。');
    }
    return {
      ...task,
      status: 'planning',
      lastObservationFingerprint: event.fingerprint,
      unchangedObservations: unchanged,
    };
  }

  if (event.type === 'replan-failed') return fail(task, event.error);

  if (event.type === 'plan-ready') {
    if (task.status !== 'planning' && task.status !== 'replanning') return task;
    return {
      ...task,
      status: 'awaiting-confirmation',
      destructivePlan: event.destructive,
    };
  }

  if (event.type === 'confirmed') {
    if (task.status === 'awaiting-destructive-confirmation') {
      return { ...task, status: 'executing' };
    }
    if (task.status !== 'awaiting-confirmation') return task;
    return {
      ...task,
      status:
        task.destructivePlan
          ? 'awaiting-destructive-confirmation'
          : 'executing',
    };
  }

  if (event.type === 'step-succeeded') {
    if (task.status !== 'executing') return task;
    const count = Math.max(1, Math.floor(event.count ?? 1));
    if (task.executedSteps + count > MAX_STEPS) {
      return fail(task, `已达到 ${MAX_STEPS} 步执行上限。`);
    }
    return {
      ...task,
      status: 'verifying',
      executedSteps: task.executedSteps + count,
      currentStepRepairs: 0,
      evidence: [...task.evidence, event.evidence],
    };
  }

  if (event.type === 'step-failed') {
    if (task.status !== 'executing') return task;
    if (event.retryable && task.currentStepRepairs < MAX_REPAIRS_PER_STEP) {
      return {
        ...task,
        status: 'replanning',
        currentStepRepairs: task.currentStepRepairs + 1,
        error: event.error,
      };
    }
    return fail(task, event.error);
  }

  if (event.type === 'verified') {
    if (task.status !== 'verifying') return task;
    const evidence = [...task.evidence, event.evidence];
    if (event.ok) return { ...task, status: 'completed', evidence };
    if (task.replans >= MAX_REPLANS) {
      return fail({ ...task, evidence }, `已达到 ${MAX_REPLANS} 次重新规划上限。`);
    }
    return {
      ...task,
      status: 'replanning',
      replans: task.replans + 1,
      evidence,
    };
  }

  return task;
}
