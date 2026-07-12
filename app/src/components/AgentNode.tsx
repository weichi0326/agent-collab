import { useEffect, useMemo, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import {
  RobotOutlined,
  DownOutlined,
  RightOutlined,
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
  success: '成功',
  failed: '失败',
  skipped: '跳过',
} as const;

const TIMED_STATUSES = new Set<AgentRunStatus>(['running', 'success', 'failed']);

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

function AgentNode({ id, data, selected }: NodeProps<AgentNodeType>) {
  const d = data;
  const activeId = useCanvasStore((s) => s.activeId);
  const toggleCollapse = useCanvasStore((s) => s.toggleCollapse);
  // 实例快照名:拖入时复制自定义,之后与定义解耦(见两层模型)
  const label = d?.label ?? 'Agent';
  const runStatus = d?.runState?.status ?? 'idle';
  const elapsedText = useElapsedText(d?.runState);
  const showElapsed = TIMED_STATUSES.has(runStatus);

  return (
    <div
      className={`agent-node agent-node--run-${runStatus}${
        selected ? ' agent-node--selected' : ''
      }`}
    >
      <NodeRoutingHandles />
      <div className="agent-node__main">
        {d?.collapsible && (
          <button
            type="button"
            className="agent-node__collapse"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(activeId, id);
            }}
          >
            {d.collapsed ? <RightOutlined /> : <DownOutlined />}
          </button>
        )}
        <RobotOutlined className="agent-node__icon" />
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

export default AgentNode;
