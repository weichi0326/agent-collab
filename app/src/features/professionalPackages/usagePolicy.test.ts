import { describe, expect, it } from 'vitest';
import { FICTIONIST_AGENT_IDS } from '../fictionist/agents';
import { findProfessionalAgent } from './agentRegistry';
import {
  professionalAgentCanvasUsageDecision,
  professionalAgentUsageDecision,
} from './usagePolicy';

function agent(id: string) {
  const definition = findProfessionalAgent(id);
  if (!definition) throw new Error(`missing professional agent: ${id}`);
  return definition;
}

describe('professional agent canvas usage policy', () => {
  it('keeps unrestricted professional agents available on ordinary canvases', () => {
    expect(professionalAgentUsageDecision(
      agent(FICTIONIST_AGENT_IDS.storyArchitect),
      {},
    )).toEqual({ allowed: true });
  });

  it('blocks chapter insight agents on ordinary and unrelated workflow canvases', () => {
    const contextAnalyst = agent(FICTIONIST_AGENT_IDS.contextAnalyst);
    const canonReviewer = agent(FICTIONIST_AGENT_IDS.continuityReviewer);

    expect(professionalAgentUsageDecision(contextAnalyst, {})).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('AI 起草'),
    });
    expect(professionalAgentUsageDecision(canonReviewer, {
      systemWorkflow: {
        packageId: 'fictionist',
        key: 'fictionist.outline-optimize',
      },
    })).toMatchObject({ allowed: false });
  });

  it('allows chapter insight agents in draft and continuation system templates', () => {
    const contextAnalyst = agent(FICTIONIST_AGENT_IDS.contextAnalyst);

    expect(professionalAgentUsageDecision(contextAnalyst, {
      systemWorkflow: {
        packageId: 'fictionist',
        key: 'fictionist.chapter-draft',
      },
    })).toEqual({ allowed: true });
    expect(professionalAgentUsageDecision(contextAnalyst, {
      systemWorkflow: {
        packageId: 'fictionist',
        key: 'fictionist.chapter-continue',
      },
    })).toEqual({ allowed: true });
  });

  it('allows chapter insight agents only for valid draft and continuation tasks', () => {
    const canonReviewer = agent(FICTIONIST_AGENT_IDS.continuityReviewer);

    expect(professionalAgentUsageDecision(canonReviewer, {
      task: { packageId: 'fictionist', taskType: 'draft-chapter' },
    })).toEqual({ allowed: true });
    expect(professionalAgentUsageDecision(canonReviewer, {
      task: { packageId: 'fictionist', taskType: 'continue-chapter' },
    })).toEqual({ allowed: true });
    expect(professionalAgentUsageDecision(canonReviewer, {
      task: { packageId: 'fictionist', taskType: 'custom-workflow' },
    })).toMatchObject({ allowed: false });
    expect(professionalAgentUsageDecision(canonReviewer, {
      task: { packageId: 'tester', taskType: 'continue-chapter' },
    })).toMatchObject({ allowed: false });
  });

  it('requires an origin to resolve to the matching persisted professional task', () => {
    const contextAnalyst = agent(FICTIONIST_AGENT_IDS.contextAnalyst);
    const origin = {
      packageId: 'fictionist',
      taskId: 'task-1',
      taskType: 'continue-chapter',
    };
    const task = {
      id: 'task-1',
      packageId: 'fictionist',
      taskType: 'continue-chapter',
      taskLabel: '续写下一章',
      sourceLabel: '《测试作品》· 第一章',
      status: 'ready' as const,
      sourceRefs: [{ type: 'fiction-chapter', id: 'chapter-1', revision: 1 }],
      contextSnapshot: { title: '上下文', format: 'markdown' as const, content: '正文' },
      expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'txt' },
      packagePayload: {},
      outputs: [],
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    };

    expect(professionalAgentCanvasUsageDecision(
      contextAnalyst,
      { origin },
      {},
    )).toMatchObject({ allowed: false });
    expect(professionalAgentCanvasUsageDecision(
      contextAnalyst,
      { origin },
      { [task.id]: task },
    )).toEqual({ allowed: true });
    expect(professionalAgentCanvasUsageDecision(
      contextAnalyst,
      { origin },
      { [task.id]: { ...task, taskType: 'custom-workflow' } },
    )).toMatchObject({ allowed: false });
  });
});
