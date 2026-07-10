// 旧工具标签迁移：读写分离的旧标签 → 合并后的单一多 action 工具标签。
// file-read/file-write/file-delete → file，docx-read/docx-write → docx。
// Python 侧保留旧名作只读别名兜底；此处让持久化的 Agent 定义与画布节点标签也归一。

const TAG_ALIASES: Record<string, string> = {
  'file-read': 'file',
  'file-write': 'file',
  'file-delete': 'file',
  'docx-read': 'docx',
  'docx-write': 'docx',
};

export function normalizeToolTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const mapped = TAG_ALIASES[trimmed] ?? trimmed;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}
