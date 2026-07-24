import { describe, expect, it } from 'vitest';
import { FICTIONIST_AGENT_IDS } from '../fictionist/agents';
import { CHAPTER_CONTEXT_RESULT_ROLE } from '../fictionist/chapterInsights';
import { FICTIONIST_PACKAGE_ID } from '../fictionist/package';
import { findProfessionalAgent, INSTALLED_PROFESSIONAL_AGENT_GROUPS } from './agentRegistry';
import { professionalAgentNodeData } from './domain';

describe('professional package agent registry', () => {
  it('registers the fictionist package with stable, unique professional agents', () => {
    const fictionist = INSTALLED_PROFESSIONAL_AGENT_GROUPS.find(
      (group) => group.packageId === FICTIONIST_PACKAGE_ID,
    );

    expect(fictionist?.agents).toHaveLength(10);
    expect(new Set(fictionist?.agents.map((agent) => agent.id)).size).toBe(10);
    expect(fictionist?.agents.every((agent) => (
      agent.name.length > 0
      && agent.description.length > 0
      && agent.systemPrompt.length > 0
      && agent.packageId === FICTIONIST_PACKAGE_ID
    ))).toBe(true);
  });

  it('keeps the context output role when a professional node is dragged to a canvas', () => {
    const definition = findProfessionalAgent(FICTIONIST_AGENT_IDS.contextAnalyst);
    expect(professionalAgentNodeData(definition!)).toMatchObject({
      professionalAgentId: FICTIONIST_AGENT_IDS.contextAnalyst,
      resultRole: CHAPTER_CONTEXT_RESULT_ROLE,
      outputFormat: 'markdown',
    });
  });

  it('creates a runnable node snapshot that retains its package origin', () => {
    const definition = findProfessionalAgent(FICTIONIST_AGENT_IDS.chapterWriter);
    expect(definition).toBeDefined();

    const data = professionalAgentNodeData(definition!, {
      configId: 'config-1',
      modelId: 'model-1',
    });

    expect(data).toMatchObject({
      professionalAgentId: FICTIONIST_AGENT_IDS.chapterWriter,
      professionalPackageId: FICTIONIST_PACKAGE_ID,
      label: '章节写手',
      outputFormat: 'txt',
      modelRef: { configId: 'config-1', modelId: 'model-1' },
    });
    expect(data.systemPromptSourceName).toBe('小说家专业包');
    expect(data.toolTags).not.toBe(definition?.toolTags);
  });
});
