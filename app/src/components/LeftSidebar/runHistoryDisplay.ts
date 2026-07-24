import type { RunRecord } from '../../stores/canvasStore';

export function runHistoryDisplayName(record: RunRecord): string {
  return record.history?.displayName ?? `${record.canvasName}_${record.stamp}`;
}
