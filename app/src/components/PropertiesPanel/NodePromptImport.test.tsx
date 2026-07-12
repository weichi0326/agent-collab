import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../PropertiesPanel.tsx', import.meta.url),
  'utf8',
);

describe('node prompt import presentation', () => {
  it('uses the Jizi import and collapsible preview pattern', () => {
    expect(source).toContain('node-prompt-import__controls');
    expect(source).toContain('node-prompt-import__preview');
    expect(source).toContain('master-config-preview__toggle');
    expect(source).toContain('<span>系统提示词预览</span>');
    expect(source).toContain("promptText ? `已导入 · ${promptSourceLabel}` : '未导入'");
    expect(source).toContain('systemPromptSourceName');
    expect(source).not.toContain('当前节点提示词已导入。预览默认收起');
    expect(source).not.toContain('当前节点尚未导入系统提示词。');
    expect(source).not.toContain(
      'placeholder="定义该节点的角色、任务与输出要求"',
    );
  });

  it('provides an optional custom output rule with the same import pattern', () => {
    expect(source).toContain('自定义输出规则');
    expect(source).toContain('outputRuleEnabled');
    expect(source).toContain('outputRuleSourceName');
    expect(source).toContain('node-output-rule__controls');
    expect(source).toContain('node-output-rule__preview');
    expect(source).toContain('<span>输出规则预览</span>');
  });
});
