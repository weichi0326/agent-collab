import { asObject } from './jsonGuards';
import { chat, type LLMConfig } from './llmClient';
import { cleanJsonFence } from './masterPlanner';
import { buildJiziSkillSystemBlock } from './jiziSkills';
import type { MasterAction } from './masterActions';
import type {
  ToolMetaCapability,
  ToolMetaImplementation,
} from './pythonClient';

const NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function asPlainParams(value: unknown): Record<string, unknown> {
  return asObject(value) ?? {};
}

function asCapabilities(value: unknown): ToolMetaCapability[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asObject)
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => ({
      label: String(item.label ?? '').trim(),
      description: String(item.description ?? '').trim(),
    }))
    .filter((item) => item.label && item.description)
    .slice(0, 8);
}

function asImplementation(value: unknown, dependencies: string[]): ToolMetaImplementation {
  const obj = asObject(value);
  return {
    language: String(obj?.language ?? 'Python 3.10+').trim() || 'Python 3.10+',
    libraries:
      asStringArray(obj?.libraries).length > 0
        ? asStringArray(obj?.libraries)
        : dependencies.length > 0
          ? dependencies
          : ['标准库'],
    note: String(obj?.note ?? '').trim() || undefined,
  };
}

// 受控生成 prompt：明确工具契约与安全约束，要求模型只输出 JSON。
function buildGeneratorPrompt(requirement: string, runtimeContext?: string): string {
  return [
    '你是 Python 工具代码生成器，为一个多 Agent 协同工具生成可动态注册的工具模块。',
    '严格只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。',
    'JSON 字段：',
    '- name: 工具名 slug，须匹配正则 ^[a-z][a-z0-9-]{1,39}$（小写字母开头，仅小写字母/数字/连字符）。',
    '- description: 一句话中文描述工具用途。',
    '- tags: 字符串数组，只放工具名本身，例如 name 为 "api-tester" 时 tags 必须是 ["api-tester"]。不要生成 api/test/http 这类分类标签。',
    '- dependencies: 字符串数组，pip 包名（requirements 风格，如 ["requests"] 或 ["requests==2.31.0"]）；只用标准库时给空数组 []。',
    '- implementation: 对象，包含 language、libraries、note。language 通常为 "Python 3.10+"；libraries 写标准库/第三方库；note 用中文说明实现原理。',
    '- capabilities: 数组，3~6 项，每项 {label, description}，中文，写清楚工具能力和参数/输出价值。',
    '- smokeTestParams: 对象，用于安装后自动试运行。必须安全离线，不访问真实外网、不删除用户文件、不依赖私人路径。',
    '- code: 完整 Python 模块源码字符串。',
    '代码契约（必须严格遵守）：',
    '1) 必须定义顶层 `async def execute(params: dict[str, Any]) -> Any`，从 params 字典取参数。',
    '2) 返回值必须可 JSON 序列化（dict/list/str/int/float/bool/None）。',
    '3) 出错时 raise 异常（ValueError 用于参数/业务错误），不要返回错误字符串。',
    '4) 任何文件路径操作必须 `from tools.sandbox import resolve_safe_path` 并用它校验路径，禁止直接用裸路径读写。',
    '5) 不要写死任何密钥/令牌；除非 dependencies/描述已声明联网，否则不发起网络请求。',
    '6) 只 import 标准库或 dependencies 中声明的包。代码保持精简（20KB 以内）。',
    '接口测试特殊规则：如果用户想让 Agent 具备接口/API/HTTP 测试能力，即使没有提供具体 URL，也要生成一个通用接口测试工具，不要反问。',
    '通用接口测试工具应使用 requests 作为 dependency，支持 method、url、headers、params、json/body、timeout、expected_status 等参数，并返回 status_code、headers、body/JSON、elapsed_ms 和是否符合预期。',
    '接口测试工具的 smokeTestParams 必须使用 dry_run:true 或 mock:true 这类离线模式；如果代码没有离线模式，请实现一个不会真的发请求的 dry_run 分支。',
    runtimeContext
      ? `【当前项目状态】\n${runtimeContext}\n\n请先看现有工具能力；如果已有工具能覆盖，不要重复造同类工具，除非用户明确要求新增独立工具。`
      : '',
    `【工具需求】\n${requirement}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 让 LLM 按受控 prompt 生成工具代码，解析并做客户端基础校验。
 * 返回 create-tool 动作供确认卡片展示完整代码；生成/解析失败则 throw。
 * 注意：这里只生成，不安装。安装须经用户审阅完整代码后确认（见 executor create-tool 分支）。
 */
export async function generateToolWithLLM(
  requirement: string,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
  runtimeContext?: string,
): Promise<Extract<MasterAction, { type: 'create-tool' }>> {
  const skillBlock = await buildJiziSkillSystemBlock(
    `生成工具\n${requirement}`,
    cfg,
    model,
    signal,
    { requiredIds: ['tool-generation-review'], autoSelect: false },
  );
  const reply = await chat({
    cfg,
    model,
    system: [
      '你只输出一个 JSON 对象，不输出自然语言解释，不使用 Markdown 代码块。',
      skillBlock,
    ]
      .filter(Boolean)
      .join('\n\n'),
    text: buildGeneratorPrompt(requirement, runtimeContext),
    signal,
    scene: 'tool-generate',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJsonFence(reply));
  } catch {
    throw new Error('模型没有返回可解析的工具 JSON，请换个说法再试。');
  }
  const root =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!root) throw new Error('模型返回格式不正确，请重试。');

  const name = String(root.name ?? '').trim();
  const code = String(root.code ?? '');
  const description = String(root.description ?? '').trim();
  const tags = [name];
  const dependencies = asStringArray(root.dependencies);
  const implementation = asImplementation(root.implementation, dependencies);
  const capabilities = asCapabilities(root.capabilities);
  const smokeTestParams = asPlainParams(root.smokeTestParams);

  if (!NAME_RE.test(name)) {
    throw new Error(`模型生成的工具名「${name || '(空)'}」不合法，请重试或补充需求。`);
  }
  if (!code.trim() || !/async\s+def\s+execute\s*\(/.test(code)) {
    throw new Error('模型生成的代码缺少 async def execute，请重试。');
  }

  return {
    type: 'create-tool',
    name,
    description,
    tags,
    dependencies,
    implementation,
    capabilities,
    smokeTestParams,
    code,
  };
}

