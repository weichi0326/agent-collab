import type { SearchResult } from './searchClient';
import { chat, type LLMConfig } from './llmClient';
import { cleanJsonFence } from './masterPlanner';

export interface SearchQualityReport {
  kept: SearchResult[];
  summary: string;
  droppedCount: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseQualityReply(reply: string, results: SearchResult[]): SearchQualityReport {
  const root = asObject(JSON.parse(cleanJsonFence(reply)));
  const indexes = Array.isArray(root?.keep)
    ? root.keep
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= results.length)
    : [];
  const unique = Array.from(new Set(indexes));
  const kept = unique.length > 0 ? unique.map((index) => results[index - 1]) : results.slice(0, 3);
  const summary = typeof root?.summary === 'string' && root.summary.trim()
    ? root.summary.trim()
    : '已筛掉明显不相关或低价值的搜索结果。';
  return { kept, summary, droppedCount: Math.max(0, results.length - kept.length) };
}

function buildQualityPrompt(userText: string, query: string, results: SearchResult[]): string {
  const rows = results.map((result, index) => [
    `${index + 1}. ${result.title}`,
    result.snippet,
    result.link,
  ].join('\n')).join('\n\n');
  return [
    '你是姬子的搜索结果质检员。你不回答用户，只判断哪些搜索结果值得注入给回答模型。',
    '请保留与用户问题直接相关、来源看起来可靠、信息有价值的结果。丢弃广告、标题党、明显不相关、重复、过时或内容太空的结果。',
    '如果没有结果足够好，可以保留 0 个。',
    '只返回 JSON，不要 Markdown。格式：{"keep":[1,3],"summary":"一句话说明筛选情况"}',
    '',
    `【用户问题】${userText}`,
    `【搜索词】${query}`,
    '',
    '【候选结果】',
    rows || '(无)',
  ].join('\n');
}

export async function assessSearchResultsWithLLM(params: {
  userText: string;
  query: string;
  results: SearchResult[];
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
}): Promise<SearchQualityReport> {
  const results = params.results.slice(0, 8);
  if (results.length === 0) return { kept: [], summary: '没有搜索结果可用。', droppedCount: 0 };
  try {
    const reply = await chat({
      cfg: params.cfg,
      model: params.model,
      system: '你只负责筛选搜索结果，只输出 JSON。',
      text: buildQualityPrompt(params.userText, params.query, results),
      signal: params.signal,
      scene: 'search-quality',
    });
    return parseQualityReply(reply, results);
  } catch {
    return {
      kept: results.slice(0, 5),
      summary: '搜索结果质检失败，已保留前几条结果。',
      droppedCount: Math.max(0, results.length - 5),
    };
  }
}
