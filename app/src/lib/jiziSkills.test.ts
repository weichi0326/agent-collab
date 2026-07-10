import { describe, expect, it } from 'vitest';
import {
  parseJiziSkillFile,
  parseSkillSelectionReply,
  type JiziSkillFile,
} from './jiziSkills';

const skillFile: JiziSkillFile = {
  id: 'failure-diagnosis',
  path: 'jizi-agent-architecture/skills/failure-diagnosis/SKILL.md',
  content: `---
name: failure-diagnosis
description: Diagnose failed canvas nodes and tool calls.
---

# Failure Diagnosis

Explain the likely cause and cheapest next check.`,
};

describe('parseJiziSkillFile', () => {
  it('parses frontmatter and body from SKILL.md', () => {
    const skill = parseJiziSkillFile(skillFile);
    expect(skill?.id).toBe('failure-diagnosis');
    expect(skill?.name).toBe('failure-diagnosis');
    expect(skill?.title).toBe('Failure Diagnosis');
    expect(skill?.description).toBe('Diagnose failed canvas nodes and tool calls.');
    expect(skill?.capabilities).toEqual([]);
    expect(skill?.instructions).toContain('Explain the likely cause');
  });

  it('parses user-facing display metadata and capabilities', () => {
    const skill = parseJiziSkillFile({
      id: 'api-test-helper',
      path: 'jizi-agent-architecture/skills/api-test-helper/SKILL.md',
      content: `---
name: api-test-helper
description: Use when the user needs to design, run, or debug API tests.
display_title: 接口测试助手
display_description: 帮你设计接口测试步骤，并判断需要哪些请求工具。
capabilities: 设计接口测试步骤 | 判断缺失依赖 | 解释状态码和返回体
---

# 接口测试助手

## Instructions

Ask for missing endpoint details before running tests.`,
    });

    expect(skill?.title).toBe('接口测试助手');
    expect(skill?.displayTitle).toBe('接口测试助手');
    expect(skill?.displayDescription).toBe('帮你设计接口测试步骤，并判断需要哪些请求工具。');
    expect(skill?.capabilities).toEqual([
      '设计接口测试步骤',
      '判断缺失依赖',
      '解释状态码和返回体',
    ]);
  });

  it('rejects files without required skill metadata', () => {
    const skill = parseJiziSkillFile({
      id: 'broken',
      path: '',
      content: '# Missing frontmatter',
    });
    expect(skill).toBeNull();
  });
});

describe('parseSkillSelectionReply', () => {
  it('keeps only valid selected skill ids returned by the model', () => {
    const skill = parseJiziSkillFile(skillFile);
    expect(skill).toBeTruthy();
    const selected = parseSkillSelectionReply(
      `{"selected":[{"id":"failure-diagnosis","reason":"failure report"},{"id":"unknown","reason":"nope"}]}`,
      [skill!],
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.skill.id).toBe('failure-diagnosis');
    expect(selected[0]?.reason).toBe('failure report');
  });

  it('deduplicates and respects the selection limit', () => {
    const first = parseJiziSkillFile(skillFile);
    const second = parseJiziSkillFile({
      id: 'tool-generation-review',
      path: '',
      content: `---
name: tool-generation-review
description: Generate and review custom Python tools.
---

# Tool Generation Review

Review generated tools before installation.`,
    });
    expect(first && second).toBeTruthy();
    const selected = parseSkillSelectionReply(
      `{"selected":[{"id":"failure-diagnosis"},{"id":"failure-diagnosis"},{"id":"tool-generation-review"}]}`,
      [first!, second!],
      1,
    );
    expect(selected.map((item) => item.skill.id)).toEqual(['failure-diagnosis']);
  });

  it('does not cap skill selection at three by default', () => {
    const skills = [1, 2, 3, 4].map((idx) =>
      parseJiziSkillFile({
        id: `skill-${idx}`,
        path: '',
        content: `---
name: skill-${idx}
description: Skill ${idx}.
---

# Skill ${idx}

Do thing ${idx}.`,
      }),
    );
    expect(skills.every(Boolean)).toBe(true);
    const selected = parseSkillSelectionReply(
      '{"selected":[{"id":"skill-1"},{"id":"skill-2"},{"id":"skill-3"},{"id":"skill-4"}]}',
      skills.filter((skill): skill is NonNullable<typeof skill> => !!skill),
    );
    expect(selected.map((item) => item.skill.id)).toEqual([
      'skill-1',
      'skill-2',
      'skill-3',
      'skill-4',
    ]);
  });
});
