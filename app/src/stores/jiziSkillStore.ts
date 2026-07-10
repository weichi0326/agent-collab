import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';

interface JiziSkillSettingsState {
  disabledSkillIds: string[];
  setSkillEnabled: (id: string, enabled: boolean) => void;
}

export const useJiziSkillSettingsStore = create<JiziSkillSettingsState>()(
  persist(
    (set) => ({
      disabledSkillIds: [],

      setSkillEnabled: (id, enabled) =>
        set((state) => {
          const exists = state.disabledSkillIds.includes(id);
          if (enabled && exists) {
            return {
              disabledSkillIds: state.disabledSkillIds.filter((item) => item !== id),
            };
          }
          if (!enabled && !exists) {
            return { disabledSkillIds: [...state.disabledSkillIds, id] };
          }
          return {};
        }),
    }),
    {
      name: 'multi-agent-jizi-skills',
      storage: createProjectStorage(),
      version: 1,
    },
  ),
);

export function enabledJiziSkillIds(ids: string[]): string[] {
  const disabled = new Set(useJiziSkillSettingsStore.getState().disabledSkillIds);
  return ids.filter((id) => !disabled.has(id));
}
