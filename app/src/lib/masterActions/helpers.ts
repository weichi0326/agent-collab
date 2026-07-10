import type { Node } from '@xyflow/react';
import { uid } from '../id';
import { nodeLabel } from '../agentNode';
import {
  PRESET_TEMPLATES,
  useAgentStore,
  type AgentDef,
  type AgentDraft,
} from '../../stores/agentStore';
import {
  useCanvasStore,
  type AgentOutputFormat,
} from '../../stores/canvasStore';
import type { MasterPlanStep } from './types';

export function activeCanvasId(): string {
  const id = useCanvasStore.getState().activeId;
  if (!id) throw new Error('当前没有打开的画布');
  return id;
}

export function defaultAgentDraft(name: string): AgentDraft {
  return {
    name,
    description: '',
    systemPrompt: '',
    toolTags: [],
    modelRef: null,
    inputSchemaText: '',
    outputSchemaText: '',
  };
}

function scoreAgent(agentName: string, query: string): number {
  const name = agentName.toLowerCase();
  const q = query.toLowerCase();
  if (name === q) return 100;
  if (name.includes(q) || q.includes(name)) return 80;
  let score = 0;
  for (const token of q.split(/[\s,，、]+/).filter(Boolean)) {
    if (name.includes(token)) score += 20;
  }
  if (/分析/.test(query) && /分析/.test(agentName)) score += 40;
  if (/测试|用例/.test(query) && /测试|用例/.test(agentName)) score += 40;
  if (/bug|缺陷|问题/i.test(query) && /bug|缺陷|问题/i.test(agentName)) score += 40;
  return score;
}

function findAgent(query: string): AgentDef | undefined {
  const agents = useAgentStore.getState().agents;
  return agents
    .map((agent) => ({ agent, score: scoreAgent(agent.name, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.agent;
}

function presetDraftForSpec(spec: { label: string; agentQuery?: string }): AgentDraft {
  const query = spec.agentQuery || spec.label;
  const template = PRESET_TEMPLATES
    .map((item) => ({ item, score: scoreAgent(item.draft.name, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
  return template
    ? { ...template.draft, toolTags: [...template.draft.toolTags] }
    : defaultAgentDraft(spec.label);
}

function ensureAgentForSpec(spec: { label: string; agentQuery?: string }): AgentDef {
  const existing = findAgent(spec.agentQuery || spec.label);
  if (existing) return existing;

  const draft = presetDraftForSpec(spec);
  const id = useAgentStore.getState().addAgent(draft);
  const created = useAgentStore.getState().agents.find((agent) => agent.id === id);
  if (!created) {
    throw new Error(`创建 Agent「${draft.name}」失败`);
  }
  return created;
}

export function nodeFromAgentSpec(
  spec: { label: string; agentQuery?: string; outputFormat?: AgentOutputFormat },
  index: number,
): Node {
  const def = ensureAgentForSpec(spec);
  const label = spec.label || def.name;
  return {
    id: uid('node'),
    type: 'agent',
    position: { x: 140 + index * 260, y: 140 },
    data: {
      agentId: def.id,
      label,
      description: def.description,
      systemPrompt: def.systemPrompt,
      toolTags: def.toolTags,
      modelRef: def.modelRef,
      inputSchemaText: def.inputSchemaText ?? '',
      outputSchemaText: def.outputSchemaText ?? '',
      outputFormat: spec.outputFormat,
    },
  };
}

export function activeEditableCanvasId(): string {
  const id = activeCanvasId();
  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === id);
  if (!canvas) throw new Error('当前画布不存在');
  if (canvas.readOnly) throw new Error('只读运行画布不可编辑');
  return id;
}

export function normalizedLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

export function findNodeByLabel(canvasId: string, label: string, aliases?: Map<string, string>): Node {
  const key = normalizedLabel(label);
  const aliasId = aliases?.get(key);
  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === canvasId);
  if (!canvas) throw new Error('当前画布不存在');
  if (aliasId) {
    const node = canvas.nodes.find((item) => item.id === aliasId);
    if (node) return node;
  }

  const exact = canvas.nodes.find((item) => normalizedLabel(nodeLabel(item)) === key);
  if (exact) return exact;

  const fuzzy = canvas.nodes.find((item) => {
    const current = normalizedLabel(nodeLabel(item));
    return current.includes(key) || key.includes(current);
  });
  if (fuzzy) return fuzzy;

  throw new Error(`没有找到节点「${label}」`);
}

export function removeNodeWithEdges(canvasId: string, nodeId: string): void {
  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === canvasId);
  if (!canvas) throw new Error('当前画布不存在');
  const edgeChanges = canvas.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => ({ id: edge.id, type: 'remove' as const }));
  if (edgeChanges.length > 0) {
    useCanvasStore.getState().applyEdges(canvasId, edgeChanges);
  }
  useCanvasStore.getState().applyNodes(canvasId, [{ id: nodeId, type: 'remove' }]);
  useCanvasStore.getState().recompute(canvasId);
}

export function addNodeToActiveCanvas(
  step: Extract<MasterPlanStep, { type: 'add-node' }>,
  aliases: Map<string, string>,
): string {
  const canvasId = activeEditableCanvasId();
  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === canvasId);
  if (!canvas) throw new Error('当前画布不存在');
  const node = nodeFromAgentSpec(step, canvas.nodes.length);
  node.position = {
    x: 160 + canvas.nodes.length * 260,
    y: 140 + (canvas.nodes.length % 3) * 90,
  };
  useCanvasStore.getState().addNode(canvasId, node);
  aliases.set(normalizedLabel(step.label), node.id);
  if (step.agentQuery) aliases.set(normalizedLabel(step.agentQuery), node.id);
  return node.id;
}

export function connectPlanNodes(
  canvasId: string,
  step: Extract<MasterPlanStep, { type: 'connect-nodes' }>,
  aliases: Map<string, string>,
): void {
  const source = findNodeByLabel(canvasId, step.source, aliases);
  const target = findNodeByLabel(canvasId, step.target, aliases);
  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === canvasId);
  if (canvas?.edges.some((edge) => edge.source === source.id && edge.target === target.id)) {
    return;
  }
  useCanvasStore.getState().connect(canvasId, {
    source: source.id,
    sourceHandle: null,
    target: target.id,
    targetHandle: null,
  });
}
