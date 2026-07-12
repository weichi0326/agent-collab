export const NODE_PROMPT_CHAR_CAP = 14_000;

export function normalizeNodePromptText(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= NODE_PROMPT_CHAR_CAP) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, NODE_PROMPT_CHAR_CAP),
    truncated: true,
  };
}

export function nodePromptSourceLabel(
  text: string,
  sourceName: string | undefined,
): string {
  if (sourceName) return sourceName;
  return text ? '早期手动编辑（无关联文件）' : '未导入';
}
