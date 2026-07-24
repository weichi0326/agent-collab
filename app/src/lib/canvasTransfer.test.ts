import { describe, expect, it } from 'vitest';
import { buildCanvasExport, parseCanvasImport } from './canvasTransfer';
import type { AgentNodeData } from '../stores/canvasStore';

describe('canvas prompt metadata transfer', () => {
  it('preserves the plain text output format through export and import', () => {
    const envelope = buildCanvasExport({
      name: '小说画布',
      nodes: [{
        id: 'writer',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { label: '章节作者', outputFormat: 'txt' },
      }],
      edges: [],
    });

    const result = parseCanvasImport(JSON.stringify(envelope), []);

    expect(result.nodes[0].data.outputFormat).toBe('txt');
  });

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

describe('canvas agent capability transfer', () => {
  it('preserves capability settings and remaps selected upstream ids', () => {
    const envelope = buildCanvasExport({
      name: 'capability canvas',
      nodes: [
        { id: 'source', position: { x: 0, y: 0 }, data: { label: 'source' } },
        {
          id: 'target',
          position: { x: 300, y: 0 },
          data: {
            label: 'target',
            capabilities: {
              input: {
                enabled: true,
                selectionMode: 'selected',
                selectedUpstreamIds: ['source'],
                upstreamOrder: ['source'],
                contentMode: 'summary',
              },
              generation: {
                enabled: true,
                maxTokens: 8192,
                fallbackModelRef: { configId: 'local-only', modelId: 'fallback' },
              },
              execution: { enabled: true, retryCount: 1, timeoutSeconds: 90 },
              validation: { enabled: true, requiredTerms: ['结论'] },
            },
          },
        },
      ],
      edges: [{ id: 'edge', source: 'source', target: 'target' }],
    });

    const result = parseCanvasImport(JSON.stringify(envelope), []);
    const sourceId = result.nodes[0].id;
    const capabilities = (result.nodes[1].data as AgentNodeData).capabilities;
    expect(capabilities?.input).toMatchObject({
      enabled: true,
      selectedUpstreamIds: [sourceId],
      upstreamOrder: [sourceId],
      contentMode: 'summary',
    });
    expect(capabilities?.generation).toMatchObject({
      enabled: true,
      maxTokens: 8192,
      fallbackModelRef: null,
    });
    expect(capabilities?.execution).toMatchObject({ retryCount: 1, timeoutSeconds: 90 });
    expect(capabilities?.validation).toMatchObject({ requiredTerms: ['结论'] });
  });
});
