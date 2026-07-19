import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

const { useOnboardingStore } = await import('./onboardingStore');

beforeEach(() => {
  memory.clear();
  useOnboardingStore.getState().restart('welcome');
});

describe('onboarding store', () => {
  it('does not allow skipping before the welcome sequence is complete', () => {
    useOnboardingStore.getState().skip();
    expect(useOnboardingStore.getState().status).toBe('pending');

    useOnboardingStore.getState().nextWelcome();
    useOnboardingStore.getState().nextWelcome();
    useOnboardingStore.getState().nextWelcome();
    expect(useOnboardingStore.getState()).toMatchObject({
      status: 'active',
      stage: 'models',
    });

    useOnboardingStore.getState().skip();
    expect(useOnboardingStore.getState().status).toBe('skipped');
  });

  it('restarts a selected chapter without retaining tutorial resources', () => {
    useOnboardingStore.setState({
      tutorialCanvasId: 'canvas-old',
      tutorialAgentIds: ['agent-a', 'agent-b'],
      tutorialStep: 5,
    });

    useOnboardingStore.getState().restart('models');

    expect(useOnboardingStore.getState()).toMatchObject({
      status: 'active',
      stage: 'models',
      modelStep: 0,
      tutorialStep: 0,
      tutorialCanvasId: null,
      tutorialAgentIds: null,
    });
  });

  it.each([
    ['skip', 'skipped'],
    ['complete', 'completed'],
  ] as const)('%s clears temporary tutorial resource references', (action, status) => {
    useOnboardingStore.setState({
      status: 'active',
      stage: 'tutorial',
      tutorialCanvasId: 'canvas-old',
      tutorialAgentIds: ['agent-a', 'agent-b'],
    });

    useOnboardingStore.getState()[action]();

    expect(useOnboardingStore.getState()).toMatchObject({
      status,
      tutorialCanvasId: null,
      tutorialAgentIds: null,
    });
  });
});
