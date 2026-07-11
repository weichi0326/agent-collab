// Python 服务 HTTP 客户端（M5/M6）。
// 调用模式与 llmClient.ts 一致：Tauri 桌面端用插件 fetch 绕 CORS，浏览器预览回落原生 fetch。
// Python 服务监听 localhost:18081，由 Tauri setup 时自动拉起。

import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { createTimeoutSignal } from './abortUtils'; // M1：消除重复超时信号逻辑

const httpFetch: typeof fetch = isTauri() ? (tauriFetch as typeof fetch) : fetch;

const BASE_URL = 'http://localhost:18081';

// 服务鉴权令牌:由 Rust 会话级生成,前端取一次缓存(跨 Python 重启沿用同一 token)。
let cachedServiceToken: string | null = null;
async function getServiceToken(): Promise<string> {
  if (!isTauri()) return ''; // 浏览器预览无 Rust,后台也未配 token→无鉴权
  if (cachedServiceToken !== null) return cachedServiceToken;
  try {
    cachedServiceToken = await invoke<string>('service_token_cmd');
  } catch {
    cachedServiceToken = '';
  }
  return cachedServiceToken;
}

// Python 工具接口统一入口:注入 X-Service-Token 头;401 时刷新 token 重试一次
// (应对 Python 重启后极端不同步)。/health 不走此函数(豁免鉴权)。
async function pyFetch(url: string, init: RequestInit): Promise<Response> {
  const withToken = (t: string): RequestInit => ({
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(t ? { 'X-Service-Token': t } : {}),
    },
  });
  const token = await getServiceToken();
  let res = await httpFetch(url, withToken(token));
  if (res.status === 401 && isTauri()) {
    cachedServiceToken = null;
    const fresh = await getServiceToken();
    if (fresh && fresh !== token) res = await httpFetch(url, withToken(fresh));
  }
  return res;
}
const HEALTH_TIMEOUT = 3000;  // 健康检查超时
const EXECUTE_TIMEOUT = 300000; // 工具执行超时（LLM/文档任务可能需要较长时间）
// ⚠️ 必须与 python/tools/llm_calling.py 的 LLM_CALLING_VERSION 完全一致。
// 后台工具返回结构/行为一变就两处同步升,否则旧后台不会被识别并强制重启(见该文件注释)。
export const EXPECTED_PYTHON_SERVICE_VERSION = '2026-07-11.custom-model-endpoints';

export type ServiceStatus = 'starting' | 'running' | 'stopped';

interface HealthPayload {
  status?: string;
  serviceVersion?: string;
}

// ─── 健康检查 ────────────────────────────────────────────────
/** 探活详情：返回 null 表示服务不可达或响应不可解析。 */
export async function getHealth(): Promise<HealthPayload | null> {
  const { signal, done } = createTimeoutSignal(HEALTH_TIMEOUT);
  try {
    const res = await httpFetch(`${BASE_URL}/health`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as HealthPayload;
  } catch {
    return null;
  } finally {
    done();
  }
}

/** 探活：返回 true 表示服务已就绪。 */
export async function pingHealth(): Promise<boolean> {
  return (await getHealth())?.status === 'ok';
}

function isCompatibleHealth(health: HealthPayload | null): boolean {
  return (
    health?.status === 'ok' &&
    health.serviceVersion === EXPECTED_PYTHON_SERVICE_VERSION
  );
}

async function waitForCompatibleHealth(): Promise<boolean> {
  for (let i = 0; i < 12; i += 1) {
    if (isCompatibleHealth(await getHealth())) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 350));
  }
  return false;
}

/**
 * 运行任务前确认后台代码版本正确。
 * 旧后台即使 /health 可达，也可能仍在使用修复前的工具代码，需要主动重启。
 */
export async function ensureCompatiblePythonService(): Promise<void> {
  const health = await getHealth();
  if (isCompatibleHealth(health)) return;

  if (!isTauri()) {
    throw new Error(
      health
        ? 'Python 工具服务版本过旧，请重启桌面应用后再运行。'
        : 'Python 工具服务未就绪，请先启动桌面应用或检查服务状态。',
    );
  }

  const status = await restartPythonService();
  if (status !== 'running') {
    throw new Error(
      health
        ? 'Python 工具服务版本过旧，且自动重启失败，请先运行环境配置器。'
        : 'Python 工具服务未就绪，且自动启动失败，请先运行环境配置器。',
    );
  }

  if (!(await waitForCompatibleHealth())) {
    const after = await getHealth();
    throw new Error(
      `Python 工具服务版本未更新，请重启应用后再运行。当前版本：${after?.serviceVersion ?? '未知'}`,
    );
  }
}

/** 查询 Rust 侧记录的进程状态（不等于 HTTP 可达性）。 */
export async function getProcessStatus(): Promise<'running' | 'stopped'> {
  if (!isTauri()) return 'stopped';
  try {
    const status = await invoke<string>('python_status');
    return status === 'running' ? 'running' : 'stopped';
  } catch {
    return 'stopped';
  }
}

/** 手动重启 Rust 托管的 Python 后台服务。 */
export async function restartPythonService(): Promise<'running' | 'stopped'> {
  if (!isTauri()) {
    throw new Error('请在桌面应用中重启后台服务');
  }
  const status = await invoke<string>('python_restart');
  return status === 'running' ? 'running' : 'stopped';
}

/**
 * 综合服务状态：HTTP 可达即视为可用；Rust 侧进程已起但 HTTP 还未就绪 → "starting"；
 * 进程不存在且 HTTP 不可达 → "stopped"。
 */
export async function getServiceStatus(): Promise<ServiceStatus> {
  const alive = await pingHealth();
  if (alive) return 'running';
  const processStatus = await getProcessStatus();
  if (processStatus === 'stopped') return 'stopped';
  return 'starting';
}

// ─── 工具列表 ────────────────────────────────────────────────
/** 获取 Python 服务已注册的工具名称列表。 */
export async function listTools(): Promise<string[]> {
  const { signal, done } = createTimeoutSignal(HEALTH_TIMEOUT);
  try {
    const res = await pyFetch(`${BASE_URL}/tools`, { signal });
    if (!res.ok) return [];
    return (await res.json()) as string[];
  } catch {
    return [];
  } finally {
    done();
  }
}

// ─── 工具元数据 ──────────────────────────────────────────────
export type ToolSource = 'builtin' | 'manual' | 'generated';

export interface ToolMetaCapability {
  label: string;
  description: string;
}

export interface ToolMetaImplementation {
  language: string;
  libraries: string[];
  note?: string;
}

export interface ToolMeta {
  name: string;
  module: string | null;
  description: string;
  tags: string[];
  dependencies: string[];
  implementation?: ToolMetaImplementation;
  capabilities?: ToolMetaCapability[];
  source: ToolSource;
  builtin: boolean;
  internal: boolean;
  createdAt: number | null;
  loadError: string | null;
}

/** 获取内置 + 自定义工具的统一元数据（GET /tools/meta）。 */
export async function listToolMeta(): Promise<ToolMeta[]> {
  const { signal, done } = createTimeoutSignal(HEALTH_TIMEOUT);
  try {
    const res = await pyFetch(`${BASE_URL}/tools/meta`, { signal });
    if (!res.ok) return [];
    return (await res.json()) as ToolMeta[];
  } catch {
    return [];
  } finally {
    done();
  }
}

// ─── 工具安装审计 ────────────────────────────────────────────
export interface ToolAuditRecord {
  ts: number;
  name: string;
  approved_by: string;
  reason: string;
  allow_side_effects: boolean;
  code_sha256: string;
  code_excerpt: string;
  source: string;
}

/** 获取工具安装审计日志(GET /tools/audit-log),最近若干条,时间升序。 */
export async function listToolAuditLog(): Promise<ToolAuditRecord[]> {
  const { signal, done } = createTimeoutSignal(HEALTH_TIMEOUT);
  try {
    const res = await pyFetch(`${BASE_URL}/tools/audit-log`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { records?: ToolAuditRecord[] };
    return data.records ?? [];
  } catch {
    return [];
  } finally {
    done();
  }
}

// ─── 工具安装 / 删除 ─────────────────────────────────────────
export interface InstallToolPayload {
  name: string;
  description: string;
  tags: string[];
  dependencies: string[];
  implementation?: ToolMetaImplementation;
  capabilities?: ToolMetaCapability[];
  code: string;
  // 顶层副作用放行位(默认省略=false)。仅桌面 UI 明确勾选时置 true,由 installer.py 硬门校验。
  allow_top_level_side_effects?: boolean;
  // 放行副作用时必填:{ approved_by, reason }。installer 收紧后缺失会拒装,并写入安装审计。
  approval?: { approved_by: string; reason: string };
}

export interface InstallToolResult {
  ok: boolean;
  error?: string;
}

export interface WebPageContent {
  url: string;
  contentType: string;
  text: string;
}

export async function readWebPage(
  url: string,
  signal?: AbortSignal,
): Promise<WebPageContent> {
  const { signal: reqSignal, done } = createTimeoutSignal(EXECUTE_TIMEOUT, signal);
  try {
    const res = await pyFetch(`${BASE_URL}/web/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: reqSignal,
    });
    if (!res.ok) {
      const detail = await parseHttpError(res);
      throw new Error(detail || '网页正文读取失败');
    }
    return (await res.json()) as WebPageContent;
  } finally {
    done();
  }
}

/** 读取自定义工具完整定义，供覆盖/删除事务在失败时恢复。 */
export async function getToolSnapshot(
  toolName: string,
  signal?: AbortSignal,
): Promise<InstallToolPayload> {
  const { signal: reqSignal, done } = createTimeoutSignal(HEALTH_TIMEOUT, signal);
  try {
    const res = await pyFetch(
      `${BASE_URL}/tools/${encodeURIComponent(toolName)}/snapshot`,
      { signal: reqSignal },
    );
    if (!res.ok) {
      const detail = await parseHttpError(res);
      throw new Error(detail || `无法读取工具「${toolName}」的回滚快照`);
    }
    return (await res.json()) as InstallToolPayload;
  } finally {
    done();
  }
}

/** 安装自定义工具（落盘 + 装依赖 + 注册，POST /tools/install）。 */
export async function installTool(
  payload: InstallToolPayload,
  signal?: AbortSignal,
): Promise<InstallToolResult> {
  const { signal: reqSignal, done } = createTimeoutSignal(EXECUTE_TIMEOUT, signal);
  try {
    const res = await pyFetch(`${BASE_URL}/tools/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: reqSignal,
    });
    if (!res.ok) {
      const detail = await parseHttpError(res);
      return { ok: false, error: detail || `HTTP ${res.status}` };
    }
    return (await res.json()) as InstallToolResult;
  } catch (err) {
    if (reqSignal.aborted) {
      throw new DOMException('已中止安装', 'AbortError');
    }
    const msg = err instanceof Error ? err.message : '安装请求失败';
    return { ok: false, error: msg };
  } finally {
    done();
  }
}

/** 删除自定义工具（POST /tools/{name}/remove，拒删内置）。 */
export async function removeTool(toolName: string): Promise<InstallToolResult> {
  const { signal, done } = createTimeoutSignal(HEALTH_TIMEOUT);
  try {
    const res = await pyFetch(
      `${BASE_URL}/tools/${encodeURIComponent(toolName)}/remove`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal },
    );
    if (!res.ok) {
      const detail = await parseHttpError(res);
      return { ok: false, error: detail || `HTTP ${res.status}` };
    }
    return (await res.json()) as InstallToolResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '删除请求失败';
    return { ok: false, error: msg };
  } finally {
    done();
  }
}

// ─── 工具执行 ────────────────────────────────────────────────
export interface ToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** 解析 HTTP 错误响应体为可读字符串：优先 detail，其次 error，最后原始 body；解析失败返回空串。 */
async function parseHttpError(res: Response): Promise<string> {
  try {
    const body = await res.text();
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
    return typeof parsed.detail === 'string'
      ? parsed.detail
      : typeof parsed.error === 'string'
        ? parsed.error
        : body;
  } catch {
    return '';
  }
}

/** 解包 ToolResult：失败抛 Error（res.error 优先，否则 fallback），成功返回 result。 */
export function unwrapToolResult<T = unknown>(res: ToolResult, fallback: string): T {
  if (!res.ok) throw new Error(res.error || fallback);
  return res.result as T;
}

/** 调用 Python 工具执行接口。 */
export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const { signal: reqSignal, done } = createTimeoutSignal(EXECUTE_TIMEOUT, signal);
  try {
    const res = await pyFetch(`${BASE_URL}/tools/${encodeURIComponent(toolName)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
      signal: reqSignal,
    });
    if (!res.ok) {
      const detail = await parseHttpError(res);
      if (res.status === 404) {
        return {
          ok: false,
          error:
            `工具「${toolName}」未注册。` +
            '请重启应用或 Python 服务后再运行。' +
            (detail ? ` (${detail})` : ''),
        };
      }
      return {
        ok: false,
        error: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
      };
    }
    return (await res.json()) as ToolResult;
  } catch (err) {
    if (reqSignal.aborted) {
      throw new DOMException('已中止任务', 'AbortError');
    }
    const msg = err instanceof Error ? err.message : '请求失败';
    return { ok: false, error: msg };
  } finally {
    done();
  }
}
