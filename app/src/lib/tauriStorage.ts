import { isTauri } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

// 数据持久化适配器:
// - 桌面端(Tauri):经 Rust 命令读写项目文件夹内的 data/<key>.json,随项目迁移。
// - 纯浏览器(npm run dev):回落 localStorage,保证浏览器预览仍可用。
// isTauri() 在模块加载时求值一次即可(运行环境不会中途改变)。
const inTauri = isTauri();

const projectStorage: StateStorage = {
  getItem: async (name) => {
    if (!inTauri) return localStorage.getItem(name);
    try {
      const v = await invoke<string | null>('storage_get', { key: name });
      return v ?? null;
    } catch (e) {
      console.error('[storage_get] 读取失败', name, e);
      return null;
    }
  },
  // 写入/删除失败会导致内存态与磁盘态不一致,若静默吞掉调用方会误以为已落盘。
  // 记录日志后重新抛出,交给 persist 中间件的 rejection(可被上层感知/告警)。
  setItem: async (name, value) => {
    if (!inTauri) {
      localStorage.setItem(name, value);
      return;
    }
    try {
      await invoke('storage_set', { key: name, value });
    } catch (e) {
      console.error('[storage_set] 写入失败', name, e);
      throw e;
    }
  },
  removeItem: async (name) => {
    if (!inTauri) {
      localStorage.removeItem(name);
      return;
    }
    try {
      await invoke('storage_remove', { key: name });
    } catch (e) {
      console.error('[storage_remove] 删除失败', name, e);
      throw e;
    }
  },
};

export function createProjectStorage() {
  return createJSONStorage(() => projectStorage);
}
