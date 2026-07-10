import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import type { ModelRef } from '../lib/modelRef';

// 总 Agent 选用的对话模型(指向 modelStore 中某条已启用模型)
export type MasterModel = ModelRef;

export type AppView = 'workspace' | 'reports';

interface UiState {
  leftWidth: number;
  rightWidth: number;
  masterModel: MasterModel | null;
  // 姬子抽屉是否展开、当前主视图。上提到 store 供编排层在 React 之外读取/切换(如
  // 收起时点通知「去确认」跳回消息页)。二者是瞬态,不持久化(见下方 partialize),
  // 保持刷新后默认收起 / 停留工作区的原行为。
  drawerExpanded: boolean;
  view: AppView;

  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setMasterModel: (m: MasterModel | null) => void;
  setDrawerExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  setView: (v: AppView) => void;
}

export const LEFT_MIN = 220;
export const LEFT_MAX = 460;
export const RIGHT_MIN = 280;
export const RIGHT_MAX = 560;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      leftWidth: 280,
      rightWidth: 340,
      masterModel: null,
      drawerExpanded: false,
      view: 'workspace',

      setLeftWidth: (w) => set({ leftWidth: clamp(w, LEFT_MIN, LEFT_MAX) }),
      setRightWidth: (w) => set({ rightWidth: clamp(w, RIGHT_MIN, RIGHT_MAX) }),
      setMasterModel: (m) => set({ masterModel: m }),
      setDrawerExpanded: (v) =>
        set((s) => ({
          drawerExpanded:
            typeof v === 'function' ? v(s.drawerExpanded) : v,
        })),
      setView: (v) => set({ view: v }),
    }),
    {
      name: 'multi-agent-ui',
      storage: createProjectStorage(),
      version: 1,
      // drawerExpanded / view 为瞬态,不入盘(避免刷新后自动展开抽屉或停在报表页)。
      partialize: (s) => ({
        leftWidth: s.leftWidth,
        rightWidth: s.rightWidth,
        masterModel: s.masterModel,
      }),
    },
  ),
);
