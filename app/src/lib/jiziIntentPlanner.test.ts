import { describe, expect, it } from 'vitest';
import { parseJiziIntentDecision } from './jiziIntentPlanner';

describe('parseJiziIntentDecision', () => {
  it('parses tool generation decisions', () => {
    const decision = parseJiziIntentDecision(
      JSON.stringify({
        kind: 'generate-tool',
        requirement:
          '生成一个通用接口测试工具，支持 URL、method、headers、params、json/body、timeout 和 expected_status。',
        reason: '用户想让 Agent 新增接口测试能力',
      }),
    );

    expect(decision).toEqual({
      kind: 'generate-tool',
      requirement:
        '生成一个通用接口测试工具，支持 URL、method、headers、params、json/body、timeout 和 expected_status。',
      reason: '用户想让 Agent 新增接口测试能力',
    });
  });

  it('keeps the recommended choice first', () => {
    const decision = parseJiziIntentDecision(
      JSON.stringify({
        kind: 'ask-choice',
        title: '选择执行方式',
        summary: '不同方式会影响自动化程度。',
        customPlaceholder: '输入你的执行方式',
        options: [
          {
            id: 'manual',
            title: '先手动跑一次',
            description: '先看效果，再决定是否自动化。',
          },
          {
            id: 'daily',
            title: '每天自动执行',
            description: '适合稳定重复任务。',
            recommended: true,
          },
        ],
      }),
    );

    expect(decision.kind).toBe('ask-choice');
    if (decision.kind === 'ask-choice') {
      expect(decision.options[0]?.id).toBe('daily');
      expect(decision.options[0]?.recommended).toBe(true);
      expect(decision.customPlaceholder).toBe('输入你的执行方式');
    }
  });

  it('falls back to chat for weak choice payloads', () => {
    const decision = parseJiziIntentDecision(
      JSON.stringify({
        kind: 'ask-choice',
        options: [{ id: 'only', title: '唯一方案', description: '直接做。' }],
      }),
    );

    expect(decision).toEqual({ kind: 'chat', reason: '' });
  });

  it('parses system check decisions', () => {
    const decision = parseJiziIntentDecision(
      JSON.stringify({
        kind: 'system-check',
        reason: '用户想检查当前配置是否正常',
      }),
    );

    expect(decision).toEqual({
      kind: 'system-check',
      reason: '用户想检查当前配置是否正常',
    });
  });
});
