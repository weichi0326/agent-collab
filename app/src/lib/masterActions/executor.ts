import type { Edge, Node } from '@xyflow/react';
import { uid } from '../id';
import { rerunCanvasNode } from '../agentRunner';
import { runCanvasWithSystemFallback } from '../../features/professionalTasks/systemWorkflowExecution';
import { useAgentStore } from '../../stores/agentStore';
import { canvasLimitMessage, useCanvasStore } from '../../stores/canvasStore';
import { useToolStore } from '../../stores/toolStore';
import { useUiStore } from '../../stores/uiStore';
import { useModelStore } from '../../stores/modelStore';
import type { MasterAction } from './types';
import {
  activeCanvasId,
  defaultAgentDraft,
  nodeFromAgentSpec,
} from './helpers';
import { executePlanAction } from './planExecutor';
import { getProvider } from '../providers';
import { repairGeneratedToolAfterSmokeFailure, runToolSmokeTest } from '../toolSmokeTest';

export async function executeMasterAction(
  action: MasterAction,
  signal?: AbortSignal,
): Promise<string> {
  const canvasStore = useCanvasStore.getState();

  if (action.type === 'plan') {
    return executePlanAction(action, signal);
  }

  if (action.type === 'run-active-canvas') {
    const id = activeCanvasId();
    const result = await runCanvasWithSystemFallback(id, signal);
    return `当前画布运行完成：${result.nodeCount} 个节点，写出 ${result.writtenCount} 个文件。`;
  }

  if (action.type === 'rerun-canvas-node') {
    const result = await rerunCanvasNode(
      action.runTabId,
      action.nodeId,
      action.sourceCanvasId,
      signal,
    );
    return `已就地重跑失败节点及其下游：${result.nodeCount} 个节点，写出 ${result.writtenCount} 个文件。`;
  }

  if (action.type === 'create-canvas') {
    const createdId = canvasStore.addCanvas();
    if (!createdId) throw new Error(canvasLimitMessage(canvasStore.maxCanvases));
    if (action.name && createdId) {
      useCanvasStore.getState().renameCanvas(createdId, action.name);
    }
    return action.name ? `已创建画布「${action.name}」。` : '已创建新画布。';
  }

  if (action.type === 'create-workflow-canvas') {
    const createdId = canvasStore.addCanvas();
    if (!createdId) throw new Error(canvasLimitMessage(canvasStore.maxCanvases));
    if (action.name) {
      useCanvasStore.getState().renameCanvas(createdId, action.name);
    }

    const nodes = action.nodes.map((spec, index) => nodeFromAgentSpec(spec, index));
    const edges: Edge[] = action.connectSequential
      ? nodes.slice(0, -1).map((node, index) => ({
          id: uid('edge'),
          source: node.id,
          target: nodes[index + 1].id,
        }))
      : [];
    useCanvasStore.getState().addGraph(createdId, nodes, edges);

    const name = action.name ?? '新画布';
    return `已创建画布「${name}」，添加 ${nodes.length} 个节点，并连接 ${edges.length} 条线。`;
  }

  if (action.type === 'rename-active-canvas') {
    const id = activeCanvasId();
    useCanvasStore.getState().renameCanvas(id, action.name);
    return `已将当前画布重命名为「${action.name}」。`;
  }

  if (action.type === 'create-tool') {
    const install = async (tool: typeof action) => {
      const res = await useToolStore.getState().installTool(
        {
          name: tool.name,
          description: tool.description,
          tags: tool.tags,
          dependencies: tool.dependencies,
          implementation: tool.implementation,
          capabilities: tool.capabilities,
          code: tool.code,
        },
        signal,
      );
      if (!res.ok) throw new Error(res.error || '工具安装失败');
    };

    let currentTool = action;
    await install(currentTool);
    const repairNotes: string[] = [];
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const smoke = await runToolSmokeTest(currentTool, signal);
      if (smoke.ok) {
        return repairNotes.length === 0
          ? `已生成并安装工具「${action.name}」，自动试运行通过。`
          : `已生成并安装工具「${action.name}」。试运行曾失败 ${repairNotes.length} 次，姬子已自动修复并覆盖安装，最终试运行通过。修复记录：${repairNotes.join('；')}`;
      }
      if (attempt >= 2) {
        throw new Error(
          `工具「${action.name}」已安装并自动修复 ${repairNotes.length} 次，但试运行仍失败：${smoke.error || '未知错误'}。请在工具库里手动试运行并检查代码。`,
        );
      }

      const masterModel = useUiStore.getState().masterModel;
      const cfg = masterModel
        ? useModelStore.getState().configs.find((item) => item.id === masterModel.configId)
        : undefined;
      if (!masterModel || !cfg || !cfg.apiKey) {
        throw new Error(
          `工具「${action.name}」已安装，但自动试运行失败：${smoke.error || '未知错误'}。当前没有可用姬子模型，无法自动修复。`,
        );
      }

      const preset = getProvider(cfg.providerId);
      currentTool = await repairGeneratedToolAfterSmokeFailure(
        currentTool,
        smoke,
        {
          api: preset?.api ?? 'openai',
          baseURL: cfg.baseURL,
          apiKey: cfg.apiKey,
        },
        masterModel.modelId,
        signal,
      );
      repairNotes.push(`第 ${attempt + 1} 次根据试运行错误「${smoke.error || '未知错误'}」修复`);
      await install(currentTool);
    }
    throw new Error(`工具「${action.name}」自动试运行流程异常结束。`);
  }

  if (action.type !== 'create-agent') {
    throw new Error('暂不支持这个操作');
  }

  const agentId = useAgentStore.getState().addAgent(defaultAgentDraft(action.name));
  const id = useCanvasStore.getState().activeId;
  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === id);
  if (canvas && !canvas.readOnly) {
    const node: Node = {
      id: uid('node'),
      type: 'agent',
      position: { x: 160 + canvas.nodes.length * 40, y: 120 + canvas.nodes.length * 30 },
      data: {
        agentId,
        label: action.name,
        description: '',
        systemPrompt: '',
        toolTags: [],
        modelRef: null,
        inputSchemaText: '',
        outputSchemaText: '',
      },
    };
    useCanvasStore.getState().addNode(canvas.id, node);
    return `已创建 Agent「${action.name}」，并放到当前画布。`;
  }
  return `已创建 Agent「${action.name}」。`;
}


