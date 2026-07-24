import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

let useProfessionalTaskStore: typeof import('./professionalTaskStore').useProfessionalTaskStore;

function createTask() {
  return useProfessionalTaskStore.getState().createTask({
    packageId: 'fictionist',
    taskType: 'continue-chapter',
    taskLabel: '续写下一章',
    sourceLabel: '《测试作品》· 第一章',
    sourceRefs: [{ type: 'fiction-chapter', id: 'chapter-1', revision: 2 }],
    contextSnapshot: { title: '上下文', format: 'markdown', content: '正文快照' },
    expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'markdown' },
    historyDescriptor: {
      subjectType: 'fiction-chapter',
      subjectId: 'chapter-2',
      subjectLabel: '第二章',
      actionLabel: '续写',
    },
    packagePayload: { projectId: 'project-1' },
  });
}

beforeAll(async () => {
  ({ useProfessionalTaskStore } = await import('./professionalTaskStore'));
});

beforeEach(() => {
  memory.clear();
  useProfessionalTaskStore.setState({ tasks: {}, focusedTaskId: null });
});

describe('professional task lifecycle', () => {
  it('moves a task from canvas creation to one reviewable result', () => {
    const origin = createTask();
    const state = useProfessionalTaskStore.getState();
    state.linkCanvas(origin, 'canvas-1');
    state.markRunStarted(origin, 'run-1', 'run-canvas-1');
    state.markRunSucceeded(origin, [{
      nodeId: 'node-final',
      resultRole: 'fictionist.chapter-draft',
      outputFormat: 'markdown',
      label: '定稿',
      content: '下一章正文',
    }]);

    expect(useProfessionalTaskStore.getState().tasks[origin.taskId]).toMatchObject({
      status: 'review_required',
      canvasId: 'canvas-1',
      runId: 'run-1',
      runCanvasId: 'run-canvas-1',
      historyDescriptor: {
        subjectLabel: '第二章',
        actionLabel: '续写',
      },
      errorMessage: undefined,
    });
  });

  it('rejects missing or duplicate stable result roles', () => {
    const origin = createTask();
    const duplicate = {
      nodeId: 'node-1',
      resultRole: 'fictionist.chapter-draft',
      outputFormat: 'markdown',
      label: '草稿',
      content: '正文',
    };
    useProfessionalTaskStore.getState().markRunSucceeded(origin, [
      duplicate,
      { ...duplicate, nodeId: 'node-2' },
    ]);

    expect(useProfessionalTaskStore.getState().tasks[origin.taskId]).toMatchObject({
      status: 'failed',
    });
    expect(useProfessionalTaskStore.getState().tasks[origin.taskId].errorMessage).toContain(
      '实际得到 2 个',
    );
  });

  it('recovers persisted running tasks as interrupted', () => {
    const origin = createTask();
    useProfessionalTaskStore.getState().markRunStarted(origin, 'run-1', 'run-canvas-1');

    expect(useProfessionalTaskStore.getState().recoverInterrupted()).toBe(1);
    expect(useProfessionalTaskStore.getState().tasks[origin.taskId].status).toBe('interrupted');
  });

  it('clears primary run pointers and outputs before linking a fallback canvas', () => {
    const origin = createTask();
    const state = useProfessionalTaskStore.getState();
    state.linkCanvas(origin, 'primary-canvas');
    state.markRunStarted(origin, 'primary-run', 'primary-run-canvas');
    state.markRunSucceeded(origin, [{
      nodeId: 'node-final',
      resultRole: 'fictionist.chapter-draft',
      outputFormat: 'markdown',
      label: '部分结果',
      content: '不应被备用流程沿用',
    }]);

    state.linkCanvas(origin, 'fallback-canvas');

    expect(useProfessionalTaskStore.getState().tasks[origin.taskId]).toMatchObject({
      status: 'ready',
      canvasId: 'fallback-canvas',
      outputs: [],
      runId: undefined,
      runCanvasId: undefined,
    });
  });

  it('removes only tasks belonging to the cleaned package', () => {
    const fictionist = createTask();
    const other = useProfessionalTaskStore.getState().createTask({
      packageId: 'other-package',
      taskType: 'other-task',
      taskLabel: '其他任务',
      sourceLabel: '其他来源',
      sourceRefs: [],
      contextSnapshot: { title: '其他', format: 'markdown', content: '其他内容' },
      expectedResult: { role: 'other.result', outputFormat: 'markdown' },
      packagePayload: {},
    });

    useProfessionalTaskStore.getState().removePackageTasks('fictionist');

    expect(useProfessionalTaskStore.getState().tasks[fictionist.taskId]).toBeUndefined();
    expect(useProfessionalTaskStore.getState().tasks[other.taskId]).toBeTruthy();
  });
});
