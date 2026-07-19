import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT } from './masterAgentStore';

describe('DEFAULT_SYSTEM_PROMPT', () => {
  it('uses the generalized multi-agent workflow personality by default', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('通用任务类型');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('默认执行策略（B）');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('创意与写作');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('需求与分析');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('工程与交付');
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('游戏测试工具，Windows 桌面端');
  });

  it('describes confirmed project actions without denying them', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('确认');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('画布');
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(
      '还不能直接执行创建/修改画布',
    );
  });
});
