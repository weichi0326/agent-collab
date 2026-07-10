export const RUN_HISTORY_STATUS = {
  idle: { text: '未运行', tone: 'neutral' },
  running: { text: '运行中', tone: 'running' },
  success: { text: '成功', tone: 'success' },
  failed: { text: '失败', tone: 'failed' },
  cancelled: { text: '手动中止', tone: 'cancelled' },
} as const;
