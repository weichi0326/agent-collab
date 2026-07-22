import { describe, expect, it } from 'vitest';
import { inferModelCaps, mergeInferredModelCaps } from './modelCapabilityInfer';

describe('model capability inference', () => {
  it('infers capabilities only when no saved value exists', () => {
    expect(mergeInferredModelCaps(undefined, 'gpt-5-vision')).toEqual(
      inferModelCaps('gpt-5-vision'),
    );
  });

  it('preserves explicit false values from the user', () => {
    const current = { longContext: false, vision: false, audio: false };
    expect(mergeInferredModelCaps(current, 'gpt-5-vision')).toEqual(current);
  });
});
