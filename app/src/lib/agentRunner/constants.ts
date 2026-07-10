// 运行前工具预检失败上报时的占位 nodeId(非真实节点); 编排层据此区分"预检失败"与"具体节点失败"。
export const PREFLIGHT_NODE_ID = '__preflight__';

export const MAX_PARALLEL_NODES = 4;
// 同时处于 running 状态的画布数量上限: runCanvas 入口据此拦截,超过则拒绝启动新运行。
export const MAX_CONCURRENT_RUNS = 6;
export const NODE_START_STAGGER_MS = 80;
export const NODE_RETRY_LIMIT = 2;
export const NODE_RETRY_DELAY_MS = 900;
export const OUTPUT_SUMMARY_MAX_CHARS = 420;
export const OUTPUT_MAX_BYTES = 10 * 1024 * 1024;

export const RETRYABLE_NODE_ERROR_PATTERNS = [
  'llm 连接中途断开',
  '返回空内容',
  'response ended prematurely',
  'socket hang up',
  'timeout',
  'timed out',
  'network',
  '429',
  '502',
  '503',
  '504',
];
