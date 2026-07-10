import type { AgentRunStatus } from '../../stores/canvasStore';

// 门控节点纯判定逻辑:与调度器(agentRunner.runGraph)解耦,便于单测。
// runGraph 内的 isReady / 门控分支复用这两个函数,保证「测的即是用的」。

export type GateType = 'or' | 'and' | 'nor';

type MaybeStatus = AgentRunStatus | undefined;

// 「已定局」状态:success/failed/skipped 都算 settled(不会再变)。
function isSettled(s: MaybeStatus): boolean {
  return s === 'success' || s === 'failed' || s === 'skipped';
}

// 节点是否 ready 可执行:
// - 门控节点:所有上游都 settled 即可判(才能对 failed/skipped 做布尔评估;这是修复
//   「AND 上游有 failed 就卡死」「OR/NOR 兜底不跑」的关键——不要求全 success)。
// - agent 节点:所有上游 success(原逻辑,上游失败则下游本就该跳过)。
export function isNodeReady(
  gateType: GateType | undefined,
  parentStatuses: MaybeStatus[],
): boolean {
  if (gateType) return parentStatuses.every(isSettled);
  return parentStatuses.every((s) => s === 'success');
}

// 门控是否「通过」(放行下游):
// - or : 任一上游 success
// - and: 全部上游 success
// - nor: 全部上游非 success(即没有一个成功→兜底分支生效)
// skipped/failed 都算「非 success」,与「通过=success」的产品定义一致。
export function gatePassed(
  gateType: GateType,
  parentStatuses: MaybeStatus[],
): boolean {
  const successCount = parentStatuses.filter((s) => s === 'success').length;
  if (gateType === 'or') return successCount >= 1;
  if (gateType === 'and') return successCount === parentStatuses.length;
  if (gateType === 'nor') return successCount === 0;
  return false;
}
