import { describe, expect, it, vi } from 'vitest';

const delayedStorage = vi.hoisted(() => {
  let resolveItem!: (value: unknown) => void;
  const item = new Promise<unknown>((resolve) => {
    resolveItem = resolve;
  });
  return {
    getItem: vi.fn(() => item),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    resolveItem,
  };
});

vi.mock('../../lib/tauriStorage', () => ({
  createProjectStorage: () => ({
    getItem: delayedStorage.getItem,
    setItem: delayedStorage.setItem,
    removeItem: delayedStorage.removeItem,
  }),
}));

describe('fictionist system workflow initialization', () => {
  it('waits for canvas hydration before adding all package templates', async () => {
    vi.resetModules();
    const { useCanvasStore } = await import('../../stores/canvasStore');
    const {
      subscribeFictionistWorkflowInitialization,
    } = await import('./systemWorkflowInitialization');
    const {
      FICTIONIST_SYSTEM_WORKFLOW_SPECS,
      isFictionistSystemWorkflow,
    } = await import('../../features/fictionist/systemWorkflows');

    const stop = subscribeFictionistWorkflowInitialization();
    expect(useCanvasStore.persist.hasHydrated()).toBe(false);
    expect(useCanvasStore.getState().savedCanvases).toHaveLength(0);

    const malformedTemplates = FICTIONIST_SYSTEM_WORKFLOW_SPECS.flatMap((spec) => {
      const legacyName = spec.key === 'fictionist.chapter-draft' ? 'AI 起草本章' : spec.name;
      return ([1, 2] as const).map((version) => ({
        id: `legacy-${spec.key}-${version}`,
        name: `${legacyName} · ${version === 1 ? '1号主流程' : '2号保底流程'}`,
        nodes: [{
          id: `preserved-${spec.key}-${version}`,
          position: { x: 0, y: 0 },
          data: { label: '保留用户配置' },
        }],
        edges: [],
        savedAt: '2026-07-23 23:56:15',
        readOnly: version === 2,
        workflowRef: {
          packageId: 'fictionist',
          workflowId: `workflow-${spec.key}-${version}`,
          systemWorkflow: {
            key: 'mist-harbor',
            version: spec.key as unknown as 1 | 2,
          },
        },
      }));
    });

    const hydrationFinished = new Promise<void>((resolve) => {
      const unsubscribe = useCanvasStore.persist.onFinishHydration(() => {
        unsubscribe();
        resolve();
      });
    });
    delayedStorage.resolveItem({
      version: 2,
      state: {
        canvases: [{
          id: 'persisted-open',
          name: '普通画布',
          nodes: [],
          edges: [],
        }],
        activeId: 'persisted-open',
        savedCanvases: [
          {
            id: 'persisted-saved',
            name: '普通已保存画布',
            nodes: [],
            edges: [],
            savedAt: '2026-07-24 10:00:00',
          },
          ...malformedTemplates,
        ],
        runHistory: [],
      },
    });
    await hydrationFinished;

    const state = useCanvasStore.getState();
    expect(state.canvases.map((canvas) => canvas.id)).toEqual(['persisted-open']);
    expect(state.savedCanvases.some((canvas) => canvas.id === 'persisted-saved')).toBe(true);

    const templates = state.savedCanvases.filter((canvas) =>
      isFictionistSystemWorkflow(canvas.workflowRef),
    );
    expect(templates).toHaveLength(FICTIONIST_SYSTEM_WORKFLOW_SPECS.length * 2);
    expect(templates.map((canvas) => canvas.id).sort()).toEqual(
      malformedTemplates.map((canvas) => canvas.id).sort(),
    );
    expect(templates.filter((canvas) => canvas.workflowRef?.systemWorkflow?.version === 1)
      .every((canvas) => String(canvas.nodes[0]?.id).startsWith('preserved-'))).toBe(true);
    for (const spec of FICTIONIST_SYSTEM_WORKFLOW_SPECS) {
      expect(templates.filter((canvas) => canvas.workflowRef?.systemWorkflow?.key === spec.key)
        .map((canvas) => canvas.workflowRef?.systemWorkflow?.version)
        .sort()).toEqual([1, 2]);
    }
    expect(templates.every((canvas) =>
      canvas.workflowRef?.systemWorkflow?.templateRevision === 2,
    )).toBe(true);
    expect(templates.filter((canvas) => canvas.readOnly))
      .toHaveLength(FICTIONIST_SYSTEM_WORKFLOW_SPECS.length);
    expect(templates.every((canvas) => !/[12]\s*号/u.test(canvas.name))).toBe(true);
    expect(templates.some((canvas) => canvas.name === 'AI 起草 · 主流程')).toBe(true);
    stop();
  });
});
