import type { MasterAction } from '../masterActions';

type PendingPlanHandler = (
  sessionId: string,
  action: Extract<MasterAction, { type: 'plan' }>,
) => void;

let handler: PendingPlanHandler | null = null;

export function registerAutonomyPendingHandler(next: PendingPlanHandler): void {
  handler = next;
}

export function requestAutonomyPendingPlan(
  sessionId: string,
  action: Extract<MasterAction, { type: 'plan' }>,
): void {
  if (!handler) throw new Error('自主任务确认桥尚未初始化');
  handler(sessionId, action);
}
