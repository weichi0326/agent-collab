import type { NodeValidationCapability } from '../../stores/canvasStore';
import {
  validateTextOutput,
  validationCapability,
} from '../agentNodeCapabilities';

export class NodeOutputValidationError extends Error {
  retryable: boolean;

  constructor(issues: string[], retryable: boolean) {
    super(`输出质量校验失败：${issues.join('；')}`);
    this.name = 'NodeOutputValidationError';
    this.retryable = retryable;
  }
}

export function assertValidNodeOutput(
  text: string,
  capability: Partial<NodeValidationCapability> | undefined,
): void {
  const issues = validateTextOutput(text, capability);
  if (issues.length === 0) return;
  const config = validationCapability(capability);
  throw new NodeOutputValidationError(issues, config.onFailure === 'retry');
}

export function isRetryableOutputValidationError(
  error: unknown,
  capability: Partial<NodeValidationCapability> | undefined,
): boolean {
  const config = validationCapability(capability);
  if (!config.enabled || config.onFailure !== 'retry' || !(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  if (message.includes('JSON Schema 不是合法 JSON 对象')) return false;
  return [
    '不符合 schema',
    '不符合内置 schema',
    '没有返回可用于生成',
  ].some((pattern) => message.includes(pattern));
}

export async function runWithNodeTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutSeconds: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) {
    throw new DOMException('已取消', 'AbortError');
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`节点执行超时（${timeoutSeconds} 秒）`));
      controller.abort();
    }, timeoutSeconds * 1000);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
