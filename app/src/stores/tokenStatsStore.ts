import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';

// Token 用量统计:只统计用量不计费,永久累计持久化。维度——
// byModel(按模型 total) / byNode(按节点 total) / masterTotal(姬子总控) + grandTotal(全局)
// + byScene(姬子按场景细分:导入/规划/诊断/工具生成 等)。
// 记录点在两条 LLM 链路的唯一入口:节点走 modelCalls.callNodeModelWithPrompt,姬子走 llmClient.chat。
export type JiziScene =
  | 'import-skill'
  | 'skill-select'
  | 'memory-extract'
  | 'memory-select'
  | 'search-plan'
  | 'search-quality'
  | 'turn-plan'
  | 'tool-generate'
  | 'tool-smoke'
  | 'orchestrate'
  | 'master-reply'
  | 'input-rewrite'
  | 'session-summary'
  | 'session-title';

interface TokenStatsState {
  byModel: Record<string, number>; // modelId → 累计 total token
  byNode: Record<string, { label: string; total: number }>; // nodeId → 累计
  masterTotal: number; // 姬子(总控)累计
  grandTotal: number; // 全局累计
  byScene: Record<string, number>; // 姬子按场景累计(import-skill/skill-select/...)

  recordNode: (nodeId: string, label: string, model: string, total: number) => void;
  recordMaster: (model: string, total: number, scene?: JiziScene) => void;
  reset: () => void;
}

export const useTokenStatsStore = create<TokenStatsState>()(
  persist(
    (set) => ({
      byModel: {},
      byNode: {},
      masterTotal: 0,
      grandTotal: 0,
      byScene: {},

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

      recordMaster: (model, total, scene) => {
        if (!(total > 0)) return;
        set((s) => {
          const next: Partial<TokenStatsState> = {
            masterTotal: s.masterTotal + total,
            byModel: { ...s.byModel, [model]: (s.byModel[model] ?? 0) + total },
            grandTotal: s.grandTotal + total,
          };
          if (scene) {
            next.byScene = {
              ...s.byScene,
              [scene]: (s.byScene[scene] ?? 0) + total,
            };
          }
          return next;
        });
      },

      reset: () =>
        set({ byModel: {}, byNode: {}, masterTotal: 0, grandTotal: 0, byScene: {} }),
    }),
    {
      name: 'multi-agent-token-stats',
      storage: createProjectStorage(),
      version: 2,
      // 只持久化数据字段,不入 action。
      partialize: (s) => ({
        byModel: s.byModel,
        byNode: s.byNode,
        masterTotal: s.masterTotal,
        grandTotal: s.grandTotal,
        byScene: s.byScene,
      }),
      migrate: (persisted: unknown, _fromVersion: number) => {
        const p = (persisted ?? {}) as Partial<TokenStatsState>;
        return {
          byModel: p.byModel ?? {},
          byNode: p.byNode ?? {},
          masterTotal: p.masterTotal ?? 0,
          grandTotal: p.grandTotal ?? 0,
          byScene: p.byScene ?? {},
        };
      },
    },
  ),
);
