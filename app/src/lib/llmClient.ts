// LLM 请求统一经 Python llm-calling 发出，由固定 IP 连接层执行 SSRF 防护。

import type { ProviderApi } from './providers';
import { createTimeoutSignal } from './abortUtils'; // M1：消除重复超时信号逻辑
import { ensureCompatiblePythonService, executeTool, unwrapToolResult } from './pythonClient';
import { useTokenStatsStore, type JiziScene } from '../stores/tokenStatsStore';
import { validateModelBaseUrl } from './modelEndpoint';

export const LATENCY_LOW = 1000; // <1s 低延迟(绿)
export const TIMEOUT = 10000; // 探活/取列表:>10s 视为超时(红)
export const CHAT_TIMEOUT = 120000; // 对话:回复可能较长,给 120s

export interface LLMConfig {
  api: ProviderApi;
  baseURL: string;
  apiKey: string;
}

export type TestStatus = 'ok-low' | 'ok-high' | 'fail';

function trimBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

// 获取模型列表
export async function listModels(cfg: LLMConfig): Promise<string[]> {
  const base = trimBase(await validateModelBaseUrl(cfg.baseURL));
  if (!base) throw new Error('缺少 baseURL');
  if (!cfg.apiKey) throw new Error('缺少密钥');

  await ensureCompatiblePythonService();
  const { signal, done } = createTimeoutSignal(TIMEOUT);
  try {
    const res = await executeTool('llm-calling', {
      action: 'list_models',
      api: cfg.api,
      base_url: base,
      api_key: cfg.apiKey,
    }, signal);
    const result = unwrapToolResult<{ models?: unknown }>(res, '获取模型列表失败');
    if (
      !Array.isArray(result.models) ||
      result.models.some((model) => typeof model !== 'string')
    ) {
      throw new Error('返回格式无法解析');
    }
    return result.models;
  } finally {
    done();
  }
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

const MAX_TOKENS = 30000; // anthropic 必填,openai/gemini 忽略

// 单轮对话(非流式)。三协议统一入口:anthropic 走 /messages;openai/gemini 兼容端点走 /chat/completions。
// 图片走各协议的多模态 content 块。取消由外部 signal 驱动。
export async function chat(params: ChatParams): Promise<string> {
  const { cfg, model, system, text, images = [], history = [], signal, scene } = params;
  const base = trimBase(await validateModelBaseUrl(cfg.baseURL));
  if (!base) throw new Error('缺少 baseURL');
  if (!cfg.apiKey) throw new Error('缺少密钥');
  if (!model) throw new Error('缺少模型');

  const { signal: reqSignal, done } = createTimeoutSignal(CHAT_TIMEOUT, signal);
  try {
    await ensureCompatiblePythonService();
    let messages: unknown[];
    let systemPayload: unknown;
    if (cfg.api === 'anthropic') {
      const content: unknown[] = images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      }));
      content.push({ type: 'text', text });
      messages = [
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content },
      ];
      // 人格提示词是稳定前缀，保留 Anthropic prompt cache 标记。
      systemPayload = system
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : undefined;
    } else {
      const userContent = images.length > 0
        ? [
            { type: 'text', text },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
            })),
          ]
        : text;
      messages = [];
      if (system) messages.push({ role: 'system', content: system });
      for (const turn of history) messages.push({ role: turn.role, content: turn.content });
      messages.push({ role: 'user', content: userContent });
    }

    const res = await executeTool('llm-calling', {
      api: cfg.api,
      base_url: base,
      api_key: cfg.apiKey,
      model,
      ...(systemPayload === undefined ? {} : { system: systemPayload }),
      messages,
      max_tokens: MAX_TOKENS,
    }, reqSignal);
    const result = unwrapToolResult<{
      reply?: unknown;
      usage?: { total?: unknown };
    }>(res, '模型对话失败');
    if (typeof result.reply !== 'string') throw new Error('返回格式无法解析');
    recordChatUsage(model, result.usage?.total ?? 0, scene);
    return result.reply;
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
