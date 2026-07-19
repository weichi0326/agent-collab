import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_STEPS,
  interactionTargets,
  MODEL_STEPS,
  TUTORIAL_STEPS,
} from './onboardingSteps';

describe('onboarding step catalog', () => {
  it('covers mandatory model setup before optional capabilities', () => {
    expect(MODEL_STEPS.map((step) => step.key)).toEqual([
      'model-entry',
      'model-provider',
      'model-credentials',
      'model-list',
      'model-test',
    ]);
    expect(MODEL_STEPS.at(-1)?.requirement).toBe('validated-model');
    expect(CAPABILITY_STEPS.map((step) => step.section)).toEqual([
      'search',
      'tools',
      'jizi',
    ]);
  });

  it('teaches the complete real canvas workflow in order', () => {
    expect(TUTORIAL_STEPS.map((step) => step.requirement)).toEqual([
      'first-agent',
      'second-agent',
      'connection',
      'inspect-properties',
      'saved-canvas',
      'optional-run',
      'use-jizi',
    ]);
  });

  it('limits each step to the interaction regions it actually needs', () => {
    expect(interactionTargets(MODEL_STEPS[1])).toEqual([
      'model-provider-list',
    ]);
    expect(interactionTargets(TUTORIAL_STEPS[0])).toEqual([
      'tutorial-agent-first',
      'canvas-surface',
    ]);
    expect(interactionTargets(TUTORIAL_STEPS[3])).toEqual([
      'canvas-surface',
      'properties-panel',
    ]);
    expect(interactionTargets(TUTORIAL_STEPS[6])).toEqual([
      'jizi-entry',
      'jizi-panel',
    ]);
  });
});
