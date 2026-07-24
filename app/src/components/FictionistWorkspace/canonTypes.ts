import type { FictionCanonEntryType } from '../../features/fictionist/domain';

export const CANON_ENTRY_TYPE_LABELS: Record<FictionCanonEntryType, string> = {
  character: '人物',
  location: '地点',
  organization: '组织',
  item: '物品',
  rule: '世界规则',
};

export const CANON_ENTRY_TYPE_OPTIONS = Object.entries(CANON_ENTRY_TYPE_LABELS).map(
  ([value, label]) => ({ value: value as FictionCanonEntryType, label }),
);
