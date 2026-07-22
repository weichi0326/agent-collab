import { describe, expect, it } from 'vitest';
import type { Canvas } from '../stores/canvasStore';
import { buildCanvasAdvice } from './canvasAdvisor';

function canvasWithSource(data: Record<string, unknown>): Canvas {
  return {
    id: 'canvas',
    name: 'canvas',
    nodes: [{ id: 'source', position: { x: 0, y: 0 }, data }],
    edges: [],
  };
}

describe('buildCanvasAdvice source inputs', () => {
  it('does not report a configured URL source as missing input', () => {
    const advice = buildCanvasAdvice(canvasWithSource({
      modelRef: { configId: 'cfg', modelId: 'model' },
      dataSourceMode: 'url',
      dataSourceUrl: 'https://example.com/source',
    }));

    expect(advice.some((item) => item.title === '入口节点可能缺输入')).toBe(false);
  });

  it('reports an empty URL source as missing input', () => {
    const advice = buildCanvasAdvice(canvasWithSource({
      modelRef: { configId: 'cfg', modelId: 'model' },
      dataSourceMode: 'url',
      dataSourceUrl: '   ',
    }));

    expect(advice.some((item) => item.title === '入口节点可能缺输入')).toBe(true);
  });
});
