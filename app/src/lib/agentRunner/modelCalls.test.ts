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

describe('buildPrompt node name decoupling', () => {
  // 名字与真实任务故意相悖:节点名不该进 prompt,任务只由职责(description)承载。
  it('does not inject the node label into its own prompt', () => {
    const prompt = buildPrompt(
      agentNode({ label: '角色设定生成', description: '生成世界观' }),
      '输入X',
    );
    expect(prompt).not.toContain('角色设定生成');
    expect(prompt).not.toContain('你正在执行 Agent 节点');
    expect(prompt).toContain('生成世界观');
    expect(prompt).toContain('输入X');
  });
});
