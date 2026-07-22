import { describe, expect, it } from 'vitest';
import { skillRemovalCopy } from './skillRemoval';

describe('skill removal copy', () => {
  it('names the capabilities lost when removing a user Skill', () => {
    expect(skillRemovalCopy({
      title: '接口诊断',
      capabilities: ['构造 API 请求', '分析响应错误'],
    }, false)).toEqual({
      title: '移除 Skill',
      content: '移除「接口诊断」后无法撤销。姬子将失去此 Skill 提供的能力：构造 API 请求、分析响应错误。',
      okText: '确认移除',
    });
  });

  it('explains that restoring an override keeps the built-in Skill', () => {
    expect(skillRemovalCopy({
      title: '项目审计',
      capabilities: ['审计项目问题'],
    }, true)).toEqual({
      title: '恢复内置 Skill',
      content: '将移除「项目审计」的用户覆盖版本，并恢复应用内置内容。用户修改的能力与做事方法会丢失，内置 Skill 仍可继续使用。',
      okText: '恢复内置版本',
    });
  });
});
