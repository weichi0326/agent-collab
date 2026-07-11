import { describe, expect, it } from 'vitest';
import {
  BUILTIN_JIZI_SKILL_IDS,
  isBuiltinSkill,
  fitJiziSkillContext,
  mergeJiziSkillFiles,
  parseJiziSkillFile,
  parseSkillSelectionReply,
  type JiziSkillFile,
} from './jiziSkills';
import { unicodeLength } from './jiziSkillFormat';

const skillFile: JiziSkillFile = {
  id: 'failure-diagnosis',
  path: 'jizi-agent-architecture/skills/failure-diagnosis/SKILL.md',
  content: `---
index: failure-diagnosis
title: 失败诊断
description: 诊断失败的画布节点和工具调用。
---

# 失败诊断

说明最可能的原因和最低成本的下一步检查。`,
};

describe('parseJiziSkillFile', () => {
  it('parses frontmatter and body from SKILL.md', () => {
    const skill = parseJiziSkillFile(skillFile);
    expect(skill?.id).toBe('failure-diagnosis');
    expect(skill?.title).toBe('失败诊断');
    expect(skill?.description).toBe('诊断失败的画布节点和工具调用。');
    expect(skill?.capabilities).toEqual([]);
    expect(skill?.instructions).toContain('最低成本');
    expect(skill?.legacyFormat).toBe(false);
  });

  it('parses title, description and capabilities', () => {
    const skill = parseJiziSkillFile({
      id: 'api-test-helper',
      path: 'jizi-agent-architecture/skills/api-test-helper/SKILL.md',
      content: `---
index: api-test-helper
title: 接口测试助手
description: 帮你设计接口测试步骤，并判断需要哪些请求工具。
capabilities: 设计接口测试步骤 | 判断缺失依赖 | 解释状态码和返回体
---

# 接口测试助手

## Instructions

Ask for missing endpoint details before running tests.`,
    });

    expect(skill?.title).toBe('接口测试助手');
    expect(skill?.description).toBe('帮你设计接口测试步骤，并判断需要哪些请求工具。');
    expect(skill?.capabilities).toEqual([
      '设计接口测试步骤',
      '判断缺失依赖',
      '解释状态码和返回体',
    ]);
  });

  it('keeps compatibility with old display metadata', () => {
    const skill = parseJiziSkillFile({
      id: 'api-test-helper',
      path: 'jizi-agent-architecture/skills/api-test-helper/SKILL.md',
      content: `---
name: api-test-helper
description: Use when the user needs to design, run, or debug API tests.
display_title: 接口测试助手
display_description: 帮你设计接口测试步骤，并判断需要哪些请求工具。
capabilities: 设计接口测试步骤 | 判断缺失依赖
---

# 接口测试助手

Ask for missing endpoint details before running tests.`,
    });

    expect(skill?.title).toBe('接口测试助手');
    expect(skill?.description).toBe('帮你设计接口测试步骤，并判断需要哪些请求工具。');
    expect(skill?.capabilities).toEqual(['设计接口测试步骤', '判断缺失依赖']);
    expect(skill?.legacyFormat).toBe(true);
    expect(skill?.rawContent).toContain('display_title');
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

describe('mergeJiziSkillFiles', () => {
  it('keeps every built-in skill alongside newly added disk skills', () => {
    const merged = mergeJiziSkillFiles([
      {
        id: 'custom-review',
        path: 'jizi-agent-architecture/skills/custom-review/SKILL.md',
        content: `---
index: custom-review
title: 自定义审阅
description: 审阅用户提供的自定义内容。
capabilities: 审阅内容
---

# 自定义审阅

检查输入并给出结论。`,
      },
    ]);

    expect(merged.map((skill) => skill.id)).toEqual([
      ...BUILTIN_JIZI_SKILL_IDS,
      'custom-review',
    ]);
  });

  it('uses a valid disk file to override a built-in without changing its identity', () => {
    const merged = mergeJiziSkillFiles([
      {
        id: 'failure-diagnosis',
        path: 'jizi-agent-architecture/skills/failure-diagnosis/SKILL.md',
        content: `---
index: failure-diagnosis
title: 定制失败诊断
description: 使用用户定制的诊断流程。
capabilities: 定位错误
---

# 定制失败诊断

先收集日志，再判断根因。`,
      },
    ]);

    const overridden = merged.find((skill) => skill.id === 'failure-diagnosis');
    expect(overridden?.title).toBe('定制失败诊断');
    expect(overridden?.path).toContain('failure-diagnosis');
    expect(isBuiltinSkill(overridden)).toBe(true);
  });

  it('falls back to the built-in when a same-id disk file is invalid', () => {
    const merged = mergeJiziSkillFiles([
      { id: 'workflow-planner', path: 'broken/SKILL.md', content: '# broken' },
    ]);
    const workflow = merged.find((skill) => skill.id === 'workflow-planner');
    expect(workflow?.title).toBe('工作流规划');
    expect(workflow?.path).toBeUndefined();
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
index: tool-generation-review
title: 工具生成审阅
description: 生成和审阅自定义 Python 工具。
---

# 工具生成审阅

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
index: skill-${idx}
title: Skill ${idx}
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

describe('fitJiziSkillContext', () => {
  it('enforces the context limit even for the first selected skill', () => {
    const skill = parseJiziSkillFile({
      id: 'large-skill',
      path: '',
      content: `---
index: large-skill
title: 大型 Skill
description: 用于测试上下文限制。
category: workflow
capabilities: 能力一 | 能力二 | 能力三
---

${'长'.repeat(20_000)}`,
    })!;
    const fitted = fitJiziSkillContext([{ skill, reason: '测试' }], 1_000);
    expect(unicodeLength(fitted.block)).toBeLessThanOrEqual(1_000);
    expect(fitted.block).toContain('已截断');
  });
});
