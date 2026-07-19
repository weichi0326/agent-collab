import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

const [{ useAgentStore }, { useCanvasStore }, { useModelStore }, tutorial] =
  await Promise.all([
    import('../stores/agentStore'),
    import('../stores/canvasStore'),
    import('../stores/modelStore'),
    import('./onboardingTutorial'),
  ]);

beforeEach(() => {
  memory.clear();
  useAgentStore.setState({ agents: [] });
  useCanvasStore.setState({
    canvases: [],
    activeId: '',
    savedCanvases: [],
    runHistory: [],
    history: {},
  });
  useModelStore.setState({
    configs: [
      {
        id: 'provider-1',
        providerId: 'openai',
        name: 'Primary',
        apiKey: 'key',
        baseURL: 'https://example.com/v1',
        starred: false,
        models: [
          {
            id: 'model-a',
            enabled: true,
            caps: { longContext: false, vision: false, audio: false },
          },
        ],
        test: { status: 'ok-low' },
      },
    ],
  });
});

describe('tutorial resources', () => {
  it('creates one resumable canvas and two model-backed tutorial agents', () => {
    const created = tutorial.ensureTutorialResources(null);
    expect(created).not.toBeNull();
    expect(useCanvasStore.getState().canvases).toHaveLength(1);
    expect(useAgentStore.getState().agents).toHaveLength(2);
    expect(
      useAgentStore.getState().agents.every(
        (agent) =>
          agent.modelRef?.configId === 'provider-1' &&
          agent.modelRef.modelId === 'model-a',
      ),
    ).toBe(true);

    expect(tutorial.ensureTutorialResources(created)).toEqual(created);
    expect(useCanvasStore.getState().canvases).toHaveLength(1);
    expect(useAgentStore.getState().agents).toHaveLength(2);
  });

  it('removes the temporary canvas, saved copy and tutorial agents', () => {
    const created = tutorial.ensureTutorialResources(null)!;
    useCanvasStore.getState().saveActive('新手示例画布');

    tutorial.removeTutorialResources(created);

    expect(useCanvasStore.getState().canvases).toHaveLength(0);
    expect(useCanvasStore.getState().savedCanvases).toHaveLength(0);
    expect(useAgentStore.getState().agents).toHaveLength(0);
  });

  it('uses an enabled model only from a provider that passed testing', () => {
    useModelStore.setState({
      configs: [
        {
          id: 'provider-failed',
          providerId: 'openai',
          name: 'Failed provider',
          apiKey: 'key',
          baseURL: 'https://failed.example.com/v1',
          starred: false,
          models: [
            {
              id: 'model-failed',
              enabled: true,
              caps: { longContext: false, vision: false, audio: false },
            },
          ],
          test: { status: 'fail' },
        },
        {
          id: 'provider-success',
          providerId: 'openai',
          name: 'Validated provider',
          apiKey: 'key',
          baseURL: 'https://success.example.com/v1',
          starred: false,
          models: [
            {
              id: 'model-success',
              enabled: true,
              caps: { longContext: false, vision: false, audio: false },
            },
          ],
          test: { status: 'ok-high' },
        },
      ],
    });

    tutorial.ensureTutorialResources(null);

    expect(
      useAgentStore.getState().agents.every(
        (agent) =>
          agent.modelRef?.configId === 'provider-success' &&
          agent.modelRef.modelId === 'model-success',
      ),
    ).toBe(true);
  });
});
