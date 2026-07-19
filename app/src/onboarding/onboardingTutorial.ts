import { useAgentStore, type AgentDraft } from '../stores/agentStore';
import { useCanvasStore } from '../stores/canvasStore';
import { useModelStore } from '../stores/modelStore';

export interface TutorialResources {
  canvasId: string;
  agentIds: [string, string];
}

export const TUTORIAL_CANVAS_NAME = '新手示例画布';
export const TUTORIAL_AGENT_NAMES = [
  '新手教程·需求分析师',
  '新手教程·方案整理员',
] as const;

function tutorialDraft(
  index: 0 | 1,
  modelRef: { configId: string; modelId: string },
): AgentDraft {
  if (index === 0) {
    return {
      name: TUTORIAL_AGENT_NAMES[0],
      description: '把一个目标整理成清晰的需求与验收标准。',
      systemPrompt:
        '你是需求分析师。请把收到的目标整理为功能需求、约束条件和验收标准。',
      toolTags: [],
      modelRef,
      inputSchemaText: '',
      outputSchemaText: '',
    };
  }
  return {
    name: TUTORIAL_AGENT_NAMES[1],
    description: '把上游分析结果整理成简洁、可执行的方案。',
    systemPrompt:
      '你是方案整理员。请根据上游需求分析，输出结构清晰、可执行的实施方案。',
    toolTags: [],
    modelRef,
    inputSchemaText: '',
    outputSchemaText: '',
  };
}

function enabledModelRef(): { configId: string; modelId: string } | null {
  for (const config of useModelStore.getState().configs) {
    if (config.test.status !== 'ok-low' && config.test.status !== 'ok-high') {
      continue;
    }
    const model = config.models.find((item) => item.enabled);
    if (model) return { configId: config.id, modelId: model.id };
  }
  return null;
}

function resourcesExist(resources: TutorialResources): boolean {
  const canvasExists = useCanvasStore
    .getState()
    .canvases.some((canvas) => canvas.id === resources.canvasId);
  const agentIds = new Set(useAgentStore.getState().agents.map((agent) => agent.id));
  return canvasExists && resources.agentIds.every((id) => agentIds.has(id));
}

export function ensureTutorialResources(
  existing: TutorialResources | null,
): TutorialResources | null {
  if (existing && resourcesExist(existing)) {
    useCanvasStore.getState().setActive(existing.canvasId);
    return existing;
  }
  if (existing) removeTutorialResources(existing);

  const modelRef = enabledModelRef();
  if (!modelRef) return null;
  const canvasId = useCanvasStore.getState().addCanvas();
  if (!canvasId) return null;
  useCanvasStore.getState().renameCanvas(canvasId, TUTORIAL_CANVAS_NAME);

  const first = useAgentStore.getState().addAgent(tutorialDraft(0, modelRef));
  const second = useAgentStore.getState().addAgent(tutorialDraft(1, modelRef));
  return { canvasId, agentIds: [first, second] };
}

export function removeTutorialResources(resources: TutorialResources): void {
  const canvas = useCanvasStore
    .getState()
    .canvases.find((item) => item.id === resources.canvasId);
  if (canvas?.savedId) useCanvasStore.getState().deleteSaved(canvas.savedId);
  if (canvas?.runId) useCanvasStore.getState().deleteRun(canvas.runId);
  useCanvasStore.getState().removeCanvas(resources.canvasId);
  resources.agentIds.forEach((id) => useAgentStore.getState().removeAgent(id));
}
