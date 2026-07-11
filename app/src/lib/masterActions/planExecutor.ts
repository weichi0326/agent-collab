import { runCanvas } from '../agentRunner';
import { observeJiziProject } from '../jiziProjectObservation';
import { useAgentStore } from '../../stores/agentStore';
import { canvasLimitMessage, useCanvasStore } from '../../stores/canvasStore';
import { useToolStore } from '../../stores/toolStore';
import { getToolSnapshot, type InstallToolPayload } from '../pythonClient';
import type { MasterAction, MasterPlanStep } from './types';
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
import { preflightMasterPlan } from './preflight';
import { executeStepTransaction } from './transaction';

interface LocalPlanSnapshot {
  canvases: ReturnType<typeof useCanvasStore.getState>['canvases'];
  activeId: string;
  history: ReturnType<typeof useCanvasStore.getState>['history'];
  agents: ReturnType<typeof useAgentStore.getState>['agents'];
  tools: InstallToolPayload[];
}

async function captureLocalPlanSnapshot(
  steps: MasterPlanStep[],
  signal?: AbortSignal,
): Promise<LocalPlanSnapshot> {
  const canvas = useCanvasStore.getState();
  const toolNames = Array.from(
    new Set(
      steps.flatMap((step) => {
        if (step.type === 'delete-tool') return [step.toolName];
        if (step.type === 'overwrite-tool') return [step.payload.name];
        return [];
      }),
    ),
  );
  const tools = await Promise.all(
    toolNames.map((name) => getToolSnapshot(name, signal)),
  );
  return {
    canvases: structuredClone(canvas.canvases),
    activeId: canvas.activeId,
    history: structuredClone(canvas.history),
    agents: structuredClone(useAgentStore.getState().agents),
    tools: structuredClone(tools),
  };
}

async function restoreLocalPlanSnapshot(snapshot: LocalPlanSnapshot): Promise<void> {
  useCanvasStore.setState({
    canvases: structuredClone(snapshot.canvases),
    activeId: snapshot.activeId,
    history: structuredClone(snapshot.history),
  });
  useAgentStore.setState({ agents: structuredClone(snapshot.agents) });
  for (const tool of snapshot.tools) {
    const restored = await useToolStore.getState().installTool(tool);
    if (!restored.ok) {
      throw new Error(restored.error || `工具「${tool.name}」恢复失败`);
    }
  }
}

export async function executePlanAction(
  action: Extract<MasterAction, { type: 'plan' }>,
  signal?: AbortSignal,
): Promise<string> {
  const aliases = new Map<string, string>();
  let lastCanvasId = useCanvasStore.getState().activeId;
  const validation = preflightMasterPlan(
    action.steps,
    await observeJiziProject(),
  );
  if (!validation.ok) {
    throw new Error(
      `计划预检未通过：${validation.issues
        .map((issue) => `第 ${issue.stepIndex + 1} 步 ${issue.message}`)
        .join('；')}`,
    );
  }

  const executeStep = async (step: MasterPlanStep) => {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    switch (step.type) {
      case 'create-canvas': {
        const store = useCanvasStore.getState();
        const createdId = store.addCanvas();
        if (!createdId) throw new Error(canvasLimitMessage(store.maxCanvases));
        if (step.name) useCanvasStore.getState().renameCanvas(createdId, step.name);
        lastCanvasId = createdId;
        break;
      }
      case 'rename-active-canvas': {
        const id = activeCanvasId();
        useCanvasStore.getState().renameCanvas(id, step.name);
        lastCanvasId = id;
        break;
      }
      case 'create-agent':
        useAgentStore.getState().addAgent(defaultAgentDraft(step.name));
        break;
      case 'add-node':
        lastCanvasId = activeEditableCanvasId();
        addNodeToActiveCanvas(step, aliases);
        break;
      case 'connect-nodes':
        connectPlanNodes(activeEditableCanvasId(), step, aliases);
        lastCanvasId = activeCanvasId();
        break;
      case 'delete-node': {
        const canvasId = activeEditableCanvasId();
        const node = findNodeByLabel(canvasId, step.label, aliases);
        removeNodeWithEdges(canvasId, node.id);
        aliases.delete(normalizedLabel(step.label));
        lastCanvasId = canvasId;
        break;
      }
      case 'set-node-output-format': {
        const canvasId = activeEditableCanvasId();
        const node = findNodeByLabel(canvasId, step.label, aliases);
        useCanvasStore
          .getState()
          .updateNodeData(canvasId, node.id, { outputFormat: step.outputFormat });
        lastCanvasId = canvasId;
        break;
      }
      case 'update-agent':
        useAgentStore.getState().updateAgent(step.agentId, step.patch);
        break;
      case 'update-node-agent-config':
        useCanvasStore.getState().updateNodeData(step.canvasId, step.nodeId, {
          description: step.patch.description,
          systemPrompt: step.patch.systemPrompt,
          toolTags: step.patch.toolTags,
          modelRef: step.patch.modelRef,
          ...(step.patch.name ? { label: step.patch.name } : {}),
        });
        lastCanvasId = step.canvasId;
        break;
      case 'delete-canvas':
        useCanvasStore.getState().removeCanvas(step.canvasId);
        lastCanvasId = useCanvasStore.getState().activeId;
        break;
      case 'overwrite-tool':
        {
          const installed = await useToolStore.getState().installTool(step.payload, signal);
          if (!installed.ok) throw new Error(installed.error || '工具覆盖失败');
          break;
        }
      case 'delete-tool': {
        const removed = await useToolStore.getState().removeTool(step.toolName);
        if (!removed.ok) throw new Error(removed.error || '工具删除失败');
        break;
      }
      case 'run-active-canvas':
        await runCanvas(activeCanvasId(), signal);
        break;
    }
  };

  const result = await executeStepTransaction({
    steps: validation.normalizedSteps,
    capture: () => captureLocalPlanSnapshot(validation.normalizedSteps, signal),
    execute: executeStep,
    restore: restoreLocalPlanSnapshot,
  });
  if (!result.ok) {
    throw new Error(
      `${result.error ?? '计划执行失败'}；回滚：${
        result.rollback === 'succeeded'
          ? '已恢复执行前状态'
          : result.rollbackDetails.join('；') || result.rollback
      }`,
    );
  }

  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === lastCanvasId);
  return canvas
    ? `已执行计划：${result.completedSteps} 步完成。当前画布「${canvas.name}」有 ${canvas.nodes.length} 个节点、${canvas.edges.length} 条连线。`
    : `已执行计划：${result.completedSteps} 步完成。`;
}
