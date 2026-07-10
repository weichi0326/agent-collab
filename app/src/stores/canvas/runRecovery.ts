import type { Node } from '@xyflow/react';
import { datetime } from '../../lib/time';
import type { AgentNodeData, CanvasRunState } from './types';

export function recoverRunNodes(nodes: Node[], finishedAt = datetime()): Node[] {
  return nodes.map((node) => {
    const data = node.data as AgentNodeData;
    const runState = data.runState;
    if (runState?.status === 'running') {
      return {
        ...node,
        data: {
          ...node.data,
          runState: {
            ...runState,
            status: 'failed',
            message: '应用已重启，任务已中断',
            finishedAt,
          },
        },
      };
    }
    if (runState?.status === 'queued') {
      return {
        ...node,
        data: {
          ...node.data,
          runState: {
            ...runState,
            status: 'skipped',
            message: '应用已重启，未继续执行',
            finishedAt,
          },
        },
      };
    }
    return node;
  });
}

export function recoverRunState(
  runState?: CanvasRunState,
  finishedAt = datetime(),
): CanvasRunState | undefined {
  if (runState?.status !== 'running') return runState;
  return {
    ...runState,
    status: 'cancelled',
    message: '应用已重启，任务已中断',
    finishedAt,
  };
}
