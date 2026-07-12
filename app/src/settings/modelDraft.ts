export interface ModelProviderDraft {
  name: string;
  baseURL: string;
  apiKey: string;
}

export function providerDraft(config: ModelProviderDraft): ModelProviderDraft {
  return {
    name: config.name,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  };
}

export function isModelDraftDirty(
  draft: ModelProviderDraft,
  baseline: ModelProviderDraft,
): boolean {
  return (
    draft.name !== baseline.name ||
    draft.baseURL !== baseline.baseURL ||
    draft.apiKey !== baseline.apiKey
  );
}

export function canApplyModelSave(
  mounted: boolean,
  requestRevision: number,
  currentRevision: number,
): boolean {
  return mounted && requestRevision === currentRevision;
}
