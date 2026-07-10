import { create } from 'zustand';
import type { RunArtifact } from '../lib/agentRunner';

// 中止运行后残留产物的清理入口:整图运行(TitleBar)与子图重跑(姬子 rerun 动作)都把残留产物
// 推到这里,由 TitleBar 的「任务已中止」Modal 统一提供「保留/移除产物」。不持久化——瞬态。
export interface AbortedRunArtifacts {
  canvasId: string;
  artifacts: RunArtifact[];
  runId?: string;
}

interface AbortedRunState {
  abortedRun: AbortedRunArtifacts | null;
  setAbortedRun: (run: AbortedRunArtifacts) => void;
  clearAbortedRun: () => void;
}

export const useAbortedRunStore = create<AbortedRunState>((set) => ({
  abortedRun: null,
  setAbortedRun: (abortedRun) => set({ abortedRun }),
  clearAbortedRun: () => set({ abortedRun: null }),
}));
