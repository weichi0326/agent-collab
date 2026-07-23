import { invoke, isTauri } from '@tauri-apps/api/core';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

// 数据持久化适配器:
// - 桌面端(Tauri):经 Rust 命令读写项目文件夹内的 data/<key>.json,随项目迁移。
// - 纯浏览器(npm run dev):回落 localStorage,保证浏览器预览仍可用。
// isTauri() 在模块加载时求值一次即可(运行环境不会中途改变)。
const inTauri = isTauri();

export const PROJECT_STORAGE_KEYS = [
  'multi-agent-canvas',
  'multi-agent-agents',
  'multi-agent-models',
  'multi-agent-search',
  'multi-agent-master',
  'multi-agent-ui',
  'multi-agent-tools',
  'multi-agent-token-stats',
  'multi-agent-orchestrator',
  'multi-agent-jizi-skills',
  'multi-agent-onboarding',
] as const;

export async function clearProjectStorageData(): Promise<void> {
  if (inTauri) {
    await Promise.all(
      [
        ...PROJECT_STORAGE_KEYS.map((key) => invoke('storage_remove', { key })),
        invoke('clear_selected_app_data', {
          input: { itemIds: ['fictionist'] },
        }),
      ],
    );
    return;
  }
  Object.keys(localStorage)
    .filter((key) => key.startsWith('multi-agent-'))
    .forEach((key) => localStorage.removeItem(key));
}

export async function getProjectStorageItem(name: string): Promise<string | null> {
  if (!inTauri) return localStorage.getItem(name);
  try {
    const value = await invoke<string | null>('storage_get', { key: name });
    return value ?? null;
  } catch (error) {
    console.error('[storage_get] 读取失败', name, error);
    throw error;
  }
}

export async function setProjectStorageItem(name: string, value: string): Promise<void> {
  if (!inTauri) {
    localStorage.setItem(name, value);
    return;
  }
  try {
    await invoke('storage_set', { key: name, value });
  } catch (error) {
    console.error('[storage_set] 写入失败', name, error);
    throw error;
  }
}

export async function removeProjectStorageItem(name: string): Promise<void> {
  if (!inTauri) {
    localStorage.removeItem(name);
    return;
  }
  try {
    await invoke('storage_remove', { key: name });
  } catch (error) {
    console.error('[storage_remove] 删除失败', name, error);
    throw error;
  }
}

const projectStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await getProjectStorageItem(name);
    } catch {
      // Persisted master stores keep their historic fallback-to-empty behavior.
      return null;
    }
  },
  // 写入/删除失败会导致内存态与磁盘态不一致,若静默吞掉调用方会误以为已落盘。
  // 记录日志后重新抛出,交给 persist 中间件的 rejection(可被上层感知/告警)。
  setItem: setProjectStorageItem,
  removeItem: removeProjectStorageItem,
};

export function createProjectStorage() {
  return createJSONStorage(() => projectStorage);
}
