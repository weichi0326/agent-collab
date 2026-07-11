import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';

export interface JiziSkillUsage {
  count: number;
  lastUsedAt: number;
  lastReason: string;
}

interface JiziSkillUsageState {
  usage: Record<string, JiziSkillUsage>;
  record: (id: string, reason: string) => void;
  remove: (id: string) => void;
}

export const useJiziSkillUsageStore = create<JiziSkillUsageState>()(
  persist(
    (set) => ({
      usage: {},
      record: (id, reason) =>
        set((state) => ({
          usage: {
            ...state.usage,
            [id]: {
              count: (state.usage[id]?.count ?? 0) + 1,
              lastUsedAt: Date.now(),
              lastReason: reason.trim(),
            },
          },
        })),
      remove: (id) =>
        set((state) => {
          const usage = { ...state.usage };
          delete usage[id];
          return { usage };
        }),
    }),
    {
      name: 'multi-agent-jizi-skill-usage',
      storage: createProjectStorage(),
      version: 1,
    },
  ),
);
