import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../../stores/canvasStore';
import { runHistoryDisplayName } from './runHistoryDisplay';

const base: RunRecord = {
  id: 'run-1',
  canvasId: 'canvas-1',
  canvasName: '原画布',
  time: '2026-07-24 12:00:00',
  stamp: '20260724120000',
  nodes: [],
  edges: [],
};

describe('run history display name', () => {
  it('uses business metadata for professional runs', () => {
    expect(runHistoryDisplayName({
      ...base,
      history: {
        packageId: 'fictionist',
        subjectType: 'fiction-chapter',
        subjectLabel: '明日之后',
        actionLabel: 'AI起草',
        sequence: 1,
        displayName: '明日之后-AI起草（1）',
      },
    })).toBe('明日之后-AI起草（1）');
  });

  it('preserves the legacy canvas-and-stamp name for old records', () => {
    expect(runHistoryDisplayName(base)).toBe('原画布_20260724120000');
  });
});
