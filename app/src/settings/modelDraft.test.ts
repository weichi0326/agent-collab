import { describe, expect, it } from 'vitest';
import {
  canApplyModelSave,
  isModelDraftDirty,
  providerDraft,
} from './modelDraft';

const config = {
  name: 'OpenAI',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'secret',
};

describe('model provider drafts', () => {
  it('does not mark a freshly selected provider dirty', () => {
    expect(isModelDraftDirty(providerDraft(config), providerDraft(config))).toBe(
      false,
    );
  });

  it('marks name, BaseURL, or API key edits dirty', () => {
    const baseline = providerDraft(config);

    expect(isModelDraftDirty({ ...baseline, name: 'Renamed' }, baseline)).toBe(
      true,
    );
    expect(
      isModelDraftDirty(
        { ...baseline, baseURL: 'https://example.com/v1' },
        baseline,
      ),
    ).toBe(true);
    expect(
      isModelDraftDirty({ ...baseline, apiKey: 'changed' }, baseline),
    ).toBe(true);
  });

  it('ignores a save result after unmount or a newer save request', () => {
    expect(canApplyModelSave(true, 2, 2)).toBe(true);
    expect(canApplyModelSave(false, 2, 2)).toBe(false);
    expect(canApplyModelSave(true, 1, 2)).toBe(false);
  });
});
