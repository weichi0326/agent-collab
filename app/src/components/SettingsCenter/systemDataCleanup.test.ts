import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Canvas, RunRecord, SavedCanvas } from '../../stores/canvas/types';
import type { AgentDef } from '../../stores/agentStore';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

function persistedState(key: string): Record<string, unknown> {
  const value = memory.get(key);
  expect(value).toBeTruthy();
  return (JSON.parse(value!) as { state: Record<string, unknown> }).state;
}

let reconcileClearedAppData: typeof import('./systemDataCleanup').reconcileClearedAppData;
let useAgentStore: typeof import('../../stores/agentStore').useAgentStore;
let useCanvasStore: typeof import('../../stores/canvasStore').useCanvasStore;
let useTokenStatsStore: typeof import('../../stores/tokenStatsStore').useTokenStatsStore;
let useWorkflowPolicyStore: typeof import('../../features/professionalTasks/workflowPolicyStore').useWorkflowPolicyStore;

const baseCanvas: Canvas = {
  id: 'canvas-base',
  name: '工作画布',
  nodes: [{ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} }],
  edges: [],
};

const savedCanvas: SavedCanvas = {
  id: 'saved-1',
  name: '保存画布',
  nodes: [],
  edges: [],
  savedAt: '2026-07-23 00:00:00',
};

const runRecord: RunRecord = {
  id: 'run-1',
  canvasId: baseCanvas.id,
  canvasName: baseCanvas.name,
  time: '2026-07-23 00:00:00',
  stamp: '20260723000000',
  nodes: [],
  edges: [],
  runState: { status: 'success', startedAt: '2026-07-23 00:00:00' },
};

const customAgent: AgentDef = {
  id: 'agent-1',
  name: '测试 Agent',
  description: '',
  systemPrompt: '',
  toolTags: [],
  modelRef: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

beforeAll(async () => {
  ({ reconcileClearedAppData } = await import('./systemDataCleanup'));
  ({ useAgentStore } = await import('../../stores/agentStore'));
  ({ useCanvasStore } = await import('../../stores/canvasStore'));
  ({ useTokenStatsStore } = await import('../../stores/tokenStatsStore'));
  ({ useWorkflowPolicyStore } = await import('../../features/professionalTasks/workflowPolicyStore'));
});

beforeEach(() => {
  memory.clear();
  useAgentStore.setState({ agents: [customAgent] });
  useCanvasStore.setState({
    canvases: [baseCanvas],
    activeId: baseCanvas.id,
    savedCanvases: [savedCanvas],
    runHistory: [runRecord],
    history: { [baseCanvas.id]: [] },
  });
  useTokenStatsStore.setState({
    byModel: { model: 20 },
    byNode: { 'node-1': { label: '测试节点', total: 20 } },
    masterTotal: 5,
    grandTotal: 25,
    byScene: { orchestrate: 5 },
  });
  useWorkflowPolicyStore.setState({
    policies: {
      'fictionist:fictionist.chapter-draft': { fallbackEnabled: true },
      'translator:translate': { fallbackEnabled: true },
    },
  });
});

describe('system data cleanup memory reconciliation', () => {
  it('removes canvases, saved copies, undo history and custom agents', () => {
    reconcileClearedAppData(['canvas_agents']);

    expect(useCanvasStore.getState()).toMatchObject({
      canvases: [],
      activeId: '',
      savedCanvases: [],
      history: {},
      runHistory: [],
    });
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(persistedState('multi-agent-canvas')).toMatchObject({
      canvases: [],
      activeId: '',
      savedCanvases: [],
      runHistory: [],
    });
    expect(persistedState('multi-agent-agents')).toMatchObject({ agents: [] });
  });

  it('removes run history, run snapshot tabs and token statistics', () => {
    useCanvasStore.setState({
      canvases: [
        baseCanvas,
        { ...baseCanvas, id: 'canvas-run', name: '运行快照', runId: runRecord.id },
      ],
      activeId: 'canvas-run',
      history: { [baseCanvas.id]: [], 'canvas-run': [] },
    });

    reconcileClearedAppData(['runtime']);

    expect(useCanvasStore.getState()).toMatchObject({
      canvases: [baseCanvas],
      activeId: baseCanvas.id,
      runHistory: [],
      history: { [baseCanvas.id]: [] },
    });
    expect(useTokenStatsStore.getState()).toMatchObject({
      byModel: {},
      byNode: {},
      masterTotal: 0,
      grandTotal: 0,
      byScene: {},
    });
    expect(persistedState('multi-agent-canvas')).toMatchObject({ runHistory: [] });
    expect(persistedState('multi-agent-token-stats')).toMatchObject({
      byModel: {},
      byNode: {},
      grandTotal: 0,
    });
  });

  it('removes only the cleared professional package workflow policies', () => {
    reconcileClearedAppData(['fictionist']);

    expect(useWorkflowPolicyStore.getState().policies).toEqual({
      'translator:translate': { fallbackEnabled: true },
    });
  });
});
