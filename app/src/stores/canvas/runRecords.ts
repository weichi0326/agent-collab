import type { Edge, Node } from '@xyflow/react';
import { uid } from '../../lib/id';
import { datetime, stamp } from '../../lib/time';
import { recomputeDerived } from './derived';
import type {
  AgentNodeData,
  Canvas,
  CanvasRunState,
  RunRecord,
} from './types';

// 最近多少条运行记录保留完整图快照(可只读回看);更早的仅保留元数据。
export const MAX_RUN_HISTORY = 50;

// runHistory 永久保留元数据(名称/时间/状态),但只有最近 MAX_RUN_HISTORY 条保留
// nodes/edges 图快照;更早的记录清空图数据以防存储无限膨胀(回看时提示不可回看)。
export function pruneRunHistory(records: RunRecord[]): RunRecord[] {
  return records.map((r, i) =>
    i < MAX_RUN_HISTORY ? r : { ...r, nodes: [], edges: [] },
  );
}

export function cloneRunNodes(nodes: Node[]): Node[] {
  return nodes.map((n) => ({ ...n, data: { ...n.data } }));
}

export function cloneEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => ({ ...e }));
}

export function createRunningArtifacts(
  canvasId: string,
  canvas: Canvas,
  runId: string,
  tabId: string,
): { record: RunRecord; tab: Canvas } {
  const time = datetime();
  const compact = stamp();
  const runState: CanvasRunState = {
    status: 'running',
    message: '正在运行',
    startedAt: time,
    total: canvas.nodes.length,
    completed: 0,
    failed: 0,
  };
  const runNodes = canvas.nodes.map((n) => ({
    ...n,
    selected: false,
    data: {
      ...n.data,
      collapsed: false,
      lastOutput: null,
      runState: undefined,
    },
  }));
  const runEdges = canvas.edges.map((e) => ({ ...e, selected: false }));
  const d = recomputeDerived(runNodes, runEdges);
  const record: RunRecord = {
    id: runId,
    canvasId,
    canvasName: canvas.name,
    time,
    stamp: compact,
    nodes: cloneRunNodes(d.nodes),
    edges: cloneEdges(d.edges),
    runState,
  };
  const tab: Canvas = {
    id: tabId,
    name: `${record.canvasName}_${record.stamp}`,
    nodes: d.nodes,
    edges: d.edges,
    readOnly: true,
    runId,
    lockClose: true,
    runState,
  };
  return { record, tab };
}

export function expandedRunGraph(nodes: Node[], edges: Edge[]) {
  const expanded = nodes.map((n) => ({
    ...n,
    data: { ...n.data, collapsed: false },
  }));
  return recomputeDerived(expanded, cloneEdges(edges));
}

export function createRunSnapshotTab(
  record: RunRecord,
  nodes: Node[],
  runState: CanvasRunState | undefined,
): Canvas {
  const d = expandedRunGraph(nodes, record.edges);
  return {
    id: uid('c'),
    name: `${record.canvasName}_${record.stamp}`,
    nodes: d.nodes,
    edges: d.edges,
    readOnly: true,
    runId: record.id,
    lockClose: runState?.status === 'running',
    runState,
  };
}

export function markDeletedOutputs(nodes: Node[], paths: Set<string>): Node[] {
  return nodes.map((n) => {
    const data = n.data as AgentNodeData;
    const output = data.lastOutput;
    if (!output?.items?.some((item) => item.path && paths.has(item.path))) {
      return n;
    }
    return {
      ...n,
      data: {
        ...n.data,
        lastOutput: {
          ...output,
          items: output.items.map((item) =>
            item.path && paths.has(item.path) ? { ...item, deleted: true } : item,
          ),
        },
      },
    };
  });
}
