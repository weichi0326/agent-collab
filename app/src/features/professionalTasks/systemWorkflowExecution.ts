import type { Node } from '@xyflow/react';
import {
  RunAbortedError,
  runCanvas,
  type RunCanvasResult,
} from '../../lib/agentRunner';
import {
  useCanvasStore,
  type AgentNodeData,
  type Canvas,
  type SavedCanvas,
} from '../../stores/canvasStore';
import { taskMatchesOrigin } from './domain';
import { useProfessionalTaskStore } from './professionalTaskStore';
import { isWorkflowFallbackEnabled } from './workflowPolicyStore';

type WorkflowCanvas = Canvas | SavedCanvas;
type CanvasRunner = (canvasId: string, signal?: AbortSignal) => Promise<RunCanvasResult>;
const runningProfessionalTaskIds = new Set<string>();

export interface SystemWorkflowFallbackContext {
  fallbackCanvasId: string;
  primaryError: unknown;
}

export interface SystemWorkflowExecutionResult extends RunCanvasResult {
  sourceCanvasId: string;
  usedFallback: boolean;
}

interface SystemWorkflowExecutionOptions {
  runner?: CanvasRunner;
  fallbackEnabled?: boolean;
  onFallback?: (context: SystemWorkflowFallbackContext) => void;
}

function errorDetail(reason: unknown): string {
  return reason instanceof Error ? reason.message : '未知错误';
}

export class SystemWorkflowPrimaryError extends Error {
  readonly primaryError: unknown;

  constructor(primaryError: unknown) {
    super(`主流程运行失败，备用流程未启用：${errorDetail(primaryError)}`);
    this.name = 'SystemWorkflowPrimaryError';
    this.primaryError = primaryError;
  }
}

export class SystemWorkflowFallbackError extends Error {
  readonly primaryError: unknown;
  readonly fallbackError: unknown;

  constructor(primaryError: unknown, fallbackError: unknown) {
    super(
      `主流程和备用流程均运行失败。主流程：${errorDetail(primaryError)}；备用流程：${errorDetail(fallbackError)}`,
    );
    this.name = 'SystemWorkflowFallbackError';
    this.primaryError = primaryError;
    this.fallbackError = fallbackError;
  }
}

function isCancelled(reason: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted
    || reason instanceof RunAbortedError
    || (reason instanceof Error && reason.name === 'AbortError'),
  );
}

function taskResultError(canvasId: string): Error | undefined {
  const canvas = useCanvasStore.getState().canvases.find((item) => item.id === canvasId);
  if (!canvas?.origin) return undefined;
  const task = useProfessionalTaskStore.getState().tasks[canvas.origin.taskId];
  if (task?.status !== 'failed') return undefined;
  return new Error(task.errorMessage ?? '专业任务结果校验失败');
}

function matchesFallback(template: WorkflowCanvas, source: Canvas): boolean {
  const sourceRef = source.workflowRef;
  const fallbackRef = template.workflowRef;
  return Boolean(
    sourceRef?.sourceWorkflow
    && fallbackRef?.systemWorkflow
    && fallbackRef.packageId === sourceRef.packageId
    && fallbackRef.projectId === undefined
    && fallbackRef.systemWorkflow.key === sourceRef.sourceWorkflow.key
    && fallbackRef.systemWorkflow.version === 2,
  );
}

function fallbackNodes(template: WorkflowCanvas, source: Canvas, snapshot: string): Node[] {
  const sourceAgents = new Map<string, AgentNodeData>();
  let defaultModelRef: AgentNodeData['modelRef'];
  for (const node of source.nodes) {
    const data = node.data as AgentNodeData;
    if (data.professionalAgentId) sourceAgents.set(data.professionalAgentId, data);
    defaultModelRef ??= data.modelRef ?? undefined;
  }

  return template.nodes.map((node) => {
    const data = node.data as AgentNodeData;
    const sourceData = data.professionalAgentId
      ? sourceAgents.get(data.professionalAgentId)
      : undefined;
    return {
      ...node,
      data: {
        ...data,
        modelRef: data.modelRef ?? sourceData?.modelRef ?? defaultModelRef,
        ...(data.dataSourceMode === 'inline' ? {
          inlineDataSource: {
            name: data.inlineDataSource?.name ?? '专业任务上下文快照',
            content: snapshot,
          },
        } : {}),
      },
    };
  });
}

/**
 * Copies a locked version-2 system template into a runnable task canvas.
 * The template remains immutable; only the one-off copy receives task context.
 */
export function createSystemWorkflowFallbackCanvas(sourceCanvasId: string): string | null {
  const state = useCanvasStore.getState();
  const source = state.canvases.find((canvas) => canvas.id === sourceCanvasId);
  if (!source?.origin || source.workflowRef?.sourceWorkflow?.version !== 1) return null;

  const task = useProfessionalTaskStore.getState().tasks[source.origin.taskId];
  if (!task || !taskMatchesOrigin(task, source.origin)) return null;

  const template = state.savedCanvases.find((canvas) => matchesFallback(canvas, source))
    ?? state.canvases.find((canvas) => matchesFallback(canvas, source));
  if (!template) return null;

  const create = () => useCanvasStore.getState().createCanvasFromTemplate(
    `${source.name} · 备用流程`,
    fallbackNodes(template, source, task.contextSnapshot.content),
    template.edges.map((edge) => ({ ...edge })),
    source.origin,
    {
      packageId: source.workflowRef!.packageId,
      projectId: source.workflowRef!.projectId,
      workflowId: source.origin!.taskId,
      sourceWorkflow: {
        key: source.workflowRef!.sourceWorkflow!.key,
        version: 2,
        workflowId: template.workflowRef!.workflowId,
        fallbackEnabled: source.workflowRef!.sourceWorkflow!.fallbackEnabled,
      },
    },
  );

  // Reserve one tab for the fallback source and another for its run snapshot.
  // The failed primary run remains in history and can be reopened later.
  if (state.canvases.length >= state.maxCanvases - 1 && task.runCanvasId) {
    useCanvasStore.getState().removeCanvas(task.runCanvasId);
  }
  const fallbackCanvasId = create();
  if (!fallbackCanvasId) return null;

  const afterCreate = useCanvasStore.getState();
  if (afterCreate.canvases.length >= afterCreate.maxCanvases
    && task.runCanvasId
    && afterCreate.canvases.some((canvas) => canvas.id === sourceCanvasId)) {
    useCanvasStore.getState().removeCanvas(sourceCanvasId);
  }

  useProfessionalTaskStore.getState().linkCanvas(source.origin, fallbackCanvasId);
  return fallbackCanvasId;
}

export async function runCanvasWithSystemFallback(
  sourceCanvasId: string,
  signal?: AbortSignal,
  options: SystemWorkflowExecutionOptions = {},
): Promise<SystemWorkflowExecutionResult> {
  const runner = options.runner ?? runCanvas;
  const source = useCanvasStore.getState().canvases.find((canvas) => canvas.id === sourceCanvasId);
  const taskId = source?.origin?.taskId;
  if (taskId && runningProfessionalTaskIds.has(taskId)) {
    throw new Error('该专业任务正在运行，请勿重复启动。');
  }
  if (taskId) runningProfessionalTaskIds.add(taskId);
  try {
    const workflow = source?.workflowRef?.sourceWorkflow;
    const fallbackEnabled = options.fallbackEnabled
      ?? workflow?.fallbackEnabled
      ?? Boolean(
        source?.workflowRef
        && workflow?.version === 1
        && isWorkflowFallbackEnabled(source.workflowRef.packageId, workflow.key),
      );
    if (source?.origin && workflow?.version === 1) {
      useProfessionalTaskStore.getState().clearFallbackAttempt(source.origin);
    }
    try {
      const result = await runner(sourceCanvasId, signal);
      const resultError = taskResultError(sourceCanvasId);
      if (resultError) throw resultError;
      return { ...result, sourceCanvasId, usedFallback: false };
    } catch (primaryError) {
      if (isCancelled(primaryError, signal)) throw primaryError;
      if (!fallbackEnabled) {
        throw workflow?.version === 1
          ? new SystemWorkflowPrimaryError(primaryError)
          : primaryError;
      }
      const fallbackCanvasId = createSystemWorkflowFallbackCanvas(sourceCanvasId);
      if (!fallbackCanvasId) {
        throw new SystemWorkflowFallbackError(
          primaryError,
          new Error('备用流程未能启动，请检查备用模板和画布数量上限'),
        );
      }

      if (source?.origin) {
        useProfessionalTaskStore.getState().markFallbackStarted(
          source.origin,
          fallbackCanvasId,
          errorDetail(primaryError),
        );
      }
      options.onFallback?.({ fallbackCanvasId, primaryError });
      try {
        const result = await runner(fallbackCanvasId, signal);
        const resultError = taskResultError(fallbackCanvasId);
        if (resultError) throw resultError;
        if (source?.origin) {
          useProfessionalTaskStore.getState().markFallbackFinished(source.origin, 'succeeded');
        }
        return { ...result, sourceCanvasId: fallbackCanvasId, usedFallback: true };
      } catch (fallbackError) {
        if (isCancelled(fallbackError, signal)) {
          if (source?.origin) {
            useProfessionalTaskStore.getState().markFallbackFinished(
              source.origin,
              'cancelled',
              '备用流程已被用户中止',
            );
          }
          throw fallbackError;
        }
        if (source?.origin) {
          useProfessionalTaskStore.getState().markFallbackFinished(
            source.origin,
            'failed',
            errorDetail(fallbackError),
          );
        }
        throw new SystemWorkflowFallbackError(primaryError, fallbackError);
      }
    }
  } finally {
    if (taskId) runningProfessionalTaskIds.delete(taskId);
  }
}
