import { useProfessionalTaskStore } from '../../features/professionalTasks/professionalTaskStore';
import { useWorkflowPolicyStore } from '../../features/professionalTasks/workflowPolicyStore';
import type { CleanableItemId } from '../../lib/systemInfo';
import { useAgentStore } from '../../stores/agentStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { useTokenStatsStore } from '../../stores/tokenStatsStore';

export function reconcileClearedAppData(clearedIds: readonly CleanableItemId[]): void {
  const cleared = new Set(clearedIds);

  if (cleared.has('canvas_agents')) {
    useCanvasStore.getState().clearCanvasData();
    useAgentStore.getState().clearAgents();
  }
  if (cleared.has('runtime')) {
    useCanvasStore.getState().clearRunHistory();
    useTokenStatsStore.getState().reset();
  }
  if (cleared.has('fictionist')) {
    useProfessionalTaskStore.getState().removePackageTasks('fictionist');
    useWorkflowPolicyStore.getState().removePackagePolicies('fictionist');
    useCanvasStore.getState().removePackageCanvases('fictionist');
  }
}
