import { chat, type ChatTurn, type LLMConfig } from './llmClient';
import { asObject } from './jsonGuards';
import { cleanJsonFence } from './masterPlanner';
import { textValue } from './agentRunner/utils';
import type { AgentOutputFormat } from '../stores/canvasStore';
import type {
  MasterAction,
  MasterAgentConfigPatch,
  MasterPlanStep,
} from './masterActions';
import type { JiziSearchDecision } from './jiziSearchPlanner';
import { normalizeChoiceOptions, type UserChoiceOption } from './jiziIntentPlanner';

export type JiziTurnDecision =
  | {
      kind: 'action';
      action: Extract<MasterAction, { type: 'plan' }>;
      reason: string;
      search: JiziSearchDecision;
    }
  | {
      kind: 'generate-tool';
      requirement: string;
      reason: string;
      search: JiziSearchDecision;
    }
  | {
      kind: 'ask-choice';
      title: string;
      summary: string;
      options: UserChoiceOption[];
      customPlaceholder: string;
      reason: string;
      search: JiziSearchDecision;
    }
  | { kind: 'system-check'; reason: string; search: JiziSearchDecision }
  | { kind: 'chat'; reason: string; search: JiziSearchDecision };

export interface JiziTurnPlannerOptions {
  runtimeContext?: string;
  allowSearch: boolean;
  allowChoice: boolean;
  allowActions: boolean;
  signal?: AbortSignal;
}

function optionalTextValue(value: unknown): string | undefined {
  return textValue(value) || undefined;
}

function noSearch(reason = ''): JiziSearchDecision {
  return { shouldSearch: false, reason };
}

function normalizeSearchDecision(
  value: unknown,
  allowSearch: boolean,
): JiziSearchDecision {
  if (!allowSearch) return noSearch('本轮未开启或未配置联网搜索');
  const obj = asObject(value);
  if (!obj || obj.shouldSearch !== true) {
    return noSearch(textValue(obj?.reason));
  }
  const query = textValue(obj.query);
  if (!query) return noSearch(textValue(obj.reason));
  return { shouldSearch: true, query, reason: textValue(obj.reason) };
}

function normalizeOutputFormat(value: unknown): AgentOutputFormat | undefined {
  const raw = optionalTextValue(value)?.toLowerCase();
  if (!raw) return undefined;
  if (['txt', 'text', '纯文本', '文本'].includes(raw)) return 'txt';
  if (['markdown', 'md'].includes(raw)) return 'markdown';
  if (['docx', 'word', '文档'].includes(raw)) return 'docx';
  if (['xlsx', 'excel', '表格'].includes(raw)) return 'xlsx';
  if (['mindmap', 'html', '思维导图'].includes(raw)) return 'mindmap';
  return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    ),
  );
}

function normalizeAgentPatch(value: unknown): MasterAgentConfigPatch | null {
  const item = asObject(value);
  if (!item) return null;
  const patch: MasterAgentConfigPatch = {};
  for (const key of ['name', 'description', 'systemPrompt'] as const) {
    const text = optionalTextValue(item[key]);
    if (text) patch[key] = text;
  }
  const toolTags = normalizeStringArray(item.toolTags);
  if (toolTags) patch.toolTags = toolTags;
  if (item.modelRef === null) {
    patch.modelRef = null;
  } else {
    const modelRef = asObject(item.modelRef);
    const configId = optionalTextValue(modelRef?.configId);
    const modelId = optionalTextValue(modelRef?.modelId);
    if (configId && modelId) patch.modelRef = { configId, modelId };
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function normalizeStep(value: unknown): MasterPlanStep | null {
  const item = asObject(value);
  if (!item) return null;
  const type = optionalTextValue(item.type);
  if (!type) return null;

  if (type === 'create-canvas') {
    return { type, name: optionalTextValue(item.name) };
  }
  if (type === 'rename-active-canvas') {
    const name = optionalTextValue(item.name);
    return name ? { type, name } : null;
  }
  if (type === 'create-agent') {
    const name = optionalTextValue(item.name);
    return name ? { type, name } : null;
  }
  if (type === 'add-node') {
    const label = optionalTextValue(item.label);
    if (!label) return null;
    // systemPrompt/description 姬子生成时直接写入节点;14000 上限:提示词是软约束,
    // 真正的硬截断在写入层 helpers.nodeFromAgentSpec(MASTER_NODE_PROMPT_CAP),解析层不截断。
    return {
      type,
      label,
      agentQuery: optionalTextValue(item.agentQuery),
      outputFormat: normalizeOutputFormat(item.outputFormat),
      description: optionalTextValue(item.description),
      systemPrompt: optionalTextValue(item.systemPrompt),
    };
  }
  if (type === 'connect-nodes') {
    const source = optionalTextValue(item.source);
    const target = optionalTextValue(item.target);
    return source && target ? { type, source, target } : null;
  }
  if (type === 'delete-node') {
    const label = optionalTextValue(item.label);
    return label ? { type, label } : null;
  }
  if (type === 'set-node-output-format') {
    const label = optionalTextValue(item.label);
    const outputFormat = normalizeOutputFormat(item.outputFormat);
    return label && outputFormat ? { type, label, outputFormat } : null;
  }
  if (type === 'update-agent') {
    const agentId = optionalTextValue(item.agentId);
    const patch = normalizeAgentPatch(item.patch);
    return agentId && patch ? { type, agentId, patch } : null;
  }
  if (type === 'update-node-agent-config') {
    const canvasId = optionalTextValue(item.canvasId);
    const nodeId = optionalTextValue(item.nodeId);
    const patch = normalizeAgentPatch(item.patch);
    return canvasId && nodeId && patch
      ? { type, canvasId, nodeId, patch }
      : null;
  }
  if (type === 'delete-canvas') {
    const canvasId = optionalTextValue(item.canvasId);
    return canvasId ? { type, canvasId } : null;
  }
  if (type === 'delete-tool') {
    const toolName = optionalTextValue(item.toolName);
    return toolName ? { type, toolName } : null;
  }
  if (type === 'run-active-canvas') {
    return { type };
  }
  return null;
}

export function parseJiziTurnDecision(
  reply: string,
  opts: Pick<JiziTurnPlannerOptions, 'allowSearch' | 'allowChoice' | 'allowActions'>,
): JiziTurnDecision {
  const root = asObject(JSON.parse(cleanJsonFence(reply)));
  const kind = textValue(root?.kind);
  const reason = textValue(root?.reason);
  const search = normalizeSearchDecision(root?.search, opts.allowSearch);

  if (opts.allowActions && kind === 'action') {
    const rawSteps = Array.isArray(root?.steps) ? root.steps : [];
    const steps = rawSteps
      .map((step) => normalizeStep(step))
      .filter((step): step is MasterPlanStep => !!step);
    if (steps.length > 0) {
      return {
        kind,
        action: {
          type: 'plan',
          summary: textValue(root?.summary) || '执行自然语言操作计划',
          steps,
        },
        reason,
        search: noSearch('操作计划不需要联网搜索'),
      };
    }
  }

  if (kind === 'generate-tool') {
    const requirement = textValue(root?.requirement);
    if (requirement) {
      return {
        kind,
        requirement,
        reason,
        search: noSearch('生成工具先基于当前项目状态判断'),
      };
    }
  }

  if (opts.allowChoice && kind === 'ask-choice') {
    const options = normalizeChoiceOptions(root?.options);
    if (options.length >= 2) {
      return {
        kind,
        title: textValue(root?.title) || '请选择一种处理方式',
        summary: textValue(root?.summary),
        options,
        customPlaceholder:
          textValue(root?.customPlaceholder) || '输入你的自定义方案',
        reason,
        search: noSearch('等待用户选择时不联网搜索'),
      };
    }
  }

  if (kind === 'system-check') {
    return {
      kind,
      reason,
      search: noSearch('本地配置体检不需要联网搜索'),
    };
  }

  return { kind: 'chat', reason, search };
}

function buildHistoryBlock(history: ChatTurn[]): string {
  return (
    history
      .slice(-6)
      .map((turn) => `${turn.role === 'user' ? '用户' : '姬子'}：${turn.content}`)
      .join('\n') || '(无)'
  );
}

function buildPlannerPrompt(
  text: string,
  history: ChatTurn[],
  opts: JiziTurnPlannerOptions,
): string {
  return [
    '你是姬子的“总规划器”。你只负责判断本轮应该怎么处理，不直接回答用户。',
    '请理解用户真实意图，不要做关键词机械匹配。',
    '',
    '本项目语境：Agent 默认指本应用画布里的 Agent 节点；工具默认指本项目可安装/可调用的 Python 工具；画布、节点、门控、skill、姬子都默认是本项目内部概念。',
    '',
    '你要一次性判断：',
    '1. 本轮主路线 kind：action / generate-tool / ask-choice / system-check / chat。',
    '2. 如果主路线是 chat，再判断是否真的需要联网搜索。',
    '',
    '主路线规则：',
    '- action：用户明确要求修改/创建/运行画布或 Agent，例如创建画布、加节点、连接节点、运行当前画布。疑问句、解释类问题不要选 action。',
    '- generate-tool：用户想让本项目 Agent 新增某种可安装 Python 工具能力，例如接口/API/HTTP 测试、文件处理、联网抓取、格式转换、自动化执行。没有完整参数也可以生成通用工具候选。',
    '- ask-choice：用户目标明确，但路线会明显影响后果，需要用户先选择；推荐方案必须放第一位并标 recommended:true。',
    '- system-check：用户想检查当前配置/环境/能力是否正常，例如体检、检查配置、为什么不能用、现在能做什么。',
    '- chat：普通问答、解释、建议，或可以直接回答。',
    '',
    `本轮是否允许 action：${opts.allowActions ? '允许' : '不允许'}`,
    `本轮是否允许 ask-choice：${opts.allowChoice ? '允许' : '不允许'}`,
    `本轮是否允许联网搜索：${opts.allowSearch ? '允许，但必须先判断需要' : '不允许'}`,
    '',
    '联网搜索规则：',
    '- 只有 chat 路线才考虑 search.shouldSearch=true。',
    '- 问今天、最新、价格、政策、新闻、版本、官网文档、外部产品现状、外部库当前用法时，才需要搜索。',
    '- 本项目内部问题、Agent 节点设计、工具是否缺失、画布操作、配置体检、普通解释，不要搜索。',
    '- 如果不确定，优先不搜索。',
    '',
    'action steps 只允许：create-canvas、rename-active-canvas、create-agent、add-node、connect-nodes、delete-node、set-node-output-format、update-agent、update-node-agent-config、delete-canvas、delete-tool、run-active-canvas。',
    '修改 Agent 或节点配置必须提供稳定 agentId，或 canvasId+nodeId，并把白名单字段放入 patch。删除画布必须提供 canvasId，删除工具必须提供 toolName；禁止只靠显示名称猜测目标。',
    'add-node 造节点时，必须为每个节点写出 systemPrompt（该节点完整的任务指令，将作为它的系统角色）和 description（一句话职责）。任务语义只由 systemPrompt+description 承载，节点名(label)只用于展示，不要靠节点名传达任务。systemPrompt 必须控制在 14000 字符以内。',
    'outputFormat 只能是 txt、markdown、docx、xlsx、mindmap。用户说纯文本对应 txt，Word 对应 docx，Excel 对应 xlsx。',
    '不允许规划批量运行、运行全部画布；只能规划 run-active-canvas 或回到 chat 说明。',
    '',
    '只返回 JSON，不要 Markdown，不要解释。',
    'action 格式：{"kind":"action","reason":"短原因","summary":"一句话概括","steps":[{"type":"create-canvas","name":"画布名"},{"type":"add-node","label":"节点显示名","description":"一句话职责","systemPrompt":"完整任务指令……","outputFormat":"markdown"}],"search":{"shouldSearch":false,"reason":"操作不搜索"}}',
    'generate-tool 格式：{"kind":"generate-tool","reason":"短原因","requirement":"整理后的工具需求","search":{"shouldSearch":false,"reason":"生成工具不搜索"}}',
    'ask-choice 格式：{"kind":"ask-choice","reason":"短原因","title":"一句话问题","summary":"为什么需要选择","customPlaceholder":"自定义输入提示","options":[{"id":"a","title":"推荐方案","description":"一句话影响/取舍","recommended":true}],"search":{"shouldSearch":false,"reason":"等待选择不搜索"}}',
    'system-check 格式：{"kind":"system-check","reason":"短原因","search":{"shouldSearch":false,"reason":"体检不搜索"}}',
    'chat 格式：{"kind":"chat","reason":"短原因","search":{"shouldSearch":true,"query":"简洁检索词","reason":"为什么需要搜索"}} 或 {"kind":"chat","reason":"短原因","search":{"shouldSearch":false,"reason":"为什么不搜索"}}',
    opts.runtimeContext ? `\n【当前项目状态】\n${opts.runtimeContext}` : '',
    `\n【最近对话】\n${buildHistoryBlock(history)}`,
    `\n【用户最新输入】\n${text}`,
  ].join('\n');
}

export async function planJiziTurnWithLLM(
  text: string,
  history: ChatTurn[],
  cfg: LLMConfig,
  model: string,
  opts: JiziTurnPlannerOptions,
): Promise<JiziTurnDecision> {
  const reply = await chat({
    cfg,
    model,
    system: '你只负责规划姬子本轮处理路线，只输出 JSON。',
    text: buildPlannerPrompt(text, history, opts),
    signal: opts.signal,
    scene: 'turn-plan',
  });
  return parseJiziTurnDecision(reply, opts);
}
