import { describe, expect, it } from 'vitest';
import {
  inputCapability,
  generationCapability,
  executionCapability,
  executionAttemptPlan,
  modelGenerationOptions,
  validationCapability,
  selectUpstreamIds,
  applyInputLengthPolicy,
  validateTextOutput,
} from './agentNodeCapabilities';

describe('agent node capability defaults', () => {
  it('preserves current behavior when capability groups are absent', () => {
    expect(inputCapability(undefined)).toEqual({
      enabled: false,
      selectionMode: 'all',
      selectedUpstreamIds: [],
      upstreamOrder: [],
      contentMode: 'legacy',
      includeSupplementalSources: false,
      maxInputChars: 120000,
      oversizeStrategy: 'error',
    });
    expect(generationCapability(undefined)).toEqual({
      enabled: false,
      maxTokens: 4096,
      temperature: null,
      fallbackModelRef: null,
      retryOnEmpty: true,
    });
    expect(executionCapability(undefined)).toEqual({
      enabled: false,
      retryCount: 2,
      timeoutSeconds: 300,
      allowManualRerun: false,
    });
    expect(validationCapability(undefined)).toEqual({
      enabled: false,
      minChars: null,
      maxChars: null,
      requiredTerms: [],
      forbiddenTerms: [],
      onFailure: 'fail',
    });
  });

  it('clamps malformed imported values to supported ranges', () => {
    expect(generationCapability({ enabled: true, maxTokens: 99999, temperature: -1 })).toMatchObject({
      enabled: true,
      maxTokens: 16384,
      temperature: 0,
    });
    expect(executionCapability({ enabled: true, retryCount: 9, timeoutSeconds: 2 })).toMatchObject({
      enabled: true,
      retryCount: 2,
      timeoutSeconds: 30,
    });
  });

  it('only overrides model request settings while generation is enabled', () => {
    expect(modelGenerationOptions(undefined)).toEqual({ maxTokens: 4096 });
    expect(modelGenerationOptions({
      enabled: true,
      maxTokens: 8192,
      temperature: 0.35,
    })).toEqual({ maxTokens: 8192, temperature: 0.35 });
  });

  it('runs fallback once after the configured primary attempts', () => {
    const primary = { configId: 'primary-config', modelId: 'primary-model' };
    const fallback = { configId: 'fallback-config', modelId: 'fallback-model' };
    expect(executionAttemptPlan(primary, {
      generation: { enabled: true, fallbackModelRef: fallback },
      execution: { enabled: true, retryCount: 1 },
    })).toEqual([
      { kind: 'primary', modelRef: primary, attempts: 2 },
      { kind: 'fallback', modelRef: fallback, attempts: 1 },
    ]);
  });
});

describe('selectUpstreamIds', () => {
  const connected = ['a', 'b', 'c'];

  it('keeps all connected upstream nodes in connection order by default', () => {
    expect(selectUpstreamIds(connected, undefined)).toEqual(connected);
  });

  it('filters selected nodes and applies the configured order', () => {
    expect(selectUpstreamIds(connected, {
      enabled: true,
      selectionMode: 'selected',
      selectedUpstreamIds: ['a', 'c', 'missing'],
      upstreamOrder: ['c', 'a'],
    })).toEqual(['c', 'a']);
  });
});

describe('validateTextOutput', () => {
  it('reports deterministic length and term violations', () => {
    const issues = validateTextOutput('这是内部草稿', {
      enabled: true,
      minChars: 20,
      requiredTerms: ['结论'],
      forbiddenTerms: ['内部'],
    });
    expect(issues).toEqual([
      '输出少于 20 个字符',
      '输出缺少必含词：结论',
      '输出包含禁用词：内部',
    ]);
  });

  it('does nothing while validation is disabled', () => {
    expect(validateTextOutput('', { enabled: false, minChars: 10 })).toEqual([]);
  });
});

describe('applyInputLengthPolicy', () => {
  it('throws or truncates according to the configured strategy', () => {
    const oversized = 'x'.repeat(1001);
    expect(() => applyInputLengthPolicy(oversized, {
      enabled: true,
      maxInputChars: 1000,
      oversizeStrategy: 'error',
    })).toThrow('输入内容超过');
    expect(applyInputLengthPolicy(oversized, {
      enabled: true,
      maxInputChars: 1000,
      oversizeStrategy: 'truncate',
    })).toEqual({ kind: 'ready', text: 'x'.repeat(1000) });
    expect(applyInputLengthPolicy(oversized, {
      enabled: true,
      maxInputChars: 1000,
      oversizeStrategy: 'summarize',
    })).toEqual({ kind: 'summarize', text: oversized, maxChars: 1000 });
  });
});
