import { describe, expect, it } from 'vitest';
import type { Connection, Edge, Node } from '@xyflow/react';
import { routeEdgesForNodes, validateConnection } from './edgeRouting';

const node = (id: string, x: number, y: number): Node => ({
  id,
  position: { x, y },
  data: {},
});

const connection = (source: string, target: string): Connection => ({
  source,
  target,
  sourceHandle: null,
  targetHandle: null,
});

describe('routeEdgesForNodes', () => {
  it('routes a backward edge from the source left side to the target right side', () => {
    const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }];

    expect(routeEdgesForNodes([node('a', 400, 0), node('b', 0, 0)], edges)).toEqual([
      expect.objectContaining({
        sourceHandle: 'port-left',
        targetHandle: 'port-right',
      }),
    ]);
  });

  it('routes a forward edge from the source right side to the target left side', () => {
    const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }];

    expect(routeEdgesForNodes([node('a', 0, 0), node('b', 400, 0)], edges)).toEqual([
      expect.objectContaining({
        sourceHandle: 'port-right',
        targetHandle: 'port-left',
      }),
    ]);
  });

  it('uses vertical ports when vertical distance is greater', () => {
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'a-c', source: 'a', target: 'c' },
    ];

    const routed = routeEdgesForNodes(
      [node('a', 0, 0), node('b', 20, 400), node('c', 20, -400)],
      edges,
    );

    expect(routed[0]).toEqual(
      expect.objectContaining({
        sourceHandle: 'port-bottom',
        targetHandle: 'port-top',
      }),
    );
    expect(routed[1]).toEqual(
      expect.objectContaining({
        sourceHandle: 'port-top',
        targetHandle: 'port-bottom',
      }),
    );
  });

  it('leaves an edge unchanged when either endpoint is missing', () => {
    const edge: Edge = { id: 'a-missing', source: 'a', target: 'missing' };
    expect(routeEdgesForNodes([node('a', 0, 0)], [edge])).toEqual([edge]);
  });
});

describe('validateConnection', () => {
  const nodes = [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)];

  it('rejects self connections', () => {
    expect(validateConnection(nodes, [], connection('a', 'a'))).toBe('节点不能连接自身');
  });

  it('rejects duplicate connections regardless of handle', () => {
    const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }];
    const next = {
      ...connection('a', 'b'),
      sourceHandle: 'source-top',
      targetHandle: 'target-bottom',
    };
    expect(validateConnection(nodes, edges, next)).toBe('这两个节点已经连接');
  });

  it('rejects a connection that would create a cycle', () => {
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-c', source: 'b', target: 'c' },
    ];
    expect(validateConnection(nodes, edges, connection('c', 'a'))).toBe(
      '该连接会形成循环',
    );
  });

  it('accepts an acyclic connection', () => {
    const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }];
    expect(validateConnection(nodes, edges, connection('a', 'c'))).toBeNull();
  });

  it('rejects incomplete or missing endpoints', () => {
    expect(
      validateConnection(
        nodes,
        [],
        { ...connection('a', 'b'), target: null } as unknown as Connection,
      ),
    ).toBe('连接端点无效');
    expect(validateConnection(nodes, [], connection('a', 'missing'))).toBe(
      '连接端点无效',
    );
  });
});
