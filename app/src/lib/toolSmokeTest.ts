import { asObject } from './jsonGuards';
import { executeTool, type ToolResult } from './pythonClient';
import { chat, type LLMConfig } from './llmClient';
import { cleanJsonFence } from './masterPlanner';
import type { MasterAction } from './masterActions/types';

export interface ToolSmokeTestOutcome {
  ok: boolean;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

function safeSmokeParams(value: unknown): Record<string, unknown> {
  const obj = asObject(value);
  return obj ? obj : {};
}

export async function runToolSmokeTest(
  action: Extract<MasterAction, { type: 'create-tool' }>,
  signal?: AbortSignal,
): Promise<ToolSmokeTestOutcome> {
  const params = safeSmokeParams(action.smokeTestParams);
  let res: ToolResult;
  try {
    res = await executeTool(action.name, params, signal);
  } catch (err) {
    return {
      ok: false,
      params,
      error: err instanceof Error ? err.message : '试运行请求失败',
    };
  }
  if (!res.ok) {
    return { ok: false, params, error: res.error || '试运行失败' };
  }
  return { ok: true, params, result: res.result };
}

function buildRepairPrompt(params: {
  action: Extract<MasterAction, { type: 'create-tool' }>;
  smoke: ToolSmokeTestOutcome;
}): string {
  const { action, smoke } = params;
  return [
    '你是 Python 工具修复器。下面这个多 Agent 应用的自定义工具已经安装，但 smoke test 失败了。',
    '请只输出 JSON 对象，不要 Markdown，不要解释。',
    '你可以修改 code、description、dependencies、implementation、capabilities、smokeTestParams。',
    '必须保留同一个 name；必须继续定义 async def execute(params)。',
    'smokeTestParams 必须是安全离线参数：不要访问真实外网、不要删除用户文件、不要依赖用户私人路径。',
    '',
    '返回格式：',
    '{"name":"same-name","description":"中文描述","dependencies":[],"implementation":{"language":"Python 3.10+","libraries":["标准库"],"note":"中文原理"},"capabilities":[{"label":"能力","description":"说明"}],"smokeTestParams":{},"code":"完整 Python 代码"}',
    '',
    `【工具名】${action.name}`,
    `【原描述】${action.description}`,
    `【依赖】${JSON.stringify(action.dependencies)}`,
    `【试运行参数】${JSON.stringify(smoke.params)}`,
    `【试运行错误】${smoke.error || '未知错误'}`,
    '【原代码】',
    action.code,
  ].join('\n');
}

export async function repairGeneratedToolAfterSmokeFailure(
  action: Extract<MasterAction, { type: 'create-tool' }>,
  smoke: ToolSmokeTestOutcome,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
): Promise<Extract<MasterAction, { type: 'create-tool' }>> {
  const reply = await chat({
    cfg,
    model,
    system: '你只负责修复 Python 工具代码，只输出 JSON。',
    text: buildRepairPrompt({ action, smoke }),
    signal,
    scene: 'tool-smoke',
  });

  const parsed = JSON.parse(cleanJsonFence(reply)) as Record<string, unknown>;
  const name = String(parsed.name ?? '').trim();
  if (name !== action.name) {
    throw new Error('模型修复时改了工具名，已拒绝自动覆盖。');
  }
  const code = String(parsed.code ?? '');
  if (!code.trim() || !/async\s+def\s+execute\s*\(/.test(code)) {
    throw new Error('模型修复后的代码缺少 async def execute。');
  }

  return {
    ...action,
    description: String(parsed.description ?? action.description).trim() || action.description,
    dependencies: Array.isArray(parsed.dependencies)
      ? parsed.dependencies.map((item) => String(item).trim()).filter(Boolean)
      : action.dependencies,
    implementation: asObject(parsed.implementation)
      ? {
          language: String((parsed.implementation as Record<string, unknown>).language ?? 'Python 3.10+'),
          libraries: Array.isArray((parsed.implementation as Record<string, unknown>).libraries)
            ? ((parsed.implementation as Record<string, unknown>).libraries as unknown[]).map((item) => String(item).trim()).filter(Boolean)
            : action.implementation?.libraries ?? action.dependencies,
          note: String((parsed.implementation as Record<string, unknown>).note ?? '').trim() || action.implementation?.note,
        }
      : action.implementation,
    capabilities: Array.isArray(parsed.capabilities)
      ? parsed.capabilities
          .map(asObject)
          .filter((item): item is Record<string, unknown> => !!item)
          .map((item) => ({
            label: String(item.label ?? '').trim(),
            description: String(item.description ?? '').trim(),
          }))
          .filter((item) => item.label && item.description)
      : action.capabilities,
    smokeTestParams: safeSmokeParams(parsed.smokeTestParams ?? action.smokeTestParams),
    code,
  };
}
