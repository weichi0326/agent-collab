import { create } from 'zustand';
import { executeMasterAction } from '../lib/masterActions';
import { useMasterAgentStore } from './masterAgentStore';
import { useAbortedRunStore } from './abortedRunStore';
import { getMessage } from '../lib/appNotify';
import { RunAbortedError } from '../lib/agentRunner';
import { errorMessage } from '../lib/agentRunner/utils';
import {
  actionCustomLabel,
  actionWithCustomValue,
} from '../components/MasterAgentPanel/actionCustomization';
import type {
  ActionChoice,
  PendingActionView,
} from '../components/MasterAgentPanel/types';

// 待确认动作从「会随抽屉卸载而丢失的组件内 state」上提到常驻 store,使编排层在抽屉
// 关闭时也能挂起待确认动作;执行用的 AbortController 放模块级 Map,存活于组件卸载之外。
// 不持久化——待确认动作是瞬态,刷新即失效。
//
// key 是「槽位 id」而非 sessionId:普通对话动作槽位 id=sessionId(一个会话同时只有一张卡),
// 诊断动作槽位 id=incidentId(多个失败共用同一诊断固定会话,按 incident 分槽才不会互相覆盖)。
// 卡片真正所属会话记在 view.sessionId 上,收尾消息据此写回正确会话。

// 模块级执行控制器:key=slotId。不随抽屉卸载清空(与 MasterAgentPanel 的 chat/生成
// 请求各用各的 Map,互不影响)。
const controllers = new Map<string, AbortController>();

interface PendingActionState {
  pendingActions: Record<string, PendingActionView>;
  setPending: (slotId: string, view: PendingActionView) => void;
  setChoice: (slotId: string, choice: ActionChoice) => void;
  setCustomValue: (slotId: string, value: string) => void;
  reset: (slotId: string) => void;
  isRunning: (slotId: string) => boolean;
  abortPending: (slotId: string) => void;
  runPending: (slotId: string, choice?: ActionChoice) => Promise<void>;
}

export const usePendingActionStore = create<PendingActionState>((set, get) => ({
  pendingActions: {},

  setPending: (slotId, view) =>
    set((s) => ({ pendingActions: { ...s.pendingActions, [slotId]: view } })),

  setChoice: (slotId, choice) =>
    set((s) => {
      const current = s.pendingActions[slotId];
      if (!current || current.choice === choice) return s;
      return {
        pendingActions: {
          ...s.pendingActions,
          [slotId]: { ...current, choice },
        },
      };
    }),

  setCustomValue: (slotId, customValue) =>
    set((s) => {
      const current = s.pendingActions[slotId];
      if (!current || current.customValue === customValue) return s;
      return {
        pendingActions: {
          ...s.pendingActions,
          [slotId]: { ...current, customValue },
        },
      };
    }),

  reset: (slotId) =>
    set((s) => {
      const { [slotId]: _removed, ...rest } = s.pendingActions;
      return { pendingActions: rest };
    }),

  isRunning: (slotId) => controllers.has(slotId),

  abortPending: (slotId) => {
    controllers.get(slotId)?.abort();
  },

  runPending: async (slotId, choice) => {
    const pending = get().pendingActions[slotId];
    if (!pending || controllers.has(slotId)) return;

    const master = useMasterAgentStore.getState();
    const selectedChoice = choice ?? pending.choice;
    // 收尾消息写回卡片真正所属会话,而非槽位 id(诊断槽位 id 是 incidentId,并非会话)。
    const sessionId = pending.sessionId;

    if (selectedChoice === 'cancel') {
      master.addMessageToSession(sessionId, {
        role: 'assistant',
        content: '已取消这次操作。',
        status: 'done',
      });
      const cancelledIncidentId = pending.incidentId;
      get().reset(slotId);
      // 取消的是失败诊断的修复卡片 → 把 incident 退回「失败」重新进问题列表(item 2)。
      if (cancelledIncidentId) {
        void import('./orchestratorStore')
          .then((m) => m.useOrchestratorStore.getState().revertToFailed(cancelledIncidentId))
          .catch((e) => console.error('[pendingAction] 取消后退回失败状态出错', e));
      }
      return;
    }

    const needsCustom = selectedChoice === 'custom';
    if (needsCustom && !pending.customValue.trim()) {
      getMessage()?.warning(
        `请填写${actionCustomLabel(pending.action) || '自定义内容'}`,
      );
      return;
    }

    const action = needsCustom
      ? actionWithCustomValue(pending.action, pending.customValue)
      : pending.action;
    const incidentId = pending.incidentId;
    get().reset(slotId);

    const controller = new AbortController();
    controllers.set(slotId, controller);
    const assistantId = master.addMessageToSession(sessionId, {
      role: 'assistant',
      content: '',
      status: 'sending',
    });
    try {
      const done = await executeMasterAction(action, controller.signal);
      useMasterAgentStore
        .getState()
        .updateMessage(assistantId, { content: done, status: 'done' });
      // 工具安装成功(仅在此计数,失败会抛错走 catch 不计数)。
      // 动态 import 避免与 orchestratorStore 形成静态循环依赖。
      if (action.type === 'create-tool') {
        void import('./orchestratorStore')
          .then((m) => {
            const orchestrator = m.useOrchestratorStore.getState();
            orchestrator.recordToolInstalled();
            // 源自失败诊断的安装,回调编排层挂起「重跑画布」待确认。
            if (incidentId) orchestrator.onToolInstalled(incidentId, sessionId);
          })
          .catch((e) => console.error('[pendingAction] 工具安装后回调编排层失败', e));
      }
      // 自愈重跑跑通(全节点成功,未抛错)→ 回读结果把 incident 收尾为「已解决」。
      if (
        incidentId &&
        (action.type === 'run-active-canvas' || action.type === 'rerun-canvas-node')
      ) {
        void import('./orchestratorStore')
          .then((m) => m.useOrchestratorStore.getState().finalizeRepair(incidentId, true))
          .catch((e) => console.error('[pendingAction] 重跑成功收尾 incident 失败', e));
      }
    } catch (err) {
      // 重跑被用户中止且已生成残留产物 → 汇入与整图运行相同的「任务已中止」清理 Modal,
      // 用较温和的措辞而非「操作失败」。
      if (err instanceof RunAbortedError && err.artifacts.length > 0) {
        useAbortedRunStore.getState().setAbortedRun({
          canvasId: err.canvasId ?? '',
          artifacts: err.artifacts,
          runId: err.runId,
        });
        useMasterAgentStore
          .getState()
          .updateMessage(assistantId, {
            content: '已中止本次操作。',
            status: 'done',
          });
      } else {
        const detail = errorMessage(err);
        useMasterAgentStore
          .getState()
          .updateMessage(assistantId, {
            content: `操作失败：${detail}`,
            status: 'error',
          });
      }
      // 自愈重跑仍失败/被中止(抛错)→ 回读结果把 incident 收尾为「失败」,退回问题列表。
      if (
        incidentId &&
        (action.type === 'run-active-canvas' || action.type === 'rerun-canvas-node')
      ) {
        void import('./orchestratorStore')
          .then((m) => m.useOrchestratorStore.getState().finalizeRepair(incidentId, false))
          .catch((e) => console.error('[pendingAction] 重跑失败收尾 incident 失败', e));
      }
    } finally {
      controllers.delete(slotId);
    }
  },
}));
