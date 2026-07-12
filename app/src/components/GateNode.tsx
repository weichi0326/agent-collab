import { memo, useMemo, useEffect, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import {
  LoadingOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import {
  useCanvasStore,
  type AgentNode as AgentNodeType,
  type AgentRunState,
  type AgentRunStatus,
} from '../stores/canvasStore';
import { NodeRoutingHandles } from './CanvasArea/NodeRoutingHandles';

const RUN_STATUS_TEXT = {
  idle: '未运行',
  queued: '等待',
  running: '运行中',
  success: '通过',
  failed: '失败',
  skipped: '未通过',
} as const;

const TIMED_STATUSES = new Set<AgentRunStatus>(['running', 'success', 'failed']);

const GATE_LABEL: Record<string, string> = {
  or: '或门',
  and: '与门',
  nor: '非门',
};

// SVG 门控符号:OR=∪(并集杯)、AND=∩(交集杯)、NOR=∪带否定横线。
function GateSymbol({ type }: { type: 'or' | 'and' | 'nor' }) {
  if (type === 'or') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8 Q4 4 8 4 L16 4 Q20 4 20 8 L20 14 Q20 20 12 20 Q4 20 4 14 Z" />
      </svg>
    );
  }
  if (type === 'and') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14 Q4 20 8 20 L16 20 Q20 20 20 14 L20 8 Q20 4 12 4 Q4 4 4 8 Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8 Q4 4 8 4 L16 4 Q20 4 20 8 L20 14 Q20 20 12 20 Q4 20 4 14 Z" />
      <line x1="3" y1="22" x2="21" y2="22" />
    </svg>
  );
}

function parseRunTime(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  const time = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function useElapsedText(runState?: AgentRunState): string {
  const [now, setNow] = useState(() => Date.now());
  const status = runState?.status ?? 'idle';
  const startedAt = runState?.startedAt;
  const finishedAt = runState?.finishedAt;
  const durationMs = runState?.durationMs;

  useEffect(() => {
    if (status !== 'running') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  return useMemo(() => {
    if (typeof durationMs === 'number') return formatDuration(durationMs);
    const start = parseRunTime(startedAt);
    if (!start) return '00:00:00';
    if (status === 'running') return formatDuration(now - start);
    const end = parseRunTime(finishedAt);
    return formatDuration((end ?? now) - start);
  }, [durationMs, finishedAt, now, startedAt, status]);
}

function RunStatusPill({ status }: { status: AgentRunStatus }) {
  const icon =
    status === 'running' ? (
      <LoadingOutlined />
    ) : status === 'success' ? (
      <CheckCircleFilled />
    ) : status === 'failed' ? (
      <CloseCircleFilled />
    ) : status === 'skipped' ? (
      <MinusCircleOutlined />
    ) : (
      <ClockCircleOutlined />
    );

  return (
    <span className={`agent-node__run agent-node__run--${status}`}>
      {icon}
      <span>{RUN_STATUS_TEXT[status]}</span>
    </span>
  );
}

function GateNode({ id, data, selected }: NodeProps<AgentNodeType>) {
  const d = data;
  const gateType = (d?.gateType ?? 'or') as 'or' | 'and' | 'nor';
  const label = d?.label ?? GATE_LABEL[gateType] ?? '门控';
  const runStatus = d?.runState?.status ?? 'idle';
  const elapsedText = useElapsedText(d?.runState);
  const showElapsed = TIMED_STATUSES.has(runStatus);
  const activeId = useCanvasStore((s) => s.activeId);
  const toggleCollapse = useCanvasStore((s) => s.toggleCollapse);

  return (
    <div
      className={`gate-node gate-node--${gateType} agent-node--run-${runStatus}${
        selected ? ' gate-node--selected' : ''
      }`}
    >
      <span className="gate-node__bar" />
      <NodeRoutingHandles />
      <div className="gate-node__main">
        {d?.collapsible && (
          <button
            type="button"
            className="agent-node__collapse"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(activeId, id);
            }}
          >
            <span className="gate-node__icon">
              <GateSymbol type={gateType} />
            </span>
          </button>
        )}
        {!d?.collapsible && (
          <span className="gate-node__icon">
            <GateSymbol type={gateType} />
          </span>
        )}
        <span className="agent-node__label">{label}</span>
        <RunStatusPill status={runStatus} />
        {d?.collapsed && (d.hiddenCount ?? 0) > 0 && (
          <span className="agent-node__badge">+{d.hiddenCount}</span>
        )}
      </div>
      {showElapsed && (
        <div className="agent-node__elapsed">已运行：{elapsedText}</div>
      )}
    </div>
  );
}

export default memo(GateNode);
