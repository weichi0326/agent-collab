import { asObject } from './jsonGuards';
import { chat, type ChatTurn, type LLMConfig } from './llmClient';
import { cleanJsonFence } from './masterPlanner';

export type JiziSearchDecision =
  | { shouldSearch: true; query: string; reason: string }
  | { shouldSearch: false; reason: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseJiziSearchDecision(reply: string): JiziSearchDecision {
  const root = asObject(JSON.parse(cleanJsonFence(reply)));
  const reason = textValue(root?.reason);
  const shouldSearch = root?.shouldSearch === true;

  if (!shouldSearch) {
    return { shouldSearch: false, reason };
  }

  const query = textValue(root?.query);
  if (!query) return { shouldSearch: false, reason };
  return { shouldSearch: true, query, reason };
}

function buildSearchPrompt(text: string, history: ChatTurn[]): string {
  const context = history
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? '用户' : '姬子'}：${turn.content}`)
    .join('\n');

  return [
    '你是姬子的“联网搜索裁判”。用户打开了联网搜索开关，但这不代表每句话都要搜索。',
    '你的任务不是回答用户，而是判断本轮是否真的需要外部网页资料。',
    '',
    '本项目语境：',
    '- “Agent”默认指这个应用画布里的 Agent 节点，不是 Dify、Coze、CrewAI 或其他平台。',
    '- “工具”默认指本项目可安装/可调用的 Python 工具。',
    '- “画布/节点/门控/技能/姬子”都默认是本项目内部概念。',
    '',
    '应该搜索：',
    '- 用户问今天、最新、价格、政策、新闻、版本、官网文档、外部产品现状等可能过期的信息。',
    '- 用户明确要求查资料、联网、搜索、找来源。',
    '- 需要确认某个外部库、API、网站、服务的当前用法。',
    '',
    '不应该搜索：',
    '- 用户问本项目怎么用、Agent 节点怎么设计、要不要生成工具、报错怎么理解、代码/架构建议。',
    '- 普通概念解释、写作、方案设计、基于当前对话就能回答的问题。',
    '- 用户只是提到“接口测试、Agent、工具、技能”等本项目内部能力。',
    '',
    '如果不确定，优先不搜索，让姬子基于项目语境回答；不要因为开关打开就硬搜。',
    '只返回 JSON，不要 Markdown，不要解释。',
    '需要搜索：{"shouldSearch":true,"query":"适合提交给搜索引擎的简洁查询词","reason":"一句很短的原因"}',
    '不需要搜索：{"shouldSearch":false,"reason":"一句很短的原因"}',
    '',
    '【最近对话】',
    context || '(无)',
    '',
    '【用户最新输入】',
    text,
  ].join('\n');
}

export async function planJiziSearchWithLLM(
  text: string,
  history: ChatTurn[],
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
): Promise<JiziSearchDecision> {
  const reply = await chat({
    cfg,
    model,
    system: '你只负责判断本轮是否需要联网搜索，只输出 JSON。',
    text: buildSearchPrompt(text, history),
    signal,
    scene: 'search-plan',
  });

  try {
    return parseJiziSearchDecision(reply);
  } catch (err) {
    console.warn('[jiziSearchPlanner] failed to parse search decision', err);
    return { shouldSearch: false, reason: '搜索判断失败，按无需搜索处理' };
  }
}
