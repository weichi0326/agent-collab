import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from './modelCalls';

function agentNode(data: Record<string, unknown>): Node {
  return {
    id: 'agent-1',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { label: '测试节点', outputFormat: 'xlsx', ...data },
  };
}

describe('buildPrompt custom output rule', () => {
  it('does not change the prompt while the rule is disabled', () => {
    const prompt = buildPrompt(
      agentNode({ outputRuleEnabled: false, outputRuleText: '第一列必须是编号' }),
      '输入内容',
    );

    expect(prompt).not.toContain('第一列必须是编号');
  });

  it('does not change the prompt when an enabled rule is empty', () => {
    const prompt = buildPrompt(
      agentNode({ outputRuleEnabled: true, outputRuleText: '   ' }),
      '输入内容',
    );

    expect(prompt).not.toContain('自定义输出规则');
  });

  it('adds a non-empty rule after the hard output format instruction', () => {
    const prompt = buildPrompt(
      agentNode({
        outputRuleEnabled: true,
        outputRuleText: '第一列必须是编号，第二列必须是标题。',
      }),
      '输入内容',
    );

    const formatIndex = prompt.indexOf('只输出合法 JSON');
    const ruleIndex = prompt.indexOf('自定义输出规则');
    expect(formatIndex).toBeGreaterThanOrEqual(0);
    expect(ruleIndex).toBeGreaterThan(formatIndex);
    expect(prompt).toContain('第一列必须是编号，第二列必须是标题。');
  });
});
