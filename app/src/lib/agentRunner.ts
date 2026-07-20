import type { Node } from '@xyflow/react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  canvasLimitMessage,
  useCanvasStore,
  type AgentNodeData,
  type AgentRunStatus,
  type Canvas,
} from '../stores/canvasStore';
import { datetime } from './time';
import {
  ensureCompatiblePythonService,
  executeTool,
  unwrapToolResult,
} from './pythonClient';
import { getAppOutputDir } from './outputDirectory';
import {
  MAX_CONCURRENT_RUNS,
  MAX_PARALLEL_NODES,
  NODE_RETRY_DELAY_MS,
  NODE_START_STAGGER_MS,
  PREFLIGHT_NODE_ID,
  RETRYABLE_NODE_ERROR_PATTERNS,
} from './agentRunner/constants';
import {
  RunAbortedError,
  RerunUnavailableError,
  type NodeOutput,
  type RunArtifact,
  type RunCanvasResult,
} from './agentRunner/types';
import {
  incomingSources,
  outgoingTargets,
  topoSort,
} from './agentRunner/graph';
import {
  errorMessage,
  isAbortError,
  joinPath,
  sleep,
  interruptibleSleep,
} from './agentRunner/utils';
import {
  collectInput,
  ensureRequiredTools,
  ensureDataSources,
  ensureNodeCapabilities,
} from './agentRunner/inputs';
import { callNodeModel } from './agentRunner/modelCalls';
import { persistOutput } from './agentRunner/outputWriter';
import { isNodeReady, gatePassed } from './agentRunner/gateLogic';
import { nodeLabel } from './agentNode';
import { reportNodeFailureToOrchestrator } from './orchestratorBridge';
import {
  executionAttemptPlan,
  executionCapability,
  generationCapability,
} from './agentNodeCapabilities';
import {
  NodeOutputValidationError,
  assertValidNodeOutput,
  isRetryableOutputValidationError,
  runWithNodeTimeout,
} from './agentRunner/execution';

export { RunAbortedError } from './agentRunner/types';
export type {
  RunArtifact,
  RunCanvasResult,
} from './agentRunner/types';

let activeNativeTasks = 0;
let nativeTaskActivation: Promise<void> = Promise.resolve();
let nativeTaskTransitions: Promise<void> = Promise.resolve();

async function setNativeTaskRunning(running: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('set_task_running', { running });
  } catch {
    // 关闭保护同步失败不应改变任务执行结果。
  }
}

function queueNativeTaskState(running: boolean): Promise<void> {
  nativeTaskTransitions = nativeTaskTransitions.then(() =>
    setNativeTaskRunning(running),
  );
  return nativeTaskTransitions;
}

async function withNativeTaskGuard<T>(task: () => Promise<T>): Promise<T> {
  activeNativeTasks += 1;
  if (activeNativeTasks === 1) {
    nativeTaskActivation = queueNativeTaskState(true);
  }
  await nativeTaskActivation;
  try {
    return await task();
  } finally {
    activeNativeTasks = Math.max(0, activeNativeTasks - 1);
    if (activeNativeTasks === 0) {
      await nativeTaskActivation;
      if (activeNativeTasks === 0) {
        await queueNativeTaskState(false);
      }
    }
  }
}

// 并发运行名额信号量:一个名额 = 一次「正在实际执行节点」的运行。计时节点倒计时期间会
// 主动交还名额(见 runGraph 计时分支),使等计时的运行不占并发名额;计时结束需重新申领,
// 名额满则按 FIFO 排队等待其他运行释放。整图运行(runCanvas)入口用 tryReserve 满即拒绝;
// 子图重跑(rerunCanvasNode)用 waitAndReserve 排队而非拒绝,避免自愈重跑被硬性挡下。
class RunSlotSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }

  // 整图运行入口:名额满则返回 false 由调用方抛错拒绝(原子:检查与占用同步无 await 间隙)。
  tryReserve(): boolean {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }

  // 排队申领:有空位立即占用,否则挂入 FIFO 队列,直到 release 唤醒或 signal 中止。
  waitAndReserve(signal?: AbortSignal): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const grant = () => {
        cleanup();
        this.active++;
        resolve();
      };
      const onAbort = () => {
        cleanup();
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new DOMException('已取消', 'AbortError'));
      };
      if (signal?.aborted) {
        reject(new DOMException('已取消', 'AbortError'));
        return;
      }
      this.waiters.push(grant);
      signal?.addEventListener('abort', onAbort);
    });
  }

  // 释放名额:优先直接交给队首等待者(交接名额,不落到 0),无等待者才真正腾出空位。
  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

const runSlots = new RunSlotSemaphore(MAX_CONCURRENT_RUNS);

// 名额持有标记:在运行入口与 runGraph 计时分支之间传递,保证 release/reserve 严格配对,
// 即使计时期间被中止(重新申领失败)也不会让外层 finally 重复释放。
interface RunSlotHolder {
  held: boolean;
}

function isRetryableNodeError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  const message = errorMessage(err).toLowerCase();
  return RETRYABLE_NODE_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function setNodeRunState(
  canvasId: string,
  nodeId: string,
  status: AgentRunStatus,
  message?: string,
  patch?: Partial<NonNullable<AgentNodeData['runState']>>,
): void {
  useCanvasStore.getState().setNodeRunState(canvasId, nodeId, {
    status,
    message,
    ...patch,
  });
}

export async function removeRunArtifacts(
  canvasId: string,
  artifacts: RunArtifact[],
  runId?: string,
): Promise<number> {
  const paths = Array.from(
    new Set(artifacts.map((a) => a.path).filter((p) => typeof p === 'string' && p.trim())),
  );
  if (paths.length === 0) return 0;

  const res = await executeTool('file', {
    action: 'delete',
    paths,
    remove_empty_parents: true,
    allow_outside_roots: true,
  });
  if (!res.ok) throw new Error(res.error || '移除产物失败');

  useCanvasStore.getState().markOutputItemsDeleted(canvasId, paths, runId);

  const result = res.result as { deleted?: unknown };
  return Array.isArray(result.deleted) ? result.deleted.length : paths.length;
}

export function runCanvas(canvasId: string, signal?: AbortSignal): Promise<RunCanvasResult> {
  return withNativeTaskGuard(() => runCanvasInternal(canvasId, signal));
}

async function runCanvasInternal(
  canvasId: string,
  signal?: AbortSignal,
): Promise<RunCanvasResult> {
  const canvasState = useCanvasStore.getState();
  const sourceCanvas = canvasState.canvases.find((c) => c.id === canvasId);
  if (!sourceCanvas) throw new Error('当前画布不存在。');
  if (sourceCanvas.readOnly) throw new Error('只读运行画布不可再次运行。');
  if (sourceCanvas.nodes.length === 0) throw new Error('画布为空，请先添加节点。');
  if (canvasState.canvases.length >= canvasState.maxCanvases) {
    throw new Error(`${canvasLimitMessage(canvasState.maxCanvases)}，无法创建运行副本。`);
  }

  await ensureCompatiblePythonService();

  // 并发运行名额守卫(原子:检查+占用同步完成,无 await 间隙):整图运行入口满即拒绝。
  // 手动运行按钮虽一次只跑一个,姬子批量/未来多路径可能并发,此处是唯一入口的统一护栏。
  if (!runSlots.tryReserve()) {
    throw new Error(
      `最多只能同时运行 ${MAX_CONCURRENT_RUNS} 个画布，请等待部分运行完成后再试。`,
    );
  }
  const slotHolder: RunSlotHolder = { held: true };

  try {
    topoSort(sourceCanvas.nodes, sourceCanvas.edges);
    ensureDataSources(sourceCanvas);
    try {
      await ensureRequiredTools(sourceCanvas);
    } catch (err) {
      // 运行前工具预检失败(如缺少某文件读取工具)也上报编排层,交姬子判断能否补齐。
      const detail = errorMessage(err);
      reportNodeFailureToOrchestrator({
        canvasId,
        nodeId: PREFLIGHT_NODE_ID,
        nodeLabel: sourceCanvas.name,
        errorDetail: detail,
      });
      throw err;
    }
    const run = useCanvasStore.getState().createRun(sourceCanvas.id);
    if (!run) {
      const state = useCanvasStore.getState();
      if (state.canvases.length >= state.maxCanvases) {
        throw new Error(`${canvasLimitMessage(state.maxCanvases)}，无法创建运行副本。`);
      }
      throw new Error('创建运行副本失败。');
    }

    const canvas = useCanvasStore
      .getState()
      .canvases.find((c) => c.id === run.canvasId);
    if (!canvas) throw new Error('运行副本不存在。');

    const order = topoSort(canvas.nodes, canvas.edges);
    const incoming = incomingSources(canvas.edges);
    const outgoing = outgoingTargets(canvas.edges);
    const byId = new Map(order.map((node) => [node.id, node]));

    const { writtenCount } = await runGraph({
      canvas,
      runId: run.runId,
      sourceCanvasId: canvasId,
      order,
      incoming,
      outgoing,
      byId,
      outputs: new Map<string, NodeOutput>(),
      presetSuccess: new Set<string>(),
      runStartedAt: canvas.runState?.startedAt,
      slotHolder,
      signal,
    });
    return { nodeCount: order.length, writtenCount };
  } finally {
    if (slotHolder.held) runSlots.release();
  }
}

interface RunGraphParams {
  canvas: Canvas;
  runId: string;
  sourceCanvasId: string;
  order: Node[];
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  byId: Map<string, Node>;
  outputs: Map<string, NodeOutput>;
  presetSuccess: Set<string>;
  runStartedAt?: string;
  // 运行入口持有的并发名额;计时分支据此交还/重申名额。缺省(重跑未持名额)时计时分支不动名额。
  slotHolder?: RunSlotHolder;
  signal?: AbortSignal;
}

// 图执行核心: 整图运行(runCanvas)与子图重跑(rerunCanvasNode)共用同一调度器。
// order = 本次要调度的节点; presetSuccess = 视为已成功、不调度的节点(其输出已预置进 outputs)。
async function runGraph({
  canvas,
  runId,
  sourceCanvasId,
  order,
  incoming,
  outgoing,
  byId,
  outputs,
  presetSuccess,
  runStartedAt,
  slotHolder,
  signal,
}: RunGraphParams): Promise<{ writtenCount: number }> {
  const artifacts: RunArtifact[] = [];
  let writtenCount = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let settled = 0;
  let running = 0;
  let aborted = false;
  const status = new Map<string, 'queued' | 'running' | 'success' | 'failed' | 'skipped'>();
  const ready: Node[] = [];

  // ready 判定复用 gateLogic 纯函数(测的即用的):门控要求所有上游 settled、agent 要求全 success。
  const gateTypeOf = (id: string) =>
    (byId.get(id)?.data as AgentNodeData | undefined)?.gateType;
  const isGate = (id: string) => !!gateTypeOf(id);
  const isReady = (childId: string) => {
    const parents = incoming.get(childId) ?? [];
    return isNodeReady(
      gateTypeOf(childId),
      parents.map((p) => status.get(p)),
    );
  };

  // 防止同一节点被重复 push 进 ready 队列。
  const readyHas = new Set<string>();

  // 预置成功的上游节点先入 status,使下面的 ready 判定与 onNodeSettled 门控天然兼容。
  for (const id of presetSuccess) status.set(id, 'success');
  for (const node of order) {
    setNodeRunState(canvas.id, node.id, 'queued', '等待执行');
    status.set(node.id, 'queued');
    if (isReady(node.id)) {
      ready.push(node);
      readyHas.add(node.id);
    }
  }
  useCanvasStore.getState().syncRunSnapshot(runId, canvas.id);

  const updateRunningState = (message = '正在运行') => {
    useCanvasStore.getState().setCanvasRunState(canvas.id, {
      status: 'running',
      message,
      startedAt: runStartedAt,
      total: order.length,
      completed,
      failed,
      skipped,
    });
    useCanvasStore.getState().syncRunSnapshot(runId, canvas.id);
  };

  // 上游 settled(success/failed/skipped)后,扫描下游门控节点是否 ready。
  // 对 agent 下游也兼容(parents.every(success) 判定不变)。
  const onNodeSettled = (node: Node) => {
    for (const childId of outgoing.get(node.id) ?? []) {
      if (status.get(childId) !== 'queued') continue;
      if (readyHas.has(childId)) continue;
      if (isReady(childId)) {
        const child = byId.get(childId);
        if (child) {
          ready.push(child);
          readyHas.add(childId);
        }
      }
    }
  };

  const markSkipped = (nodeId: string, message: string) => {
    const current = status.get(nodeId);
    if (!current || current !== 'queued') return;
    // 门控节点绝不被上游 failed/skipped「被动跳过」——它必须等所有上游 settled 后
    // 走 executeNode 门控分支自评估(OR/NOR 才能在部分上游失败时仍正确判通过/兜底)。
    // 这里直接返回不标记:门控的 ready 推进由各上游 settle 时调用的 onNodeSettled 负责,
    // 最后一个上游 settle 时会把门控 push 进 ready 队列并执行。防止「兜底分支不跑」的 bug。
    if (isGate(nodeId)) return;
    status.set(nodeId, 'skipped');
    skipped++;
    settled++;
    setNodeRunState(canvas.id, nodeId, 'skipped', message);
    // skipped 算 settled,可能让门控下游 ready(如 NOR 上游全 skipped→通过)。
    const node = byId.get(nodeId);
    if (node) onNodeSettled(node);
    for (const childId of outgoing.get(nodeId) ?? []) {
      markSkipped(childId, '前序失败，已跳过');
    }
  };

  const abortRun = (
    reject: (reason?: unknown) => void,
    activeNode?: Node,
    activeStartedAt?: string,
    activeStartMs?: number,
  ) => {
    if (aborted) return;
    aborted = true;
    const now = datetime();
    if (activeNode && status.get(activeNode.id) === 'running') {
      status.set(activeNode.id, 'skipped');
      skipped++;
      settled++;
      setNodeRunState(canvas.id, activeNode.id, 'skipped', '已停止', {
        startedAt: activeStartedAt,
        finishedAt: now,
        durationMs: Date.now() - (activeStartMs ?? Date.now()),
      });
    }
    for (const node of order) {
      const current = status.get(node.id);
      if (current === 'queued' || current === 'running') {
        status.set(node.id, 'skipped');
        skipped++;
        settled++;
        setNodeRunState(canvas.id, node.id, 'skipped', '运行已停止');
      }
    }
    useCanvasStore.getState().setCanvasRunState(canvas.id, {
      status: 'cancelled',
      message: '运行已停止',
      startedAt: runStartedAt,
      finishedAt: now,
      total: order.length,
      completed,
      failed,
      skipped,
    });
    useCanvasStore.getState().syncRunSnapshot(runId, canvas.id);
    reject(new RunAbortedError(artifacts, runId, canvas.id));
  };

  await new Promise<void>((resolve, reject) => {
    const maybeFinish = () => {
      if (aborted) return;
      if (settled < order.length || running > 0) return;
      resolve();
    };

    const launchReady = () => {
      if (aborted) return;
      let launched = 0;
      while (ready.length > 0 && running < MAX_PARALLEL_NODES) {
        const node = ready.shift()!;
        if (status.get(node.id) !== 'queued') continue;
        void executeNode(node, launched * NODE_START_STAGGER_MS);
        launched++;
      }
      maybeFinish();
    };

    const executeNode = async (node: Node, startDelayMs = 0) => {
      const startedAt = datetime();
      const startMs = Date.now();
      running++;
      status.set(node.id, 'running');
      setNodeRunState(canvas.id, node.id, 'running', '正在运行', { startedAt });
      updateRunningState();

      try {
        if (startDelayMs > 0) await sleep(startDelayMs);
        // 门控节点:不调 LLM/工具,按上游 status 算布尔值,通过则聚合输出透传给下游,
        // 不通过则自身 skipped(非 failed),下游被编排器按现有 skipped 传播规则自动标 skipped。
        const gateType = (node.data as AgentNodeData).gateType;
        if (gateType) {
          const parents = incoming.get(node.id) ?? [];
          const parentStatuses = parents.map((p) => status.get(p));
          const successCount = parentStatuses.filter((s) => s === 'success').length;
          // 复用 gateLogic 纯函数(测的即用的),successCount 仅用于状态文案。
          const passed = gatePassed(gateType, parentStatuses);
          if (passed) {
            // 聚合上游 NodeOutput 成信封,每源 content 截断 8000 字符,总封顶 64000。
            const sources = parents
              .map((p) => outputs.get(p))
              .filter(Boolean) as NodeOutput[];
            const content = sources
              .slice(0, 8)
              .map((s) => `=== 「${s.label}」 ===\n${(s.content ?? '').slice(0, 8000)}`)
              .join('\n\n');
            const output: NodeOutput = {
              label: nodeLabel(node),
              content,
              summary: `门控通过（${successCount}/${parents.length} 上游成功）`,
              nodeId: node.id,
            };
            outputs.set(node.id, output);
            completed++;
            settled++;
            status.set(node.id, 'success');
            setNodeRunState(
              canvas.id,
              node.id,
              'success',
              `门控通过（${successCount}/${parents.length}）`,
              { startedAt, finishedAt: datetime(), durationMs: Date.now() - startMs },
            );
            onNodeSettled(node);
          } else {
            skipped++;
            settled++;
            status.set(node.id, 'skipped');
            setNodeRunState(
              canvas.id,
              node.id,
              'skipped',
              `门控未通过（${successCount}/${parents.length}）`,
              { startedAt, finishedAt: datetime(), durationMs: Date.now() - startMs },
            );
            // 下游按现有 skipped 传播:markSkipped 递归(内部会调 onNodeSettled 推进门控下游)。
            for (const childId of outgoing.get(node.id) ?? []) {
              markSkipped(childId, '门控未通过，已跳过');
            }
            // 本门控自身 settled 后也要扫直接下游:若下游是门控,markSkipped 对其提前 return
            // 不推进,只有这里的 onNodeSettled 能在其所有上游 settled 时把它 push 进 ready。
            // 缺此调用会造成「门控→门控」链在上游未通过时下游永不被调度→整轮挂死。
            onNodeSettled(node);
          }
          return;
        }
        // 定时节点:上游全部通过后开始倒计时(无上游则运行即刻开始)。先立即聚合上游产物写入本节点
        // 输出,使下游在计时结束(本节点 success)时即刻可取用,不必再等获取产物;倒计时可被 signal 中断。
        const timerSeconds = (node.data as AgentNodeData).timerSeconds;
        if (typeof timerSeconds === 'number') {
          const parents = incoming.get(node.id) ?? [];
          const sources = parents
            .map((p) => outputs.get(p))
            .filter(Boolean) as NodeOutput[];
          const content = sources
            .slice(0, 8)
            .map((s) => `=== 「${s.label}」 ===\n${(s.content ?? '').slice(0, 8000)}`)
            .join('\n\n');
          const output: NodeOutput = {
            label: nodeLabel(node),
            content,
            summary:
              parents.length > 0
                ? `定时透传（${sources.length} 个上游产物）`
                : '定时器',
            nodeId: node.id,
          };
          // 补充1:计时开始即备好产物,下游计时结束可立即取用。startedAt 已在上面 running 时写入,
          // 供定时节点 UI 反推倒计时剩余,这里不再重置以保留起点。
          outputs.set(node.id, output);
          const waitMs =
            Math.min(86400, Math.max(1, Math.floor(timerSeconds))) * 1000;
          // item 12:计时期间交还并发名额,等计时的运行不占名额,让其他运行推进;计时结束
          // 重新申领(名额满则 FIFO 排队等待释放)。被中止时 waitAndReserve 抛错、不置 held,
          // 外层 finally 便不会重复释放,保证 release/reserve 严格配对。
          const yieldedSlot = slotHolder?.held === true;
          if (yieldedSlot && slotHolder) {
            runSlots.release();
            slotHolder.held = false;
          }
          try {
            await interruptibleSleep(waitMs, signal);
          } finally {
            if (yieldedSlot && slotHolder) {
              await runSlots.waitAndReserve(signal);
              slotHolder.held = true;
            }
          }
          completed++;
          settled++;
          status.set(node.id, 'success');
          setNodeRunState(canvas.id, node.id, 'success', '定时完成', {
            startedAt,
            finishedAt: datetime(),
            durationMs: Date.now() - startMs,
          });
          onNodeSettled(node);
          return;
        }
        // 严格能力门控: 节点必须显式声明运行时会用到的工具标签, 缺失即拒绝执行。
        // 属于配置错误, 放在重试循环外(重试无意义), 失败走既有 catch→reportNodeFailure。
        ensureNodeCapabilities(canvas, node);
        let output: NodeOutput | undefined;
        const nodeData = node.data as AgentNodeData;
        const execution = executionCapability(nodeData.capabilities?.execution);
        const generation = generationCapability(nodeData.capabilities?.generation);
        const attemptPlan = executionAttemptPlan(nodeData.modelRef, nodeData.capabilities);
        attemptGroups: for (let groupIndex = 0; groupIndex < attemptPlan.length; groupIndex++) {
          const group = attemptPlan[groupIndex];
          for (let attempt = 0; attempt < group.attempts; attempt++) {
            try {
              const runAttempt = async (attemptSignal?: AbortSignal) => {
                if (attemptSignal?.aborted) throw new DOMException('已取消', 'AbortError');
                const input = await collectInput(
                  node,
                  incoming.get(node.id) ?? [],
                  outputs,
                  attemptSignal,
                );
                if (attemptSignal?.aborted) throw new DOMException('已取消', 'AbortError');
                const reply = await callNodeModel(node, input, attemptSignal, group.modelRef);
                if (generation.enabled && generation.retryOnEmpty && !reply.trim()) {
                  throw new Error('LLM 返回空内容');
                }
                assertValidNodeOutput(reply, nodeData.capabilities?.validation);
                return persistOutput(canvas, node, reply, attemptSignal);
              };
              output = execution.enabled
                ? await runWithNodeTimeout(runAttempt, execution.timeoutSeconds, signal)
                : await runAttempt(signal);
              break attemptGroups;
            } catch (err) {
              if (isAbortError(err)) throw err;
              const retryable = err instanceof NodeOutputValidationError
                ? err.retryable
                : isRetryableOutputValidationError(
                    err,
                    nodeData.capabilities?.validation,
                  ) || isRetryableNodeError(err);
              const hasAttemptRetry = attempt + 1 < group.attempts;
              const hasFallback = group.kind === 'primary' && groupIndex + 1 < attemptPlan.length;
              if (hasAttemptRetry && retryable) {
                setNodeRunState(
                  canvas.id,
                  node.id,
                  'running',
                  `临时失败，正在重试（${attempt + 1}/${group.attempts - 1}）`,
                );
                updateRunningState('正在重试失败节点');
                await sleep(NODE_RETRY_DELAY_MS);
                continue;
              }
              if (hasFallback && retryable) {
                setNodeRunState(canvas.id, node.id, 'running', '主模型失败，正在切换回退模型');
                updateRunningState('正在切换回退模型');
                break;
              }
              throw err;
            }
          }
        }
        if (!output) throw new Error('节点未产生输出');
        if (output.path) {
          writtenCount++;
          artifacts.push({ nodeId: node.id, path: output.path });
        }
        if (output.dataPath) {
          writtenCount++;
          artifacts.push({ nodeId: node.id, path: output.dataPath });
        }
        outputs.set(node.id, output);
        completed++;
        settled++;
        status.set(node.id, 'success');
        setNodeRunState(canvas.id, node.id, 'success', '运行成功', {
          startedAt,
          finishedAt: datetime(),
          durationMs: Date.now() - startMs,
        });
        onNodeSettled(node);
      } catch (err) {
        if (isAbortError(err)) {
          running--;
          abortRun(reject, node, startedAt, startMs);
          return;
        }

        failed++;
        settled++;
        const detail = errorMessage(err);
        status.set(node.id, 'failed');
        setNodeRunState(canvas.id, node.id, 'failed', detail, {
          startedAt,
          finishedAt: datetime(),
          durationMs: Date.now() - startMs,
        });
        for (const childId of outgoing.get(node.id) ?? []) {
          markSkipped(childId, '前序失败，已跳过');
        }
        // 失败也算 settled,可能让门控下游 ready(如 NOR 上游全 failed→通过)。
        // 在 markSkipped 递归标完下游后调:markSkipped 内部已对每个被标节点调过 onNodeSettled,
        // 这里再调一次扫本节点的直接下游(防 readyHas 漏标),readyHas 防重复 push。
        onNodeSettled(node);
        // 把失败上报给常驻编排层(姬子诊断→半自主造工具)。fire-and-forget,不阻塞
        // 也不影响现有失败隔离;通过事件桥上报源画布 id
        // (sourceCanvasId,用于整图回落)+ 运行副本定位(canvas.id/runId,用于就地重跑失败子节点)。
        reportNodeFailureToOrchestrator({
          canvasId: sourceCanvasId,
          nodeId: node.id,
          nodeLabel: nodeLabel(node),
          errorDetail: detail,
          runTabId: canvas.id,
          runId,
        });
      } finally {
        if (!aborted && status.get(node.id) !== 'running') {
          running--;
          updateRunningState();
          launchReady();
        }
      }
    };

    launchReady();
  });

  if (failed > 0) {
    const message =
      skipped > 0
        ? `运行完成，但 ${failed} 个节点失败，${skipped} 个依赖节点已跳过`
        : `运行完成，但 ${failed} 个节点失败`;
    useCanvasStore.getState().setCanvasRunState(canvas.id, {
      status: 'failed',
      message,
      startedAt: runStartedAt,
      finishedAt: datetime(),
      total: order.length,
      completed,
      failed,
      skipped,
    });
    useCanvasStore.getState().syncRunSnapshot(runId, canvas.id);
    throw new Error(message);
  }

  useCanvasStore.getState().setCanvasRunState(canvas.id, {
    status: 'success',
    message: '运行完成',
    startedAt: runStartedAt,
    finishedAt: datetime(),
    total: order.length,
    completed,
    failed,
    skipped,
  });
  useCanvasStore.getState().syncRunSnapshot(runId, canvas.id);
  return { writtenCount };
}

// 就地重跑「失败节点 + 其下游」: 在既有只读运行副本 tab 上,把已成功上游节点的输出
// 从磁盘 data.json 恢复进内存,只调度失败子图重跑(上游不重算)。无法就地重跑时抛
// RerunUnavailableError,由上层回落整图重跑。
export function rerunCanvasNode(
  runTabId: string,
  nodeId: string,
  sourceCanvasId: string,
  signal?: AbortSignal,
): Promise<RunCanvasResult> {
  return withNativeTaskGuard(() =>
    rerunCanvasNodeInternal(runTabId, nodeId, sourceCanvasId, signal),
  );
}

async function rerunCanvasNodeInternal(
  runTabId: string,
  nodeId: string,
  sourceCanvasId: string,
  signal?: AbortSignal,
): Promise<RunCanvasResult> {
  await ensureCompatiblePythonService();

  const canvas = useCanvasStore
    .getState()
    .canvases.find((c) => c.id === runTabId);
  if (!canvas || !canvas.readOnly || !canvas.runId) {
    throw new RerunUnavailableError('运行副本已不存在，无法就地重跑。');
  }
  const runId = canvas.runId;
  if (!canvas.nodes.some((n) => n.id === nodeId)) {
    throw new RerunUnavailableError('运行副本上找不到目标节点，无法就地重跑。');
  }

  const incoming = incomingSources(canvas.edges);
  const outgoing = outgoingTargets(canvas.edges);

  // 失败节点 + 全部下游后代 = 本次要重跑的子图。
  const rerunIds = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const childId of outgoing.get(id) ?? []) {
      if (!rerunIds.has(childId)) {
        rerunIds.add(childId);
        queue.push(childId);
      }
    }
  }

  const fullOrder = topoSort(canvas.nodes, canvas.edges);
  const order = fullOrder.filter((n) => rerunIds.has(n.id));
  const byId = new Map(order.map((n) => [n.id, n]));

  // 恢复子图上游(不在 rerunIds 内)的已成功输出;presetSuccess = 全部非重跑节点。
  const outputs = new Map<string, NodeOutput>();
  const presetSuccess = new Set<string>();
  const restoredCache = new Map<string, NodeOutput>();
  for (const node of order) {
    for (const parentId of incoming.get(node.id) ?? []) {
      if (rerunIds.has(parentId)) continue;
      presetSuccess.add(parentId);
      if (outputs.has(parentId)) continue;
      let restored = restoredCache.get(parentId);
      if (!restored) {
        const parentNode = canvas.nodes.find((n) => n.id === parentId);
        if (!parentNode) {
          throw new RerunUnavailableError('上游节点缺失，无法就地重跑。');
        }
        restored = await restoreNodeOutput(parentNode, signal);
        restoredCache.set(parentId, restored);
      }
      outputs.set(parentId, restored);
    }
  }

  // 把要重跑的节点状态回到 queued,并挂起运行态(只读 tab 允许被 store 改写)。
  const runStartedAt = datetime();
  useCanvasStore.getState().setCanvasRunState(runTabId, {
    status: 'running',
    message: '正在重跑失败节点及其下游',
    startedAt: runStartedAt,
    total: order.length,
    completed: 0,
    failed: 0,
    skipped: 0,
  });
  for (const node of order) {
    setNodeRunState(runTabId, node.id, 'queued', '等待重跑');
  }
  useCanvasStore.getState().syncRunSnapshot(runId, runTabId);

  // 子图重跑也占并发名额,但用排队申领而非拒绝:名额满时等待释放而不硬性挡下自愈重跑。
  await runSlots.waitAndReserve(signal);
  const slotHolder: RunSlotHolder = { held: true };
  try {
    const { writtenCount } = await runGraph({
      canvas,
      runId,
      sourceCanvasId,
      order,
      incoming,
      outgoing,
      byId,
      outputs,
      presetSuccess,
      runStartedAt,
      slotHolder,
      signal,
    });
    return { nodeCount: order.length, writtenCount };
  } finally {
    if (slotHolder.held) runSlots.release();
  }
}

// 从磁盘 data.json 恢复某已成功节点的输出(供子图重跑作上游输入用)。
// data.json 是产物事实源: envelope.data=structuredData, rawReply=content, summary, node.label。
async function restoreNodeOutput(
  node: Node,
  signal?: AbortSignal,
): Promise<NodeOutput> {
  const lastOutput = (node.data as AgentNodeData).lastOutput;
  const firstItem = lastOutput?.items?.[0];
  if (!lastOutput?.folderName || !firstItem || firstItem.deleted) {
    throw new RerunUnavailableError(
      `节点「${nodeLabel(node)}」的上游产物已不可用，无法就地重跑。`,
    );
  }
  const dataPath = joinPath(await getAppOutputDir(), lastOutput.folderName, 'data.json');
  const res = await executeTool(
    'file',
    { path: dataPath, action: 'read', mode: 'text' },
    signal,
  );
  const result = unwrapToolResult<{ content?: unknown }>(
    res,
    `读取上游产物失败：${dataPath}`,
  );
  if (typeof result.content !== 'string') {
    throw new RerunUnavailableError(`上游产物读取结果异常：${dataPath}`);
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(result.content) as Record<string, unknown>;
  } catch {
    throw new RerunUnavailableError(`上游产物 data.json 解析失败：${dataPath}`);
  }
  const nodeMeta = envelope.node as { label?: unknown } | undefined;
  const label =
    typeof nodeMeta?.label === 'string' ? nodeMeta.label : nodeLabel(node);
  return {
    label,
    content: typeof envelope.rawReply === 'string' ? envelope.rawReply : '',
    structuredData:
      envelope.data && typeof envelope.data === 'object'
        ? (envelope.data as NodeOutput['structuredData'])
        : undefined,
    summary: typeof envelope.summary === 'string' ? envelope.summary : undefined,
    nodeId: node.id,
  };
}
