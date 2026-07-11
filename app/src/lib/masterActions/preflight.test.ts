import { describe, expect, it } from 'vitest';
import type { JiziProjectObservation } from '../jiziProjectObservation';
import { preflightMasterPlan } from './preflight';

const observation: JiziProjectObservation = {
  activeCanvasId: 'canvas-1',
  activeCanvas: null,
  canvases: [
    {
      id: 'canvas-1',
      name: '主画布',
      readOnly: false,
      runId: null,
      run: { status: 'idle', message: '' },
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          label: '研究',
          agentId: 'agent-1',
          description: '',
          systemPrompt: '',
          toolTags: [],
          modelRef: null,
          inputSchemaText: '',
          outputSchemaText: '',
          outputFormat: null,
          run: { status: 'idle', message: '' },
          lastOutput: null,
        },
      ],
      edges: [],
    },
  ],
  agents: [
    {
      id: 'agent-1',
      name: '研究助手',
      description: '',
      systemPrompt: '',
      toolTags: [],
      modelRef: null,
      inputSchemaText: '',
      outputSchemaText: '',
    },
  ],
  models: [
    {
      configId: 'cfg-1',
      providerId: 'openai',
      configName: '主模型',
      models: [
        {
          id: 'model-1',
          label: '模型一',
          enabled: true,
          caps: { longContext: false, vision: false, audio: false },
        },
      ],
    },
  ],
  selectedMasterModel: null,
  tools: [
    {
      name: 'file',
      description: '文件',
      tags: ['file'],
      dependencies: [],
      builtin: true,
      internal: false,
      loadError: null,
    },
    {
      name: 'custom-reader',
      description: '自定义读取',
      tags: ['custom-reader'],
      dependencies: [],
      builtin: false,
      internal: false,
      loadError: null,
    },
  ],
  serviceStatus: 'running',
  searchProviderIds: [],
  enabledSkillIds: [],
};

describe('preflightMasterPlan', () => {
  it('accepts a valid update and requires normal confirmation', () => {
    const result = preflightMasterPlan(
      [
        {
          type: 'update-agent',
          agentId: 'agent-1',
          patch: {
            modelRef: { configId: 'cfg-1', modelId: 'model-1' },
            toolTags: ['file'],
          },
        },
      ],
      observation,
    );

    expect(result.ok).toBe(true);
    expect(result.risk).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.requiresSecondConfirmation).toBe(false);
  });

  it('rejects missing targets and unavailable capabilities', () => {
    const result = preflightMasterPlan(
      [
        {
          type: 'update-node-agent-config',
          canvasId: 'canvas-1',
          nodeId: 'missing',
          patch: {
            modelRef: { configId: 'cfg-1', modelId: 'missing-model' },
            toolTags: ['missing-tool'],
          },
        },
      ],
      observation,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['node-not-found', 'model-unavailable', 'tool-unavailable']),
    );
  });

  it('marks deletion destructive and protects built-in tools', () => {
    const allowed = preflightMasterPlan(
      [{ type: 'delete-tool', toolName: 'custom-reader' }],
      observation,
    );
    const blocked = preflightMasterPlan(
      [{ type: 'delete-tool', toolName: 'file' }],
      observation,
    );

    expect(allowed).toMatchObject({
      ok: true,
      risk: 'destructive',
      requiresSecondConfirmation: true,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.issues[0].code).toBe('builtin-tool-protected');
  });

  it('rejects plans above the eight-step limit before execution', () => {
    const result = preflightMasterPlan(
      Array.from({ length: 9 }, (_, index) => ({
        type: 'create-agent' as const,
        name: `Agent ${index + 1}`,
      })),
      observation,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'step-limit')).toBe(true);
  });
});
