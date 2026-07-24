import { describe, expect, it } from 'vitest';
import { FICTIONIST_AGENT_IDS } from '../../features/fictionist/agents';
import { buildAgentNodeFromDrop } from './agentDrop';

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
});
