import { describe, expect, it } from 'vitest';
import { parseJiziSearchDecision } from './jiziSearchPlanner';

describe('parseJiziSearchDecision', () => {
  it('parses a search decision', () => {
    const decision = parseJiziSearchDecision(
      JSON.stringify({
        shouldSearch: true,
        query: 'OpenAI API 最新模型 2026',
        reason: '用户询问最新外部信息',
      }),
    );

    expect(decision).toEqual({
      shouldSearch: true,
      query: 'OpenAI API 最新模型 2026',
      reason: '用户询问最新外部信息',
    });
  });

  it('parses a no-search decision', () => {
    const decision = parseJiziSearchDecision(
      JSON.stringify({
        shouldSearch: false,
        reason: '这是本项目内部 Agent 节点问题',
      }),
    );

    expect(decision).toEqual({
      shouldSearch: false,
      reason: '这是本项目内部 Agent 节点问题',
    });
  });

  it('falls back to no search when query is empty', () => {
    const decision = parseJiziSearchDecision(
      JSON.stringify({
        shouldSearch: true,
        query: '',
        reason: '缺少检索词',
      }),
    );

    expect(decision).toEqual({
      shouldSearch: false,
      reason: '缺少检索词',
    });
  });
});
