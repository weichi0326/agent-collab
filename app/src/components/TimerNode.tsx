import { memo, useMemo, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  LoadingOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleOutlined,
  MinusCircleOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import {
  useCanvasStore,
  type AgentNode as AgentNodeType,
  type AgentRunState,
  type AgentRunStatus,
} from '../stores/canvasStore';

const RUN_STATUS_TEXT = {
  idle: '未运行',
  queued: '等待',
  running: '计时中',
  success: '已完成',
  failed: '失败',
  skipped: '未执行',
} as const;

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

// 倒计时:running 时按 startedAt + timerSeconds 反推剩余,每秒刷新,到 0 停在 00:00:00。
function useCountdownText(timerSeconds: number, runState?: AgentRunState): string {
  const [now, setNow] = useState(() => Date.now());
  const status = runState?.status ?? 'idle';
  const startedAt = runState?.startedAt;

  useEffect(() => {
    if (status !== 'running') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  return useMemo(() => {
    const start = parseRunTime(startedAt);
    if (status !== 'running' || !start) return formatDuration(timerSeconds * 1000);
    const remaining = timerSeconds * 1000 - (now - start);
    return formatDuration(remaining);
  }, [timerSeconds, startedAt, status, now]);
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

function TimerNode({ id, data, selected }: NodeProps<AgentNodeType>) {
  const d = data;
  const timerSeconds = typeof d?.timerSeconds === 'number' ? d.timerSeconds : 300;
  const label = d?.label ?? `定时 ${formatDuration(timerSeconds * 1000)}`;
  const runStatus = d?.runState?.status ?? 'idle';
  const countdownText = useCountdownText(timerSeconds, d?.runState);
  const activeId = useCanvasStore((s) => s.activeId);
  const toggleCollapse = useCanvasStore((s) => s.toggleCollapse);

  return (
    <div
      className={`timer-node agent-node--run-${runStatus}${
        selected ? ' timer-node--selected' : ''
      }`}
    >
      <span className="timer-node__bar" />
      <Handle
        type="target"
        position={Position.Left}
        className="agent-node__handle"
      />
      <div className="timer-node__main">
        {d?.collapsible && (
          <button
            type="button"
            className="agent-node__collapse"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(activeId, id);
            }}
          >
            <span className="timer-node__icon">
              <FieldTimeOutlined />
            </span>
          </button>
        )}
        {!d?.collapsible && (
          <span className="timer-node__icon">
            <FieldTimeOutlined />
          </span>
        )}
        <span className="agent-node__label">{label}</span>
        <RunStatusPill status={runStatus} />
        {d?.collapsed && (d.hiddenCount ?? 0) > 0 && (
          <span className="agent-node__badge">+{d.hiddenCount}</span>
        )}
      </div>
      {runStatus === 'running' && (
        <div className="agent-node__elapsed">剩余：{countdownText}</div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="agent-node__handle"
      />
    </div>
  );
}

export default memo(TimerNode);
