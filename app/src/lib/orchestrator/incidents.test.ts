import { describe, expect, it } from 'vitest';
import {
  capIncidents,
  isTerminalIncident,
  reduceFinalizeRepair,
  reduceIgnore,
  reduceRevertToFailed,
} from './incidents';
import type { Incident, IncidentStatus } from './diagnosis';

function makeIncident(
  id: string,
  status: IncidentStatus,
  extra: Partial<Incident> = {},
): Incident {
  return {
    id,
    canvasId: `canvas-${id}`,
    nodeId: `node-${id}`,
    nodeLabel: `节点 ${id}`,
    errorDetail: `报错 ${id}`,
    sessionId: 'diagnosis-session',
    status,
    createdAt: 0,
    ...extra,
  };
}

describe('isTerminalIncident', () => {
  it('treats resolved / failed / ignored as terminal', () => {
    expect(isTerminalIncident(makeIncident('a', 'resolved'))).toBe(true);
    expect(isTerminalIncident(makeIncident('b', 'failed'))).toBe(true);
    expect(
      isTerminalIncident(makeIncident('c', 'diagnosing', { ignored: true })),
    ).toBe(true);
  });

  it('treats diagnosing / awaiting-confirm / repairing as active', () => {
    expect(isTerminalIncident(makeIncident('a', 'diagnosing'))).toBe(false);
    expect(isTerminalIncident(makeIncident('b', 'awaiting-confirm'))).toBe(false);
    expect(isTerminalIncident(makeIncident('c', 'repairing'))).toBe(false);
  });
});

describe('capIncidents', () => {
  it('keeps the list untouched when within cap', () => {
    const list = [makeIncident('a', 'failed'), makeIncident('b', 'resolved')];
    const { kept, removedIds } = capIncidents(list, 5);
    expect(kept).toBe(list);
    expect(removedIds).toEqual([]);
  });

  it('trims the oldest terminal incidents first', () => {
    const list = [
      makeIncident('old-failed', 'failed'),
      makeIncident('active', 'repairing'),
      makeIncident('new-resolved', 'resolved'),
    ];
    const { kept, removedIds } = capIncidents(list, 2);
    expect(removedIds).toEqual(['old-failed']);
    expect(kept.map((i) => i.id)).toEqual(['active', 'new-resolved']);
  });

  it('never trims active incidents even when over cap', () => {
    const list = [
      makeIncident('a', 'diagnosing'),
      makeIncident('b', 'awaiting-confirm'),
      makeIncident('c', 'repairing'),
    ];
    const { kept, removedIds } = capIncidents(list, 1);
    expect(removedIds).toEqual([]);
    expect(kept).toBe(list);
  });

  it('only removes as many terminal incidents as needed', () => {
    const list = [
      makeIncident('t1', 'failed'),
      makeIncident('t2', 'resolved'),
      makeIncident('active', 'diagnosing'),
      makeIncident('t3', 'failed'),
    ];
    // over cap by 1 → remove exactly one (the oldest terminal)
    const { kept, removedIds } = capIncidents(list, 3);
    expect(removedIds).toEqual(['t1']);
    expect(kept.map((i) => i.id)).toEqual(['t2', 'active', 't3']);
  });
});

describe('reduceFinalizeRepair', () => {
  it('marks a repairing incident resolved and keeps its diagnosisText', () => {
    const list = [
      makeIncident('x', 'repairing', { diagnosisText: '修复中说明' }),
    ];
    const next = reduceFinalizeRepair(list, 'x', true);
    expect(next[0].status).toBe('resolved');
    expect(next[0].diagnosisText).toBe('修复中说明');
  });

  it('marks a repairing incident failed and rewrites diagnosisText', () => {
    const list = [makeIncident('x', 'repairing')];
    const next = reduceFinalizeRepair(list, 'x', false);
    expect(next[0].status).toBe('failed');
    expect(next[0].diagnosisText).toContain('仍未跑通');
  });

  it('also finalizes an optimistically-resolved incident', () => {
    const list = [makeIncident('x', 'resolved')];
    const next = reduceFinalizeRepair(list, 'x', false);
    expect(next[0].status).toBe('failed');
  });

  it('leaves non-repairing / non-resolved incidents untouched', () => {
    const list = [makeIncident('x', 'awaiting-confirm')];
    expect(reduceFinalizeRepair(list, 'x', true)).toBe(list);
  });

  it('is a no-op for an unknown incident id', () => {
    const list = [makeIncident('x', 'repairing')];
    expect(reduceFinalizeRepair(list, 'missing', true)).toBe(list);
  });
});

describe('reduceRevertToFailed', () => {
  it('reverts an awaiting-confirm incident to failed', () => {
    const list = [makeIncident('x', 'awaiting-confirm')];
    const next = reduceRevertToFailed(list, 'x');
    expect(next[0].status).toBe('failed');
    expect(next[0].diagnosisText).toContain('取消了这次修复');
  });

  it('does nothing for incidents that are not awaiting-confirm', () => {
    for (const status of ['diagnosing', 'repairing', 'resolved', 'failed'] as const) {
      const list = [makeIncident('x', status)];
      expect(reduceRevertToFailed(list, 'x')).toBe(list);
    }
  });
});

describe('reduceIgnore', () => {
  it('marks the target incident ignored without touching others', () => {
    const list = [
      makeIncident('a', 'failed'),
      makeIncident('b', 'diagnosing'),
    ];
    const next = reduceIgnore(list, 'b');
    expect(next.find((i) => i.id === 'b')?.ignored).toBe(true);
    expect(next.find((i) => i.id === 'a')?.ignored).toBeUndefined();
  });
});
