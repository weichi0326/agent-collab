import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Canvas,
  CanvasWorkflowRef,
  RunRecord,
  SavedCanvas,
} from './canvas/types';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

let useCanvasStore: typeof import('./canvasStore').useCanvasStore;

function canvases(count: number): Canvas[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `canvas-${index}`,
    name: `画布 ${index}`,
    nodes: [],
    edges: [],
  }));
}

beforeAll(async () => {
  ({ useCanvasStore } = await import('./canvasStore'));
});

beforeEach(() => {
  memory.clear();
  useCanvasStore.setState({
    canvases: canvases(20),
    activeId: 'canvas-7',
    savedCanvases: [],
    runHistory: [],
    history: {},
  });
});

describe('canvas open limit', () => {
  it('rejects creating and importing without changing the active canvas', () => {
    const state = useCanvasStore.getState();
    expect(state.addCanvas()).toBeNull();
    expect(state.importCanvas('导入画布', [], [])).toBe(false);
    expect(useCanvasStore.getState().canvases).toHaveLength(20);
    expect(useCanvasStore.getState().activeId).toBe('canvas-7');
  });

  it('rejects opening saved and historical canvases at the limit', () => {
    const saved: SavedCanvas = {
      id: 'saved-1',
      name: '已保存画布',
      nodes: [],
      edges: [],
      savedAt: '2026-07-11 00:00:00',
    };
    const run: RunRecord = {
      id: 'run-1',
      canvasId: 'source-1',
      canvasName: '历史画布',
      time: '2026-07-11 00:00:00',
      stamp: '20260711000000',
      nodes: [],
      edges: [],
    };
    useCanvasStore.setState({ savedCanvases: [saved], runHistory: [run] });

    expect(useCanvasStore.getState().openSaved(saved.id)).toBe('limit');
    expect(useCanvasStore.getState().openRun(run.id)).toBe('limit');
    expect(useCanvasStore.getState().canvases).toHaveLength(20);
    expect(useCanvasStore.getState().activeId).toBe('canvas-7');
  });

  it('still activates an already-open canvas at the limit', () => {
    const current = useCanvasStore.getState().canvases;
    current[12] = { ...current[12], savedId: 'saved-open' };
    useCanvasStore.setState({ canvases: current });

    expect(useCanvasStore.getState().openSaved('saved-open')).toBe('activated');
    expect(useCanvasStore.getState().activeId).toBe('canvas-12');
  });

  it('rejects a run snapshot at 20 and permits it as the twentieth tab', () => {
    expect(useCanvasStore.getState().createRun('canvas-0')).toBeNull();
    expect(useCanvasStore.getState().runHistory).toHaveLength(0);

    useCanvasStore.setState({ canvases: canvases(19), activeId: 'canvas-0' });
    expect(useCanvasStore.getState().createRun('canvas-0')).not.toBeNull();
    expect(useCanvasStore.getState().canvases).toHaveLength(20);
    expect(useCanvasStore.getState().runHistory).toHaveLength(1);
  });
});

describe('read-only canvas selection', () => {
  it('allows selecting a node for inspection without allowing edits', () => {
    useCanvasStore.setState({
      canvases: [{
        id: 'run-canvas',
        name: '运行历史快照',
        nodes: [{
          id: 'node-1',
          type: 'agent',
          position: { x: 10, y: 20 },
          data: { label: '历史节点' },
        }],
        edges: [],
        readOnly: true,
        runId: 'run-1',
      }],
      activeId: 'run-canvas',
    });

    useCanvasStore.getState().applyNodes('run-canvas', [{
      id: 'node-1',
      type: 'select',
      selected: true,
    }]);
    expect(useCanvasStore.getState().canvases[0].nodes[0].selected).toBe(true);

    useCanvasStore.getState().applyNodes('run-canvas', [{
      id: 'node-1',
      type: 'position',
      position: { x: 90, y: 100 },
      dragging: false,
    }]);
    expect(useCanvasStore.getState().canvases[0].nodes[0].position)
      .toEqual({ x: 10, y: 20 });
  });
});

describe('saved canvas deletion', () => {
  it('deletes the saved record without closing a running open tab', () => {
    const saved: SavedCanvas = {
      id: 'saved-running',
      name: '运行中画布',
      nodes: [],
      edges: [],
      savedAt: '2026-07-20 00:00:00',
    };
    useCanvasStore.setState({
      canvases: [
        {
          id: 'canvas-running',
          name: '运行中画布',
          nodes: [],
          edges: [],
          savedId: saved.id,
          lockClose: true,
          runState: { status: 'running', startedAt: '2026-07-20 00:00:00' },
        },
      ],
      activeId: 'canvas-running',
      savedCanvases: [saved],
      history: {},
    });

    useCanvasStore.getState().deleteSaved(saved.id);

    const state = useCanvasStore.getState();
    expect(state.savedCanvases).toHaveLength(0);
    expect(state.canvases).toHaveLength(1);
    expect(state.canvases[0].savedId).toBeUndefined();
    expect(state.canvases[0].runState?.status).toBe('running');
    expect(state.activeId).toBe('canvas-running');
  });
});

describe('reusable workflow canvas', () => {
  it('creates package templates without opening canvas tabs', () => {
    useCanvasStore.setState({ canvases: [], activeId: '', savedCanvases: [] });

    const created = useCanvasStore.getState().createSavedWorkflowCanvas(
      'AI 起草 · 主流程',
      {
        packageId: 'fictionist',
        systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
      },
      {
        nodes: [{
          id: 'writer',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: { label: '章节写手' },
        }],
      },
    );

    expect(created).toBeTruthy();
    expect(useCanvasStore.getState()).toMatchObject({ canvases: [], activeId: '' });
    expect(useCanvasStore.getState().savedCanvases[0]).toMatchObject({
      id: created?.savedId,
      workflowRef: {
        packageId: 'fictionist',
        workflowId: created?.workflowId,
        systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
      },
    });
  });

  it('repairs a malformed system workflow reference without losing primary edits', () => {
    const editedNode = {
      id: 'custom-writer',
      type: 'agent',
      position: { x: 42, y: 24 },
      data: { label: '用户调整后的写手' },
    };
    const malformedRef = {
      packageId: 'fictionist',
      workflowId: 'workflow-legacy',
      systemWorkflow: {
        key: 'mist-harbor',
        version: 'fictionist.chapter-draft',
      },
    } as unknown as CanvasWorkflowRef;
    useCanvasStore.setState({
      canvases: [],
      activeId: '',
      savedCanvases: [{
        id: 'saved-legacy',
        name: 'AI 起草本章 · 1号主流程',
        nodes: [editedNode],
        edges: [],
        savedAt: '2026-07-23 23:56:15',
        workflowRef: malformedRef,
      }],
    });

    const first = useCanvasStore.getState().ensureSavedSystemWorkflowCanvas(
      'AI 起草 · 主流程',
      {
        packageId: 'fictionist',
        systemWorkflow: {
          key: 'fictionist.chapter-draft',
          version: 1,
          templateRevision: 1,
        },
      },
      { nodes: [], edges: [] },
    );
    const second = useCanvasStore.getState().ensureSavedSystemWorkflowCanvas(
      'AI 起草 · 主流程',
      {
        packageId: 'fictionist',
        systemWorkflow: {
          key: 'fictionist.chapter-draft',
          version: 1,
          templateRevision: 1,
        },
      },
      { nodes: [], edges: [] },
    );

    expect(first).toEqual({ savedId: 'saved-legacy', workflowId: 'workflow-legacy' });
    expect(second).toEqual(first);
    expect(useCanvasStore.getState().savedCanvases).toHaveLength(1);
    expect(useCanvasStore.getState().savedCanvases[0]).toMatchObject({
      id: 'saved-legacy',
      name: 'AI 起草 · 主流程',
      nodes: [editedNode],
      workflowRef: {
        packageId: 'fictionist',
        workflowId: 'workflow-legacy',
        systemWorkflow: {
          key: 'fictionist.chapter-draft',
          version: 1,
          templateRevision: 1,
        },
      },
    });
  });

  it('restores a malformed fallback from the package template and locks it', () => {
    const malformedRef = {
      packageId: 'fictionist',
      workflowId: 'workflow-fallback',
      systemWorkflow: {
        key: 'mist-harbor',
        version: 'fictionist.chapter-draft',
      },
    } as unknown as CanvasWorkflowRef;
    const damagedNode = {
      id: 'damaged',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { label: '被改坏的备用节点' },
    };
    const templateNode = {
      id: 'fallback-writer',
      type: 'agent',
      position: { x: 160, y: 180 },
      data: { label: '原始备用写手' },
    };
    useCanvasStore.setState({
      canvases: [{
        id: 'canvas-fallback',
        name: 'AI 起草本章 · 2号备用流程',
        nodes: [damagedNode],
        edges: [],
        savedId: 'saved-fallback',
        workflowRef: malformedRef,
      }],
      activeId: 'canvas-fallback',
      savedCanvases: [{
        id: 'saved-fallback',
        name: 'AI 起草本章 · 2号备用流程',
        nodes: [damagedNode],
        edges: [],
        savedAt: '2026-07-23 23:56:15',
        workflowRef: malformedRef,
      }],
    });

    useCanvasStore.getState().ensureSavedSystemWorkflowCanvas(
      'AI 起草 · 备用流程',
      {
        packageId: 'fictionist',
        systemWorkflow: {
          key: 'fictionist.chapter-draft',
          version: 2,
          templateRevision: 1,
        },
      },
      { nodes: [templateNode], edges: [], readOnly: true },
    );

    const state = useCanvasStore.getState();
    expect(state.savedCanvases[0]).toMatchObject({
      id: 'saved-fallback',
      name: 'AI 起草 · 备用流程',
      nodes: [templateNode],
      readOnly: true,
      workflowRef: {
        systemWorkflow: { key: 'fictionist.chapter-draft', version: 2 },
      },
    });
    expect(state.canvases[0]).toMatchObject({
      name: 'AI 起草 · 备用流程',
      nodes: [templateNode],
      readOnly: true,
      workflowRef: state.savedCanvases[0].workflowRef,
    });
  });

  it('creates the open tab and saved workflow atomically and preserves its project link', () => {
    useCanvasStore.setState({
      canvases: [],
      activeId: '',
      savedCanvases: [],
      runHistory: [],
      history: {},
    });

    const created = useCanvasStore.getState().createWorkflowCanvas('章节连续性检查', {
      packageId: 'fictionist',
      projectId: 'project-1',
    });

    expect(created).toBeTruthy();
    const state = useCanvasStore.getState();
    expect(state.activeId).toBe(created?.canvasId);
    expect(state.canvases).toHaveLength(1);
    expect(state.savedCanvases).toHaveLength(1);
    expect(state.canvases[0]).toMatchObject({
      name: '章节连续性检查',
      savedId: created?.savedId,
      workflowRef: {
        packageId: 'fictionist',
        projectId: 'project-1',
        workflowId: created?.workflowId,
      },
    });
    expect(state.savedCanvases[0]).toMatchObject({
      id: created?.savedId,
      name: '章节连续性检查',
      workflowRef: state.canvases[0].workflowRef,
    });

    useCanvasStore.getState().removeCanvas(created!.canvasId);
    expect(useCanvasStore.getState().openSaved(created!.savedId)).toBe('opened');
    expect(useCanvasStore.getState().canvases[0].workflowRef).toEqual(
      state.savedCanvases[0].workflowRef,
    );

    const run = useCanvasStore.getState().createRun(useCanvasStore.getState().activeId);
    expect(run).toBeTruthy();
    expect(useCanvasStore.getState().runHistory[0].workflowRef).toEqual(
      state.savedCanvases[0].workflowRef,
    );
  });

  it('deletes a user-created package workflow and closes its open canvas', () => {
    useCanvasStore.setState({
      canvases: [],
      activeId: '',
      savedCanvases: [],
      runHistory: [],
      history: {},
    });
    const created = useCanvasStore.getState().createWorkflowCanvas('用户校对流程', {
      packageId: 'fictionist',
    });

    expect(created).toBeTruthy();
    useCanvasStore.getState().deleteSaved(created!.savedId);

    const state = useCanvasStore.getState();
    expect(state.savedCanvases).toHaveLength(0);
    expect(state.canvases).toHaveLength(0);
    expect(state.activeId).toBe('');
  });

  it('does not leave partial state when the name conflicts or the tab limit is reached', () => {
    expect(useCanvasStore.getState().createWorkflowCanvas('已满工作流', {
      packageId: 'fictionist',
      projectId: 'project-1',
    })).toBeNull();
    expect(useCanvasStore.getState().savedCanvases).toHaveLength(0);
    expect(useCanvasStore.getState().canvases).toHaveLength(20);

    useCanvasStore.setState({ canvases: [], activeId: '', savedCanvases: [] });
    expect(useCanvasStore.getState().createWorkflowCanvas('同名工作流', {
      packageId: 'fictionist',
      projectId: 'project-1',
    })).toBeTruthy();
    expect(useCanvasStore.getState().createWorkflowCanvas('同名工作流', {
      packageId: 'fictionist',
      projectId: 'project-1',
    })).toBeNull();
    expect(useCanvasStore.getState().canvases).toHaveLength(1);
    expect(useCanvasStore.getState().savedCanvases).toHaveLength(1);
  });

  it('allows the same scoped workflow name in another project', () => {
    useCanvasStore.setState({ canvases: [], activeId: '', savedCanvases: [] });

    const first = useCanvasStore.getState().createWorkflowCanvas('跨项目工作流', {
      packageId: 'fictionist',
      projectId: 'project-1',
    });
    const second = useCanvasStore.getState().createWorkflowCanvas('跨项目工作流', {
      packageId: 'fictionist',
      projectId: 'project-2',
    });

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(useCanvasStore.getState().canvases).toHaveLength(2);
    expect(useCanvasStore.getState().savedCanvases).toHaveLength(2);
  });

  it('keeps an ordinary canvas name globally reserved', () => {
    useCanvasStore.setState({
      canvases: [{ id: 'plain', name: '共享名称', nodes: [], edges: [] }],
      activeId: 'plain',
      savedCanvases: [],
    });

    expect(useCanvasStore.getState().createWorkflowCanvas('共享名称', {
      packageId: 'fictionist',
      projectId: 'project-2',
    })).toBeNull();
  });

  it('protects system workflow records from deletion', () => {
    useCanvasStore.setState({ canvases: [], activeId: '', savedCanvases: [] });
    const created = useCanvasStore.getState().createWorkflowCanvas('AI 起草 · 主流程', {
      packageId: 'fictionist',
      projectId: 'project-1',
      systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
    });

    expect(created).toBeTruthy();
    useCanvasStore.getState().deleteSaved(created!.savedId);
    expect(useCanvasStore.getState().savedCanvases).toHaveLength(1);
    expect(useCanvasStore.getState().canvases).toHaveLength(1);
  });

  it('restores only an editable primary system workflow to its package template', () => {
    useCanvasStore.setState({ canvases: [], activeId: '', savedCanvases: [] });
    const created = useCanvasStore.getState().createWorkflowCanvas('AI 起草 · 主流程', {
      packageId: 'fictionist',
      systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
    }, {
      nodes: [{
        id: 'writer', type: 'agent', position: { x: 0, y: 0 }, data: { label: '用户版本' },
      }],
    });

    const reset = useCanvasStore.getState().resetSavedSystemWorkflow(created!.savedId, [{
      id: 'writer', type: 'agent', position: { x: 10, y: 20 }, data: { label: '默认版本' },
    }], []);

    expect(reset).toBe(true);
    expect(useCanvasStore.getState().savedCanvases[0].nodes[0].data.label).toBe('默认版本');
    expect(useCanvasStore.getState().canvases[0].nodes[0].data.label).toBe('默认版本');
    expect(useCanvasStore.getState().history[created!.canvasId]).toHaveLength(1);
  });

  it('removes only the deleted project system workflows', () => {
    const systemWorkflow = {
      packageId: 'fictionist',
      projectId: 'project-1',
      workflowId: 'system-1',
      systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 as const },
    };
    const otherProjectWorkflow = {
      ...systemWorkflow,
      projectId: 'project-2',
      workflowId: 'system-2',
    };
    const taskWorkflow = {
      packageId: 'fictionist',
      projectId: 'project-1',
      workflowId: 'task-1',
      sourceWorkflow: { key: 'fictionist.chapter-draft', version: 1 as const },
    };
    useCanvasStore.setState({
      canvases: [
        { id: 'system-1', name: 'system-1', nodes: [], edges: [], workflowRef: systemWorkflow },
        { id: 'system-2', name: 'system-2', nodes: [], edges: [], workflowRef: otherProjectWorkflow },
        { id: 'task-1', name: 'task-1', nodes: [], edges: [], workflowRef: taskWorkflow },
      ],
      activeId: 'system-1',
      savedCanvases: [
        { id: 'saved-system-1', name: 'system-1', nodes: [], edges: [], savedAt: 'now', workflowRef: systemWorkflow },
        { id: 'saved-system-2', name: 'system-2', nodes: [], edges: [], savedAt: 'now', workflowRef: otherProjectWorkflow },
        { id: 'saved-task-1', name: 'task-1', nodes: [], edges: [], savedAt: 'now', workflowRef: taskWorkflow },
      ],
      runHistory: [],
      history: { 'system-1': [], 'system-2': [], 'task-1': [] },
    });

    useCanvasStore.getState().removeProjectSystemWorkflows('fictionist', 'project-1');

    expect(useCanvasStore.getState()).toMatchObject({
      activeId: 'task-1',
      canvases: [{ id: 'system-2' }, { id: 'task-1' }],
      savedCanvases: [{ id: 'saved-system-2' }, { id: 'saved-task-1' }],
      history: { 'system-2': [], 'task-1': [] },
    });
  });

  it('keeps the fallback system workflow read-only after reopening', () => {
    useCanvasStore.setState({ canvases: [], activeId: '', savedCanvases: [] });
    const created = useCanvasStore.getState().createWorkflowCanvas('AI 起草 · 备用流程', {
      packageId: 'fictionist',
      projectId: 'project-1',
      systemWorkflow: { key: 'fictionist.chapter-draft', version: 2 },
    }, {
      readOnly: true,
      nodes: [{
        id: 'writer',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { label: '章节写手' },
      }],
    });

    expect(created).toBeTruthy();
    const state = useCanvasStore.getState();
    state.updateNodeData(created!.canvasId, 'writer', { label: '已修改' });
    state.renameCanvas(created!.canvasId, '已重命名');
    state.renameSaved(created!.savedId, '已重命名');
    expect(useCanvasStore.getState().canvases[0]).toMatchObject({
      name: 'AI 起草 · 备用流程',
      readOnly: true,
    });
    expect(useCanvasStore.getState().canvases[0].nodes[0].data.label).toBe('章节写手');
    expect(useCanvasStore.getState().savedCanvases[0].name).toBe('AI 起草 · 备用流程');

    state.removeCanvas(created!.canvasId);
    expect(useCanvasStore.getState().openSaved(created!.savedId)).toBe('opened');
    expect(useCanvasStore.getState().canvases[0].readOnly).toBe(true);
  });
});

describe('professional task canvas origin', () => {
  it('survives saving, reopening and creating a run snapshot', () => {
    useCanvasStore.setState({
      canvases: [],
      activeId: '',
      savedCanvases: [],
      runHistory: [],
      history: {},
    });
    const origin = {
      packageId: 'fictionist',
      taskId: 'task-1',
      taskType: 'continue-chapter',
    };
    const workflowRef = {
      packageId: 'fictionist',
      projectId: 'project-1',
      workflowId: origin.taskId,
    };
    const canvasId = useCanvasStore.getState().createCanvasFromTemplate(
      '续写画布',
      [],
      [],
      origin,
      workflowRef,
    );
    expect(canvasId).toBeTruthy();
    expect(useCanvasStore.getState().canvases[0].workflowRef).toEqual(workflowRef);
    useCanvasStore.getState().saveActive('续写画布');
    const saved = useCanvasStore.getState().savedCanvases[0];
    expect(saved.origin).toEqual(origin);
    expect(saved.workflowRef).toEqual(workflowRef);

    useCanvasStore.getState().removeCanvas(canvasId!);
    expect(useCanvasStore.getState().openSaved(saved.id)).toBe('opened');
    const reopened = useCanvasStore.getState().canvases[0];
    expect(reopened.origin).toEqual(origin);
    expect(reopened.workflowRef).toEqual(workflowRef);

    const run = useCanvasStore.getState().createRun(reopened.id);
    expect(run).toBeTruthy();
    expect(useCanvasStore.getState().runHistory[0].origin).toEqual(origin);
    expect(useCanvasStore.getState().runHistory[0].workflowRef).toEqual(workflowRef);
    expect(
      useCanvasStore.getState().canvases.find((canvas) => canvas.id === run?.canvasId)?.origin,
    ).toEqual(origin);
  });

  it('removes task canvases, saved copies and history with the package cleanup', () => {
    const origin = {
      packageId: 'fictionist',
      taskId: 'task-cleanup',
      taskType: 'continue-chapter',
    };
    const workflowRef = {
      packageId: 'fictionist',
      projectId: 'project-cleanup',
      workflowId: 'workflow-cleanup',
    };
    useCanvasStore.setState({
      canvases: [
        { id: 'fiction', name: 'fiction', nodes: [], edges: [], origin },
        { id: 'workflow', name: 'workflow', nodes: [], edges: [], workflowRef },
        { id: 'plain', name: 'plain', nodes: [], edges: [] },
      ],
      activeId: 'fiction',
      savedCanvases: [
        { id: 'saved-fiction', name: 'fiction', nodes: [], edges: [], savedAt: 'now', origin },
        { id: 'saved-workflow', name: 'workflow', nodes: [], edges: [], savedAt: 'now', workflowRef },
      ],
      runHistory: [
        {
          id: 'run-fiction', canvasId: 'fiction', canvasName: 'fiction', time: 'now', stamp: 'now',
          nodes: [], edges: [], origin,
        },
        {
          id: 'run-workflow', canvasId: 'workflow', canvasName: 'workflow', time: 'now', stamp: 'now',
          nodes: [], edges: [], workflowRef,
        },
      ],
      history: { fiction: [], workflow: [], plain: [] },
    });

    useCanvasStore.getState().removePackageCanvases('fictionist');

    expect(useCanvasStore.getState()).toMatchObject({
      activeId: 'plain',
      canvases: [{ id: 'plain' }],
      savedCanvases: [],
      runHistory: [],
      history: { plain: [] },
    });
  });
});

describe('manual edge routes', () => {
  it('stores an adjusted route and restores it through undo', () => {
    useCanvasStore.setState({
      canvases: [
        {
          id: 'canvas-route',
          name: 'route canvas',
          nodes: [],
          edges: [{ id: 'edge-1', source: 'a', target: 'b' }],
        },
      ],
      activeId: 'canvas-route',
      history: {},
    });

    const routePoints = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 200 },
      { x: 300, y: 200 },
    ];
    useCanvasStore.getState().pushHistory('canvas-route');
    useCanvasStore.getState().setEdgeRoute('canvas-route', 'edge-1', routePoints);

    expect(
      useCanvasStore.getState().canvases[0].edges[0].data?.routePoints,
    ).toEqual(routePoints);

    useCanvasStore.getState().undo('canvas-route');
    expect(
      useCanvasStore.getState().canvases[0].edges[0].data?.routePoints,
    ).toBeUndefined();
  });
});
