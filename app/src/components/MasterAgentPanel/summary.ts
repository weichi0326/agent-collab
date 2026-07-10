import type { ChatMessage } from '../../stores/masterAgentStore';
import { SUMMARY_SOURCE_CHAR_CAP } from './constants';

export function messageTextLength(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + historyLine(msg, 0).length, 0);
}

function compactContent(content: string, cap = 1200): string {
  const text = content.trim().replace(/\s+/g, ' ');
  return text.length > cap ? `${text.slice(0, cap)}...` : text;
}

function historyLine(msg: ChatMessage, index: number): string {
  const role = msg.role === 'user' ? '用户' : '姬子';
  const parts = [compactContent(msg.content) || '(无文字)'];
  if (msg.attachments?.length) {
    parts.push(
      '附件：' +
        msg.attachments
          .map((att) => `${att.isImage ? '图片' : '文件'}「${att.name}」`)
          .join('、'),
    );
  }
  return `${index + 1}. ${role}: ${parts.join('；')}`;
}

export function buildSummaryPrompt(
  previousSummary: string | undefined,
  messages: ChatMessage[],
): string {
  const lines = messages
    .map((msg, index) => historyLine(msg, index))
    .join('\n\n')
    .slice(0, SUMMARY_SOURCE_CHAR_CAP);
  return [
    '请把下面这段总 Agent 对话压缩成一份后续可继续使用的上下文摘要。',
    '要求：只保留用户目标、关键决定、偏好、约束、待办、已经排除或暂缓的方案；不要写寒暄；不要编造；用简体中文；控制在 800 字以内。',
    previousSummary ? `【已有摘要】\n${previousSummary}` : '',
    `【新增旧对话】\n${lines}`,
    '请输出更新后的完整摘要：',
  ]
    .filter(Boolean)
    .join('\n\n');
}
