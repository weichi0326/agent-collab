import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../stores/modelStore';
import type { Canvas } from '../stores/canvas/types';
import {
  advanceWelcome,
  canSkipOnboarding,
  createInitialOnboardingState,
  canAdvanceModelSetupStep,
  hasValidatedModel,
  tutorialMilestones,
} from './onboardingState';

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    providerId: 'openai',
    name: 'Primary',
    apiKey: 'key',
    baseURL: 'https://example.com/v1',
    starred: false,
    models: [],
    test: { status: 'idle' },
    ...overrides,
  };
}

describe('onboarding state', () => {
  it('requires all three welcome pages before model setup begins', () => {
    const initial = createInitialOnboardingState();
    expect(initial).toMatchObject({
      status: 'pending',
      stage: 'welcome',
      welcomePage: 0,
    });
    expect(canSkipOnboarding(initial)).toBe(false);

    const second = advanceWelcome(initial);
    const third = advanceWelcome(second);
    const setup = advanceWelcome(third);

    expect(second.welcomePage).toBe(1);
    expect(third.welcomePage).toBe(2);
    expect(setup).toMatchObject({ status: 'active', stage: 'models' });
    expect(canSkipOnboarding(setup)).toBe(true);
  });

  it('accepts only a successful provider with an enabled model', () => {
    expect(
      hasValidatedModel([
        provider({
          models: [
            {
              id: 'model-a',
              enabled: true,
              caps: { longContext: false, vision: false, audio: false },
            },
          ],
          test: { status: 'ok-low' },
        }),
      ]),
    ).toBe(true);

    expect(
      hasValidatedModel([
        provider({
          models: [
            {
              id: 'model-a',
              enabled: false,
              caps: { longContext: false, vision: false, audio: false },
            },
          ],
          test: { status: 'ok-high' },
        }),
      ]),
    ).toBe(false);
    expect(
      hasValidatedModel([
        provider({
          models: [
            {
              id: 'model-a',
              enabled: true,
              caps: { longContext: false, vision: false, audio: false },
            },
          ],
          test: { status: 'fail' },
        }),
      ]),
    ).toBe(false);
  });

  it('does not let another saved provider unlock the active model setup flow', () => {
    const configs = [
      provider({
        id: 'existing-provider',
        models: [
          {
            id: 'existing-model',
            enabled: true,
            caps: { longContext: false, vision: false, audio: false },
          },
        ],
        test: { status: 'ok-low' },
      }),
    ];

    expect(
      canAdvanceModelSetupStep(1, configs, {
        credentialsVisible: false,
        credentialsConfigId: null,
        modelListConfigId: null,
      }),
    ).toBe(false);
    expect(
      canAdvanceModelSetupStep(2, configs, {
        credentialsVisible: true,
        credentialsConfigId: null,
        modelListConfigId: null,
      }),
    ).toBe(false);
    expect(
      canAdvanceModelSetupStep(3, configs, {
        credentialsVisible: true,
        credentialsConfigId: 'existing-provider',
        modelListConfigId: null,
      }),
    ).toBe(false);
    expect(
      canAdvanceModelSetupStep(4, configs, {
        credentialsVisible: true,
        credentialsConfigId: 'existing-provider',
        modelListConfigId: 'existing-provider',
      }),
    ).toBe(true);
  });

  it('derives tutorial progress from real canvas data', () => {
    const canvas: Canvas = {
      id: 'tutorial-canvas',
      name: '新手示例画布',
      savedId: 'saved-tutorial',
      nodes: [
        { id: 'node-a', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: 'agent-a' } },
        { id: 'node-b', type: 'agent', position: { x: 240, y: 0 }, data: { agentId: 'agent-b' } },
      ],
      edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
      runState: { status: 'success' },
    };

    expect(tutorialMilestones(canvas, ['agent-a', 'agent-b'])).toEqual({
      firstPlaced: true,
      secondPlaced: true,
      connected: true,
      saved: true,
      runSucceeded: true,
    });
  });
});
