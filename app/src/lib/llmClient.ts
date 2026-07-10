// 唯一联网出入口(LLM 请求)。桌面端(Tauri)用插件 fetch 在 Rust 侧发请求,绕开 WebView 的浏览器同源/CORS 限制
// (多数 LLM 厂商接口不支持浏览器 CORS 预检,纯浏览器预览下仍会被拦截,属已知限制)。

import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ProviderApi } from './providers';
import { createTimeoutSignal } from './abortUtils'; // M1：消除重复超时信号逻辑
import { ensureCompatiblePythonService, executeTool, unwrapToolResult } from './pythonClient';
import { useTokenStatsStore, type JiziScene } from '../stores/tokenStatsStore';

const httpFetch: typeof fetch = isTauri() ? (tauriFetch as typeof fetch) : fetch;

export const LATENCY_LOW = 1000; // <1s 低延迟(绿)
export const TIMEOUT = 10000; // 探活/取列表:>10s 视为超时(红)
export const CHAT_TIMEOUT = 120000; // 对话:回复可能较长,给 120s

export interface LLMConfig {
  api: ProviderApi;
  baseURL: string;
  apiKey: string;
}

export type TestStatus = 'ok-low' | 'ok-high' | 'fail';

function authHeaders(cfg: LLMConfig): Record<string, string> {
  if (cfg.api === 'anthropic') {
    return {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  // openai / gemini(OpenAI 兼容端点)统一 Bearer
  return { Authorization: `Bearer ${cfg.apiKey}` };
}

function trimBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const { signal, done } = createTimeoutSignal(TIMEOUT);
  try {
    return await httpFetch(url, { ...init, signal });
  } finally {
    done();
  }
}

// 获取模型列表
export async function listModels(cfg: LLMConfig): Promise<string[]> {
  const base = trimBase(cfg.baseURL);
  if (!base) throw new Error('缺少 baseURL');
  if (!cfg.apiKey) throw new Error('缺少密钥');

  const url = `${base}/models`;
  const res = await withTimeout(url, {
    method: 'GET',
    headers: authHeaders(cfg),
  });
  if (!res.ok) {
    throw new Error(`请求失败 (${res.status})`);
  }
  const data = await res.json();
  // OpenAI/Anthropic/Gemini 兼容端点均返回 { data: [{ id }] }
  const list = Array.isArray(data?.data) ? data.data : data?.models;
  if (!Array.isArray(list)) throw new Error('返回格式无法解析');
  return list
    .map((m: unknown) =>
      typeof m === 'string'
        ? m
        : (m as { id?: string; name?: string })?.id ??
          (m as { name?: string })?.name ??
          '',
    )
    .filter((id: string) => !!id);
}

async function errorText(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.text();
    if (body) {
      try {
        const j = JSON.parse(body);
        const raw =
          j?.error?.message ??
          j?.error?.detail ??
          j?.error ??
          j?.message ??
          j?.detail ??
          j?.reason ??
          j?.code ??
          '';
        detail =
          typeof raw === 'string'
            ? raw
            : raw
              ? JSON.stringify(raw)
              : body.slice(0, 500);
      } catch {
        detail = body.slice(0, 500);
      }
    }
  } catch {
    /* 无 body,忽略 */
  }
  return detail
    ? `请求失败 (${res.status}): ${detail}`
    : `请求失败 (${res.status})`;
}

// 随消息一起发送的图片(base64,不含 data: 前缀)
export interface ChatImage {
  mediaType: string; // 如 image/png
  base64: string;
}

// 历史轮次(纯文本,不含附件):用于携带上下文做多轮对话
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  cfg: LLMConfig;
  model: string;
  system?: string;
  text: string;
  images?: ChatImage[];
  history?: ChatTurn[]; // 之前的对话轮次(不含当前这轮)
  signal?: AbortSignal; // 供取消
  scene: JiziScene; // 姬子调用场景,用于 token 按场景统计(必填)
}

const MAX_TOKENS = 4096; // anthropic 必填,openai/gemini 忽略

// 单轮对话(非流式)。三协议统一入口:anthropic 走 /messages;openai/gemini 兼容端点走 /chat/completions。
// 图片走各协议的多模态 content 块。取消由外部 signal 驱动。
export async function chat(params: ChatParams): Promise<string> {
  const { cfg, model, system, text, images = [], history = [], signal, scene } = params;
  const base = trimBase(cfg.baseURL);
  if (!base) throw new Error('缺少 baseURL');
  if (!cfg.apiKey) throw new Error('缺少密钥');
  if (!model) throw new Error('缺少模型');

  const { signal: reqSignal, done } = createTimeoutSignal(CHAT_TIMEOUT, signal);
  try {
    if (cfg.api === 'anthropic') {
      const content: unknown[] = images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      }));
      content.push({ type: 'text', text });
      const res = await httpFetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          ...authHeaders(cfg),
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          // 人格提示词是每轮几乎不变的稳定前缀,标记 cache_control 后第二轮起按 ~10% 计费;
          // 块过短(<最小可缓存 token)时厂商会静默跳过缓存,不会报错。
          ...(system
            ? {
                system: [
                  {
                    type: 'text',
                    text: system,
                    cache_control: { type: 'ephemeral' },
                  },
                ],
              }
            : {}),
          messages: [
            ...history.map((t) => ({ role: t.role, content: t.content })),
            { role: 'user', content },
          ],
        }),
        signal: reqSignal,
      });
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      const blocks: Array<{ type?: string; text?: string }> = Array.isArray(
        data?.content,
      )
        ? data.content
        : [];
      const out = blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      // Token 用量:anthropic 无 total 字段,input+output 相加。chat() 现所有调用点都是姬子侧,计入总控。
      recordChatUsage(model, (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0), scene);
      return out || '(空回复)';
    }

    // openai / gemini(OpenAI 兼容)
    const userContent =
      images.length > 0
        ? [
            { type: 'text', text },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
            })),
          ]
        : text;
    const messages: unknown[] = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const t of history) messages.push({ role: t.role, content: t.content });
    messages.push({ role: 'user', content: userContent });
    const res = await httpFetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders(cfg), 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages }),
      signal: reqSignal,
    });
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content;
    if (typeof out !== 'string') throw new Error('返回格式无法解析');
    // Token 用量:openai 兼容端点取 usage.total_tokens。
    recordChatUsage(model, data?.usage?.total_tokens ?? 0, scene);
    return out;
  } finally {
    done();
  }
}

// chat() 是姬子(总控)侧唯一 LLM 入口(masterPlanner/orchestratorStore/toolGenerator 三处调用),
// 故在此统一记录 token 到总控维度。若未来出现非姬子场景调用 chat(),需在此另行分流。
function recordChatUsage(model: string, total: unknown, scene: JiziScene): void {
  const n = typeof total === 'number' ? total : 0;
  if (n > 0) useTokenStatsStore.getState().recordMaster(model, n, scene);
}

// L16 修复：边界值改为 <=，延迟恰好 1000ms 归入低延迟档
function classify(latencyMs: number): TestStatus {
  return latencyMs <= LATENCY_LOW ? 'ok-low' : 'ok-high';
}

async function testChatConnection(cfg: LLMConfig, model: string): Promise<void> {
  await ensureCompatiblePythonService();
  const res = await executeTool('llm-calling', {
    api: cfg.api,
    base_url: cfg.baseURL,
    api_key: cfg.apiKey,
    model,
    messages: [
      {
        role: 'user',
        content: '请只回复 OK，用于测试模型真实对话接口是否可用。',
      },
    ],
    max_tokens: 64,
  });
  // 调用 executeTool 后用 unwrapToolResult 统一处理失败（抛错），成功结果本处不消费。
  unwrapToolResult(res, '模型真实对话测试失败');
}

// 通信测试:优先走 Python llm-calling 发起真实 chat；无模型时退回模型列表探活。
export async function testConnection(
  cfg: LLMConfig,
  model?: string,
): Promise<{ status: TestStatus; latencyMs: number }> {
  const start = performance.now();
  try {
    if (model) {
      await testChatConnection(cfg, model);
    } else {
      await listModels(cfg);
    }
    const latencyMs = Math.round(performance.now() - start);
    return { status: classify(latencyMs), latencyMs };
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return { status: 'fail', latencyMs };
  }
}
