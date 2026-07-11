import { describe, expect, it } from 'vitest';
import { JIZI_EVALUATION_CASES } from './cases';

describe('Jizi intelligence evaluation corpus', () => {
  it('contains at least 60 unique cases across every required category', () => {
    expect(JIZI_EVALUATION_CASES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(JIZI_EVALUATION_CASES.map((item) => item.id)).size).toBe(
      JIZI_EVALUATION_CASES.length,
    );
    for (const category of [
      'canvas', 'agent', 'tool', 'recovery', 'search', 'memory',
      'correction', 'cancellation', 'rollback',
    ] as const) {
      expect(
        JIZI_EVALUATION_CASES.some((item) => item.category === category),
      ).toBe(true);
    }
  });

  it('defines an observable expected outcome for every case', () => {
    for (const item of JIZI_EVALUATION_CASES) {
      expect(item.goal.trim()).not.toBe('');
      expect(item.expectedEvidenceCode.trim()).not.toBe('');
      expect(item.maxSteps).toBeGreaterThan(0);
      expect(item.maxSteps).toBeLessThanOrEqual(8);
    }
  });
});
