import type { OutputReport } from '../../lib/outputDirectory';
import { nodeLabel } from '../../lib/agentNode';
import type {
  AgentNodeData,
  AgentRunStatus,
  CanvasRunStatus,
  RunRecord,
} from '../../stores/canvasStore';

export interface ReportMetrics {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  runningRuns: number;
  successRate: number;
  totalReports: number;
  latestReportAt: string;
  avgRunDurationMs?: number;
  uniqueCanvases: number;
  uniqueNodes: number;
}

export interface CanvasMetric {
  name: string;
  runs: number;
  success: number;
  failed: number;
  cancelled: number;
  reports: number;
  successRate: number;
}

export interface NodeMetric {
  name: string;
  runs: number;
  success: number;
  failed: number;
  skipped: number;
  reports: number;
  successRate: number;
}

// ── Token 用量统计 ──────────────────────────────────────
export interface TokenModelRow {
  model: string;
  total: number;
}
export interface TokenNodeRow {
  label: string;
  total: number;
}
export interface TokenMetrics {
  grandTotal: number;
  masterTotal: number;
  byModel: TokenModelRow[]; // 按 total 降序
  activeNodes: TokenNodeRow[]; // 当前仍存在的节点,按 total 降序
  deletedTotal: number; // 已删除节点的 token 汇总(不在任何画布里)
}

interface TokenStatsSnapshot {
  byModel: Record<string, number>;
  byNode: Record<string, { label: string; total: number }>;
  masterTotal: number;
  grandTotal: number;
}

// 交叉 token 统计与「当前存在的节点 id 集合」,把 byNode 分区为 活跃节点 vs 已删除汇总。
export function buildTokenMetrics(
  stats: TokenStatsSnapshot,
  existingNodeIds: Set<string>,
): TokenMetrics {
  const byModel = Object.entries(stats.byModel)
    .map(([model, total]) => ({ model, total }))
    .sort((a, b) => b.total - a.total);
  const activeNodes: TokenNodeRow[] = [];
  let deletedTotal = 0;
  for (const [nodeId, rec] of Object.entries(stats.byNode)) {
    if (existingNodeIds.has(nodeId)) activeNodes.push({ label: rec.label, total: rec.total });
    else deletedTotal += rec.total;
  }
  activeNodes.sort((a, b) => b.total - a.total);
  return {
    grandTotal: stats.grandTotal,
    masterTotal: stats.masterTotal,
    byModel,
    activeNodes,
    deletedTotal,
  };
}

// 千分位格式化(1234567 → "1,234,567")。
export function formatTokens(n: number): string {
  return (n || 0).toLocaleString('en-US');
}

export function parseTimeMs(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : undefined;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '暂无';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function canvasDuration(record: RunRecord): number | undefined {
  const start = parseTimeMs(record.runState?.startedAt);
  const end = parseTimeMs(record.runState?.finishedAt);
  if (start === undefined || end === undefined) return undefined;
  return Math.max(0, end - start);
}

export function buildReportMetrics(
  runHistory: RunRecord[],
  reports: OutputReport[],
): ReportMetrics {
  const successRuns = runHistory.filter((r) => r.runState?.status === 'success').length;
  const failedRuns = runHistory.filter((r) => r.runState?.status === 'failed').length;
  const cancelledRuns = runHistory.filter((r) => r.runState?.status === 'cancelled').length;
  const runningRuns = runHistory.filter((r) => r.runState?.status === 'running').length;
  const finishedRuns = successRuns + failedRuns + cancelledRuns;
  const durations = runHistory
    .map(canvasDuration)
    .filter((v): v is number => typeof v === 'number');
  const avgRunDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, v) => sum + v, 0) / durations.length)
      : undefined;
  const latestReportAt =
    [...reports].sort((a, b) => (b.run_at || '').localeCompare(a.run_at || ''))[0]
      ?.run_at ?? '暂无';

  return {
    totalRuns: runHistory.length,
    successRuns,
    failedRuns,
    cancelledRuns,
    runningRuns,
    successRate: finishedRuns > 0 ? Math.round((successRuns / finishedRuns) * 100) : 0,
    totalReports: reports.length,
    latestReportAt,
    avgRunDurationMs,
    uniqueCanvases: new Set(reports.map((r) => r.canvas_name).filter(Boolean)).size,
    uniqueNodes: new Set(reports.map((r) => r.node_label).filter(Boolean)).size,
  };
}

export function buildCanvasMetrics(
  runHistory: RunRecord[],
  reports: OutputReport[],
): CanvasMetric[] {
  const map = new Map<string, CanvasMetric>();
  const ensure = (name: string) => {
    const key = name || '未命名画布';
    const current = map.get(key);
    if (current) return current;
    const next: CanvasMetric = {
      name: key,
      runs: 0,
      success: 0,
      failed: 0,
      cancelled: 0,
      reports: 0,
      successRate: 0,
    };
    map.set(key, next);
    return next;
  };

  runHistory.forEach((record) => {
    const item = ensure(record.canvasName);
    item.runs += 1;
    const status = record.runState?.status as CanvasRunStatus | undefined;
    if (status === 'success') item.success += 1;
    if (status === 'failed') item.failed += 1;
    if (status === 'cancelled') item.cancelled += 1;
  });
  reports.forEach((report) => {
    ensure(report.canvas_name).reports += 1;
  });

  return [...map.values()]
    .map((item) => ({
      ...item,
      successRate:
        item.success + item.failed + item.cancelled > 0
          ? Math.round((item.success / (item.success + item.failed + item.cancelled)) * 100)
          : 0,
    }))
    .sort((a, b) => b.runs + b.reports - (a.runs + a.reports));
}

export function buildNodeMetrics(
  runHistory: RunRecord[],
  reports: OutputReport[],
): NodeMetric[] {
  const map = new Map<string, NodeMetric>();
  const ensure = (name: string) => {
    const key = name || '未命名节点';
    const current = map.get(key);
    if (current) return current;
    const next: NodeMetric = {
      name: key,
      runs: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      reports: 0,
      successRate: 0,
    };
    map.set(key, next);
    return next;
  };

  runHistory.forEach((record) => {
    record.nodes.forEach((node) => {
      const data = node.data as AgentNodeData | undefined;
      const status = data?.runState?.status as AgentRunStatus | undefined;
      if (!status || status === 'idle' || status === 'queued') return;
      const item = ensure(nodeLabel(node));
      item.runs += 1;
      if (status === 'success') item.success += 1;
      if (status === 'failed') item.failed += 1;
      if (status === 'skipped') item.skipped += 1;
    });
  });
  reports.forEach((report) => {
    ensure(report.node_label).reports += 1;
  });

  return [...map.values()]
    .map((item) => ({
      ...item,
      successRate:
        item.success + item.failed + item.skipped > 0
          ? Math.round((item.success / (item.success + item.failed + item.skipped)) * 100)
          : 0,
    }))
    .sort((a, b) => b.runs + b.reports - (a.runs + a.reports));
}
