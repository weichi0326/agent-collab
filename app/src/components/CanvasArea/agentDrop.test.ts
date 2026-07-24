import { describe, expect, it } from 'vitest';
import { FICTIONIST_AGENT_IDS } from '../../features/fictionist/agents';
import {
  agentNodeDropRestriction,
  buildAgentNodeFromDrop,
} from './agentDrop';

describe('agent canvas drop', () => {
  it('builds a fictionist node snapshot from the professional drag payload', () => {
    const node = buildAgentNodeFromDrop(
      JSON.stringify({
        professionalAgentId: FICTIONIST_AGENT_IDS.chapterWriter,
        name: '章节写手',
      }),
      { x: 120, y: 80 },
      [],
    );

    expect(node).toMatchObject({
      type: 'agent',
      position: { x: 120, y: 80 },
      data: {
        professionalAgentId: FICTIONIST_AGENT_IDS.chapterWriter,
        professionalPackageId: 'fictionist',
        label: '章节写手',
        outputFormat: 'txt',
      },
    });
  });

  it('rejects malformed or unknown professional payloads', () => {
    expect(buildAgentNodeFromDrop('{', { x: 0, y: 0 }, [])).toBeNull();
    expect(buildAgentNodeFromDrop(
      JSON.stringify({ professionalAgentId: 'fictionist.missing', name: '未知节点' }),
      { x: 0, y: 0 },
      [],
    )).toBeNull();
  });

  it('blocks restricted insight nodes outside their writing canvases', () => {
    const node = buildAgentNodeFromDrop(
      JSON.stringify({
        professionalAgentId: FICTIONIST_AGENT_IDS.contextAnalyst,
        name: '上下文分析',
      }),
      { x: 0, y: 0 },
      [],
    );
    if (!node) throw new Error('missing context analyst node');

    expect(agentNodeDropRestriction(node, undefined, {})).toContain('AI 起草');
    expect(agentNodeDropRestriction(node, {
      workflowRef: {
        packageId: 'fictionist',
        workflowId: 'workflow-1',
        systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
      },
    }, {})).toBeUndefined();
  });
});
