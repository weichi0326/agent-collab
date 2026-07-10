import type { AgentOutputFormat } from '../../stores/canvasStore';

export const RUN_STATUS_TEXT = {
  idle: '未运行',
  queued: '等待执行',
  running: '运行中',
  success: '运行成功',
  failed: '运行失败',
  skipped: '已跳过',
} as const;

export const RUN_STATUS_COLOR = {
  idle: 'default',
  queued: 'processing',
  running: 'processing',
  success: 'success',
  failed: 'error',
  skipped: 'default',
} as const;

export const OUTPUT_FORMAT_OPTIONS: { label: string; value: AgentOutputFormat }[] = [
  { label: 'Markdown', value: 'markdown' },
  { label: 'Word', value: 'docx' },
  { label: 'Excel', value: 'xlsx' },
  { label: '思维导图', value: 'mindmap' },
];

export function formatDuration(ms?: number): string | undefined {
  if (typeof ms !== 'number') return undefined;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
