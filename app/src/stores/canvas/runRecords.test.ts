import { describe, expect, it } from 'vitest';
import type { RunRecord } from './types';
import { createRunHistoryMetadata } from './runRecords';

function record(history?: RunRecord['history']): RunRecord {
  return {
    id: `run-${history?.sequence ?? 0}`,
    canvasId: 'canvas-1',
    canvasName: '小说家任务画布',
    time: '2026-07-24 12:00:00',
    stamp: '20260724120000',
    nodes: [],
    edges: [],
    history,
  };
}

describe('professional run history metadata', () => {
  it('builds a business name and increments the same subject/action series', () => {
    const descriptor = {
      subjectType: 'fiction-chapter',
      subjectId: 'chapter-1',
      subjectLabel: '明日之后',
      actionLabel: 'AI起草',
    };
    const first = createRunHistoryMetadata([], 'fictionist', descriptor);
    const second = createRunHistoryMetadata([record(first)], 'fictionist', {
      ...descriptor,
      subjectLabel: '明日之后（修订名）',
    });

    expect(first).toMatchObject({ sequence: 1, displayName: '明日之后-AI起草（1）' });
    expect(second).toMatchObject({
      sequence: 2,
      displayName: '明日之后（修订名）-AI起草（2）',
    });
  });

  it('starts a separate series for another action and ignores missing descriptors', () => {
    const first = createRunHistoryMetadata([], 'fictionist', {
      subjectType: 'fiction-chapter',
      subjectLabel: '明日之后',
      actionLabel: 'AI起草',
    });
    const continuation = createRunHistoryMetadata([record(first)], 'fictionist', {
      subjectType: 'fiction-chapter',
      subjectLabel: '明日之后',
      actionLabel: '续写',
    });

    expect(continuation).toMatchObject({ sequence: 1, displayName: '明日之后-续写（1）' });
    expect(createRunHistoryMetadata([], 'fictionist')).toBeUndefined();
  });
});
