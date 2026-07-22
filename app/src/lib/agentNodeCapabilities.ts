import type {
  AgentNodeCapabilities,
  NodeExecutionCapability,
  NodeGenerationCapability,
  NodeInputCapability,
  NodeValidationCapability,
} from '../stores/canvasStore';

export const INPUT_CHAR_LIMIT_MIN = 1000;
export const INPUT_CHAR_LIMIT_MAX = 500000;
export const NODE_MAX_TOKENS_MIN = 512;
export const NODE_MAX_TOKENS_MAX = 30000;
export const NODE_TIMEOUT_SECONDS_MIN = 30;
export const NODE_TIMEOUT_SECONDS_MAX = 300;

export interface NodeModelRef {
  configId: string;
  modelId: string;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cleanTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

export function inputCapability(
  value: Partial<NodeInputCapability> | undefined,
): Required<NodeInputCapability> {
  const selectionMode = value?.selectionMode === 'selected' ? 'selected' : 'all';
  const contentMode =
    value?.contentMode === 'structured' ||
    value?.contentMode === 'summary' ||
    value?.contentMode === 'full'
      ? value.contentMode
      : 'full';
  const oversizeStrategy =
    value?.oversizeStrategy === 'truncate' || value?.oversizeStrategy === 'summarize'
      ? value.oversizeStrategy
      : 'error';
  return {
    enabled: value?.enabled === true,
    selectionMode,
    selectedUpstreamIds: cleanTerms(value?.selectedUpstreamIds),
    upstreamOrder: cleanTerms(value?.upstreamOrder),
    contentMode,
    includeSupplementalSources: value?.includeSupplementalSources === true,
    maxInputChars: clampInteger(
      value?.maxInputChars,
      120000,
      INPUT_CHAR_LIMIT_MIN,
      INPUT_CHAR_LIMIT_MAX,
    ),
    oversizeStrategy,
  };
}

export function generationCapability(
  value: Partial<NodeGenerationCapability> | undefined,
): Required<NodeGenerationCapability> {
  const temperature =
    value?.temperature === null || value?.temperature === undefined
      ? null
      : Math.min(2, Math.max(0, Number(value.temperature) || 0));
  const fallbackModelRef = value?.fallbackModelRef;
  return {
    enabled: value?.enabled === true,
    maxTokens: clampInteger(
      value?.maxTokens,
      NODE_MAX_TOKENS_MAX,
      NODE_MAX_TOKENS_MIN,
      NODE_MAX_TOKENS_MAX,
    ),
    temperature,
    fallbackModelRef:
      fallbackModelRef &&
      typeof fallbackModelRef.configId === 'string' &&
      typeof fallbackModelRef.modelId === 'string'
        ? fallbackModelRef
        : null,
    retryOnEmpty: value?.retryOnEmpty !== false,
  };
}

export function modelGenerationOptions(
  value: Partial<NodeGenerationCapability> | undefined,
): { maxTokens: number; temperature?: number } {
  const config = generationCapability(value);
  if (!config.enabled) return { maxTokens: NODE_MAX_TOKENS_MAX };
  return {
    maxTokens: config.maxTokens,
    ...(config.temperature === null ? {} : { temperature: config.temperature }),
  };
}

export function executionCapability(
  value: Partial<NodeExecutionCapability> | undefined,
): Required<NodeExecutionCapability> {
  return {
    enabled: value?.enabled === true,
    retryCount: clampInteger(value?.retryCount, 2, 0, 2),
    timeoutSeconds: clampInteger(
      value?.timeoutSeconds,
      300,
      NODE_TIMEOUT_SECONDS_MIN,
      NODE_TIMEOUT_SECONDS_MAX,
    ),
    allowManualRerun: value?.allowManualRerun === true,
  };
}

export interface NodeExecutionAttempt {
  kind: 'primary' | 'fallback';
  modelRef: NodeModelRef | null;
  attempts: number;
}

export function executionAttemptPlan(
  primaryModelRef: NodeModelRef | null | undefined,
  capabilities: AgentNodeCapabilities | undefined,
): NodeExecutionAttempt[] {
  const execution = executionCapability(capabilities?.execution);
  const generation = generationCapability(capabilities?.generation);
  const plan: NodeExecutionAttempt[] = [{
    kind: 'primary',
    modelRef: primaryModelRef ?? null,
    attempts: (execution.enabled ? execution.retryCount : 2) + 1,
  }];
  if (generation.enabled && generation.fallbackModelRef) {
    plan.push({
      kind: 'fallback',
      modelRef: generation.fallbackModelRef,
      attempts: 1,
    });
  }
  return plan;
}

export function validationCapability(
  value: Partial<NodeValidationCapability> | undefined,
): Required<NodeValidationCapability> {
  const optionalLength = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw);
  };
  return {
    enabled: value?.enabled === true,
    minChars: optionalLength(value?.minChars),
    maxChars: optionalLength(value?.maxChars),
    requiredTerms: cleanTerms(value?.requiredTerms),
    forbiddenTerms: cleanTerms(value?.forbiddenTerms),
    onFailure: value?.onFailure === 'retry' ? 'retry' : 'fail',
  };
}

export function selectUpstreamIds(
  connectedIds: string[],
  value: Partial<NodeInputCapability> | undefined,
): string[] {
  const config = inputCapability(value);
  if (!config.enabled || config.selectionMode === 'all') return [...connectedIds];

  const connected = new Set(connectedIds);
  const selected = new Set(config.selectedUpstreamIds.filter((id) => connected.has(id)));
  const ordered = config.upstreamOrder.filter((id) => selected.has(id));
  for (const id of connectedIds) {
    if (selected.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export type InputLengthPolicyResult =
  | { kind: 'ready'; text: string }
  | { kind: 'summarize'; text: string; maxChars: number };

export function applyInputLengthPolicy(
  text: string,
  value: Partial<NodeInputCapability> | undefined,
): InputLengthPolicyResult {
  const config = inputCapability(value);
  if (!config.enabled || text.length <= config.maxInputChars) {
    return { kind: 'ready', text };
  }
  if (config.oversizeStrategy === 'truncate') {
    return { kind: 'ready', text: text.slice(0, config.maxInputChars) };
  }
  if (config.oversizeStrategy === 'summarize') {
    return { kind: 'summarize', text, maxChars: config.maxInputChars };
  }
  throw new Error(
    `输入内容超过 ${config.maxInputChars} 个字符，请调整输入上限或超长处理方式。`,
  );
}

export function validateTextOutput(
  text: string,
  value: Partial<NodeValidationCapability> | undefined,
): string[] {
  const config = validationCapability(value);
  if (!config.enabled) return [];
  const issues: string[] = [];
  if (config.minChars !== null && text.length < config.minChars) {
    issues.push(`输出少于 ${config.minChars} 个字符`);
  }
  if (config.maxChars !== null && text.length > config.maxChars) {
    issues.push(`输出超过 ${config.maxChars} 个字符`);
  }
  const missing = config.requiredTerms.filter((term) => !text.includes(term));
  if (missing.length > 0) issues.push(`输出缺少必含词：${missing.join('、')}`);
  const forbidden = config.forbiddenTerms.filter((term) => text.includes(term));
  if (forbidden.length > 0) issues.push(`输出包含禁用词：${forbidden.join('、')}`);
  return issues;
}

export function mergeNodeCapability<K extends keyof AgentNodeCapabilities>(
  capabilities: AgentNodeCapabilities | undefined,
  key: K,
  patch: Partial<NonNullable<AgentNodeCapabilities[K]>>,
): AgentNodeCapabilities {
  return {
    ...(capabilities ?? {}),
    [key]: { ...(capabilities?.[key] ?? {}), ...patch },
  };
}
