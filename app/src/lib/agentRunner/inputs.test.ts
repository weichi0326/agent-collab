import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { AgentNodeData, Canvas } from '../../stores/canvasStore';
import { collectInput, requiredToolTagsForNode } from './inputs';
import type { NodeOutput } from './types';

function node(data: AgentNodeData): Node {
  return { id: 'target', type: 'agent', position: { x: 0, y: 0 }, data };
}

const outputs = new Map<string, NodeOutput>([
  ['a', {
    nodeId: 'a',
    label: '结构化来源',
    content: 'A 的完整正文',
    summary: 'A 的摘要',
    structuredData: {
      value: 'A',
      contentRef: { kind: 'artifact', path: 'outputs/a.md' },
    },
  }],
  ['b', {
    nodeId: 'b',
    label: '普通来源',
    content: 'B 的完整正文',
    summary: 'B 的摘要',
  }],
]);

describe('collectInput capability modes', () => {
  it('uses full upstream body by default when input capability is disabled', async () => {
    const result = await collectInput(node({}), ['a'], outputs);
    expect(result.text).toContain('### 正文');
    expect(result.text).toContain('A 的完整正文');
    expect(result.text).not.toContain('机器可读 JSON');
    expect(result.text).not.toContain('A 的摘要');
    expect(result.text).not.toContain('"value": "A"');
  });

  it('selects and orders upstream nodes while full mode keeps only body text', async () => {
    const result = await collectInput(node({
      capabilities: {
        input: {
          enabled: true,
          selectionMode: 'selected',
          selectedUpstreamIds: ['a', 'b'],
          upstreamOrder: ['b', 'a'],
          contentMode: 'full',
        },
      },
    }), ['a', 'b'], outputs);

    expect(result.text.indexOf('普通来源')).toBeLessThan(result.text.indexOf('结构化来源'));
    expect(result.text).toContain('B 的完整正文');
    expect(result.text).toContain('A 的完整正文');
    expect(result.text).not.toContain('B 的摘要');
    expect(result.text).not.toContain('"value": "A"');
  });

  it('uses summary or structured content without duplicating full body', async () => {
    const summary = await collectInput(node({
      capabilities: { input: { enabled: true, contentMode: 'summary' } },
    }), ['a'], outputs);
    expect(summary.text).toContain('A 的摘要');
    expect(summary.text).not.toContain('A 的完整正文');
    expect(summary.text).not.toContain('"value": "A"');

    const structured = await collectInput(node({
      capabilities: { input: { enabled: true, contentMode: 'structured' } },
    }), ['a'], outputs);
    expect(structured.text).toContain('"value": "A"');
    expect(structured.text).toContain('"contentRef"');
    expect(structured.text).not.toContain('A 的完整正文');
    expect(structured.text).not.toContain('A 的摘要');
  });

  it('applies the configured length policy after assembling upstream input', async () => {
    const longOutputs = new Map(outputs);
    longOutputs.set('b', {
      nodeId: 'b',
      label: '长内容',
      content: 'x'.repeat(1200),
    });
    const result = await collectInput(node({
      capabilities: {
        input: {
          enabled: true,
          contentMode: 'full',
          maxInputChars: 1000,
          oversizeStrategy: 'truncate',
        },
      },
    }), ['b'], longOutputs);

    expect(result.text).toHaveLength(1000);
    expect(result.text).toContain('长内容');
  });

  it('reports webpage URL input as unsupported', async () => {
    await expect(collectInput(node({
      dataSourceMode: 'url',
      dataSourceUrl: 'https://example.com',
    }), [], outputs)).rejects.toThrow('暂未支持');
  });
});

describe('requiredToolTagsForNode supplemental inputs', () => {
  it('requires supplemental file readers even when the node has upstream', () => {
    const target = node({
      dataSourceMode: 'file',
      dataSourceFiles: ['report.pdf'],
      capabilities: {
        input: { enabled: true, includeSupplementalSources: true },
      },
    });
    const canvas: Canvas = {
      id: 'canvas',
      name: 'canvas',
      nodes: [
        { id: 'source', position: { x: 0, y: 0 }, data: {} },
        target,
      ],
      edges: [{ id: 'edge', source: 'source', target: target.id }],
    };

    expect(requiredToolTagsForNode(canvas, target)).toContain('pdf-read');
  });
});
