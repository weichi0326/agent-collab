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
import {
  cloneEdges,
  cloneRunNodes,
  createRunSnapshotTab,
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

  createRun: (canvasId: string) => CreatedRun | null;
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
          if (!c || c.name === name) return s;
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
          canvases: s.canvases.map((c) =>
            c.id === id
              ? { ...c, nodes: applyNodeChanges(changes, c.nodes) }
              : c,
          ),
        })),

      applyEdges: (id, changes) =>
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === id
              ? { ...c, edges: applyEdgeChanges(changes, c.edges) }
              : c,
          ),
        })),

      connect: (id, connection) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (!target) return s;
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
            canvas.id !== canvasId
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
          if (!target) return s;
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
          if (!c) return s;
          return { history: pushCanvasSnapshot(s.history, c) };
        }),

      undo: (id) =>
        set((s) => {
          const stack = s.history[id];
          if (!stack || stack.length === 0) return s;
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
            if (c.id !== id) return c;
            const d = recomputeDerived(c.nodes, c.edges);
            return { ...c, nodes: d.nodes, edges: d.edges };
          }),
        })),

      // 追加粘贴的节点/连线(已重映射 id 并置选中),同时清掉原有选中态
      addGraph: (id, newNodes, newEdges) =>
        set((s) => {
          const target = s.canvases.find((c) => c.id === id);
          if (!target) return s;
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
            c.id === canvasId
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
          if (!target) return s;
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
          if (!target) return s;
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
          if (!canvas) return s;
          const finalName = (name ?? '').trim();
          if (!finalName) return s;
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
              },
            ],
            canvases: s.canvases.map((c) =>
              c.id === canvas.id ? { ...c, name: finalName, savedId } : c,
            ),
          };
        }),

      // 已保存过 -> 直接覆盖更新(忽略 name);首次保存 -> 必须传入 name
      saveActive: (name) =>
        set((s) => {
          const canvas = s.canvases.find((c) => c.id === s.activeId);
          if (!canvas) return s;
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
              },
            ],
            canvases: s.canvases.map((c) =>
              c.id === canvas.id ? { ...c, name: finalName, savedId } : c,
            ),
          };
        }),

      // 原子「保存并关闭」:保存指定画布(首存需 name,已存忽略 name 覆盖),
      // 随后关闭该 tab、矫正 activeId、清理其撤销历史。一次 set 完成,避免多步竞态。
      saveAndClose: (id, name) =>
        set((s) => {
          const canvas = s.canvases.find((c) => c.id === id);
          if (!canvas) return s;

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
          const savedCanvases = s.savedCanvases.filter((x) => x.id !== savedId);
          const openTab = s.canvases.find((c) => c.savedId === savedId);
          if (!openTab) return { savedCanvases };
          if (openTab.lockClose || openTab.runState?.status === 'running') {
            return {
              savedCanvases,
              canvases: s.canvases.map((c) =>
                c.id === openTab.id ? { ...c, savedId: undefined } : c,
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
          return {
            savedCanvases: s.savedCanvases.map((sc) =>
              sc.id === savedId ? { ...sc, name: finalName } : sc,
            ),
            canvases: s.canvases.map((c) =>
              c.savedId === savedId ? { ...c, name: finalName } : c,
            ),
          };
        }),

      createRun: (canvasId) => {
        const runId = uid('r');
        const tabId = uid('c');
        let created = false;
        set((s) => {
          if (s.canvases.length >= MAX_CANVASES) return s;
          const canvas = s.canvases.find((c) => c.id === canvasId);
          if (!canvas) return s;
          const { record, tab } = createRunningArtifacts(
            canvasId,
            canvas,
            runId,
            tabId,
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
