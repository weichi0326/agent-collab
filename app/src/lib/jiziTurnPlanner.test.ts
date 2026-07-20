import { describe, expect, it } from 'vitest';
import { parseJiziTurnDecision } from './jiziTurnPlanner';

const opts = { allowSearch: true, allowChoice: true, allowActions: true };

describe('parseJiziTurnDecision', () => {
  it('parses an action plan', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'action',
        reason: '用户明确要求创建画布',
        summary: '创建接口测试流程',
        steps: [
          { type: 'create-canvas', name: '接口测试流程' },
          { type: 'add-node', label: '接口测试', outputFormat: 'markdown' },
        ],
        search: { shouldSearch: true, query: '不应使用', reason: '操作不搜索' },
      }),
      opts,
    );

    expect(decision.kind).toBe('action');
    if (decision.kind === 'action') {
      expect(decision.action.summary).toBe('创建接口测试流程');
      expect(decision.action.steps).toHaveLength(2);
      expect(decision.search.shouldSearch).toBe(false);
    }
  });

  it('parses stable-id Agent, node, canvas, and tool actions', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'action',
        reason: '用户要求修改并清理项目对象',
        steps: [
          {
            type: 'update-agent',
            agentId: 'agent-1',
            patch: {
              name: '研究助手',
              systemPrompt: '先核对来源再回答',
              toolTags: ['search', 'file'],
              ignored: 'not-allowed',
            },
          },
          {
            type: 'update-node-agent-config',
            canvasId: 'canvas-1',
            nodeId: 'node-1',
            patch: { description: '处理研究任务' },
          },
          { type: 'delete-canvas', canvasId: 'canvas-old' },
          { type: 'delete-tool', toolName: 'legacy-reader' },
        ],
        search: { shouldSearch: false, reason: '' },
      }),
      opts,
    );

    expect(decision.kind).toBe('action');
    if (decision.kind === 'action') {
      expect(decision.action.steps).toEqual([
        {
          type: 'update-agent',
          agentId: 'agent-1',
          patch: {
            name: '研究助手',
            systemPrompt: '先核对来源再回答',
            toolTags: ['search', 'file'],
          },
        },
        {
          type: 'update-node-agent-config',
          canvasId: 'canvas-1',
          nodeId: 'node-1',
          patch: { description: '处理研究任务' },
        },
        { type: 'delete-canvas', canvasId: 'canvas-old' },
        { type: 'delete-tool', toolName: 'legacy-reader' },
      ]);
    }
  });

  it('keeps add-node systemPrompt and description', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'action',
        reason: '造带提示词的节点',
        steps: [
          {
            type: 'add-node',
            label: '世界观生成',
            description: '生成世界观设定',
            systemPrompt: '你负责根据输入生成完整世界观。',
            outputFormat: 'markdown',
          },
        ],
        search: { shouldSearch: false, reason: '' },
      }),
      opts,
    );

    expect(decision.kind).toBe('action');
    if (decision.kind === 'action') {
      expect(decision.action.steps[0]).toEqual({
        type: 'add-node',
        label: '世界观生成',
        agentQuery: undefined,
        outputFormat: 'markdown',
        description: '生成世界观设定',
        systemPrompt: '你负责根据输入生成完整世界观。',
      });
    }
  });

  it('omits add-node systemPrompt and description when absent', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'action',
        reason: '造无提示词节点',
        steps: [{ type: 'add-node', label: '接口测试', outputFormat: 'markdown' }],
        search: { shouldSearch: false, reason: '' },
      }),
      opts,
    );

    expect(decision.kind).toBe('action');
    if (decision.kind === 'action') {
      const step = decision.action.steps[0];
      expect(step.type).toBe('add-node');
      if (step.type === 'add-node') {
        expect(step.systemPrompt).toBeUndefined();
        expect(step.description).toBeUndefined();
      }
    }
  });

  it('rejects name-only destructive targets', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'action',
        reason: '删除旧对象',
        steps: [
          { type: 'delete-canvas', name: '旧画布' },
          { type: 'delete-tool', name: '旧工具' },
        ],
        search: { shouldSearch: false, reason: '' },
      }),
      opts,
    );

    expect(decision.kind).toBe('chat');
  });

  it('parses chat search decisions', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'chat',
        reason: '用户询问外部最新信息',
        search: {
          shouldSearch: true,
          query: 'OpenAI API 最新模型 2026',
          reason: '需要最新资料',
        },
      }),
      opts,
    );

    expect(decision).toEqual({
      kind: 'chat',
      reason: '用户询问外部最新信息',
      search: {
        shouldSearch: true,
        query: 'OpenAI API 最新模型 2026',
        reason: '需要最新资料',
      },
    });
  });

  it('disables choice when not allowed', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'ask-choice',
        reason: '需要用户选择',
        options: [
          { id: 'a', title: '方案 A', description: '快', recommended: true },
          { id: 'b', title: '方案 B', description: '稳' },
        ],
        search: { shouldSearch: false, reason: '' },
      }),
      { ...opts, allowChoice: false },
    );

    expect(decision.kind).toBe('chat');
  });

  it('parses tool generation decisions', () => {
    const decision = parseJiziTurnDecision(
      JSON.stringify({
        kind: 'generate-tool',
        reason: '用户需要接口测试工具',
        requirement: '生成通用 HTTP 接口测试工具',
        search: { shouldSearch: false, reason: '' },
      }),
      opts,
    );

    expect(decision).toEqual({
      kind: 'generate-tool',
      reason: '用户需要接口测试工具',
      requirement: '生成通用 HTTP 接口测试工具',
      search: {
        shouldSearch: false,
        reason: '生成工具先基于当前项目状态判断',
      },
    });
  });
});
