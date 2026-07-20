import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentNodeData } from '../../stores/canvasStore';
import { useAgentStore } from '../../stores/agentStore';
import { nodeFromAgentSpec } from './helpers';

// agentStore 走 persist(tauriStorage 回落 localStorage);测试环境无 localStorage,给内存桩挡住 setItem。
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

// "世界观生成" 不命中任何预设(需求分析师/测试用例生成器/Bug 报告生成器),走 defaultAgentDraft(空提示词)。
beforeEach(() => {
  useAgentStore.setState({ agents: [] });
});

describe('nodeFromAgentSpec systemPrompt/description injection', () => {
  it('writes generated systemPrompt over template default and marks 姬子生成', () => {
    const node = nodeFromAgentSpec(
      { label: '世界观生成', systemPrompt: '你负责生成完整世界观。' },
      0,
    );
    const data = node.data as AgentNodeData;
    expect(data.systemPrompt).toBe('你负责生成完整世界观。');
    expect(data.systemPromptSourceName).toBe('姬子生成');
  });

  it('writes generated description over template default', () => {
    const node = nodeFromAgentSpec(
      { label: '世界观生成', description: '生成世界观设定' },
      0,
    );
    const data = node.data as AgentNodeData;
    expect(data.description).toBe('生成世界观设定');
  });

  it('falls back to template/default when systemPrompt absent', () => {
    const node = nodeFromAgentSpec({ label: '世界观生成' }, 0);
    const data = node.data as AgentNodeData;
    expect(data.systemPrompt).toBe('');
    expect(data.systemPromptSourceName).toBeUndefined();
  });

  it('truncates generated systemPrompt to the 14000 hard cap', () => {
    const node = nodeFromAgentSpec(
      { label: '世界观生成', systemPrompt: 'a'.repeat(14_005) },
      0,
    );
    const data = node.data as AgentNodeData;
    expect(data.systemPrompt).toHaveLength(14_000);
    expect(data.systemPromptSourceName).toBe('姬子生成');
  });
});
