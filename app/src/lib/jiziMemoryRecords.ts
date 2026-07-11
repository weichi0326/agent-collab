export type JiziMemoryKind = 'profile' | 'preference' | 'resource';
export type JiziMemoryStatus = 'active' | 'superseded' | 'conflicted' | 'expired';

export interface JiziMemoryRecord {
  id: string;
  kind: JiziMemoryKind;
  content: string;
  source: {
    sessionId?: string;
    messageId?: string;
    origin: 'conversation' | 'user-edit' | 'migration';
  };
  createdAt: number;
  updatedAt: number;
  confidence: number;
  scope: 'global' | 'project';
  expiresAt?: number;
  status: JiziMemoryStatus;
}

interface LegacyMemory {
  profile: string[];
  preferences: string[];
  resources: string[];
}

export interface MemoryRelationDecision {
  relation: 'append' | 'duplicate' | 'supersede' | 'conflict';
  relationId?: string;
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function migrateLegacyMemory(
  memory: LegacyMemory,
  now: number,
  idFactory: () => string,
): JiziMemoryRecord[] {
  const rows: Array<[JiziMemoryKind, string[]]> = [
    ['profile', memory.profile],
    ['preference', memory.preferences],
    ['resource', memory.resources],
  ];
  const seen = new Set<string>();
  const records: JiziMemoryRecord[] = [];
  for (const [kind, items] of rows) {
    for (const raw of items) {
      const content = normalized(raw);
      const key = `${kind}:${content.toLocaleLowerCase()}`;
      if (!content || seen.has(key)) continue;
      seen.add(key);
      records.push({
        id: idFactory(),
        kind,
        content,
        source: { origin: 'migration' },
        createdAt: now,
        updatedAt: now,
        confidence: 1,
        scope: 'global',
        status: 'active',
      });
    }
  }
  return records;
}

export function activeMemoryRecords(
  records: JiziMemoryRecord[],
  now = Date.now(),
): JiziMemoryRecord[] {
  return records.filter(
    (record) =>
      record.status === 'active' &&
      (record.expiresAt === undefined || record.expiresAt > now),
  );
}

export function resolveMemoryCandidate(
  records: JiziMemoryRecord[],
  candidate: JiziMemoryRecord,
  decision: MemoryRelationDecision,
): JiziMemoryRecord[] {
  if (decision.relation === 'append' || !decision.relationId) {
    return [...records, candidate];
  }
  const target = records.find((record) => record.id === decision.relationId);
  if (!target) return candidate.confidence >= 0.8 ? [...records, candidate] : records;
  if (decision.relation === 'duplicate') {
    return records.map((record) =>
      record.id === target.id
        ? {
            ...record,
            updatedAt: Math.max(record.updatedAt, candidate.updatedAt),
            confidence: Math.max(record.confidence, candidate.confidence),
          }
        : record,
    );
  }
  if (decision.relation === 'supersede') {
    return [
      ...records.map((record) =>
        record.id === target.id
          ? { ...record, status: 'superseded' as const, updatedAt: candidate.updatedAt }
          : record,
      ),
      candidate,
    ];
  }
  return [
    ...records.map((record) =>
      record.id === target.id
        ? { ...record, status: 'conflicted' as const, updatedAt: candidate.updatedAt }
        : record,
    ),
    { ...candidate, status: 'conflicted' },
  ];
}
