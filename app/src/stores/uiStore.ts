import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import type { ModelRef } from '../lib/modelRef';
import type { SettingsSection } from '../settings/settingsCatalog';

// 总 Agent 选用的对话模型(指向 modelStore 中某条已启用模型)
export type MasterModel = ModelRef;

export type AppView = 'workspace' | 'reports' | 'settings';

interface UiState {
  leftWidth: number;
  rightWidth: number;
  masterModel: MasterModel | null;
  // 姬子抽屉是否展开、当前主视图。上提到 store 供编排层在 React 之外读取/切换(如
  // 收起时点通知「去确认」跳回消息页)。二者是瞬态,不持久化(见下方 partialize),
  // 保持刷新后默认收起 / 停留工作区的原行为。
  drawerExpanded: boolean;
  drawerFullscreen: boolean;
  view: AppView;
  settingsSection: SettingsSection;
  settingsDirty: boolean;
  jiziPlacement: 'top' | 'side';
  jiziWidth: number;
  jiziSideCollapsed: boolean;

  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setMasterModel: (m: MasterModel | null) => void;
  setDrawerExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  setDrawerFullscreen: (value: boolean) => void;
  setView: (v: AppView) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setSettingsDirty: (dirty: boolean) => void;
  setJiziPlacement: (p: 'top' | 'side') => void;
  setJiziWidth: (w: number) => void;
  setJiziSideCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export const LEFT_MIN = 220;
export const LEFT_MAX = 460;
export const RIGHT_MIN = 280;
export const RIGHT_MAX = 560;
export const JIZI_MIN = 300;
export const JIZI_MAX = 560;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function partializeUiState(state: UiState) {
  return {
    leftWidth: state.leftWidth,
    rightWidth: state.rightWidth,
    masterModel: state.masterModel,
    drawerFullscreen: state.drawerFullscreen,
    jiziPlacement: state.jiziPlacement,
    jiziWidth: state.jiziWidth,
    jiziSideCollapsed: state.jiziSideCollapsed,
  };
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      leftWidth: 280,
      rightWidth: 340,
      masterModel: null,
      drawerExpanded: false,
      drawerFullscreen: false,
      view: 'workspace',
      settingsSection: 'models',
      settingsDirty: false,
      jiziPlacement: 'top',
      jiziWidth: 360,
      jiziSideCollapsed: false,

      setLeftWidth: (w) => set({ leftWidth: clamp(w, LEFT_MIN, LEFT_MAX) }),
      setRightWidth: (w) => set({ rightWidth: clamp(w, RIGHT_MIN, RIGHT_MAX) }),
      setMasterModel: (m) => set({ masterModel: m }),
      setDrawerExpanded: (v) =>
        set((s) => ({
          drawerExpanded:
            typeof v === 'function' ? v(s.drawerExpanded) : v,
        })),
      setDrawerFullscreen: (drawerFullscreen) => set({ drawerFullscreen }),
      setView: (v) => set({ view: v }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),
      setSettingsDirty: (settingsDirty) => set({ settingsDirty }),
      setJiziPlacement: (jiziPlacement) => set({ jiziPlacement }),
      setJiziWidth: (w) => set({ jiziWidth: clamp(w, JIZI_MIN, JIZI_MAX) }),
      setJiziSideCollapsed: (v) =>
        set((s) => ({
          jiziSideCollapsed:
            typeof v === 'function' ? v(s.jiziSideCollapsed) : v,
        })),
    }),
    {
      name: 'multi-agent-ui',
      storage: createProjectStorage(),
      version: 2,
      // 展开状态与主视图为瞬态；半屏/全屏是用户显示偏好，需要持久化。
      partialize: partializeUiState,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<UiState>;
        if (version < 2) {
          return {
            ...state,
            jiziPlacement: state.jiziPlacement ?? 'top',
            jiziWidth: state.jiziWidth ?? 360,
            jiziSideCollapsed: state.jiziSideCollapsed ?? false,
          };
        }
        return state;
      },
    },
  ),
);
