import { describe, expect, it } from 'vitest';
import {
  assertSkillTextLimits,
  generatedSkillId,
  normalizeSkillId,
  parseSkillDocument,
  skillFrontmatterValue,
  skillFrontmatterList,
  unicodeLength,
} from './jiziSkillFormat';

describe('jiziSkillFormat', () => {
  it('normalizes and deterministically generates skill ids', () => {
    expect(normalizeSkillId(' API 测试 Helper ')).toBe('api-helper');
    expect(generatedSkillId('同一份内容')).toBe(generatedSkillId('同一份内容'));
  });

  it('parses JSON-quoted frontmatter values written by Rust', () => {
    const parsed = parseSkillDocument(`---
title: "包含 \\"引号\\" 的名称"
---

正文`);
    expect(parsed).not.toBeNull();
    expect(skillFrontmatterValue(parsed!.frontmatter, 'title')).toBe('包含 "引号" 的名称');
  });

  it('counts Unicode characters instead of UTF-8 bytes', () => {
    expect(unicodeLength('中文😀')).toBe(3);
    expect(() =>
      assertSkillTextLimits({
        description: '描述',
        instructions: '汉'.repeat(20_000),
      }),
    ).not.toThrow();
    expect(() =>
      assertSkillTextLimits({
        description: '描述',
        instructions: '汉'.repeat(20_001),
      }),
    ).toThrow('20000');
  });

  it('parses folded multiline values and YAML sequence lists', () => {
    const parsed = parseSkillDocument(`---
description: >-
  第一行说明，
  第二行继续。
capabilities:
  - 能力一
  - "能力二"
  - 能力三
---

正文`)!;
    expect(skillFrontmatterValue(parsed.frontmatter, 'description')).toBe(
      '第一行说明， 第二行继续。',
    );
    expect(skillFrontmatterList(parsed.frontmatter, 'capabilities')).toEqual([
      '能力一',
      '能力二',
      '能力三',
    ]);
  });

  it('enforces professional title and capability limits', () => {
    expect(() => assertSkillTextLimits({
      title: '测试',
      description: '描述',
      capabilities: ['能力一', '能力二'],
      instructions: '正文',
    })).toThrow('3-8');
    expect(() => assertSkillTextLimits({
      title: '测试',
      description: '描述',
      capabilities: ['能力一', '能力二', '能力三'],
      instructions: '正文',
    })).not.toThrow();
  });
});
