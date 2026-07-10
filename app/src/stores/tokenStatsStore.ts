import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';

// Token 用量统计:只统计用量不计费,永久累计持久化。三维度——
// byModel(按模型 total) / byNode(按节点 total) / masterTotal(姬子总控) + grandTotal(全局)。
// 记录点在两条 LLM 链路的唯一入口:节点走 modelCalls.callNodeModelWithPrompt,姬子走 llmClient.chat。
interface TokenStatsState {
  byModel: Record<string, number>; // modelId → 累计 total token
  byNode: Record<string, { label: string; total: number }>; // nodeId → 累计
  masterTotal: number; // 姬子(总控)累计
  grandTotal: number; // 全局累计

  recordNode: (nodeId: string, label: string, model: string, total: number) => void;
  recordMaster: (model: string, total: number) => void;
  reset: () => void;
}

export const useTokenStatsStore = create<TokenStatsState>()(
  persist(
    (set) => ({
      byModel: {},
      byNode: {},
      masterTotal: 0,
      grandTotal: 0,

      recordNode: (nodeId, label, model, total) => {
        if (!(total > 0)) return; // 无 usage / 非正数 → 不记录
        set((s) => {
          const prev = s.byNode[nodeId]?.total ?? 0;
          return {
            byNode: { ...s.byNode, [nodeId]: { label, total: prev + total } },
            byModel: {
              ...s.byModel,
              [model]: (s.byModel[model] ?? 0) + total,
            },
            grandTotal: s.grandTotal + total,
          };
        });
      },

      recordMaster: (model, total) => {
        if (!(total > 0)) return;
        set((s) => ({
          masterTotal: s.masterTotal + total,
          byModel: { ...s.byModel, [model]: (s.byModel[model] ?? 0) + total },
          grandTotal: s.grandTotal + total,
        }));
      },

      reset: () =>
        set({ byModel: {}, byNode: {}, masterTotal: 0, grandTotal: 0 }),
    }),
    {
      name: 'multi-agent-token-stats',
      storage: createProjectStorage(),
      version: 1,
      // 只持久化 4 个数据字段,不入 action。
      partialize: (s) => ({
        byModel: s.byModel,
        byNode: s.byNode,
        masterTotal: s.masterTotal,
        grandTotal: s.grandTotal,
      }),
    },
  ),
);
