import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FICTIONIST_AGENT_IDS } from '../../features/fictionist/agents';
import { findProfessionalAgent } from '../../features/professionalPackages/agentRegistry';
import { useProfessionalTaskStore } from '../../features/professionalTasks/professionalTaskStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { AgentLibrary, professionalAgentCardState } from './AgentLibrary';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

beforeEach(() => {
  memory.clear();
  useCanvasStore.setState({ canvases: [], activeId: '' });
  useProfessionalTaskStore.setState({ tasks: {}, focusedTaskId: null });
});

function professionalCard(html: string, id: string): string {
  const escaped = id.replaceAll('.', '\\.');
  return html.match(new RegExp(`<div[^>]*data-professional-agent-id="${escaped}"[^>]*>`))?.[0] ?? '';
}

describe('AgentLibrary runtime render', () => {
  it('renders professional package agents without throwing', () => {
    const html = renderToString(<AgentLibrary />);

    expect(html).toContain('aria-controls="agent-group-fictionist"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="agent-group-fictionist"');
  });

  it('disables chapter insight agents when the active canvas has no chapter task', () => {
    const html = renderToString(<AgentLibrary />);
    const card = professionalCard(html, FICTIONIST_AGENT_IDS.contextAnalyst);

    expect(card).toContain('aria-disabled="true"');
    expect(card).toContain('draggable="false"');
    expect(card).toContain('仅用于小说家的');
  });

  it('enables chapter insight agents while editing an allowed system workflow', () => {
    const definition = findProfessionalAgent(FICTIONIST_AGENT_IDS.contextAnalyst);
    if (!definition) throw new Error('missing context analyst');
    const card = professionalAgentCardState(
      definition,
      {
        workflowRef: {
          packageId: 'fictionist',
          workflowId: 'workflow-1',
          systemWorkflow: { key: 'fictionist.chapter-continue', version: 1 },
        },
      },
      {},
    );

    expect(card).toMatchObject({
      allowed: true,
      draggable: true,
      ariaDisabled: false,
    });
  });
});
