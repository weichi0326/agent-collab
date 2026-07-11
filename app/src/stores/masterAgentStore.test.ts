import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT } from './masterAgentStore';

describe('DEFAULT_SYSTEM_PROMPT', () => {
  it('describes confirmed project actions without denying them', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('确认');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('画布');
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(
      '还不能直接执行创建/修改画布',
    );
  });
});
