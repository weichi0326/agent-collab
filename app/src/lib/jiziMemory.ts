import { chat, type ChatTurn, type LLMConfig } from './llmClient';
import type { MasterMemory, MemoryKind } from '../stores/masterAgentStore';
import { cleanJsonFence } from './masterPlanner';

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

export type MemoryDraft = Partial<Record<MemoryKind, string[]>>;

export function parseMemoryDraft(reply: string): MemoryDraft {
  const root = JSON.parse(cleanJsonFence(reply)) as Record<string, unknown>;
  return {
    profile: asStringArray(root.profile),
    preferences: asStringArray(root.preferences),
    resources: asStringArray(root.resources),
  };
}

function buildMemoryPrompt(params: {
  userText: string;
  assistantText: string;
  memory: MasterMemory;
}): string {
  const { userText, assistantText, memory } = params;
  return [
    '你是姬子的长期记忆整理器。你的任务不是回答用户，而是从本轮对话中提取“以后长期有用”的记忆。',
    '',
    '只记录稳定信息：',
    '- 用户长期偏好，例如“用户不是技术人员，解释要大白话”。',
    '- 项目长期约定，例如“用户希望姬子自主判断，不要关键词匹配”。',
    '- 常用资源或项目事实，例如“当前项目是多 Agent 画布应用”。',
    '',
    '不要记录：',
    '- 密钥、token、密码、手机号、身份证、私人敏感信息。',
    '- 一次性任务、临时情绪、已经过期的状态。',
    '- 模型自己猜测的内容。',
    '',
    '分类说明：',
    '- profile：关于用户身份/水平/角色的稳定信息。',
    '- preferences：用户长期偏好、表达偏好、产品方向偏好。',
    '- resources：用户长期会复用的项目资源、项目事实、常用对象。',
    '',
    '如果没有值得长期保存的信息，就返回空数组。',
    '只返回 JSON，不要 Markdown，不要解释。',
    '格式：{"profile":[],"preferences":[],"resources":[]}',
    '',
    '【已有记忆】',
    JSON.stringify(memory, null, 2),
    '',
    '【用户本轮输入】',
    userText,
    '',
    '【姬子本轮回复】',
    assistantText.slice(0, 2000),
  ].join('\n');
}

export async function extractJiziMemoryWithLLM(
  userText: string,
  assistantText: string,
  memory: MasterMemory,
  cfg: LLMConfig,
  model: string,
): Promise<MemoryDraft> {
  const reply = await chat({
    cfg,
    model,
    system: '你只负责整理姬子的长期记忆，只输出 JSON。',
    text: buildMemoryPrompt({ userText, assistantText, memory }),
  });
  return parseMemoryDraft(reply);
}
export interface MemoryCandidate {
  id: string;
  kind: MemoryKind;
  text: string;
}

function memoryCandidates(memory: MasterMemory): MemoryCandidate[] {
  const rows: MemoryCandidate[] = [];
  const push = (kind: MemoryKind, items: string[]) => {
    for (const item of items) {
      const text = item.trim();
      if (!text) continue;
      rows.push({ id: `m${rows.length + 1}`, kind, text });
    }
  };
  push('profile', memory.profile.slice(-12));
  push('preferences', memory.preferences.slice(-16));
  push('resources', memory.resources.slice(-16));
  return rows;
}

export function parseRelevantMemoryReply(
  reply: string,
  candidates: MemoryCandidate[],
  limit = 10,
): string[] {
  const root = JSON.parse(cleanJsonFence(reply)) as Record<string, unknown>;
  const raw = Array.isArray(root.selected) ? root.selected : [];
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const selected: string[] = [];

  for (const item of raw) {
    const id = String(item ?? '').trim();
    const candidate = byId.get(id);
    if (!candidate || seen.has(id)) continue;
    seen.add(id);
    selected.push(candidate.text);
    if (selected.length >= limit) break;
  }

  return selected;
}

function fallbackStableMemory(memory: MasterMemory): string[] {
  return [
    ...memory.profile.slice(-4),
    ...memory.preferences.slice(-6),
  ].map((item) => item.trim()).filter(Boolean);
}

function buildMemorySelectionPrompt(params: {
  userText: string;
  memory: MasterMemory;
  history: ChatTurn[];
  limit: number;
}): { prompt: string; candidates: MemoryCandidate[] } {
  const candidates = memoryCandidates(params.memory);
  const historyText = params.history
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.content.slice(0, 500)}`)
    .join('\n');
  const catalog = candidates
    .map((item) => `- ${item.id} [${item.kind}]: ${item.text}`)
    .join('\n');

  return {
    candidates,
    prompt: [
      '你是姬子的记忆筛选器。请根据本轮用户真实意图，判断哪些长期记忆会帮助姬子回答。',
      '不要做关键词匹配；要理解语义、上下文和用户长期偏好。',
      `最多选择 ${params.limit} 条。无关就选 0 条。`,
      '只返回 JSON，不要 Markdown，不要解释。',
      '格式：{"selected":["m1","m2"]}',
      '',
      '【最近对话】',
      historyText || '(无)',
      '',
      '【可选长期记忆】',
      catalog || '(无)',
      '',
      '【本轮用户输入】',
      params.userText,
    ].join('\n'),
  };
}

export async function selectRelevantJiziMemoryWithLLM(
  userText: string,
  memory: MasterMemory,
  cfg: LLMConfig,
  model: string,
  history: ChatTurn[] = [],
  signal?: AbortSignal,
  limit = 10,
): Promise<string[]> {
  const { prompt, candidates } = buildMemorySelectionPrompt({
    userText,
    memory,
    history,
    limit,
  });
  if (candidates.length === 0) return [];

  try {
    const reply = await chat({
      cfg,
      model,
      system: '你只负责为姬子筛选长期记忆，只输出 JSON。',
      text: prompt,
      signal,
    });
    return parseRelevantMemoryReply(reply, candidates, limit);
  } catch {
    return fallbackStableMemory(memory).slice(0, limit);
  }
}
