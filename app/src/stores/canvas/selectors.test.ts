import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { upstreamNames } from './selectors';

describe('upstreamNames', () => {
  it('traces through a gate to the agent that produced the data', () => {
    const nodes = [
      {
        id: 'source-agent',
        position: { x: 0, y: 0 },
        data: { label: '需求分析师' },
      },
      {
        id: 'or-gate',
        type: 'gate',
        position: { x: 100, y: 0 },
        data: { label: '或门', gateType: 'or' },
      },
      {
        id: 'target-agent',
        position: { x: 200, y: 0 },
        data: { label: '需求分析师' },
      },
    ] as Node[];
    const edges = [
      { id: 'source-to-gate', source: 'source-agent', target: 'or-gate' },
      { id: 'gate-to-target', source: 'or-gate', target: 'target-agent' },
    ] as Edge[];

    expect(upstreamNames(nodes, edges, 'target-agent')).toEqual([
      '需求分析师',
    ]);
  });
});
