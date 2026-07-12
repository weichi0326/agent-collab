import { describe, expect, it } from 'vitest';
import { isJiziDraftDirty, type JiziDraft } from './jiziDraft';

describe('isJiziDraftDirty', () => {
  const baseline: JiziDraft = {
    text: 'original persona',
    sourceName: null,
  };

  it('keeps an unchanged persona draft clean', () => {
    expect(isJiziDraftDirty({ ...baseline }, baseline)).toBe(false);
  });

  it('marks changed persona text dirty', () => {
    expect(
      isJiziDraftDirty({ text: 'imported persona', sourceName: null }, baseline),
    ).toBe(true);
  });

  it('marks a changed source name dirty', () => {
    expect(
      isJiziDraftDirty({ text: baseline.text, sourceName: 'persona.md' }, baseline),
    ).toBe(true);
  });
});
