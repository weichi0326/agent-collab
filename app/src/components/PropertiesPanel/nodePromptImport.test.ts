import { describe, expect, it } from 'vitest';
import {
  NODE_PROMPT_CHAR_CAP,
  nodePromptSourceLabel,
  normalizeNodePromptText,
} from './nodePromptImport';

describe('node prompt import rules', () => {
  it('keeps short text unchanged', () => {
    expect(normalizeNodePromptText('角色说明')).toEqual({
      text: '角色说明',
      truncated: false,
    });
  });

  it('truncates long text to the Jizi prompt limit', () => {
    const result = normalizeNodePromptText(
      'a'.repeat(NODE_PROMPT_CHAR_CAP + 5),
    );

    expect(result.text).toHaveLength(14_000);
    expect(result.truncated).toBe(true);
  });

  it('labels imported, legacy, and empty prompt sources', () => {
    expect(nodePromptSourceLabel('内容', 'analyst.md')).toBe('analyst.md');
    expect(nodePromptSourceLabel('旧内容', undefined)).toBe(
      '早期手动编辑（无关联文件）',
    );
    expect(nodePromptSourceLabel('', undefined)).toBe('未导入');
  });
});
