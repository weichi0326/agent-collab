import { describe, expect, it, vi } from 'vitest';
import {
  NodeOutputValidationError,
  assertValidNodeOutput,
  isRetryableOutputValidationError,
  runWithNodeTimeout,
} from './execution';

describe('runWithNodeTimeout', () => {
  it('turns an internal timeout into a retryable node error', async () => {
    vi.useFakeTimers();
    try {
      const promise = runWithNodeTimeout(
        () => new Promise<string>(() => undefined),
        30,
      );
      const rejection = expect(promise).rejects.toThrow('节点执行超时');
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves an external cancellation as AbortError', async () => {
    const controller = new AbortController();
    const promise = runWithNodeTimeout(
      (signal) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('已取消', 'AbortError'));
        });
      }),
      30,
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('assertValidNodeOutput', () => {
  it('throws a non-retryable validation error for fail strategy', () => {
    try {
      assertValidNodeOutput('draft', {
        enabled: true,
        requiredTerms: ['结论'],
        onFailure: 'fail',
      });
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(NodeOutputValidationError);
      expect(error).toMatchObject({ retryable: false });
      expect((error as Error).message).toContain('缺少必含词');
    }
  });

  it('marks validation failures retryable for retry strategy', () => {
    expect(() => assertValidNodeOutput('draft', {
      enabled: true,
      requiredTerms: ['结论'],
      onFailure: 'retry',
    })).toThrow(NodeOutputValidationError);
    try {
      assertValidNodeOutput('draft', {
        enabled: true,
        requiredTerms: ['结论'],
        onFailure: 'retry',
      });
    } catch (error) {
      expect(error).toMatchObject({ retryable: true });
    }
  });

  it('applies retry strategy to existing schema and file-structure failures', () => {
    const retry = { enabled: true, onFailure: 'retry' as const };
    expect(isRetryableOutputValidationError(
      new Error('输出不符合内置 schema：rows 必须是二维数组'),
      retry,
    )).toBe(true);
    expect(isRetryableOutputValidationError(
      new Error('没有返回可用于生成 Excel 工作簿的 JSON'),
      retry,
    )).toBe(true);
    expect(isRetryableOutputValidationError(
      new Error('JSON Schema 不是合法 JSON 对象'),
      retry,
    )).toBe(false);
    expect(isRetryableOutputValidationError(
      new Error('输出不符合 schema'),
      { enabled: true, onFailure: 'fail' },
    )).toBe(false);
  });
});
