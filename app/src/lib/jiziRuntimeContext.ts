import { useAgentStore } from '../stores/agentStore';
import { useCanvasStore } from '../stores/canvasStore';
import { useModelStore } from '../stores/modelStore';
import { useMasterAgentStore } from '../stores/masterAgentStore';
import {
  activeSearchEntries,
  useSearchStore,
} from '../stores/searchStore';
import { useToolStore } from '../stores/toolStore';
import { useUiStore } from '../stores/uiStore';
import { getServiceStatus, listToolMeta, type ServiceStatus } from './pythonClient';
import { BUILTIN_TOOL_TAGS } from './toolRegistry';
import { loadJiziSkills } from './jiziSkills';
import { enabledJiziSkillIds } from '../stores/jiziSkillStore';
import {
  formatJiziObservation,
  observeJiziProject,
} from './jiziProjectObservation';

function serviceStatusLabel(status: ServiceStatus | 'unknown'): string {
  if (status === 'running') return '正常';
  if (status === 'starting') return '启动中';
  if (status === 'stopped') return '未运行';
  return '未知';
}

function modelCapsLabel(model: { caps?: { longContext?: boolean; vision?: boolean; audio?: boolean } } | null | undefined): string {
  if (!model?.caps) return '未知';
  return [
    model.caps.longContext ? '长上下文' : '普通上下文',
    model.caps.vision ? '支持图片' : '不支持图片',
    model.caps.audio ? '支持音频' : '不支持音频',
  ].join(' / ');
}

async function safeServiceStatus(): Promise<ServiceStatus | 'unknown'> {
  try {
    return await getServiceStatus();
  } catch {
    return 'unknown';
  }
}

async function safeToolNames(): Promise<string[]> {
  try {
    const meta = await listToolMeta();
    if (meta.length > 0) return meta.map((tool) => tool.name);
  } catch {
    /* fall through to cached/builtin view */
  }
  const cached = useToolStore.getState().customTools.map((tool) => tool.name);
  return [...BUILTIN_TOOL_TAGS.map((tool) => tool.value), ...cached];
}

export async function buildJiziRuntimeContext(): Promise<string> {
  return formatJiziObservation(await observeJiziProject());
}

export async function buildJiziHealthReport(): Promise<string> {
  const canvasState = useCanvasStore.getState();
  const agentState = useAgentStore.getState();
  const modelState = useModelStore.getState();
  const uiState = useUiStore.getState();
  const searchState = useSearchStore.getState();
  const serviceStatus = await safeServiceStatus();
  const tools = await safeToolNames();
  const skills = await loadJiziSkills();
  const enabledSkillIds = enabledJiziSkillIds(skills.map((skill) => skill.id));

  const enabledModelCount = modelState.configs.reduce(
    (sum, cfg) => sum + cfg.models.filter((model) => model.enabled).length,
    0,
  );
  const selectedConfig = uiState.masterModel
    ? modelState.configs.find((cfg) => cfg.id === uiState.masterModel?.configId)
    : null;
  const selectedModel = selectedConfig?.models.find(
    (model) => model.id === uiState.masterModel?.modelId,
  );
  const activeCanvas = canvasState.canvases.find(
    (canvas) => canvas.id === canvasState.activeId,
  );
  const activeSearch = activeSearchEntries(searchState);
  const masterState = useMasterAgentStore.getState();
  const activeSession = masterState.sessions.find(
    (session) => session.id === masterState.activeId,
  );
  const activeSessionImageCount =
    activeSession?.messages.reduce(
      (sum, msg) => sum + (msg.attachments?.filter((item) => item.isImage).length ?? 0),
      0,
    ) ?? 0;
  const currentModelCaps = modelCapsLabel(selectedModel);

  const issues: string[] = [];
  if (serviceStatus !== 'running') {
    issues.push(`Python 工具服务现在是“${serviceStatusLabel(serviceStatus)}”，工具节点可能跑不起来。`);
  }
  if (modelState.configs.length === 0 || enabledModelCount === 0) {
    issues.push('还没有可用模型，姬子和 Agent 都不能正常调用大模型。');
  }
  if (!uiState.masterModel || !selectedConfig || !selectedModel) {
    issues.push('姬子当前没有选到有效模型，聊天前需要在右下角选一个模型。');
  } else if (!selectedConfig.apiKey) {
    issues.push('姬子当前模型所在配置没有填密钥。');
  }
  if (webSearchLooksEnabledButUnavailable(searchState)) {
    issues.push('搜索配置里有启用项但没有可用密钥，打开联网搜索也搜不到。');
  }
  if (activeSessionImageCount > 0 && selectedModel && !selectedModel.caps.vision) {
    issues.push('当前会话里曾经发过图片，但现在选的模型没有开启“视觉/图像”能力；追问图片时姬子不会把图片发给模型。');
  }
  if (enabledSkillIds.length === 0) {
    issues.push('没有读取到姬子 skill，复杂任务会少一些做事方法。');
  }

  const summary = issues.length === 0 ? '整体看起来可以正常使用。' : '有几处会影响使用体验。';
  return [
    `体检结果：${summary}`,
    '',
    `- Python 工具服务：${serviceStatusLabel(serviceStatus)}`,
    `- 姬子当前模型：${
      selectedConfig && uiState.masterModel
        ? `${selectedConfig.name || selectedConfig.providerId} / ${
            selectedModel?.label || uiState.masterModel.modelId
          }`
        : '未选择'
    }`,
    `- 可用模型数量：${enabledModelCount}`,
    `- 当前模型能力：${currentModelCaps}`,
    `- 当前会话图片记录：${activeSessionImageCount > 0 ? `${activeSessionImageCount} 个图片附件` : '没有图片附件'}`,
    `- 联网搜索：${activeSearch.length > 0 ? `可用 ${activeSearch.length} 个搜索源` : '暂无可用搜索源'}`,
    `- 当前画布：${activeCanvas ? `${activeCanvas.name}，${activeCanvas.nodes.length} 个节点` : '无'}`,
    `- Agent 数量：${agentState.agents.length}`,
    `- 工具数量：${tools.length}`,
    `- Skill 数量：${enabledSkillIds.length} 个启用 / ${skills.length} 个总计`,
    '',
    issues.length > 0
      ? `建议优先处理：\n${issues.map((issue) => `- ${issue}`).join('\n')}`
      : '建议：现在不用急着修配置，可以继续正常使用；后面如果要发布或换电脑，再跑一次完整环境检查。',
  ].join('\n');
}

function webSearchLooksEnabledButUnavailable(
  searchState: ReturnType<typeof useSearchStore.getState>,
): boolean {
  const enabledAny = Object.values(searchState.configs).some((cfg) => cfg.enabled);
  return enabledAny && activeSearchEntries(searchState).length === 0;
}

