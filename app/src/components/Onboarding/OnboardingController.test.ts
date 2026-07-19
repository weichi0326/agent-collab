import { describe, expect, it } from 'vitest';
import {
  canAdvanceTutorialStep,
  onboardingSurface,
} from './OnboardingController';

describe('OnboardingController surface selection', () => {
  it('shows the welcome surface before guided steps', () => {
    expect(onboardingSurface('pending', 'welcome')).toBe('welcome');
  });

  it('shows guided tours for setup and tutorial stages', () => {
    expect(onboardingSurface('active', 'models')).toBe('tour');
    expect(onboardingSurface('active', 'capabilities')).toBe('tour');
    expect(onboardingSurface('active', 'tutorial')).toBe('tour');
  });

  it('shows completion separately and hides finished onboarding', () => {
    expect(onboardingSurface('active', 'finish')).toBe('finish');
    expect(onboardingSurface('completed', 'finish')).toBe('hidden');
    expect(onboardingSurface('skipped', 'models')).toBe('hidden');
  });

  it('makes running optional and requires opening Jizi before completion', () => {
    expect(canAdvanceTutorialStep(5, false)).toBe(true);
    expect(canAdvanceTutorialStep(6, false)).toBe(false);
    expect(canAdvanceTutorialStep(6, true)).toBe(true);
  });
});
