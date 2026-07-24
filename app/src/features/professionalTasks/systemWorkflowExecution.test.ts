import type { Node } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfessionalTaskOrigin } from './domain';
import { useProfessionalTaskStore } from './professionalTaskStore';
import { useCanvasStore, type AgentNodeData } from '../../stores/canvasStore';
import {
  createSystemWorkflowFallbackCanvas,
  runCanvasWithSystemFallback,
} from './systemWorkflowExecution';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

const origin: ProfessionalTaskOrigin = {
  packageId: 'fictionist',
  taskId: 'task-1',
  taskType: 'draft-chapter',
};

function agentNode(id: string, content: string, modelId?: string): Node<AgentNodeData> {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      professionalAgentId: 'fictionist.chapter-writer',
      dataSourceMode: 'inline',
      inlineDataSource: { name: '上下文', content },
      modelRef: modelId ? { configId: 'config-1', modelId } : null,
    },
  };
}

beforeEach(() => {
  memory.clear();
  useCanvasStore.setState({
    canvases: [],
    activeId: '',
    savedCanvases: [],
    runHistory: [],
    history: {},
  });
  useProfessionalTaskStore.setState({ tasks: {}, focusedTaskId: null });
});

function arrangePrimaryAndFallback(): string {
  const taskOrigin = useProfessionalTaskStore.getState().createTask({
    packageId: origin.packageId,
    taskType: origin.taskType,
    taskLabel: 'AI 起草',
    sourceLabel: '第一章',
    sourceRefs: [],
    contextSnapshot: { title: '第一章上下文', format: 'markdown', content: '真实章节上下文' },
    expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'txt' },
    packagePayload: {},
  });
  origin.taskId = taskOrigin.taskId;

  useCanvasStore.getState().createWorkflowCanvas(
    'AI 起草 · 备用流程',
    {
      packageId: 'fictionist',
      systemWorkflow: { key: 'fictionist.chapter-draft', version: 2 },
    },
    { nodes: [agentNode('fallback-writer', '模板占位')], edges: [], readOnly: true },
  );
  const primaryId = useCanvasStore.getState().createCanvasFromTemplate(
    '作品 · AI 起草',
    [agentNode('primary-writer', '真实章节上下文', 'model-1')],
    [],
    taskOrigin,
    {
      packageId: 'fictionist',
      projectId: 'project-1',
      workflowId: taskOrigin.taskId,
      sourceWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
    },
  );
  if (!primaryId) throw new Error('测试主流程画布创建失败');
  useProfessionalTaskStore.getState().linkCanvas(taskOrigin, primaryId);
  return primaryId;
}

describe('system workflow fallback execution', () => {
  it('copies the locked fallback template into a runnable task canvas', () => {
    const primaryId = arrangePrimaryAndFallback();
    const fallbackId = createSystemWorkflowFallbackCanvas(primaryId);
    const fallback = useCanvasStore.getState().canvases.find((canvas) => canvas.id === fallbackId);

    expect(fallback).toMatchObject({
      origin: { taskId: origin.taskId },
      workflowRef: { sourceWorkflow: { key: 'fictionist.chapter-draft', version: 2 } },
    });
    expect(fallback?.readOnly).toBeFalsy();
    expect((fallback!.nodes[0].data as AgentNodeData).modelRef).toEqual({
      configId: 'config-1',
      modelId: 'model-1',
    });
    expect((fallback!.nodes[0].data as AgentNodeData).inlineDataSource?.content)
      .toBe('真实章节上下文');
    expect(useProfessionalTaskStore.getState().tasks[origin.taskId].canvasId).toBe(fallbackId);
  });

  it('runs version 1 first and immediately uses version 2 after a failure', async () => {
    const primaryId = arrangePrimaryAndFallback();
    const runner = vi.fn()
      .mockRejectedValueOnce(new Error('主流程失败'))
      .mockResolvedValueOnce({
        runId: 'run-2',
        runCanvasId: 'run-canvas-2',
        nodeCount: 1,
        writtenCount: 1,
        outputs: [],
      });
    const onFallback = vi.fn();

    const result = await runCanvasWithSystemFallback(primaryId, undefined, {
      runner,
      fallbackEnabled: true,
      onFallback,
    });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0][0]).toBe(primaryId);
    expect(runner.mock.calls[1][0]).not.toBe(primaryId);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(result.usedFallback).toBe(true);
    expect(result.sourceCanvasId).toBe(runner.mock.calls[1][0]);
  });

  it('treats an invalid professional result as a primary failure', async () => {
    const primaryId = arrangePrimaryAndFallback();
    const runner = vi.fn()
      .mockImplementationOnce(async () => {
        useProfessionalTaskStore.getState().markRunFailed(origin, '缺少唯一 TXT 草稿');
        return {
          runId: 'run-1',
          runCanvasId: 'run-canvas-1',
          nodeCount: 1,
          writtenCount: 0,
          outputs: [],
        };
      })
      .mockResolvedValueOnce({
        runId: 'run-2',
        runCanvasId: 'run-canvas-2',
        nodeCount: 1,
        writtenCount: 1,
        outputs: [],
      });

    const result = await runCanvasWithSystemFallback(primaryId, undefined, {
      runner,
      fallbackEnabled: true,
    });

    expect(result.usedFallback).toBe(true);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('does not enable the fallback after cancellation', async () => {
    const primaryId = arrangePrimaryAndFallback();
    const cancellation = new Error('cancelled');
    cancellation.name = 'AbortError';
    const runner = vi.fn().mockRejectedValue(cancellation);

    await expect(runCanvasWithSystemFallback(primaryId, undefined, {
      runner,
      fallbackEnabled: true,
    }))
      .rejects.toBe(cancellation);
    expect(runner).toHaveBeenCalledOnce();
    expect(useCanvasStore.getState().canvases.filter(
      (canvas) => canvas.workflowRef?.sourceWorkflow?.version === 2,
    )).toHaveLength(0);
  });

  it('fails directly when the user has not enabled the fallback', async () => {
    const primaryId = arrangePrimaryAndFallback();
    const runner = vi.fn().mockRejectedValue(new Error('主流程配置无效'));

    await expect(runCanvasWithSystemFallback(primaryId, undefined, {
      runner,
      fallbackEnabled: false,
    })).rejects.toThrow('备用流程未启用');

    expect(runner).toHaveBeenCalledOnce();
    expect(useCanvasStore.getState().canvases.filter(
      (canvas) => canvas.workflowRef?.sourceWorkflow?.version === 2,
    )).toHaveLength(0);
  });

  it('records a successful fallback on the professional task', async () => {
    const primaryId = arrangePrimaryAndFallback();
    const runner = vi.fn()
      .mockRejectedValueOnce(new Error('主流程失败'))
      .mockResolvedValueOnce({
        runId: 'run-2',
        runCanvasId: 'run-canvas-2',
        nodeCount: 1,
        writtenCount: 1,
        outputs: [],
      });

    await runCanvasWithSystemFallback(primaryId, undefined, {
      runner,
      fallbackEnabled: true,
    });

    expect(useProfessionalTaskStore.getState().tasks[origin.taskId].fallbackAttempt)
      .toMatchObject({ status: 'succeeded', primaryError: '主流程失败' });
  });

  it('rejects a second concurrent launch of the same professional task', async () => {
    const primaryId = arrangePrimaryAndFallback();
    let finish!: (result: {
      runId: string;
      runCanvasId: string;
      nodeCount: number;
      writtenCount: number;
      outputs: [];
    }) => void;
    const pending = new Promise<Parameters<typeof finish>[0]>((resolve) => {
      finish = resolve;
    });
    const runner = vi.fn(() => pending);

    const first = runCanvasWithSystemFallback(primaryId, undefined, {
      runner,
      fallbackEnabled: false,
    });
    await Promise.resolve();
    await expect(runCanvasWithSystemFallback(primaryId, undefined, {
      runner,
      fallbackEnabled: false,
    })).rejects.toThrow('正在运行');

    finish({
      runId: 'run-1',
      runCanvasId: 'run-canvas-1',
      nodeCount: 1,
      writtenCount: 1,
      outputs: [],
    });
    await expect(first).resolves.toMatchObject({ usedFallback: false });
    expect(runner).toHaveBeenCalledOnce();
  });

  it('reserves a run tab for the fallback near the canvas limit', () => {
    const primaryId = arrangePrimaryAndFallback();
    const state = useCanvasStore.getState();
    const fillerCount = state.maxCanvases - state.canvases.length;
    const fillers = Array.from({ length: fillerCount }, (_, index) => ({
      id: index === 0 ? 'primary-run' : `filler-${index}`,
      name: `占位画布 ${index}`,
      nodes: [],
      edges: [],
      ...(index === 0 ? { runId: 'run-1', origin } : {}),
    }));
    useCanvasStore.setState({ canvases: [...state.canvases, ...fillers] });
    useProfessionalTaskStore.getState().markRunStarted(origin, 'run-1', 'primary-run');

    const fallbackId = createSystemWorkflowFallbackCanvas(primaryId);
    const next = useCanvasStore.getState();

    expect(fallbackId).toBeTruthy();
    expect(next.canvases).toHaveLength(next.maxCanvases - 1);
    expect(next.canvases.some((canvas) => canvas.id === 'primary-run')).toBe(false);
    expect(next.canvases.some((canvas) => canvas.id === primaryId)).toBe(false);
    expect(next.canvases.some((canvas) => canvas.id === fallbackId)).toBe(true);
  });
});
