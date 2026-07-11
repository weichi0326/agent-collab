import { describe, expect, it } from 'vitest';
import {
  activeMemoryRecords,
  migrateLegacyMemory,
  resolveMemoryCandidate,
} from './jiziMemoryRecords';

describe('Jizi memory records', () => {
  it('migrates legacy strings without losing categories', () => {
    let id = 0;
    const records = migrateLegacyMemory(
      { profile: ['非技术用户'], preferences: ['回答简洁'], resources: ['项目 A'] },
      100,
      () => `memory-${++id}`,
    );
    expect(records.map((item) => [item.kind, item.content, item.source.origin])).toEqual([
      ['profile', '非技术用户', 'migration'],
      ['preference', '回答简洁', 'migration'],
      ['resource', '项目 A', 'migration'],
    ]);
  });

  it('supersedes explicit corrections and isolates conflicts', () => {
    const old = migrateLegacyMemory(
      { profile: [], preferences: ['回答详细'], resources: [] }, 100, () => 'old',
    );
    const superseded = resolveMemoryCandidate(old, {
      id: 'new', kind: 'preference', content: '回答简洁', confidence: 1,
      scope: 'global', source: { origin: 'conversation' }, createdAt: 200, updatedAt: 200,
      status: 'active',
    }, { relation: 'supersede', relationId: 'old' });
    expect(superseded.find((item) => item.id === 'old')?.status).toBe('superseded');
    expect(activeMemoryRecords(superseded, 300).map((item) => item.id)).toEqual(['new']);

    const conflicted = resolveMemoryCandidate(old, {
      id: 'other', kind: 'preference', content: '回答简洁', confidence: 0.6,
      scope: 'global', source: { origin: 'conversation' }, createdAt: 200, updatedAt: 200,
      status: 'active',
    }, { relation: 'conflict', relationId: 'old' });
    expect(activeMemoryRecords(conflicted, 300)).toEqual([]);
  });

  it('excludes expired records', () => {
    const records = migrateLegacyMemory(
      { profile: [], preferences: ['临时偏好'], resources: [] }, 100, () => 'expiring',
    );
    records[0].expiresAt = 150;
    expect(activeMemoryRecords(records, 200)).toEqual([]);
  });
});
