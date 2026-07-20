import { describe, expect, it } from 'vitest';
import {
  effectiveJiziPlacement,
  shouldRenderSideProperties,
} from './jiziLayout';

describe('effectiveJiziPlacement', () => {
  it('returns the stored placement when onboarding is not active', () => {
    expect(effectiveJiziPlacement('side', false)).toBe('side');
    expect(effectiveJiziPlacement('top', false)).toBe('top');
  });

  it('forces top while onboarding is active (protects tutorial targets)', () => {
    expect(effectiveJiziPlacement('side', true)).toBe('top');
    expect(effectiveJiziPlacement('top', true)).toBe('top');
  });
});

describe('shouldRenderSideProperties', () => {
  it('renders properties in side mode only when a node is selected', () => {
    expect(shouldRenderSideProperties(true)).toBe(true);
    expect(shouldRenderSideProperties(false)).toBe(false);
  });
});
