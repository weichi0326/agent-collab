import { describe, expect, it } from 'vitest';
import {
  buildJiziProjectObservation,
  formatJiziObservation,
  type JiziProjectObservationInput,
} from './jiziProjectObservation';

function fixture(): JiziProjectObservationInput {
  return {
    activeCanvasId: 'canvas-1',
    canvases: [
      {
        id: 'canvas-1',
        name: '数据处理',
        nodes: [
          {
            id: 'n1',
            type: 'agent',
            position: { x: 10, y: 20 },
            data: {
              label: '读取数据',
              agentId: 'agent-1',
              systemPrompt: '读取输入文件',
              toolTags: ['file'],
              modelRef: { configId: 'cfg-1', modelId: 'model-1' },
              outputFormat: 'markdown',
              runState: { status: 'success', message: '运行成功' },
              lastOutput: {
                folderName: 'run-1',
                runAt: '2026-07-11T10:00:00Z',
                items: [{ name: 'result.md', path: 'output/result.md', summary: '读取完成' }],
              },
            },
          },
          {
            id: 'n2',
            type: 'agent',
            position: { x: 200, y: 20 },
            data: {
              label: '汇总',
              runState: { status: 'failed', message: 'timeout' },
            },
          },
        ],
        edges: [{ id: 'edge-1', source: 'n1', target: 'n2' }],
        runState: { status: 'failed', message: '节点汇总失败' },
      },
    ],
    agents: [
      {
        id: 'agent-1',
        name: '读取助手',
        description: '读取项目数据',
        systemPrompt: '只读取用户指定的文件',
        toolTags: ['file'],
        modelRef: { configId: 'cfg-1', modelId: 'model-1' },
        version: 1,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    modelConfigs: [
      {
        id: 'cfg-1',
        providerId: 'openai',
        name: '主要模型',
        apiKey: 'secret-key-must-not-leak',
        baseURL: 'https://example.test/v1',
        starred: false,
        models: [
          {
            id: 'model-1',
            label: '主模型',
            enabled: true,
            caps: { longContext: true, vision: false, audio: false },
          },
        ],
        test: { status: 'ok-high' },
      },
    ],
    selectedMasterModel: { configId: 'cfg-1', modelId: 'model-1' },
    tools: [
      {
        name: 'file',
        module: 'tools.file',
        description: '文件读写',
        tags: ['file'],
        dependencies: [],
        source: 'builtin',
        builtin: true,
        internal: false,
        createdAt: null,
        loadError: null,
      },
    ],
    serviceStatus: 'running',
    searchProviderIds: ['serper'],
    enabledSkillIds: ['workflow-planner'],
  };
}

describe('Jizi project observation', () => {
  it('retains stable topology and run evidence', () => {
    const observation = buildJiziProjectObservation(fixture());

    expect(observation.activeCanvas?.edges[0]).toEqual({
      id: 'edge-1',
      sourceId: 'n1',
      targetId: 'n2',
    });
    expect(observation.activeCanvas?.nodes[1].run).toEqual({
      status: 'failed',
      message: 'timeout',
      error: 'timeout',
    });
    expect(observation.activeCanvas?.nodes[0].lastOutput?.items[0]).toMatchObject({
      name: 'result.md',
      summary: '读取完成',
    });
  });

  it('formats configuration and connections without leaking secrets', () => {
    const formatted = formatJiziObservation(
      buildJiziProjectObservation(fixture()),
    );

    expect(formatted).toContain('n1 -> n2');
    expect(formatted).toContain('汇总 [n2]');
    expect(formatted).toContain('失败证据：timeout');
    expect(formatted).toContain('读取助手 [agent-1]');
    expect(formatted).not.toContain('secret-key-must-not-leak');
    expect(formatted).not.toContain('apiKey');
  });

  it('respects the total formatting budget', () => {
    const input = fixture();
    input.agents[0].systemPrompt = '长提示词'.repeat(4_000);

    const formatted = formatJiziObservation(
      buildJiziProjectObservation(input),
      1_000,
    );

    expect(formatted.length).toBeLessThanOrEqual(1_000);
    expect(formatted).toContain('当前画布');
  });
});
