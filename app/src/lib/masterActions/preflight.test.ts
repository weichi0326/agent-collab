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

  it('rejects duplicate canvas and agent names before execution', () => {
    const result = preflightMasterPlan(
      [
        { type: 'create-canvas', name: observation.canvases[0].name },
        { type: 'create-agent', name: observation.agents[0].name },
      ],
      observation,
    );

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['canvas-name-duplicate', 'agent-name-duplicate']),
    );
  });

  it('rejects active-canvas mutations when no editable canvas exists', () => {
    const missing = preflightMasterPlan(
      [{ type: 'rename-active-canvas', name: '新名称' }],
      { ...observation, activeCanvasId: null, activeCanvas: null },
    );
    const readOnlyObservation: JiziProjectObservation = {
      ...observation,
      canvases: observation.canvases.map((canvas) => ({
        ...canvas,
        readOnly: true,
      })),
    };
    const readOnly = preflightMasterPlan(
      [
        { type: 'add-node', label: '新节点' },
        { type: 'delete-node', label: '研究' },
        { type: 'set-node-output-format', label: '研究', outputFormat: 'markdown' },
      ],
      readOnlyObservation,
    );

    expect(missing.issues.some((issue) => issue.code === 'active-canvas-missing')).toBe(true);
    expect(readOnly.issues.filter((issue) => issue.code === 'canvas-read-only')).toHaveLength(3);
  });

  it('rejects unresolved and duplicate connections', () => {
    const withExistingEdge: JiziProjectObservation = {
      ...observation,
      canvases: observation.canvases.map((canvas) => ({
        ...canvas,
        nodes: [
          ...canvas.nodes,
          { ...canvas.nodes[0], id: 'node-2', label: '撰写' },
        ],
        edges: [{ id: 'edge-1', sourceId: 'node-1', targetId: 'node-2' }],
      })),
    };
    const result = preflightMasterPlan(
      [
        { type: 'connect-nodes', source: '不存在', target: '撰写' },
        { type: 'connect-nodes', source: '研究', target: '撰写' },
      ],
      withExistingEdge,
    );

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['node-not-found', 'connection-duplicate']),
    );
  });

  it('rejects running an absent, read-only, or already-running canvas', () => {
    const absent = preflightMasterPlan(
      [{ type: 'run-active-canvas' }],
      { ...observation, activeCanvasId: null, activeCanvas: null },
    );
    const blocked = preflightMasterPlan(
      [{ type: 'run-active-canvas' }],
      {
        ...observation,
        canvases: observation.canvases.map((canvas) => ({
          ...canvas,
          readOnly: true,
          run: { status: 'running', message: '' },
        })),
      },
    );

    expect(absent.issues.some((issue) => issue.code === 'active-canvas-missing')).toBe(true);
    expect(blocked.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['canvas-read-only', 'canvas-running']),
    );
  });
});
