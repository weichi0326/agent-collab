import { create } from 'zustand';

// Agent 配置 Modal 的开合状态:左侧库与画布节点双击共用同一入口。
// 纯 UI 临时态,不持久化;selector 取的都是原始值,引用天然稳定(无白屏风险)。
interface AgentEditorState {
  open: boolean;
  editingId: string | null; // null 表示新建
  openNew: () => void;
  openEdit: (id: string) => void;
  close: () => void;
}

export const useAgentEditorStore = create<AgentEditorState>((set) => ({
  open: false,
  editingId: null,
  openNew: () => set({ open: true, editingId: null }),
  openEdit: (id) => set({ open: true, editingId: id }),
  close: () => set({ open: false, editingId: null }),
}));
