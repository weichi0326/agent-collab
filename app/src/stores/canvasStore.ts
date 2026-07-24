import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import { datetime } from '../lib/time';
import { uid } from '../lib/id';
import { createProjectStorage } from '../lib/tauriStorage';
import { normalizeToolTags } from '../lib/toolTagMigration';
import { makeCanvas } from './canvas/naming';
import { recomputeDerived } from './canvas/derived';
import { recoverRunNodes, recoverRunState } from './canvas/runRecovery';
import { clearOrchestratorRunDiagnosis } from '../lib/orchestratorBridge';
import type { RoutePoint } from '../lib/orthogonalRoute';
import type { ProfessionalTaskOrigin } from '../features/professionalTasks/domain';
import type { ProfessionalTaskHistoryDescriptor } from '../features/professionalTasks/domain';
import {
  cloneEdges,
  cloneRunNodes,
  createRunSnapshotTab,
  createRunHistoryMetadata,
  createRunningArtifacts,
  expandedRunGraph,
  markDeletedOutputs,
  pruneRunHistory,
} from './canvas/runRecords';
import {
  MAX_CANVASES,
  type AgentNodeData,
  type AgentRunState,
  type Canvas,
  type CanvasRunState,
  type CanvasOpenResult,
  type CreatedRun,
  type CreatedSavedWorkflowCanvas,
  type CreatedWorkflowCanvas,
  type CanvasWorkflowRef,
  type RunRecord,
  type SavedCanvas,
  type Snapshot,
} from './canvas/types';

export type {
  AgentNode,
  AgentNodeData,
  AgentNodeCapabilities,
  AgentOutputFormat,
  AgentRunState,
  AgentRunStatus,
  NodeExecutionCapability,
  NodeGenerationCapability,
  NodeInputCapability,
  NodeValidationCapability,
  Canvas,
  CanvasRunState,
  CanvasRunStatus,
  CanvasOpenResult,
  CreatedRun,
  CreatedSavedWorkflowCanvas,
  CreatedWorkflowCanvas,
  CanvasWorkflowRef,
  RunRecord,
  SavedCanvas,
} from './canvas/types';
export { canvasLimitMessage } from './canvas/types';
export {
  outputFolderName,
  isDefaultCanvasName,
  validateCanvasName,
} from './canvas/naming';
export { isCanvasDirty, upstreamNames } from './canvas/selectors';

// 撤销历史全局总条数上限(跨所有画布);单画布另有软上限,超出时按最旧序号裁剪。
const HISTORY_GLOBAL_LIMIT = 200;
const HISTORY_PER_CANVAS_LIMIT = 50;
// 快照全局单调递增序号,用于跨画布裁剪时按最旧优先淘汰。
let historySeq = 0;

function isLockedSystemWorkflow(canvas: Canvas | SavedCanvas): boolean {
  return canvas.workflowRef?.systemWorkflow?.version === 2;
}

function isProtectedSystemWorkflow(canvas: Canvas | SavedCanvas): boolean {
  return Boolean(canvas.workflowRef?.systemWorkflow);
}

// 把某画布当前状态压入撤销历史,并做单画布 + 全局总量双重裁剪。纯函数,返回新的 history。
// 供 pushHistory 动作与各结构性变更动作内联复用,确保「所有改动入口统一入栈」。
function pushCanvasSnapshot(
  history: Record<string, Snapshot[]>,
  canvas: Canvas,
): Record<string, Snapshot[]> {
  const snap: Snapshot = {
    nodes: canvas.nodes.map((n) => ({ ...n })),
    edges: canvas.edges.map((e) => ({ ...e })),
    name: canvas.name,
    seq: historySeq++,
  };
  const next: Record<string, Snapshot[]> = {
    ...history,
    [canvas.id]: [...(history[canvas.id] ?? []), snap].slice(
      -HISTORY_PER_CANVAS_LIMIT,
    ),
  };
  let total = Object.values(next).reduce((n, stack) => n + stack.length, 0);
  while (total > HISTORY_GLOBAL_LIMIT) {
    let oldestId: string | null = null;
    let oldestSeq = Infinity;
    for (const [cid, stack] of Object.entries(next)) {
      if (stack.length > 0 && stack[0].seq < oldestSeq) {
        oldestSeq = stack[0].seq;
        oldestId = cid;
      }
    }
    if (!oldestId) break;
    next[oldestId] = next[oldestId].slice(1);
    total--;
  }
  return next;
}

interface CanvasState {
  canvases: Canvas[];
  activeId: string;
  savedCanvases: SavedCanvas[];
  runHistory: RunRecord[];
  maxCanvases: number;
  history: Record<string, Snapshot[]>;

  ensureCanvas: () => void;
  recoverInterruptedRuns: () => number;
  addCanvas: () => string | null;
  clearCanvasData: () => void;
  clearRunHistory: () => void;
  createCanvasFromTemplate: (
    name: string,
    nodes: Node[],
    edges: Edge[],
    origin?: ProfessionalTaskOrigin,
    workflowRef?: CanvasWorkflowRef,
  ) => string | null;
  createWorkflowCanvas: (
    name: string,
    scope: Omit<CanvasWorkflowRef, 'workflowId'>,
    template?: {
      nodes?: Node[];
      edges?: Edge[];
      readOnly?: boolean;
    },
  ) => CreatedWorkflowCanvas | null;
  createSavedWorkflowCanvas: (
    name: string,
    scope: Omit<CanvasWorkflowRef, 'workflowId'>,
    template?: {
      nodes?: Node[];
      edges?: Edge[];
      readOnly?: boolean;
    },
  ) => CreatedSavedWorkflowCanvas | null;
  ensureSavedSystemWorkflowCanvas: (
    name: string,
    scope: Omit<CanvasWorkflowRef, 'workflowId'> & {
      systemWorkflow: NonNullable<CanvasWorkflowRef['systemWorkflow']>;
    },
    template: {
      nodes?: Node[];
      edges?: Edge[];
      readOnly?: boolean;
    },
  ) => CreatedSavedWorkflowCanvas | null;
  resetSavedSystemWorkflow: (savedId: string, nodes: Node[], edges: Edge[]) => boolean;
  removeProjectSystemWorkflows: (packageId: string, projectId: string) => void;
  removePackageCanvases: (packageId: string) => void;
  removeCanvas: (id: string) => void;
  renameCanvas: (id: string, name: string) => void;
  setActive: (id: string) => void;

  applyNodes: (id: string, changes: NodeChange[]) => void;
  applyEdges: (id: string, changes: EdgeChange[]) => void;
  connect: (id: string, connection: Connection) => void;
  setEdgeRoute: (
    canvasId: string,
    edgeId: string,
    routePoints?: RoutePoint[],
  ) => void;
  addNode: (id: string, node: Node) => void;

  pushHistory: (id: string) => void;
  undo: (id: string) => void;
  recompute: (id: string) => void;
  addGraph: (id: string, nodes: Node[], edges: Edge[]) => void;
  updateNodeData: (
    canvasId: string,
    nodeId: string,
    patch: Partial<AgentNodeData>,
  ) => void;
  setNodeRunState: (
    canvasId: string,
    nodeId: string,
    runState: AgentRunState,
  ) => void;
  setCanvasRunState: (canvasId: string, runState: CanvasRunState) => void;
  setRunCardCollapsed: (canvasId: string, collapsed: boolean) => void;
  toggleCollapse: (id: string, nodeId: string) => void;
  setAllCollapsed: (id: string, collapsed: boolean) => void;

  saveActive: (name?: string) => void;
  saveActiveAsNew: (name: string) => void;
  saveAndClose: (id: string, name?: string) => void;
  openSaved: (savedId: string) => CanvasOpenResult;
  deleteSaved: (savedId: string) => void;
  renameSaved: (savedId: string, name: string) => void;
  // 导入外部画布:重建为一张未保存的新 tab(无 savedId),画布数达上限返回 false。
  importCanvas: (name: string, nodes: Node[], edges: Edge[]) => boolean;

  createRun: (
    canvasId: string,
    historyDescriptor?: ProfessionalTaskHistoryDescriptor,
  ) => CreatedRun | null;
  syncRunSnapshot: (runId: string, canvasId: string) => void;
  markOutputItemsDeleted: (
    canvasId: string,
    paths: string[],
    runId?: string,
  ) => void;
  openRun: (runId: string) => CanvasOpenResult;
  deleteRun: (runId: string) => void;
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      canvases: [],
      activeId: '',
      savedCanvases: [],
      runHistory: [],
      maxCanvases: MAX_CANVASES,
      history: {},

      // 只矫正 activeId 指向,不再自动补建画布(允许一个都没有)
      ensureCanvas: () =>
        set((s) => {
          // 4.10：数据可能仍在加载(如超时后强制进入),此时 canvases 为空是暂态,
          // 不要清空 activeId,以免覆盖随后 hydration 补齐的状态;仅在指向缺失画布时纠正。
          if (s.canvases.length === 0) return s;
          if (!s.canvases.find((c) => c.id === s.activeId)) {
            return { activeId: s.canvases[0].id };
          }
          return s;
        }),

      recoverInterruptedRuns: () => {
        const recoveredRunIds = new Set<string>();
        set((s) => {
          const finishedAt = datetime();
          const canvases = s.canvases.map((canvas) => {
            if (canvas.runState?.status !== 'running' && !canvas.lockClose) return canvas;
            if (canvas.runState?.status === 'running') {
              recoveredRunIds.add(canvas.runId ?? canvas.id);
            }
            return {
              ...canvas,
              nodes: recoverRunNodes(canvas.nodes, finishedAt),
              lockClose: false,
              runState: recoverRunState(canvas.runState, finishedAt),
            };
          });
          const runHistory = s.runHistory.map((record) => {
            if (record.runState?.status !== 'running') return record;
            recoveredRunIds.add(record.id);
            return {
              ...record,
              nodes: recoverRunNodes(record.nodes, finishedAt),
              runState: recoverRunState(record.runState, finishedAt),
            };
          });

          return { canvases, runHistory };
        });
        return recoveredRunIds.size;
      },

      addCanvas: () => {
        let createdId: string | null = null;
        set((s) => {
          if (s.canvases.length >= MAX_CANVASES) return s;
          const c = makeCanvas(s.canvases);
          createdId = c.id;
          return { canvases: [...s.canvases, c], activeId: c.id };
        });
        return createdId;
      },

      clearCanvasData: () => set({
        canvases: [],
        activeId: '',
        savedCanvases: [],
        runHistory: [],
        history: {},
      }),

      clearRunHistory: () => set((s) => {
        const removedIds = new Set(
          s.canvases.filter((canvas) => canvas.runId).map((canvas) => canvas.id),
        );
        const canvases = s.canvases.filter((canvas) => !removedIds.has(canvas.id));
        return {
          canvases,
          activeId: removedIds.has(s.activeId) ? canvases.at(-1)?.id ?? '' : s.activeId,
          runHistory: [],
          history: Object.fromEntries(
            Object.entries(s.history).filter(([canvasId]) => !removedIds.has(canvasId)),
          ),
        };
      }),

      createCanvasFromTemplate: (name, nodes, edges, origin, workflowRef) => {
        let createdId: string | null = null;
        set((s) => {
          if (s.canvases.length >= MAX_CANVASES) return s;
          const d = recomputeDerived(
            nodes.map((node) => ({ ...node, data: { ...node.data } })),
            edges.map((edge) => ({ ...edge })),
          );
          const canvas: Canvas = {
            id: uid('c'),
            name: name.trim() || makeCanvas(s.canvases).name,
            nodes: d.nodes,
            edges: d.edges,
            origin,
            workflowRef,
          };
          createdId = canvas.id;
          return { canvases: [...s.canvases, canvas], activeId: canvas.id };
        });
        return createdId;
      },

      // 工作流是可复用的已保存画布:一次 set 同时创建 tab 与 saved record,
      // 避免达到画布上限或切换视图失败时留下半条工作流。
      createWorkflowCanvas: (name, scope, template) => {
        let created: CreatedWorkflowCanvas | null = null;
        set((s) => {
          const finalName = name.trim();
          const hasNameConflict = (canvas: Canvas | SavedCanvas) => {
            if (canvas.name !== finalName) return false;
            // Reusable workflows are scoped to a professional package project;
            // ordinary canvases (or legacy records without a scope) keep the
            // existing global name constraint.
            return !canvas.workflowRef
              || (canvas.workflowRef.packageId === scope.packageId
                && canvas.workflowRef.projectId === scope.projectId);
          };
          if (!finalName
            || s.canvases.length >= MAX_CANVASES
            || s.canvases.some(hasNameConflict)
            || s.savedCanvases.some(hasNameConflict)) {
            return s;
          }
          const canvasId = uid('c');
          const savedId = uid('s');
          const workflowId = uid('w');
          const workflowRef: CanvasWorkflowRef = { ...scope, workflowId };
          const d = recomputeDerived(
            (template?.nodes ?? []).map((node) => ({
              ...node,
              data: { ...node.data },
            })),
            (template?.edges ?? []).map((edge) => ({ ...edge })),
          );
          const canvas: Canvas = {
            id: canvasId,
            name: finalName,
            nodes: d.nodes,
            edges: d.edges,
            savedId,
            workflowRef,
            readOnly: template?.readOnly,
          };
          const saved: SavedCanvas = {
            id: savedId,
            name: finalName,
            nodes: d.nodes,
            edges: d.edges,
            savedAt: datetime(),
            readOnly: template?.readOnly,
            workflowRef,
          };
          created = { canvasId, savedId, workflowId };
          return {
            canvases: [...s.canvases, canvas],
            activeId: canvasId,
            savedCanvases: [...s.savedCanvases, saved],
          };
        });
        return created;
      },

      createSavedWorkflowCanvas: (name, scope, template) => {
        let created: CreatedSavedWorkflowCanvas | null = null;
        set((s) => {
          const finalName = name.trim();
          const hasNameConflict = (canvas: Canvas | SavedCanvas) => canvas.name === finalName
            && (!canvas.workflowRef
              || (canvas.workflowRef.packageId === scope.packageId
                && canvas.workflowRef.projectId === scope.projectId));
          if (!finalName
            || s.canvases.some(hasNameConflict)
            || s.savedCanvases.some(hasNameConflict)) return s;
          const savedId = uid('s');
          const workflowId = uid('w');
          const workflowRef: CanvasWorkflowRef = { ...scope, workflowId };
          const graph = recomputeDerived(
            (template?.nodes ?? []).map((node) => ({
              ...node,
              data: { ...node.data },
            })),
            (template?.edges ?? []).map((edge) => ({ ...edge })),
          );
          const saved: SavedCanvas = {
            id: savedId,
            name: finalName,
            nodes: graph.nodes,
            edges: graph.edges,
            savedAt: datetime(),
            readOnly: template?.readOnly,
            workflowRef,
          };
          created = { savedId, workflowId };
          return { savedCanvases: [...s.savedCanvases, saved] };
        });
        return created;
      },

      ensureSavedSystemWorkflowCanvas: (name, scope, template) => {
        let ensured: CreatedSavedWorkflowCanvas | null = null;
        set((s) => {
          const finalName = name.trim();
          if (!finalName) return s;
          const normalizedSystemName = (value: string) => value
            .replaceAll('AI 起草本章', 'AI 起草')
            .replaceAll('保底流程', '备用流程')
            .replaceAll('1号主流程', '主流程')
            .replaceAll('1 号主流程', '主流程')
            .replaceAll('2号备用流程', '备用流程')
            .replaceAll('2 号备用流程', '备用流程');
          const matchesScope = (canvas: Canvas | SavedCanvas) => {
            const ref = canvas.workflowRef;
            return ref?.packageId === scope.packageId
              && ref.projectId === scope.projectId
              && ref.systemWorkflow?.key === scope.systemWorkflow.key
              && ref.systemWorkflow.version === scope.systemWorkflow.version;
          };
          const matchesMalformedLegacy = (canvas: Canvas | SavedCanvas) => {
            const ref = canvas.workflowRef;
            return normalizedSystemName(canvas.name) === normalizedSystemName(finalName)
              && ref?.packageId === scope.packageId
              && ref.projectId === scope.projectId
              && Boolean(ref.systemWorkflow);
          };
          const templateGraph = () => recomputeDerived(
            (template.nodes ?? []).map((node) => ({
              ...node,
              data: { ...node.data },
            })),
            (template.edges ?? []).map((edge) => ({ ...edge })),
          );
          const locked = scope.systemWorkflow.version === 2;
          const saved = s.savedCanvases.find(matchesScope)
            ?? s.savedCanvases.find(matchesMalformedLegacy);

          if (saved) {
            const workflowId = saved.workflowRef?.workflowId ?? uid('w');
            const workflowRef: CanvasWorkflowRef = { ...scope, workflowId };
            const graph = locked ? templateGraph() : undefined;
            ensured = { savedId: saved.id, workflowId };
            return {
              savedCanvases: s.savedCanvases.map((canvas) => canvas.id === saved.id
                ? {
                    ...canvas,
                    name: finalName,
                    nodes: graph?.nodes ?? canvas.nodes,
                    edges: graph?.edges ?? canvas.edges,
                    readOnly: locked ? true : false,
                    workflowRef,
                  }
                : canvas),
              canvases: s.canvases.map((canvas) => canvas.savedId === saved.id
                ? {
                    ...canvas,
                    name: finalName,
                    nodes: graph?.nodes ?? canvas.nodes,
                    edges: graph?.edges ?? canvas.edges,
                    readOnly: locked ? true : false,
                    workflowRef,
                  }
                : canvas),
            };
          }

          const open = s.canvases.find(matchesScope)
            ?? s.canvases.find(matchesMalformedLegacy);
          if (open) {
            const savedId = open.savedId ?? uid('s');
            const workflowId = open.workflowRef?.workflowId ?? uid('w');
            const workflowRef: CanvasWorkflowRef = { ...scope, workflowId };
            const graph = locked
              ? templateGraph()
              : recomputeDerived(
                  open.nodes.map((node) => ({ ...node, data: { ...node.data } })),
                  open.edges.map((edge) => ({ ...edge })),
                );
            ensured = { savedId, workflowId };
            const savedCanvas: SavedCanvas = {
              id: savedId,
              name: finalName,
              nodes: graph.nodes,
              edges: graph.edges,
              savedAt: datetime(),
              readOnly: locked ? true : false,
              workflowRef,
            };
            return {
              savedCanvases: [...s.savedCanvases, savedCanvas],
              canvases: s.canvases.map((canvas) => canvas.id === open.id
                ? {
                    ...canvas,
                    name: finalName,
                    nodes: graph.nodes,
                    edges: graph.edges,
                    savedId,
                    readOnly: locked ? true : false,
                    workflowRef,
                  }
                : canvas),
            };
          }

          const graph = templateGraph();
          const savedId = uid('s');
          const workflowId = uid('w');
          const workflowRef: CanvasWorkflowRef = { ...scope, workflowId };
          const savedCanvas: SavedCanvas = {
            id: savedId,
            name: finalName,
            nodes: graph.nodes,
            edges: graph.edges,
            savedAt: datetime(),
            readOnly: locked ? true : template.readOnly,
            workflowRef,
          };
          ensured = { savedId, workflowId };
          return { savedCanvases: [...s.savedCanvases, savedCanvas] };
        });
        return ensured;
      },

      resetSavedSystemWorkflow: (savedId, nodes, edges) => {
        let reset = false;
        set((s) => {
          const saved = s.savedCanvases.find((canvas) => canvas.id === savedId);
          if (!saved || saved.workflowRef?.systemWorkflow?.version !== 1) return s;
          const graph = recomputeDerived(
            nodes.map((node) => ({ ...node, data: { ...node.data } })),
            edges.map((edge) => ({ ...edge })),
          );
          const open = s.canvases.find((canvas) => canvas.savedId === savedId);
          reset = true;
          return {
            history: open ? pushCanvasSnapshot(s.history, open) : s.history,
            savedCanvases: s.savedCanvases.map((canvas) => canvas.id === savedId
              ? { ...canvas, nodes: graph.nodes, edges: graph.edges, savedAt: datetime() }
              : canvas),
            canvases: s.canvases.map((canvas) => canvas.savedId === savedId
              ? { ...canvas, nodes: graph.nodes, edges: graph.edges }
              : canvas),
          };
        });
        return reset;
      },

      removeProjectSystemWorkflows: (packageId, projectId) => set((s) => {
        const belongsToProject = (canvas: Canvas | SavedCanvas | RunRecord) =>
          canvas.workflowRef?.packageId === packageId
          && canvas.workflowRef.projectId === projectId
          && Boolean(canvas.workflowRef.systemWorkflow);
        const removedIds = new Set(
          s.canvases.filter(belongsToProject).map((canvas) => canvas.id),
        );
        const canvases = s.canvases.filter((canvas) => !removedIds.has(canvas.id));
        return {
          canvases,
          savedCanvases: s.savedCanvases.filter((canvas) => !belongsToProject(canvas)),
          runHistory: s.runHistory.filter((record) => !belongsToProject(record)),
          activeId: removedIds.has(s.activeId) ? canvases.at(-1)?.id ?? '' : s.activeId,
          history: Object.fromEntries(
            Object.entries(s.history).filter(([canvasId]) => !removedIds.has(canvasId)),
          ),
        };
      }),

      removePackageCanvases: (packageId) => set((s) => {
        const packageSavedIds = new Set(
          s.savedCanvases
            .filter((canvas) => canvas.workflowRef?.packageId === packageId)
            .map((canvas) => canvas.id),
        );
        const removedIds = new Set(
          s.canvases
            .filter((canvas) => canvas.origin?.packageId === packageId
              || canvas.workflowRef?.packageId === packageId
              || (canvas.savedId ? packageSavedIds.has(canvas.savedId) : false))
            .map((canvas) => canvas.id),
        );
        const canvases = s.canvases.filter((canvas) => !removedIds.has(canvas.id));
        const history = Object.fromEntries(
          Object.entries(s.history).filter(([canvasId]) => !removedIds.has(canvasId)),
        );
        return {
          canvases,
          savedCanvases: s.savedCanvases.filter(
            (canvas) => canvas.origin?.packageId !== packageId
              && canvas.workflowRef?.packageId !== packageId,
          ),
          runHistory: s.runHistory.filter(
            (record) => record.origin?.packageId !== packageId
              && record.workflowRef?.packageId !== packageId,
          ),
          activeId: removedIds.has(s.activeId) ? canvases.at(-1)?.id ?? '' : s.activeId,
          history,
        };
      }),

      removeCanvas: (id) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (target?.lockClose || target?.runState?.status === 'running') {
            return s;
          }
          const idx = s.canvases.findIndex((c) => c.id === id);
          const list = s.canvases.filter((c) => c.id !== id);
          let activeId = s.activeId;
          if (activeId === id) {
            activeId = list.length ? list[Math.max(0, idx - 1)].id : '';
          }
          // H5 修复：删除画布时同步清理其撤销历史，防止 history 无限积累
          const { [id]: _dropped, ...history } = s.history;
          return { canvases: list, activeId, history };
        }),

      renameCanvas: (id, name) =>
        set((s) => {
          const c = s.canvases.find((x) => x.id === id);
          if (!c || c.readOnly || isLockedSystemWorkflow(c) || c.name === name) return s;
          return {
            history: pushCanvasSnapshot(s.history, c),
            canvases: s.canvases.map((x) =>
              x.id === id ? { ...x, name } : x,
            ),
          };
        }),

      setActive: (id) => set({ activeId: id }),

      applyNodes: (id, changes) =>
        set((s) => ({
          canvases: s.canvases.map((c) => {
            if (c.id !== id) return c;
            const allowedChanges = c.readOnly || isLockedSystemWorkflow(c)
              ? changes.filter((change) => change.type === 'select')
              : changes;
            return allowedChanges.length > 0
              ? { ...c, nodes: applyNodeChanges(allowedChanges, c.nodes) }
              : c;
          }),
        })),

      applyEdges: (id, changes) =>
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === id && !c.readOnly && !isLockedSystemWorkflow(c)
              ? { ...c, edges: applyEdgeChanges(changes, c.edges) }
              : c,
          ),
        })),

      connect: (id, connection) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (!target || target.readOnly || isLockedSystemWorkflow(target)) return s;
          return {
          history: pushCanvasSnapshot(s.history, target),
          canvases: s.canvases.map((c) => {
            if (c.id !== id) return c;
            const edges = addEdge(connection, c.edges);
            // 前序优先:目标节点接上上游后,清除其手动数据来源(以前序为准)
            const nodes = connection.target
              ? c.nodes.map((n) =>
                  n.id === connection.target
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          dataSourceMode: undefined,
                          dataSourceFiles: undefined,
                          dataSourceUrl: undefined,
                          dataSourceHistoryPaths: undefined,
                        },
                      }
                    : n,
                )
              : c.nodes;
            const d = recomputeDerived(nodes, edges);
            return { ...c, nodes: d.nodes, edges: d.edges };
          }),
          };
        }),

      setEdgeRoute: (canvasId, edgeId, routePoints) =>
        set((s) => ({
          canvases: s.canvases.map((canvas) =>
            canvas.id !== canvasId || canvas.readOnly || isLockedSystemWorkflow(canvas)
              ? canvas
              : {
                  ...canvas,
                  edges: canvas.edges.map((edge) =>
                    edge.id !== edgeId
                      ? edge
                      : {
                          ...edge,
                          data: {
                            ...edge.data,
                            routePoints: routePoints?.map((point) => ({ ...point })),
                          },
                        },
                  ),
                },
          ),
        })),

      addNode: (id, node) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (!target || target.readOnly || isLockedSystemWorkflow(target)) return s;
          return {
            history: pushCanvasSnapshot(s.history, target),
            canvases: s.canvases.map((c) => {
              if (c.id !== id) return c;
              const d = recomputeDerived([...c.nodes, node], c.edges);
              return { ...c, nodes: d.nodes, edges: d.edges };
            }),
          };
        }),

      pushHistory: (id) =>
        set((s) => {
          const c = s.canvases.find((x) => x.id === id);
          if (!c || c.readOnly || isLockedSystemWorkflow(c)) return s;
          return { history: pushCanvasSnapshot(s.history, c) };
        }),

      undo: (id) =>
        set((s) => {
          const target = s.canvases.find((canvas) => canvas.id === id);
          const stack = s.history[id];
          if (!target || target.readOnly || isLockedSystemWorkflow(target)
            || !stack || stack.length === 0) return s;
          const snap = stack[stack.length - 1];
          return {
            history: { ...s.history, [id]: stack.slice(0, -1) },
            canvases: s.canvases.map((c) =>
              c.id === id
                ? { ...c, nodes: snap.nodes, edges: snap.edges, name: snap.name }
                : c,
            ),
          };
        }),

      recompute: (id) =>
        set((s) => ({
          canvases: s.canvases.map((c) => {
            if (c.id !== id || c.readOnly || isLockedSystemWorkflow(c)) return c;
            const d = recomputeDerived(c.nodes, c.edges);
            return { ...c, nodes: d.nodes, edges: d.edges };
          }),
        })),

      // 追加粘贴的节点/连线(已重映射 id 并置选中),同时清掉原有选中态
      addGraph: (id, newNodes, newEdges) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (!target || target.readOnly || isLockedSystemWorkflow(target)) return s;
          return {
            history: pushCanvasSnapshot(s.history, target),
            canvases: s.canvases.map((c) => {
              if (c.id !== id) return c;
              const cleared = c.nodes.map((n) =>
                n.selected ? { ...n, selected: false } : n,
              );
              const clearedEdges = c.edges.map((e) =>
                e.selected ? { ...e, selected: false } : e,
              );
              const d = recomputeDerived(
                [...cleared, ...newNodes],
                [...clearedEdges, ...newEdges],
              );
              return { ...c, nodes: d.nodes, edges: d.edges };
            }),
          };
        }),

      // 编辑画布内节点实例属性:仅合并 data,不动折叠派生态,无需 recompute
      updateNodeData: (canvasId, nodeId, patch) =>
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId && !c.readOnly && !isLockedSystemWorkflow(c)
              ? {
                  ...c,
                  nodes: c.nodes.map((n) =>
                    n.id === nodeId
                      ? { ...n, data: { ...n.data, ...patch } }
                      : n,
                  ),
                }
              : c,
          ),
        })),

      setNodeRunState: (canvasId, nodeId, runState) =>
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? {
                  ...c,
                  nodes: c.nodes.map((n) =>
                    n.id === nodeId
                      ? { ...n, data: { ...n.data, runState } }
                      : n,
                  ),
                }
              : c,
          ),
        })),

      setCanvasRunState: (canvasId, runState) =>
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId ? { ...c, runState } : c,
          ),
        })),

      setRunCardCollapsed: (canvasId, collapsed) =>
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId ? { ...c, runCardCollapsed: collapsed } : c,
          ),
        })),

      toggleCollapse: (id, nodeId) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (!target || target.readOnly || isLockedSystemWorkflow(target)) return s;
          return {
            history: pushCanvasSnapshot(s.history, target),
            canvases: s.canvases.map((c) => {
              if (c.id !== id) return c;
              const nodes0 = c.nodes.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        collapsed: !(n.data as AgentNodeData)?.collapsed,
                      },
                    }
                  : n,
              );
              const d = recomputeDerived(nodes0, c.edges);
              return { ...c, nodes: d.nodes, edges: d.edges };
            }),
          };
        }),

      // 一键折叠/展开:仅对有下游的节点设 collapsed
      setAllCollapsed: (id, collapsed) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (!target || target.readOnly || isLockedSystemWorkflow(target)) return s;
          return {
            history: pushCanvasSnapshot(s.history, target),
            canvases: s.canvases.map((c) => {
              if (c.id !== id) return c;
              const hasChild = new Set(c.edges.map((e) => e.source));
              const nodes0 = c.nodes.map((n) =>
                hasChild.has(n.id)
                  ? { ...n, data: { ...n.data, collapsed } }
                  : n,
              );
              const d = recomputeDerived(nodes0, c.edges);
              return { ...c, nodes: d.nodes, edges: d.edges };
            }),
          };
        }),

      // 强制另存为新记录:即便当前 tab 已关联 savedId,也新建一条 SavedCanvas
      // (供「运行前:已保存但有改动」流程里用户选「另存为新名」)。
      saveActiveAsNew: (name) =>
        set((s) => {
          const canvas = s.canvases.find((c) => c.id === s.activeId);
          if (!canvas || canvas.readOnly || isProtectedSystemWorkflow(canvas)) return s;
          const finalName = (name ?? '').trim();
          if (!finalName) return s;
          const savedId = uid('s');
          const workflowRef = canvas.workflowRef
            ? { ...canvas.workflowRef, workflowId: uid('w') }
            : undefined;
          return {
            savedCanvases: [
              ...s.savedCanvases,
              {
                id: savedId,
                name: finalName,
                nodes: canvas.nodes,
                edges: canvas.edges,
                savedAt: datetime(),
                origin: canvas.origin,
                workflowRef,
              },
            ],
            canvases: s.canvases.map((c) =>
              c.id === canvas.id
                ? { ...c, name: finalName, savedId, workflowRef }
                : c,
            ),
          };
        }),

      // 已保存过 -> 直接覆盖更新(忽略 name);首次保存 -> 必须传入 name
      saveActive: (name) =>
        set((s) => {
          const canvas = s.canvases.find((c) => c.id === s.activeId);
          if (!canvas || canvas.readOnly) return s;
          if (
            canvas.savedId &&
            s.savedCanvases.some((sc) => sc.id === canvas.savedId)
          ) {
            return {
              savedCanvases: s.savedCanvases.map((sc) =>
                sc.id === canvas.savedId
                  ? {
                      ...sc,
                      nodes: canvas.nodes,
                      edges: canvas.edges,
                      savedAt: datetime(),
                      origin: canvas.origin,
                      workflowRef: canvas.workflowRef,
                    }
                  : sc,
              ),
            };
          }
          const finalName = (name ?? '').trim();
          if (!finalName) return s; // 首次保存必须命名
          const savedId = uid('s');
          return {
            savedCanvases: [
              ...s.savedCanvases,
              {
                id: savedId,
                name: finalName,
                nodes: canvas.nodes,
                edges: canvas.edges,
                savedAt: datetime(),
                origin: canvas.origin,
                workflowRef: canvas.workflowRef,
              },
            ],
            canvases: s.canvases.map((c) =>
              c.id === canvas.id
                ? { ...c, name: finalName, savedId, workflowRef: canvas.workflowRef }
                : c,
            ),
          };
        }),

      // 原子「保存并关闭」:保存指定画布(首存需 name,已存忽略 name 覆盖),
      // 随后关闭该 tab、矫正 activeId、清理其撤销历史。一次 set 完成,避免多步竞态。
      saveAndClose: (id, name) =>
        set((s) => {
          const canvas = s.canvases.find((c) => c.id === id);
          if (!canvas || canvas.readOnly) return s;

          let savedCanvases = s.savedCanvases;
          const alreadySaved =
            canvas.savedId &&
            s.savedCanvases.some((sc) => sc.id === canvas.savedId);
          if (alreadySaved) {
            savedCanvases = s.savedCanvases.map((sc) =>
              sc.id === canvas.savedId
                ? {
                    ...sc,
                    nodes: canvas.nodes,
                    edges: canvas.edges,
                    savedAt: datetime(),
                    origin: canvas.origin,
                    workflowRef: canvas.workflowRef,
                  }
                : sc,
            );
          } else {
            const finalName = (name ?? '').trim();
            if (!finalName) return s; // 首次保存必须命名
            savedCanvases = [
              ...s.savedCanvases,
              {
                id: uid('s'),
                name: finalName,
                nodes: canvas.nodes,
                  edges: canvas.edges,
                  savedAt: datetime(),
                  origin: canvas.origin,
                  workflowRef: canvas.workflowRef,
              },
            ];
          }

          const idx = s.canvases.findIndex((c) => c.id === id);
          const list = s.canvases.filter((c) => c.id !== id);
          let activeId = s.activeId;
          if (activeId === id) {
            activeId = list.length ? list[Math.max(0, idx - 1)].id : '';
          }
          const { [id]: _dropped, ...history } = s.history;
          return { savedCanvases, canvases: list, activeId, history };
        }),

      // 若该已保存画布对应的 tab 已打开 -> 切换过去;否则新开一个 tab
      openSaved: (savedId) => {
        let result: CanvasOpenResult = 'not-found';
        set((s) => {
          const existing = s.canvases.find((c) => c.savedId === savedId);
          if (existing) {
            result = 'activated';
            return { activeId: existing.id };
          }
          if (s.canvases.length >= MAX_CANVASES) {
            result = 'limit';
            return s;
          }
          const sc = s.savedCanvases.find((x) => x.id === savedId);
          if (!sc) return s;
          const d = recomputeDerived(
            sc.nodes.map((n) => ({ ...n })),
            sc.edges.map((e) => ({ ...e })),
          );
          const tab: Canvas = {
            id: uid('c'),
            name: sc.name,
            nodes: d.nodes,
            edges: d.edges,
            savedId: sc.id,
            readOnly: sc.readOnly || sc.workflowRef?.systemWorkflow?.version === 2,
            origin: sc.origin,
            workflowRef: sc.workflowRef,
          };
          result = 'opened';
          return { canvases: [...s.canvases, tab], activeId: tab.id };
        });
        return result;
      },

      importCanvas: (name, nodes, edges) => {
        if (get().canvases.length >= MAX_CANVASES) return false;
        set((s) => {
          const d = recomputeDerived(
            nodes.map((n) => ({ ...n })),
            edges.map((e) => ({ ...e })),
          );
          const tab: Canvas = {
            id: uid('c'),
            name,
            nodes: d.nodes,
            edges: d.edges,
          };
          return { canvases: [...s.canvases, tab], activeId: tab.id };
        });
        return true;
      },

      // 删除已保存画布;若其对应 tab 正打开则一并关闭
      deleteSaved: (savedId) =>
        set((s) => {
          const saved = s.savedCanvases.find((canvas) => canvas.id === savedId);
          if (!saved || isProtectedSystemWorkflow(saved)) return s;
          const savedCanvases = s.savedCanvases.filter((x) => x.id !== savedId);
          const openTab = s.canvases.find((c) => c.savedId === savedId);
          if (!openTab) return { savedCanvases };
          if (openTab.lockClose || openTab.runState?.status === 'running') {
            return {
              savedCanvases,
              canvases: s.canvases.map((c) =>
                c.id === openTab.id
                  ? { ...c, savedId: undefined, workflowRef: undefined }
                  : c,
              ),
            };
          }
          const idx = s.canvases.findIndex((c) => c.id === openTab.id);
          const list = s.canvases.filter((c) => c.id !== openTab.id);
          let activeId = s.activeId;
          if (activeId === openTab.id) {
            activeId = list.length ? list[Math.max(0, idx - 1)].id : '';
          }
          // H5 修复：一并清理被关闭 tab 的撤销历史
          const { [openTab.id]: _dropped, ...history } = s.history;
          return { savedCanvases, canvases: list, activeId, history };
        }),

      // 重命名已保存画布;若其对应 tab 正打开则同步更新 tab 名。
      renameSaved: (savedId, name) =>
        set((s) => {
          const finalName = name.trim();
          if (!finalName) return s;
          const saved = s.savedCanvases.find((canvas) => canvas.id === savedId);
          if (!saved || isLockedSystemWorkflow(saved)) return s;
          return {
            savedCanvases: s.savedCanvases.map((sc) =>
              sc.id === savedId ? { ...sc, name: finalName } : sc,
            ),
            canvases: s.canvases.map((c) =>
              c.savedId === savedId ? { ...c, name: finalName } : c,
            ),
          };
        }),

      createRun: (canvasId, historyDescriptor) => {
        const runId = uid('r');
        const tabId = uid('c');
        let created = false;
        set((s) => {
          if (s.canvases.length >= MAX_CANVASES) return s;
          const canvas = s.canvases.find((c) => c.id === canvasId);
          if (!canvas) return s;
          const history = createRunHistoryMetadata(
            s.runHistory,
            canvas.origin?.packageId ?? canvas.workflowRef?.packageId,
            historyDescriptor,
          );
          const { record, tab } = createRunningArtifacts(
            canvasId,
            canvas,
            runId,
            tabId,
            history,
          );
          created = true;
          return {
            runHistory: pruneRunHistory([record, ...s.runHistory]),
            canvases: [...s.canvases, tab],
            activeId: tab.id,
          };
        });
        return created ? { runId, canvasId: tabId } : null;
      },

      syncRunSnapshot: (runId, canvasId) =>
        set((s) => {
          const canvas = s.canvases.find((c) => c.id === canvasId);
          if (!canvas) return s;
          const runState = canvas.runState;
          const nodes = cloneRunNodes(canvas.nodes);
          const edges = cloneEdges(canvas.edges);
          const d = expandedRunGraph(nodes, edges);
          return {
            runHistory: s.runHistory.map((r) =>
              r.id === runId ? { ...r, nodes, edges, runState } : r,
            ),
            canvases: s.canvases.map((c) =>
              c.runId === runId
                ? {
                    ...c,
                    nodes: d.nodes,
                    edges: d.edges,
                    runState,
                    lockClose: runState?.status === 'running',
                  }
                : c,
            ),
          };
        }),

      markOutputItemsDeleted: (canvasId, paths, runId) =>
        set((s) => {
          const pathSet = new Set(paths);

          return {
            canvases: s.canvases.map((c) =>
              (runId ? c.runId === runId : c.id === canvasId)
                ? { ...c, nodes: markDeletedOutputs(c.nodes, pathSet) }
                : c,
            ),
            runHistory: s.runHistory.map((r) =>
              runId && r.id !== runId
                ? r
                : { ...r, nodes: markDeletedOutputs(r.nodes, pathSet) },
            ),
          };
        }),

      // 打开某条运行记录为只读快照 tab:已开则切过去;否则新开一个只读 tab。
      // 快照默认全展开(清 collapsed 再重算派生态),便于查看全图。
      openRun: (runId) => {
        let result: CanvasOpenResult = 'not-found';
        set((s) => {
          const existing = s.canvases.find((c) => c.runId === runId);
          if (existing) {
            result = 'activated';
            return { activeId: existing.id };
          }
          if (s.canvases.length >= MAX_CANVASES) {
            result = 'limit';
            return s;
          }
          const rec = s.runHistory.find((r) => r.id === runId);
          if (!rec) return s;
          const recoveredRunState = recoverRunState(rec.runState);
          const recoveredNodes =
            rec.runState?.status === 'running' ? recoverRunNodes(rec.nodes) : rec.nodes;
          const tab = createRunSnapshotTab(rec, recoveredNodes, recoveredRunState);
          result = 'opened';
          return {
            runHistory: s.runHistory.map((r) =>
              r.id === runId
                ? { ...r, nodes: recoveredNodes, runState: recoveredRunState }
                : r,
            ),
            canvases: [...s.canvases, tab],
            activeId: tab.id,
          };
        });
        return result;
      },

      // 删除运行记录;若其对应只读 tab 正打开则一并关闭
      deleteRun: (runId) => {
        set((s) => {
          const rec = s.runHistory.find((r) => r.id === runId);
          if (rec?.runState?.status === 'running') return s;
          const runHistory = s.runHistory.filter((r) => r.id !== runId);
          const openTab = s.canvases.find((c) => c.runId === runId);
          if (openTab?.lockClose || openTab?.runState?.status === 'running') {
            return s;
          }
          if (!openTab) return { runHistory };
          const idx = s.canvases.findIndex((c) => c.id === openTab.id);
          const list = s.canvases.filter((c) => c.id !== openTab.id);
          let activeId = s.activeId;
          if (activeId === openTab.id) {
            activeId = list.length ? list[Math.max(0, idx - 1)].id : '';
          }
          // H5 修复：一并清理被关闭只读 tab 的撤销历史
          const { [openTab.id]: _dropped, ...history } = s.history;
          return { runHistory, canvases: list, activeId, history };
        });
        // 运行删除后清掉编排层挂在该 run 上的失败去重键。
        clearOrchestratorRunDiagnosis(runId);
      },
    }),
    {
      name: 'multi-agent-canvas',
      storage: createProjectStorage(),
      version: 2,
      // v0 的运行记录没有图快照与紧凑时间戳:补空快照(无法回看,但列表不崩)、
      // 由 time("YYYY-MM-DD HH:MM:SS")去掉分隔符推出 14 位 stamp 供命名。
      // v1→v2:节点 toolTags 里的读写分离旧标签归一为 file/docx。
      migrate: (persisted, version) => {
        // L2 修复：校验 persisted 确实是对象，否则返回安全默认值避免后续属性访问崩溃
        if (typeof persisted !== 'object' || persisted === null) {
          return {} as Partial<CanvasState>;
        }
        const s = persisted as Partial<CanvasState>;
        if (version < 1 && Array.isArray(s.runHistory)) {
          s.runHistory = s.runHistory.map((r) => {
            const rec = r as Partial<RunRecord>;
            return {
              ...rec,
              nodes: rec.nodes ?? [],
              edges: rec.edges ?? [],
              stamp:
                rec.stamp ?? (rec.time ?? '').replace(/[-: ]/g, '').slice(0, 14),
            } as RunRecord;
          });
        }
        if (version < 2) {
          const migrateNodes = (nodes?: Node[]): Node[] =>
            (nodes ?? []).map((node) => {
              const data = node.data as AgentNodeData;
              if (!Array.isArray(data?.toolTags)) return node;
              return {
                ...node,
                data: { ...data, toolTags: normalizeToolTags(data.toolTags) },
              };
            });
          if (Array.isArray(s.canvases)) {
            s.canvases = s.canvases.map((c) => ({ ...c, nodes: migrateNodes(c.nodes) }));
          }
          if (Array.isArray(s.savedCanvases)) {
            s.savedCanvases = s.savedCanvases.map((sc) => ({
              ...sc,
              nodes: migrateNodes(sc.nodes),
            }));
          }
          if (Array.isArray(s.runHistory)) {
            s.runHistory = s.runHistory.map((r) => ({ ...r, nodes: migrateNodes(r.nodes) }));
          }
        }
        return s;
      },
      partialize: (s) => ({
        canvases: s.canvases,
        activeId: s.activeId,
        savedCanvases: s.savedCanvases,
        runHistory: s.runHistory,
      }),
    },
  ),
);
