// 姬子自愈状态机的纯 reducer:从 orchestratorStore 抽出,只接受 incidents 数组作参数,不持有
// store 引用、无副作用,便于独立单测(store 里的方法直接调这些函数,保证「测的即是用的」)。

import type { Incident } from './diagnosis';

// 终态 incident = 已解决/已失败/已忽略;活跃态(诊断中/待确认/修复中)绝不裁剪,
// 否则会掐断进行中的确认/重跑链路。
export function isTerminalIncident(i: Incident): boolean {
  return !!i.ignored || i.status === 'resolved' || i.status === 'failed';
}

// 超出上限时只裁最旧的终态 incident;全是活跃态则宁可暂时超限也不裁。
// 纯函数:返回保留后的列表与被裁掉的 id(diagnosedKeys 去重键清理由调用方按 removedIds 处理)。
export function capIncidents(
  list: Incident[],
  cap: number,
): { kept: Incident[]; removedIds: string[] } {
  if (list.length <= cap) return { kept: list, removedIds: [] };
  let toRemove = list.length - cap;
  const removeIds = new Set<string>();
  for (const inc of list) {
    if (toRemove <= 0) break;
    if (isTerminalIncident(inc)) {
      removeIds.add(inc.id);
      toRemove--;
    }
  }
  if (removeIds.size === 0) return { kept: list, removedIds: [] };
  return {
    kept: list.filter((i) => !removeIds.has(i.id)),
    removedIds: [...removeIds],
  };
}

// 自愈重跑收尾:仅收尾仍在修复窗口(repairing)或已乐观标 resolved 的 incident,其它状态原样返回。
// ok=true → resolved(保留原 diagnosisText);ok=false → failed(改写为失败文案)。
export function reduceFinalizeRepair(
  incidents: Incident[],
  incidentId: string,
  ok: boolean,
): Incident[] {
  const target = incidents.find((i) => i.id === incidentId);
  if (!target) return incidents;
  if (target.status !== 'repairing' && target.status !== 'resolved') {
    return incidents;
  }
  return incidents.map((i) =>
    i.id === incidentId
      ? {
          ...i,
          status: ok ? 'resolved' : 'failed',
          diagnosisText: ok
            ? i.diagnosisText
            : `已自动修复并重跑，但画布仍未跑通，已标记为失败。可在问题列表里忽略或手动排查。原始报错：${i.errorDetail}`,
        }
      : i,
  );
}

// 用户在确认卡片上取消修复:退回「失败」重新进问题列表。仅对仍在等待确认(awaiting-confirm)
// 的 incident 生效,其它状态原样返回。
export function reduceRevertToFailed(
  incidents: Incident[],
  incidentId: string,
): Incident[] {
  const target = incidents.find((i) => i.id === incidentId);
  if (!target || target.status !== 'awaiting-confirm') return incidents;
  return incidents.map((i) =>
    i.id === incidentId
      ? {
          ...i,
          status: 'failed',
          diagnosisText: `你取消了这次修复，已退回失败。可在问题列表里重新处理或忽略。原始报错：${target.errorDetail}`,
        }
      : i,
  );
}

// 手动忽略某失败:标记 ignored(移出问题列表)。停止其运行的副作用由调用方处理。
export function reduceIgnore(
  incidents: Incident[],
  incidentId: string,
): Incident[] {
  return incidents.map((i) =>
    i.id === incidentId ? { ...i, ignored: true } : i,
  );
}
