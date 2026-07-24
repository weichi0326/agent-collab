import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { AgentNodeData, Canvas } from '../../stores/canvasStore';
import { persistOutput } from './outputWriter';

const writes = new Map<string, string>();
const localStorageMemory = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStorageMemory.get(key) ?? null,
  setItem: (key: string, value: string) => localStorageMemory.set(key, value),
  removeItem: (key: string) => localStorageMemory.delete(key),
});

vi.mock('../pythonClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pythonClient')>();
  return {
    ...actual,
    executeTool: vi.fn(async (_toolName: string, params: Record<string, unknown>) => {
      if (params.action === 'write' && typeof params.path === 'string') {
        writes.set(params.path, String(params.content ?? ''));
        return { ok: true, result: { path: params.path } };
      }
      return { ok: true, result: {} };
    }),
  };
});

function canvas(): Canvas {
  return {
    id: 'canvas-1',
    name: '测试画布',
    nodes: [],
    edges: [],
    runState: { status: 'running', startedAt: '2026-07-21 00:00:00' },
  };
}

function node(data: Partial<AgentNodeData> = {}): Node<AgentNodeData> {
  return {
    id: 'node-1',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { label: '剧情规划', outputFormat: 'markdown', ...data },
  };
}

beforeEach(() => {
  writes.clear();
  localStorageMemory.clear();
});

describe('persistOutput referenced envelope', () => {
  it('writes plain text without adding markdown syntax', async () => {
    const reply = '雨水敲打着阁楼窗户。\n\n匿名来信从门缝滑了进来。';

    const output = await persistOutput(canvas(), node({
      outputFormat: 'txt',
      outputSchemaText: '{"type":"object","required":["title"]}',
    }), reply);

    expect(output.path).toMatch(/\.txt$/u);
    expect(output.content).toBe(reply);
    expect(writes.get(output.path!)).toBe(reply);
    expect(output.structuredData).toMatchObject({
      title: '剧情规划',
      outputFormat: 'txt',
      contentRef: { kind: 'artifact', path: output.path },
    });
  });

  it('stores markdown body only in the user artifact and references it from data.json', async () => {
    const reply = '# 剧情规划\n\n第一幕：主角收到旧信。\n第二幕：城市记忆被改写。';

    const output = await persistOutput(
      canvas(),
      node({ resultRole: 'fictionist.chapter-draft' }),
      reply,
    );

    expect(output.content).toBe(reply);
    expect(output.structuredData).toMatchObject({
      title: '剧情规划',
      outputFormat: 'markdown',
      contentRef: { kind: 'artifact', path: output.path },
    });
    expect(output.summary).toContain('剧情规划');

    const dataText = writes.get(output.dataPath!);
    expect(dataText).toBeTruthy();
    const envelope = JSON.parse(dataText!);
    expect(envelope).toMatchObject({
      version: '2.0',
      kind: 'agent-node-output',
      node: { resultRole: 'fictionist.chapter-draft' },
      artifact: { path: output.path },
      data: { contentRef: { kind: 'artifact', path: output.path } },
    });
    expect(output.resultRole).toBe('fictionist.chapter-draft');
    expect(envelope.rawReply).toBeUndefined();
    expect(envelope.data.text).toBeUndefined();
    expect(envelope.data.paragraphs).toBeUndefined();
    expect(dataText).not.toContain('第一幕：主角收到旧信。');

    const artifactText = writes.get(output.path!);
    expect(artifactText).toContain('第一幕：主角收到旧信。');
  });
});
