// 联网搜索:三家厂商(Serper/Tavily/Brave)各自适配,归一化成统一结果,
// 再由 searchWithFailover 按优先级逐家尝试——一家失败/额度耗尽(429/402/网络错误)自动降级到下一家。
// 桌面端(Tauri)用插件 fetch 在 Rust 侧发请求,绕开 WebView 的浏览器同源/CORS 限制
// (Brave 等厂商的接口不支持浏览器 CORS 预检,纯浏览器预览下仍会被拦截,属已知限制)。

import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { SearchApi } from './searchProviders';
import { createTimeoutSignal } from './abortUtils'; // M1：消除重复超时信号逻辑

const httpFetch: typeof fetch = isTauri() ? (tauriFetch as typeof fetch) : fetch;

const SEARCH_TIMEOUT = 10000;

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

// 携带失败归因的搜索错误:auth=密钥无效/未授权,quota=额度耗尽/限流,unavailable=其它不可用。
// 让 failover 在全部失败后能给出「换密钥」还是「等额度/换厂商」的准确提示。
export type SearchErrorKind = 'auth' | 'quota' | 'unavailable';

export class SearchError extends Error {
  kind: SearchErrorKind;
  status: number;
  constructor(provider: string, status: number) {
    let kind: SearchErrorKind;
    let reason: string;
    if (status === 401 || status === 403) {
      kind = 'auth';
      reason = '密钥无效或未授权';
    } else if (status === 429 || status === 402) {
      kind = 'quota';
      reason = '额度耗尽或触发限流';
    } else {
      kind = 'unavailable';
      reason = '服务不可用';
    }
    super(`${provider}：${reason} (${status})`);
    this.name = 'SearchError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ActiveEntry {
  providerId: string;
  api: SearchApi;
  apiKey: string;
}

export interface SearchOutcome {
  provider: string; // 实际命中的厂商 id
  results: SearchResult[];
}

// 单次请求限时,同时并入外部取消（M1：已统一到 abortUtils.createTimeoutSignal）

// 各厂商返回结构不同,但归一化步骤一致:取数组 → 截断 topN → 映射三字段 → 丢弃无链接项。
// map 由各家提供,负责把自家字段名映射到 { title, snippet, link }。
function normalizeResults<T>(
  raw: unknown,
  topN: number,
  map: (r: T) => { title?: string; snippet?: string; link?: string },
): SearchResult[] {
  const list = Array.isArray(raw) ? (raw as T[]) : [];
  return list
    .slice(0, topN)
    .map((r) => {
      const m = map(r);
      return {
        title: m.title ?? '',
        snippet: m.snippet ?? '',
        link: m.link ?? '',
      };
    })
    .filter((r) => r.link);
}

async function searchSerper(
  key: string,
  query: string,
  topN: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const res = await httpFetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query }),
    signal,
  });
  if (!res.ok) throw new SearchError('Serper', res.status);
  const data = await res.json();
  return normalizeResults<{ title?: string; snippet?: string; link?: string }>(
    data?.organic,
    topN,
    (r) => ({ title: r.title, snippet: r.snippet, link: r.link }),
  );
}

async function searchTavily(
  key: string,
  query: string,
  topN: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const res = await httpFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, max_results: topN }),
    signal,
  });
  if (!res.ok) throw new SearchError('Tavily', res.status);
  const data = await res.json();
  return normalizeResults<{ title?: string; content?: string; url?: string }>(
    data?.results,
    topN,
    (r) => ({ title: r.title, snippet: r.content, link: r.url }),
  );
}

async function searchBrave(
  key: string,
  query: string,
  topN: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
    query,
  )}&count=${topN}`;
  const res = await httpFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal,
  });
  if (!res.ok) throw new SearchError('Brave', res.status);
  const data = await res.json();
  return normalizeResults<{ title?: string; description?: string; url?: string }>(
    data?.web?.results,
    topN,
    (r) => ({ title: r.title, snippet: r.description, link: r.url }),
  );
}

function dispatch(
  entry: ActiveEntry,
  query: string,
  topN: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  switch (entry.api) {
    case 'serper':
      return searchSerper(entry.apiKey, query, topN, signal);
    case 'tavily':
      return searchTavily(entry.apiKey, query, topN, signal);
    case 'brave':
      return searchBrave(entry.apiKey, query, topN, signal);
    default: {
      // 编译期兜底:新增厂商未在此登记会在此处报类型错误
      const exhaustive: never = entry.api;
      throw new Error(`未知的搜索厂商：${String(exhaustive)}`);
    }
  }
}

// 测试单家 key 是否生效:发一次极简查询,能正常返回(不论有无结果)即视为有效。
export interface TestKeyResult {
  ok: boolean;
  count?: number;
  error?: string;
}

export async function testSearchKey(
  api: SearchApi,
  apiKey: string,
): Promise<TestKeyResult> {
  if (!apiKey.trim()) return { ok: false, error: '未填写 API Key' };
  const { signal, done } = createTimeoutSignal(SEARCH_TIMEOUT);
  try {
    const results = await dispatch(
      { providerId: api, api, apiKey },
      'test',
      1,
      signal,
    );
    return { ok: true, count: results.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '请求失败';
    return { ok: false, error: msg };
  } finally {
    done();
  }
}

// 按优先级逐家尝试:命中即返回;某家报错(含额度耗尽)则降级下一家;全部失败才抛错。
export async function searchWithFailover(
  entries: ActiveEntry[],
  query: string,
  topN = 5,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  if (entries.length === 0) throw new Error('未配置任何搜索厂商');
  if (!query.trim()) return { provider: entries[0].providerId, results: [] };

  let lastErr: unknown;
  let lastEmpty: string | null = null;

  for (const entry of entries) {
    if (signal?.aborted) throw new Error('已取消');
    const { signal: reqSignal, done } = createTimeoutSignal(SEARCH_TIMEOUT, signal);
    try {
      const results = await dispatch(entry, query, topN, reqSignal);
      if (results.length > 0) return { provider: entry.providerId, results };
      lastEmpty = entry.providerId; // 有效但无结果,继续试下一家
    } catch (err) {
      lastErr = err;
      // L17 修复：abort 时抛 AbortError 而非原始错误，让调用方能区分取消与真实失败
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    } finally {
      done();
    }
  }

  // 全部试完:若曾有厂商正常返回但无结果,返回空;否则抛出最后的错误
  if (lastEmpty) return { provider: lastEmpty, results: [] };
  throw lastErr instanceof Error ? lastErr : new Error('所有搜索厂商均不可用');
}
