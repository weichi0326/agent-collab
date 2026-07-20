import { describe, expect, it } from 'vitest';
import { actionRiskNotice } from './descriptions';
import type { MasterAction } from './types';

describe('actionRiskNotice overlong prompt warning', () => {
  it('appends a truncation warning when an add-node systemPrompt exceeds 14000', () => {
    const action: MasterAction = {
      type: 'plan',
      steps: [
        {
          type: 'add-node',
          label: '世界观生成',
          systemPrompt: 'a'.repeat(14_005),
        },
      ],
    };
    const notice = actionRiskNotice(action);
    expect(notice).toContain('14000');
    expect(notice).toContain('截断');
  });

  it('keeps the plain plan notice when all prompts fit within 14000', () => {
    const action: MasterAction = {
      type: 'plan',
      steps: [
        {
          type: 'add-node',
          label: '世界观生成',
          systemPrompt: 'a'.repeat(100),
        },
      ],
    };
    const notice = actionRiskNotice(action);
    expect(notice).not.toContain('截断');
  });
});
