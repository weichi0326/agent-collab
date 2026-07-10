import { runCanvas } from '../agentRunner';
import { useAgentStore } from '../../stores/agentStore';
import { useCanvasStore } from '../../stores/canvasStore';
import type { MasterAction } from './types';
import {
  activeCanvasId,
  activeEditableCanvasId,
  addNodeToActiveCanvas,
  connectPlanNodes,
  defaultAgentDraft,
  findNodeByLabel,
  normalizedLabel,
  removeNodeWithEdges,
} from './helpers';

export async function executePlanAction(
  action: Extract<MasterAction, { type: 'plan' }>,
  signal?: AbortSignal,
): Promise<string> {
  const aliases = new Map<string, string>();
  let completed = 0;
  let lastCanvasId = useCanvasStore.getState().activeId;

  for (const step of action.steps) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    switch (step.type) {
      case 'create-canvas': {
        useCanvasStore.getState().addCanvas();
        const createdId = useCanvasStore.getState().activeId;
        if (!createdId) throw new Error('创建画布失败');
        if (step.name) useCanvasStore.getState().renameCanvas(createdId, step.name);
        lastCanvasId = createdId;
        completed++;
        break;
      }
      case 'rename-active-canvas': {
        const id = activeCanvasId();
        useCanvasStore.getState().renameCanvas(id, step.name);
        lastCanvasId = id;
        completed++;
        break;
      }
      case 'create-agent':
        useAgentStore.getState().addAgent(defaultAgentDraft(step.name));
        completed++;
        break;
      case 'add-node':
        lastCanvasId = activeEditableCanvasId();
        addNodeToActiveCanvas(step, aliases);
        completed++;
        break;
      case 'connect-nodes':
        connectPlanNodes(activeEditableCanvasId(), step, aliases);
        lastCanvasId = activeCanvasId();
        completed++;
        break;
      case 'delete-node': {
        const canvasId = activeEditableCanvasId();
        const node = findNodeByLabel(canvasId, step.label, aliases);
        removeNodeWithEdges(canvasId, node.id);
        aliases.delete(normalizedLabel(step.label));
        lastCanvasId = canvasId;
        completed++;
        break;
      }
      case 'set-node-output-format': {
        const canvasId = activeEditableCanvasId();
        const node = findNodeByLabel(canvasId, step.label, aliases);
        useCanvasStore
          .getState()
          .updateNodeData(canvasId, node.id, { outputFormat: step.outputFormat });
        lastCanvasId = canvasId;
        completed++;
        break;
      }
      case 'run-active-canvas':
        await runCanvas(activeCanvasId(), signal);
        completed++;
        break;
    }
  }

  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === lastCanvasId);
  return canvas
    ? `已执行计划：${completed} 步完成。当前画布「${canvas.name}」有 ${canvas.nodes.length} 个节点、${canvas.edges.length} 条连线。`
    : `已执行计划：${completed} 步完成。`;
}
