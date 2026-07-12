import { describe, expect, it } from 'vitest';
import { buildCanvasExport, parseCanvasImport } from './canvasTransfer';

describe('canvas prompt metadata transfer', () => {
  it('preserves the node prompt source filename through export and import', () => {
    const envelope = buildCanvasExport({
      name: '测试画布',
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            label: '分析师',
            systemPrompt: '核对需求',
            systemPromptSourceName: 'analyst.md',
          },
        },
      ],
      edges: [],
    });

    const result = parseCanvasImport(JSON.stringify(envelope), []);

    expect(result.nodes[0].data.systemPromptSourceName).toBe('analyst.md');
  });

  it('preserves the custom output rule through export and import', () => {
    const envelope = buildCanvasExport({
      name: '测试画布',
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            label: '分析师',
            outputRuleEnabled: true,
            outputRuleText: '第一列必须是编号',
            outputRuleSourceName: 'excel-output-rule.md',
          },
        },
      ],
      edges: [],
    });

    const result = parseCanvasImport(JSON.stringify(envelope), []);

    expect(result.nodes[0].data.outputRuleEnabled).toBe(true);
    expect(result.nodes[0].data.outputRuleText).toBe('第一列必须是编号');
    expect(result.nodes[0].data.outputRuleSourceName).toBe(
      'excel-output-rule.md',
    );
  });

  it('keeps imported rule content while the switch is off', () => {
    const envelope = buildCanvasExport({
      name: '测试画布',
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            label: '分析师',
            outputRuleEnabled: false,
            outputRuleText: '保留的输出规则',
            outputRuleSourceName: 'paused-rule.txt',
          },
        },
      ],
      edges: [],
    });

    const result = parseCanvasImport(JSON.stringify(envelope), []);

    expect(result.nodes[0].data.outputRuleEnabled).toBe(false);
    expect(result.nodes[0].data.outputRuleText).toBe('保留的输出规则');
    expect(result.nodes[0].data.outputRuleSourceName).toBe('paused-rule.txt');
  });
});

describe('canvas edge route transfer', () => {
  it('preserves manually adjusted orthogonal route points', () => {
    const envelope = buildCanvasExport({
      name: 'route canvas',
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', position: { x: 300, y: 200 }, data: {} },
      ],
      edges: [
        {
          id: 'a-b',
          source: 'a',
          target: 'b',
          data: {
            routePoints: [
              { x: 0, y: 0 },
              { x: 160, y: 0 },
              { x: 160, y: 200 },
              { x: 300, y: 200 },
            ],
          },
        },
      ],
    });

    const result = parseCanvasImport(JSON.stringify(envelope), []);

    expect(result.edges[0].data?.routePoints).toEqual([
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 200 },
      { x: 300, y: 200 },
    ]);
  });
});
