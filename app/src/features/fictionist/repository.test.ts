import { beforeEach, describe, expect, it } from 'vitest';
import {
  countFictionWords,
  isSafeFictionistId,
  type FictionistIndex,
} from './domain';
import {
  FICTIONIST_INDEX_KEY,
  FICTIONIST_RECOVERY_KEY,
  MAX_CHAPTER_CONTENT_BYTES,
  chapterStorageKey,
  createFictionistRepository,
  type FictionistStorage,
} from './repository';

class MemoryStorage implements FictionistStorage {
  readonly values = new Map<string, string>();
  failNextKey: string | null = null;

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failNextKey === key) {
      this.failNextKey = null;
      throw new Error(`write failed: ${key}`);
    }
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createRepository(storage: MemoryStorage) {
  let sequence = 0;
  return createFictionistRepository(storage, {
    now: () => '2026-07-23T00:00:00.000Z',
    createId: (prefix) => `${prefix}-test-${++sequence}`,
  });
}

describe('fictionist domain rules', () => {
  it('accepts only bounded ASCII ids', () => {
    expect(isSafeFictionistId('chapter-abc-123')).toBe(true);
    expect(isSafeFictionistId('../chapter')).toBe(false);
    expect(isSafeFictionistId('章节-1')).toBe(false);
    expect(isSafeFictionistId(`chapter-${'a'.repeat(80)}`)).toBe(false);
  });

  it('derives chapter storage keys and rejects unsafe ids', () => {
    expect(chapterStorageKey('chapter-abc-123')).toBe(
      'multi-agent-fictionist-chapter-chapter-abc-123',
    );
    expect(() => chapterStorageKey('../chapter')).toThrow('章节 ID');
  });

  it('counts non-whitespace Unicode characters', () => {
    expect(countFictionWords('雾 港\n来信')).toBe(4);
    expect(countFictionWords('A 😀 B')).toBe(3);
  });
});

describe('fictionist repository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('initializes the approved sample library and separate chapter bodies once', async () => {
    const repository = createRepository(storage);

    const index = await repository.loadOrInitialize();

    expect(index.schemaVersion).toBe(1);
    expect(Object.keys(index.projects)).toHaveLength(3);
    expect(index.activeProjectId).toBe('mist-harbor');
    expect(index.activeChapterId).toBe('chapter-3');
    expect(await repository.readChapter('chapter-3')).toContain('七号泊位的铁门');
    expect(storage.values.has(FICTIONIST_INDEX_KEY)).toBe(true);
    expect(JSON.parse(storage.values.get(FICTIONIST_INDEX_KEY) ?? '{}')).not.toHaveProperty(
      'chapterContents',
    );

    const storedIndex = storage.values.get(FICTIONIST_INDEX_KEY);
    await repository.loadOrInitialize();
    expect(storage.values.get(FICTIONIST_INDEX_KEY)).toBe(storedIndex);
  });

  it('creates a persistent project with its first empty volume', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    const updated = await repository.createProject(index, {
      title: '群星沉入海底',
      genre: '长篇奇幻',
    });

    const created = Object.values(updated.projects).find(
      (project) => project.title === '群星沉入海底',
    );
    expect(created).toMatchObject({ genre: '长篇奇幻', status: 'paused' });
    expect(created?.volumeIds).toHaveLength(1);
    expect(updated.volumes[created?.volumeIds[0] ?? '']?.chapterIds).toEqual([]);
    expect(JSON.parse(storage.values.get(FICTIONIST_INDEX_KEY) ?? '{}').projects).toHaveProperty(
      created?.id ?? '',
    );
  });

  it('creates a chapter through a recoverable body and index transaction', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    const result = await repository.createChapter(index, {
      projectId: 'mist-harbor',
      title: '潮汐之后',
    });

    expect(result.chapter.title).toBe('潮汐之后');
    expect(result.chapter.revision).toBe(0);
    expect(result.index.volumes['mist-harbor-volume-1'].chapterIds.at(-1)).toBe(
      result.chapter.id,
    );
    expect(await repository.readChapter(result.chapter.id)).toBe('');
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('saves chapter content and updates metadata only after storage succeeds', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    const updated = await repository.saveChapter(
      index,
      'chapter-3',
      '雾散了。\n\n船仍未靠岸。',
    );

    expect(await repository.readChapter('chapter-3')).toBe('雾散了。\n\n船仍未靠岸。');
    expect(updated.chapters['chapter-3']).toMatchObject({
      wordCount: 10,
      revision: 2,
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('rejects chapter bodies above the explicit frontend limit', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const oversized = 'a'.repeat(MAX_CHAPTER_CONTENT_BYTES + 1);

    await expect(repository.saveChapter(index, 'chapter-3', oversized)).rejects.toThrow(
      '8 MiB',
    );
  });

  it('replays an interrupted body and index write on the next load', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    storage.failNextKey = FICTIONIST_INDEX_KEY;

    await expect(
      repository.saveChapter(index, 'chapter-3', '中断后恢复的正文'),
    ).rejects.toThrow('write failed');
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(true);

    const recoveredRepository = createRepository(storage);
    const recovered = await recoveredRepository.loadOrInitialize();

    expect(await recoveredRepository.readChapter('chapter-3')).toBe('中断后恢复的正文');
    expect(recovered.chapters['chapter-3'].wordCount).toBe(8);
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('rejects unknown chapter ids without writing recovery data', async () => {
    const repository = createRepository(storage);
    const index: FictionistIndex = await repository.loadOrInitialize();

    await expect(
      repository.saveChapter(index, 'chapter-missing', '正文'),
    ).rejects.toThrow('章节不存在');
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });
});
