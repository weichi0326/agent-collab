import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import {
  listToolMeta,
  installTool as apiInstallTool,
  removeTool as apiRemoveTool,
  type ToolMeta,
  type InstallToolPayload,
  type InstallToolResult,
} from '../lib/pythonClient';
import { BUILTIN_TOOL_TAGS, mergeToolTags } from '../lib/toolRegistry';

// 自定义工具缓存。运行时以 Python 服务 /tools/meta 返回为准，持久化仅作离线兜底
// （服务未起时仍能展示上次已知的自定义工具与标签，避免 Agent 标签选择器丢项）。

// 稳定空数组：避免 selector 返回新数组引用触发额外重渲染（见记忆:zustand selector 稳定性）。
const EMPTY_TOOLS: ToolMeta[] = [];

interface ToolState {
  customTools: ToolMeta[];
  syncFromService: () => Promise<void>;
  installTool: (payload: InstallToolPayload, signal?: AbortSignal) => Promise<InstallToolResult>;
  removeTool: (name: string) => Promise<InstallToolResult>;
}

export const useToolStore = create<ToolState>()(
  persist(
    (set, get) => ({
      customTools: EMPTY_TOOLS,

      syncFromService: async () => {
        const all = await listToolMeta();
        // 服务不可达时 listToolMeta 返回 []，此时不覆盖缓存，保留离线兜底。
        if (all.length === 0) return;
        set({ customTools: all.filter((t) => !t.builtin) });
      },

      installTool: async (payload, signal) => {
        const res = await apiInstallTool(payload, signal);
        if (res.ok) await get().syncFromService();
        return res;
      },

      removeTool: async (name) => {
        const res = await apiRemoveTool(name);
        if (res.ok) await get().syncFromService();
        return res;
      },
    }),
    {
      name: 'multi-agent-tools',
      storage: createProjectStorage(),
      version: 1,
      // 只持久化缓存本身；action 不入盘。
      partialize: (s) => ({ customTools: s.customTools }),
    },
  ),
);

// 合并内置 + 自定义工具标签供 Select 使用。selector 取稳定引用，合并放 useMemo，
// 避免每次渲染返回新数组导致的重渲染 / 白屏（见记忆:zustand selector 稳定性）。
export function useToolTags(): { value: string; label: string }[] {
  const custom = useToolStore((s) => s.customTools);
  return useMemo(() => mergeToolTags(custom), [custom]);
}

// 无 store 上下文时的兜底（纯逻辑校验用）。
export { BUILTIN_TOOL_TAGS };
