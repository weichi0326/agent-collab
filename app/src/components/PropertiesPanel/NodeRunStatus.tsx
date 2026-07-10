import { Tag } from 'antd';
import type { AgentNodeData } from '../../stores/canvasStore';
import {
  formatDuration,
  RUN_STATUS_COLOR,
  RUN_STATUS_TEXT,
} from './constants';

interface NodeRunStatusProps {
  runState: AgentNodeData['runState'];
}

export function NodeRunStatus({ runState }: NodeRunStatusProps) {
  if (!runState || runState.status === 'idle') return null;
  const duration = formatDuration(runState.durationMs);

  return (
    <div className={`node-run node-run--${runState.status}`}>
      <div className="node-run__head">
        <span className="node-run__title">运行状态</span>
        <Tag color={RUN_STATUS_COLOR[runState.status]}>
          {RUN_STATUS_TEXT[runState.status]}
        </Tag>
      </div>
      <div className="node-run__meta">
        {runState.startedAt && (
          <span>开始 {runState.startedAt.slice(11)}</span>
        )}
        {runState.finishedAt && (
          <span>结束 {runState.finishedAt.slice(11)}</span>
        )}
        {duration && <span>耗时 {duration}</span>}
      </div>
      {runState.message && (
        <div className="node-run__message">{runState.message}</div>
      )}
    </div>
  );
}
