import { describe, expect, it } from 'vitest';
import { skillRowsForRetry } from './jiziSkillImportState';

describe('skillRowsForRetry', () => {
  it('keeps only failed rows after a partially successful import', () => {
    const rows = [{ id: 'saved-a' }, { id: 'failed-b' }, { id: 'saved-c' }];

    const retryRows = skillRowsForRetry(rows, new Set([1]));

    expect(retryRows).toEqual([{ id: 'failed-b' }]);
    expect(retryRows).not.toContain(rows[0]);
    expect(retryRows).not.toContain(rows[2]);
  });

  it('returns no retry rows when every import succeeds', () => {
    expect(skillRowsForRetry([{ id: 'saved' }], new Set())).toEqual([]);
  });
});
