import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { Canvas, AgentNodeData } from '../stores/canvasStore';
import type { ProfessionalTaskOrigin } from '../features/professionalTasks/domain';
import type { CollectedInput, NodeOutput } from './agentRunner/types';

const modelCalls: Array<{ nodeId: string; modelId?: string | null }> = [];
const modelReplies: Array<string | Error | ((signal?: AbortSignal) => Promise<string>)> = [];

vi.mock('./pythonClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pythonClient')>();
  return {
    ...actual,
    ensureCompatiblePythonService: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(['llm-calling', 'file']),
    executeTool: vi.fn(async (toolName: string, params: Record<string, unknown>) => {
      if (toolName === 'file' && params.action === 'read') {
        return { ok: true, result: { content: '测试输入' } };
      }
      return { ok: true, result: {} };
    }),
  };
});

vi.mock('./agentRunner/modelCalls', () => ({
  callNodeModel: vi.fn(async (
    node: Node,
    _input: CollectedInput,
    signal?: AbortSignal,
    modelRef?: { modelId: string } | null,
  ) => {
    modelCalls.push({ nodeId: node.id, modelId: modelRef?.modelId ?? null });
    const next = modelReplies.shift();
    if (typeof next === 'function') return next(signal);
    if (next instanceof Error) throw next;
    return next ?? '默认输出 结论';
  }),
}));

vi.mock('./agentRunner/outputWriter', () => ({
  persistOutput: vi.fn(async (_canvas: Canvas, node: Node, content: string): Promise<NodeOutput> => ({
    label: String((node.data as AgentNodeData).label ?? node.id),
    content,
    nodeId: node.id,
    path: `mock://${node.id}.md`,
  })),
}));

vi.mock('./orchestratorBridge', () => ({
  reportNodeFailureToOrchestrator: vi.fn(),
  clearOrchestratorRunDiagnosis: vi.fn(),
}));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

let runCanvas: typeof import('./agentRunner').runCanvas;
let RunAbortedError: typeof import('./agentRunner').RunAbortedError;
let useCanvasStore: typeof import('../stores/canvasStore').useCanvasStore;
let useProfessionalTaskStore: typeof import('../features/professionalTasks/professionalTaskStore').useProfessionalTaskStore;

function agentNode(
  id: string,
  patch: Partial<AgentNodeData> = {},
): Node<AgentNodeData> {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      description: `职责 ${id}`,
      modelRef: { configId: 'cfg', modelId: 'primary' },
      outputFormat: 'markdown',
      toolTags: ['file'],
      dataSourceMode: 'file',
      dataSourceFiles: ['input.md'],
      ...patch,
    },
  };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

function setCanvas(nodes: Node[], edges: Edge[] = [], origin?: ProfessionalTaskOrigin) {
  useCanvasStore.setState({
    canvases: [{ id: 'canvas-1', name: '测试画布', nodes, edges, origin }],
    activeId: 'canvas-1',
    savedCanvases: [],
    runHistory: [],
    history: {},
  });
}

function runTab() {
  const state = useCanvasStore.getState();
  const run = state.canvases.find((canvas) => canvas.runId);
  if (!run) throw new Error('missing run tab');
  return run;
}

beforeEach(async () => {
  memory.clear();
  modelCalls.length = 0;
  modelReplies.length = 0;
  vi.useRealTimers();
  ({ runCanvas, RunAbortedError } = await import('./agentRunner'));
  ({ useCanvasStore } = await import('../stores/canvasStore'));
  ({ useProfessionalTaskStore } = await import('../features/professionalTasks/professionalTaskStore'));
  useCanvasStore.setState({
    canvases: [],
    activeId: '',
    savedCanvases: [],
    runHistory: [],
    history: {},
  });
  useProfessionalTaskStore.setState({ tasks: {}, focusedTaskId: null });
});

describe('agent runner integration', () => {
  it('rejects running a system workflow template without task context', async () => {
    useCanvasStore.setState({
      canvases: [{
        id: 'canvas-1',
        name: 'AI 起草 · 主流程',
        nodes: [agentNode('writer')],
        edges: [],
        workflowRef: {
          packageId: 'fictionist',
          projectId: 'project-1',
          workflowId: 'workflow-1',
          systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
        },
      }],
      activeId: 'canvas-1',
      savedCanvases: [],
      runHistory: [],
      history: {},
    });

    await expect(runCanvas('canvas-1')).rejects.toThrow('专业包内置工作流模板不能直接运行');
    expect(useCanvasStore.getState().runHistory).toHaveLength(0);
  });

  it('returns stable output references and advances a professional task to review', async () => {
    const origin = useProfessionalTaskStore.getState().createTask({
      packageId: 'fictionist',
      taskType: 'continue-chapter',
      taskLabel: '续写下一章',
      sourceLabel: '《测试作品》· 第一章',
      sourceRefs: [{ type: 'fiction-chapter', id: 'chapter-1', revision: 1 }],
      contextSnapshot: { title: '上下文', format: 'markdown', content: '来源正文' },
      expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'txt' },
      historyDescriptor: {
        subjectType: 'fiction-chapter',
        subjectId: 'chapter-2',
        subjectLabel: '明日之后',
        actionLabel: '续写',
      },
      packagePayload: {},
    });
    setCanvas([
      agentNode('final', {
        resultRole: 'fictionist.chapter-draft',
        outputFormat: 'txt',
      }),
    ], [], origin);
    modelReplies.push('这是唯一的章节草稿结论');

    const result = await runCanvas('canvas-1');

    expect(result).toMatchObject({ nodeCount: 1, runId: expect.any(String) });
    expect(result.outputs).toEqual([
      expect.objectContaining({
        nodeId: 'final',
        resultRole: 'fictionist.chapter-draft',
        outputFormat: 'txt',
        content: '这是唯一的章节草稿结论',
      }),
    ]);
    expect(useProfessionalTaskStore.getState().tasks[origin.taskId]).toMatchObject({
      status: 'review_required',
      runId: result.runId,
      runCanvasId: result.runCanvasId,
    });
    expect(useCanvasStore.getState().runHistory[0].origin).toEqual(origin);
    expect(useCanvasStore.getState().runHistory[0].history?.displayName)
      .toBe('明日之后-续写（1）');
  });

  it('retries the primary model before switching to the fallback model', async () => {
    setCanvas([
      agentNode('n1', {
        capabilities: {
          execution: { enabled: true, retryCount: 2, timeoutSeconds: 30 },
          generation: {
            enabled: true,
            fallbackModelRef: { configId: 'cfg', modelId: 'fallback' },
          },
        },
      }),
    ]);
    modelReplies.push(
      new Error('LLM 连接中途断开'),
      new Error('LLM 连接中途断开'),
      new Error('LLM 连接中途断开'),
      'fallback 结论',
    );

    await runCanvas('canvas-1');

    expect(modelCalls.map((call) => call.modelId)).toEqual([
      'primary',
      'primary',
      'primary',
      'fallback',
    ]);
    const tab = runTab();
    expect(tab.runState).toMatchObject({ status: 'success', completed: 1, failed: 0 });
    expect((tab.nodes[0].data as AgentNodeData).runState).toMatchObject({ status: 'success' });
  });

  it('retries an internal timeout but does not retry user cancellation', async () => {
    vi.useFakeTimers();
    setCanvas([
      agentNode('n1', {
        capabilities: { execution: { enabled: true, retryCount: 1, timeoutSeconds: 30 } },
      }),
    ]);
    modelReplies.push(
      () => new Promise<string>(() => undefined),
      async () => '超时重试后 结论',
    );

    const timeoutRun = runCanvas('canvas-1');
    await vi.advanceTimersByTimeAsync(30_900);
    await timeoutRun;
    expect(modelCalls.map((call) => call.modelId)).toEqual(['primary', 'primary']);
    expect((runTab().nodes[0].data as AgentNodeData).runState).toMatchObject({ status: 'success' });

    vi.useRealTimers();
    modelCalls.length = 0;
    modelReplies.length = 0;
    setCanvas([
      agentNode('n1', {
        capabilities: { execution: { enabled: true, retryCount: 1, timeoutSeconds: 30 } },
      }),
    ]);
    const controller = new AbortController();
    modelReplies.push((signal) => new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')));
      controller.abort();
    }));

    await expect(runCanvas('canvas-1', controller.signal)).rejects.toBeInstanceOf(RunAbortedError);
    expect(modelCalls.map((call) => call.modelId)).toEqual(['primary']);
    expect((runTab().nodes[0].data as AgentNodeData).runState).toMatchObject({ status: 'skipped' });
  });

  it('stops on fail-strategy validation and skips downstream nodes', async () => {
    setCanvas([
      agentNode('source', {
        capabilities: {
          validation: { enabled: true, requiredTerms: ['结论'], onFailure: 'fail' },
        },
      }),
      agentNode('child', { dataSourceFiles: [] }),
    ], [edge('source', 'child')]);
    modelReplies.push('没有关键词');

    await expect(runCanvas('canvas-1')).rejects.toThrow('运行完成，但 1 个节点失败，1 个依赖节点已跳过');

    const tab = runTab();
    const source = tab.nodes.find((node) => node.id === 'source')!;
    const child = tab.nodes.find((node) => node.id === 'child')!;
    expect((source.data as AgentNodeData).runState).toMatchObject({ status: 'failed' });
    expect((child.data as AgentNodeData).runState).toMatchObject({ status: 'skipped' });
    expect(modelCalls.map((call) => call.nodeId)).toEqual(['source']);
  });

  it('retries retry-strategy validation failures before succeeding', async () => {
    setCanvas([
      agentNode('n1', {
        capabilities: {
          execution: { enabled: true, retryCount: 1, timeoutSeconds: 30 },
          validation: { enabled: true, requiredTerms: ['结论'], onFailure: 'retry' },
        },
      }),
    ]);
    modelReplies.push('没有关键词', '包含结论');

    await runCanvas('canvas-1');

    expect(modelCalls.map((call) => call.modelId)).toEqual(['primary', 'primary']);
    expect((runTab().nodes[0].data as AgentNodeData).runState).toMatchObject({ status: 'success' });
  });
});
