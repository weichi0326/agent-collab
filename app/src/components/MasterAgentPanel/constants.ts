import type { ChatMessage } from '../../stores/masterAgentStore';

export const SUGGESTIONS = [
  '这个工具的画布和 Agent 是什么关系？',
  '帮我规划一个测试用例生成的工作流',
  '需求分析 Agent 应该配哪些工具？',
];

export const ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.csv';

export const DOC_CHAR_CAP = 20000;
export const HISTORY_TURNS = 20;
export const SUMMARY_KEEP_TURNS = 8;
export const SUMMARY_MIN_MESSAGES = 14;
export const SUMMARY_TRIGGER_CHARS = 12000;
export const SUMMARY_SOURCE_CHAR_CAP = 18000;
export const AUTO_SCROLL_THRESHOLD = 50;

export const EMPTY_MESSAGES: ChatMessage[] = [];
