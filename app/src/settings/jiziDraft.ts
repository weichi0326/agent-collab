export interface JiziDraft {
  text: string;
  sourceName: string | null;
}

export function isJiziDraftDirty(
  draft: JiziDraft,
  baseline: JiziDraft,
): boolean {
  return draft.text !== baseline.text || draft.sourceName !== baseline.sourceName;
}
