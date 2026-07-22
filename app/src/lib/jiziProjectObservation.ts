import { useAgentStore, type AgentDef } from '../stores/agentStore';
import {
  useCanvasStore,
  type AgentNodeData,
  type Canvas,
} from '../stores/canvasStore';
import { useModelStore, type ProviderConfig } from '../stores/modelStore';
import { activeSearchEntries, useSearchStore } from '../stores/searchStore';
import { enabledJiziSkillIds } from '../stores/jiziSkillStore';
import { useToolStore } from '../stores/toolStore';
import { useUiStore, type MasterModel } from '../stores/uiStore';
import { loadJiziSkills } from './jiziSkills';
import {
  getServiceStatus,
  listToolMeta,
  type ServiceStatus,
  type ToolMeta,
} from './pythonClient';
import { BUILTIN_TOOL_TAGS } from './toolRegistry';

export interface JiziProjectObservationInput {
  activeCanvasId: string | null;
  canvases: Canvas[];
  agents: AgentDef[];
  modelConfigs: ProviderConfig[];
  selectedMasterModel: MasterModel | null;
  tools: ToolMeta[];
  serviceStatus: ServiceStatus | 'unknown';
  searchProviderIds: string[];
  enabledSkillIds: string[];
}

export interface JiziNodeObservation {
  id: string;
  type: string;
  label: string;
  agentId: string | null;
  description: string;
  systemPrompt: string;
  toolTags: string[];
  modelRef: MasterModel | null;
  inputSchemaText: string;
  outputSchemaText: string;
  outputFormat: string | null;
  run: { status: string; message: string; error?: string };
  lastOutput: {
    folderName: string;
    runAt: string;
    items: Array<{ name: string; path?: string; summary?: string; deleted?: boolean }>;
  } | null;
}

export interface JiziCanvasObservation {
  id: string;
  name: string;
  readOnly: boolean;
  runId: string | null;
  run: { status: string; message: string };
  nodes: JiziNodeObservation[];
  edges: Array<{ id: string; sourceId: string; targetId: string }>;
}

export interface JiziProjectObservation {
  activeCanvasId: string | null;
  activeCanvas: JiziCanvasObservation | null;
  canvases: JiziCanvasObservation[];
  agents: Array<{
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    toolTags: string[];
    modelRef: MasterModel | null;
    inputSchemaText: string;
    outputSchemaText: string;
  }>;
  models: Array<{
    configId: string;
    providerId: string;
    configName: string;
    models: Array<{
      id: string;
      label: string;
      enabled: boolean;
      caps: { longContext: boolean; vision: boolean; audio: boolean };
    }>;
  }>;
  selectedMasterModel: MasterModel | null;
  tools: Array<{
    name: string;
    description: string;
    tags: string[];
    dependencies: string[];
    builtin: boolean;
    internal: boolean;
    loadError: string | null;
  }>;
  serviceStatus: ServiceStatus | 'unknown';
  searchProviderIds: string[];
  enabledSkillIds: string[];
}

function cleanText(value: unknown, max = 4_000): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function observeCanvas(canvas: Canvas): JiziCanvasObservation {
  return {
    id: canvas.id,
    name: canvas.name,
    readOnly: !!canvas.readOnly,
    runId: canvas.runId ?? null,
    run: {
      status: canvas.runState?.status ?? 'idle',
      message: cleanText(canvas.runState?.message, 1_000),
    },
    nodes: canvas.nodes.map((node) => {
      const data = (node.data ?? {}) as AgentNodeData;
      const status = data.runState?.status ?? 'idle';
      const message = cleanText(data.runState?.message, 2_000);
      return {
        id: node.id,
        type: node.type ?? 'agent',
        label: cleanText(data.label, 200) || '未命名节点',
        agentId: typeof data.agentId === 'string' ? data.agentId : null,
        description: cleanText(data.description, 1_000),
        systemPrompt: cleanText(data.systemPrompt),
        toolTags: Array.isArray(data.toolTags)
          ? data.toolTags.filter((item): item is string => typeof item === 'string')
          : [],
        modelRef: data.modelRef
          ? { configId: data.modelRef.configId, modelId: data.modelRef.modelId }
          : null,
        inputSchemaText: cleanText(data.inputSchemaText, 2_000),
        outputSchemaText: cleanText(data.outputSchemaText, 2_000),
        outputFormat: data.outputFormat ?? null,
        run: {
          status,
          message,
          ...(status === 'failed' && message ? { error: message } : {}),
        },
        lastOutput: data.lastOutput
          ? {
              folderName: data.lastOutput.folderName,
              runAt: data.lastOutput.runAt,
              items: data.lastOutput.items.map((item) => ({
                name: item.name,
                path: item.path,
                summary: cleanText(item.summary, 1_000) || undefined,
                deleted: item.deleted,
              })),
            }
          : null,
      };
    }),
    edges: canvas.edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
    })),
  };
}

export function buildJiziProjectObservation(
  input: JiziProjectObservationInput,
): JiziProjectObservation {
  const canvases = input.canvases.map(observeCanvas);
  return {
    activeCanvasId: input.activeCanvasId,
    activeCanvas:
      canvases.find((canvas) => canvas.id === input.activeCanvasId) ?? null,
    canvases,
    agents: input.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: cleanText(agent.description, 1_000),
      systemPrompt: cleanText(agent.systemPrompt),
      toolTags: [...agent.toolTags],
      modelRef: agent.modelRef ? { ...agent.modelRef } : null,
      inputSchemaText: cleanText(agent.inputSchemaText, 2_000),
      outputSchemaText: cleanText(agent.outputSchemaText, 2_000),
    })),
    models: input.modelConfigs.map((config) => ({
      configId: config.id,
      providerId: config.providerId,
      configName: config.name,
      models: config.models.map((model) => ({
        id: model.id,
        label: model.label ?? model.id,
        enabled: model.enabled,
        caps: { ...model.caps },
      })),
    })),
    selectedMasterModel: input.selectedMasterModel
      ? { ...input.selectedMasterModel }
      : null,
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: cleanText(tool.description, 1_000),
      tags: [...tool.tags],
      dependencies: [...tool.dependencies],
      builtin: tool.builtin,
      internal: tool.internal,
      loadError: tool.loadError,
    })),
    serviceStatus: input.serviceStatus,
    searchProviderIds: [...input.searchProviderIds],
    enabledSkillIds: [...input.enabledSkillIds],
  };
}

async function safeServiceStatus(): Promise<ServiceStatus | 'unknown'> {
  try {
    return await getServiceStatus();
  } catch {
    return 'unknown';
  }
}

async function safeToolMeta(): Promise<ToolMeta[]> {
  try {
    const tools = await listToolMeta();
    if (tools.length > 0) return tools;
  } catch {
    // Fall through to the offline cache.
  }
  const cached = useToolStore.getState().customTools;
  const builtin: ToolMeta[] = BUILTIN_TOOL_TAGS.map((tool) => ({
    name: tool.value,
    module: null,
    description: tool.label,
    tags: [tool.value],
    dependencies: [],
    source: 'builtin',
    builtin: true,
    internal: false,
    createdAt: null,
    loadError: null,
  }));
  return [...builtin, ...cached];
}

export async function observeJiziProject(): Promise<JiziProjectObservation> {
  const canvas = useCanvasStore.getState();
  const search = useSearchStore.getState();
  const skills = await loadJiziSkills();
  return buildJiziProjectObservation({
    activeCanvasId: canvas.activeId,
    canvases: canvas.canvases,
    agents: useAgentStore.getState().agents,
    modelConfigs: useModelStore.getState().configs,
    selectedMasterModel: useUiStore.getState().masterModel,
    tools: await safeToolMeta(),
    serviceStatus: await safeServiceStatus(),
    searchProviderIds: activeSearchEntries(search).map((entry) => entry.providerId),
    enabledSkillIds: enabledJiziSkillIds(skills.map((skill) => skill.id)),
  });
}

export function formatJiziObservation(
  observation: JiziProjectObservation,
  budget = 16_000,
): string {
  const lines = [
    '【姬子可见的当前项目状态】',
    `Python 工具服务：${observation.serviceStatus}`,
    `当前画布：${
      observation.activeCanvas
        ? `${observation.activeCanvas.name} [${observation.activeCanvas.id}]`
        : '无'
    }`,
  ];
  const canvas = observation.activeCanvas;
  if (canvas) {
    lines.push(`画布状态：${canvas.run.status}${canvas.run.message ? `；${canvas.run.message}` : ''}`);
    lines.push('节点：');
    for (const node of canvas.nodes) {
      lines.push(
        `- ${node.label} [${node.id}]；类型=${node.type}；Agent=${node.agentId ?? '无'}；模型=${
          node.modelRef ? `${node.modelRef.configId}/${node.modelRef.modelId}` : '无'
        }；工具=${node.toolTags.join('、') || '无'}；输出=${node.outputFormat ?? '未设置'}；运行=${node.run.status}`,
      );
      if (node.description) lines.push(`  描述：${node.description}`);
      if (node.systemPrompt) lines.push(`  提示词：${node.systemPrompt}`);
      if (node.run.error) lines.push(`  失败证据：${node.run.error}`);
      if (node.lastOutput?.items.length) {
        lines.push(
          `  最近输出：${node.lastOutput.items
            .map((item) => `${item.name}${item.summary ? `(${item.summary})` : ''}`)
            .join('、')}`,
        );
      }
    }
    lines.push('连线：');
    lines.push(
      ...(canvas.edges.length
        ? canvas.edges.map((edge) => `- ${edge.sourceId} -> ${edge.targetId} [${edge.id}]`)
        : ['- 无']),
    );
  }
  lines.push('Agent 库：');
  lines.push(
    ...(observation.agents.length
      ? observation.agents.map(
          (agent) =>
            `- ${agent.name} [${agent.id}]；描述=${agent.description || '无'}；模型=${
              agent.modelRef ? `${agent.modelRef.configId}/${agent.modelRef.modelId}` : '无'
            }；工具=${agent.toolTags.join('、') || '无'}；提示词=${agent.systemPrompt || '无'}`,
        )
      : ['- 无']),
  );
  lines.push(
    `工具：${observation.tools.map((tool) => tool.name).join('、') || '无'}`,
    `模型：${observation.models
      .flatMap((config) =>
        config.models
          .filter((model) => model.enabled)
          .map((model) => `${config.configName}/${model.label} [${config.configId}/${model.id}]`),
      )
      .join('、') || '无'}`,
    `联网搜索源：${observation.searchProviderIds.join('、') || '无'}`,
    `启用 Skill：${observation.enabledSkillIds.join('、') || '无'}`,
    '回答规则：Agent 默认指本项目画布里的 Agent 节点；工具默认指本项目 Python 工具。',
  );
  return lines.join('\n').slice(0, Math.max(0, budget));
}
