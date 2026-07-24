import { beforeEach, describe, expect, it } from 'vitest';
import {
  countFictionWords,
  isSafeFictionistId,
  type FictionistIndex,
} from './domain';
import { createDemoFictionistData } from './fixtures';
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
  failNextRemoveKey: string | null = null;

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
    if (this.failNextRemoveKey === key) {
      this.failNextRemoveKey = null;
      throw new Error(`remove failed: ${key}`);
    }
    this.values.delete(key);
  }
}

function createRepository(storage: MemoryStorage) {
  let sequence = 0;
  return createFictionistRepository(storage, {
    now: () => '2026-07-23T00:00:00.000Z',
    createId: (prefix) => `${prefix}-test-${++sequence}`,
    createCanonId: () => `canon-test-${++sequence}`,
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

  it('migrates legacy demo indexes without canon entries once', async () => {
    const repository = createRepository(storage);
    const seed = createDemoFictionistData().index;
    const { canonEntries: _canonEntries, timelineEvents: _timelineEvents, ...legacyIndex } = seed;
    await storage.setItem(FICTIONIST_INDEX_KEY, JSON.stringify(legacyIndex));

    const index = await repository.loadOrInitialize();

    expect(Object.values(index.canonEntries)).toHaveLength(6);
    expect(Object.values(index.canonEntries).every((entry) => entry.projectId === 'mist-harbor')).toBe(true);
    expect(index.timelineEvents).toEqual({});
  });

  it('persists canon entry CRUD and removes entries with their project', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const created = await repository.createCanonEntry(index, {
      projectId: 'mist-harbor',
      type: 'rule',
      name: '潮雾规则',
      summary: '停电时雾港的机械钟会同时停止。',
      content: '所有登记在册的机械钟都会停在凌晨两点十四分。',
    });

    expect(created.entry.projectId).toBe('mist-harbor');
    expect(created.index.projects['mist-harbor'].canonEntryCount).toBe(7);
    expect((await repository.loadOrInitialize()).canonEntries[created.entry.id].name).toBe('潮雾规则');

    const updated = await repository.updateCanonEntry(created.index, created.entry.id, {
      type: 'rule',
      name: '潮雾规则（修订）',
      summary: '停电时机械钟会同时停止。',
      content: '所有登记在册的机械钟都会停在凌晨两点十四分，旧海关钟塔除外。',
    });
    expect(updated.canonEntries[created.entry.id].name).toBe('潮雾规则（修订）');

    const afterDelete = await repository.deleteCanonEntry(updated, created.entry.id);
    expect(afterDelete.canonEntries[created.entry.id]).toBeUndefined();
    expect(afterDelete.projects['mist-harbor'].canonEntryCount).toBe(6);

    const afterProjectDelete = await repository.deleteProject(afterDelete, 'mist-harbor');
    expect(Object.values(afterProjectDelete.canonEntries).every((entry) => entry.projectId !== 'mist-harbor')).toBe(true);
  });

  it('persists timeline event CRUD and validates chapter ownership', async () => {
    const repository = createRepository(storage);
    let index = await repository.loadOrInitialize();
    const created = await repository.createTimelineEvent(index, {
      projectId: 'mist-harbor',
      timeLabel: '明天 · 08:00',
      title: '港区重新开放',
      description: '值夜人确认七号泊位的封锁暂时解除。',
      kind: 'confirmed',
      sourceChapterId: 'chapter-3',
    });

    expect(created.event).toMatchObject({
      projectId: 'mist-harbor',
      title: '港区重新开放',
      sourceChapterId: 'chapter-3',
      order: 5,
    });
    expect((await repository.loadOrInitialize()).timelineEvents[created.event.id]).toEqual(
      created.event,
    );

    index = await repository.updateTimelineEvent(created.index, created.event.id, {
      timeLabel: '明天 · 09:30',
      title: '港区再次封锁',
      description: '封锁令重新生效。',
      kind: 'chapter',
      sourceChapterId: undefined,
    });
    expect(index.timelineEvents[created.event.id]).toMatchObject({
      title: '港区再次封锁',
      kind: 'chapter',
      sourceChapterId: undefined,
    });

    await expect(repository.createTimelineEvent(index, {
      projectId: 'mist-harbor',
      timeLabel: '稍后',
      title: '错误来源',
      description: '',
      kind: 'background',
      sourceChapterId: 'north-window-chapter-1',
    })).rejects.toThrow('时间线章节来源无效');

    index = await repository.deleteTimelineEvent(index, created.event.id);
    expect(index.timelineEvents[created.event.id]).toBeUndefined();
    expect((await repository.loadOrInitialize()).timelineEvents[created.event.id]).toBeUndefined();
  });

  it('creates a persistent project with its first empty volume', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    const updated = await repository.createProject(index, {
      title: '群星沉入海底',
      genre: '长篇奇幻',
      coverImage: 'data:image/png;base64,iVBORw0KGgo=',
    });

    const created = Object.values(updated.projects).find(
      (project) => project.title === '群星沉入海底',
    );
    expect(created).toMatchObject({
      genre: '长篇奇幻',
      status: 'paused',
      coverImage: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(created?.volumeIds).toHaveLength(1);
    expect(updated.volumes[created?.volumeIds[0] ?? '']?.chapterIds).toEqual([]);
    expect(JSON.parse(storage.values.get(FICTIONIST_INDEX_KEY) ?? '{}').projects).toHaveProperty(
      created?.id ?? '',
    );
  });

  it('renames a project without changing its chapters', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const chapterIds = index.volumes['mist-harbor-volume-1'].chapterIds;

    const updated = await repository.renameProject(index, 'mist-harbor', '雾港余烬');

    expect(updated.projects['mist-harbor'].title).toBe('雾港余烬');
    expect(updated.volumes['mist-harbor-volume-1'].chapterIds).toEqual(chapterIds);
    expect(JSON.parse(storage.values.get(FICTIONIST_INDEX_KEY) ?? '{}')
      .projects['mist-harbor'].title).toBe('雾港余烬');
  });

  it('updates a project category, status and custom cover', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const coverImage = 'data:image/png;base64,iVBORw0KGgo=';

    const updated = await repository.updateProject(index, 'mist-harbor', {
      title: '雾港来信',
      genre: '都市悬疑',
      status: 'archived',
      coverImage,
    });

    expect(updated.projects['mist-harbor']).toMatchObject({
      title: '雾港来信',
      genre: '都市悬疑',
      status: 'archived',
      coverImage,
    });
    expect(JSON.parse(storage.values.get(FICTIONIST_INDEX_KEY) ?? '{}')
      .projects['mist-harbor'].coverImage).toBe(coverImage);
  });

  it('persists a structured outline and removes entries for deleted chapters and volumes', async () => {
    const repository = createRepository(storage);
    let index = await repository.loadOrInitialize();

    index = await repository.updateProjectOutline(index, 'mist-harbor', {
      premise: '一封蓝墨水来信把记者引向停摆的港口。',
      theme: '记忆与真相',
      protagonistGoal: '查清失踪船只的真相',
      coreConflict: '追查真相会威胁港区现有秩序',
      endingDirection: '守钟人的身份最终公开',
      details: '第一卷寻找航道图，第二卷公开守钟人的身份。',
      volumes: {
        'mist-harbor-volume-1': {
          summary: '主角进入雾港并找到第一组证据。',
          objective: '建立谜团',
          turningPoint: '发现航道图被篡改',
          climax: '进入旧海关钟塔',
          details: '以七号泊位为入口，逐步逼近钟塔。',
        },
      },
      chapters: {
        'chapter-3': {
          summary: '林砚进入七号泊位。',
          objective: '找到钟塔入口',
          pointOfView: '林砚',
          conflict: '值夜人失踪',
          keyEvents: '发现铁门没有上锁',
          clues: '第二杯热茶',
          hook: '钟声再次响起',
          details: '场景一调查泊位，场景二追踪钟声。',
        },
      },
    });

    expect(index.projects['mist-harbor'].outline).toMatchObject({
      premise: '一封蓝墨水来信把记者引向停摆的港口。',
      details: '第一卷寻找航道图，第二卷公开守钟人的身份。',
      volumes: { 'mist-harbor-volume-1': { objective: '建立谜团', details: '以七号泊位为入口，逐步逼近钟塔。' } },
      chapters: { 'chapter-3': { pointOfView: '林砚', details: '场景一调查泊位，场景二追踪钟声。' } },
    });
    expect(JSON.parse(storage.values.get(FICTIONIST_INDEX_KEY) ?? '{}')
      .projects['mist-harbor'].outline.chapters['chapter-3'].hook).toBe('钟声再次响起');

    index = await repository.deleteChapter(index, 'chapter-3');
    expect(index.projects['mist-harbor'].outline?.chapters).not.toHaveProperty('chapter-3');

    const volumeResult = await repository.createVolume(index, {
      projectId: 'mist-harbor',
      title: '第二卷',
    });
    const chapterResult = await repository.createChapter(volumeResult.index, {
      projectId: 'mist-harbor',
      volumeId: volumeResult.volume.id,
      title: '回声',
    });
    index = await repository.updateProjectOutline(chapterResult.index, 'mist-harbor', {
      premise: '',
      theme: '',
      protagonistGoal: '',
      coreConflict: '',
      endingDirection: '',
      volumes: {
        [volumeResult.volume.id]: {
          summary: '第二阶段', objective: '', turningPoint: '', climax: '',
        },
      },
      chapters: {
        [chapterResult.chapter.id]: {
          summary: '回声出现',
          objective: '',
          pointOfView: '',
          conflict: '',
          keyEvents: '',
          clues: '',
          hook: '',
        },
      },
    });
    index = await repository.deleteVolume(index, volumeResult.volume.id);
    expect(index.projects['mist-harbor'].outline?.volumes)
      .not.toHaveProperty(volumeResult.volume.id);
    expect(index.projects['mist-harbor'].outline?.chapters)
      .not.toHaveProperty(chapterResult.chapter.id);
  });

  it('rejects unsupported custom cover data', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    await expect(repository.updateProject(index, 'mist-harbor', {
      title: '雾港来信',
      genre: '长篇悬疑',
      status: 'drafting',
      coverImage: 'data:image/svg+xml;base64,PHN2Zz4=',
    })).rejects.toThrow('PNG、JPEG 或 WebP');
  });

  it('deletes a project, its volumes and chapter bodies, then selects a fallback', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const chapterIds = index.volumes['mist-harbor-volume-1'].chapterIds;

    const updated = await repository.deleteProject(index, 'mist-harbor');

    expect(updated.projects).not.toHaveProperty('mist-harbor');
    expect(updated.volumes).not.toHaveProperty('mist-harbor-volume-1');
    chapterIds.forEach((chapterId) => {
      expect(updated.chapters).not.toHaveProperty(chapterId);
      expect(storage.values.has(chapterStorageKey(chapterId))).toBe(false);
    });
    expect(updated.activeProjectId).toBe('summer-orbit');
    expect(updated.activeChapterId).toBeNull();
  });

  it('replays an interrupted project deletion on the next load', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const chapterIds = index.volumes['mist-harbor-volume-1'].chapterIds;
    storage.failNextKey = FICTIONIST_INDEX_KEY;

    await expect(repository.deleteProject(index, 'mist-harbor')).rejects.toThrow(
      'write failed',
    );
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(true);

    const recoveredRepository = createRepository(storage);
    const recovered = await recoveredRepository.loadOrInitialize();

    expect(recovered.projects).not.toHaveProperty('mist-harbor');
    chapterIds.forEach((chapterId) => {
      expect(storage.values.has(chapterStorageKey(chapterId))).toBe(false);
    });
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
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

  it('creates an accepted task draft as a recoverable chapter without touching its source', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const sourceBody = await repository.readChapter('chapter-3');

    const result = await repository.createChapter(index, {
      projectId: 'mist-harbor',
      title: '钟塔回声',
      content: '新章节正文',
      sourceTaskId: 'task-1',
    });

    expect(result.chapter).toMatchObject({
      title: '钟塔回声',
      sourceTaskId: 'task-1',
      wordCount: 5,
    });
    expect(await repository.readChapter(result.chapter.id)).toBe('新章节正文');
    expect(await repository.readChapter('chapter-3')).toBe(sourceBody);
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('commits each professional task draft at most once', async () => {
    const repository = createRepository(storage);
    const staleIndex = await repository.loadOrInitialize();

    const first = await repository.createChapter(staleIndex, {
      projectId: 'mist-harbor',
      title: '唯一续写章节',
      content: '第一次确认的正文',
      sourceTaskId: 'task-idempotent',
    });
    const second = await repository.createChapter(staleIndex, {
      projectId: 'mist-harbor',
      title: '不应重复创建',
      content: '第二次确认的正文',
      sourceTaskId: 'task-idempotent',
    });

    expect(second.chapter.id).toBe(first.chapter.id);
    expect(Object.values(second.index.chapters).filter(
      (chapter) => chapter.sourceTaskId === 'task-idempotent',
    )).toHaveLength(1);
    expect(await repository.readChapter(first.chapter.id)).toBe('第一次确认的正文');
  });

  it('does not revise a target chapter twice for the same professional task', async () => {
    const repository = createRepository(storage);
    const staleIndex = await repository.loadOrInitialize();

    const first = await repository.acceptChapterDraft(staleIndex, {
      chapterId: 'chapter-3',
      title: '第一次确认',
      content: '第一次确认的正文',
      sourceTaskId: 'task-draft-idempotent',
    });
    const second = await repository.acceptChapterDraft(staleIndex, {
      chapterId: 'chapter-3',
      title: '第二次确认',
      content: '第二次确认的正文',
      sourceTaskId: 'task-draft-idempotent',
    });

    expect(second.chapters['chapter-3']).toEqual(first.chapters['chapter-3']);
    expect(await repository.readChapter('chapter-3')).toBe('第一次确认的正文');
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

  it('creates and renames volumes, then creates a chapter in the selected volume', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    const created = await repository.createVolume(index, {
      projectId: 'mist-harbor',
      title: '第二卷 · 钟塔余波',
    });
    const renamed = await repository.renameVolume(
      created.index,
      created.volume.id,
      '第二卷 · 雾中回声',
    );
    const chapter = await repository.createChapter(renamed, {
      projectId: 'mist-harbor',
      volumeId: created.volume.id,
      title: '回声抵达之前',
      content: '钟声越过海面。',
    });

    expect(renamed.projects['mist-harbor'].volumeIds.at(-1)).toBe(created.volume.id);
    expect(renamed.volumes[created.volume.id].title).toBe('第二卷 · 雾中回声');
    expect(chapter.chapter.volumeId).toBe(created.volume.id);
    expect(chapter.index.volumes[created.volume.id].chapterIds).toEqual([chapter.chapter.id]);
  });

  it('renames a chapter without losing its body and invalidates old revision snapshots', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const body = await repository.readChapter('chapter-3');

    const updated = await repository.renameChapter(index, 'chapter-3', '钟塔入口');

    expect(updated.chapters['chapter-3']).toMatchObject({
      title: '钟塔入口',
      revision: index.chapters['chapter-3'].revision + 1,
    });
    expect(await repository.readChapter('chapter-3')).toBe(body);
  });

  it('deletes the active chapter body and selects the next chapter', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    const updated = await repository.deleteChapter(index, 'chapter-3');

    expect(updated.chapters).not.toHaveProperty('chapter-3');
    expect(updated.volumes['mist-harbor-volume-1'].chapterIds).not.toContain('chapter-3');
    expect(updated.activeChapterId).toBe('chapter-4');
    expect(storage.values.has(chapterStorageKey('chapter-3'))).toBe(false);
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('replays an interrupted chapter deletion on the next load', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    storage.failNextKey = FICTIONIST_INDEX_KEY;

    await expect(repository.deleteChapter(index, 'chapter-3')).rejects.toThrow('write failed');
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(true);

    const recoveredRepository = createRepository(storage);
    const recovered = await recoveredRepository.loadOrInitialize();

    expect(recovered.chapters).not.toHaveProperty('chapter-3');
    expect(storage.values.has(chapterStorageKey('chapter-3'))).toBe(false);
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('finishes chapter deletion when body cleanup fails once', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    storage.failNextRemoveKey = chapterStorageKey('chapter-3');

    const updated = await repository.deleteChapter(index, 'chapter-3');

    expect(updated.chapters).not.toHaveProperty('chapter-3');
    expect(storage.values.has(chapterStorageKey('chapter-3'))).toBe(false);
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('replays pending recovery before a later mutation without losing that mutation', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    storage.failNextKey = FICTIONIST_INDEX_KEY;

    await expect(repository.deleteChapter(index, 'chapter-3')).rejects.toThrow('write failed');
    const renamed = await repository.renameChapter(index, 'chapter-4', '恢复后的新标题');
    const reloaded = await repository.loadOrInitialize();

    expect(renamed.chapters).not.toHaveProperty('chapter-3');
    expect(reloaded.chapters).not.toHaveProperty('chapter-3');
    expect(reloaded.chapters['chapter-4'].title).toBe('恢复后的新标题');
    expect(storage.values.has(FICTIONIST_RECOVERY_KEY)).toBe(false);
  });

  it('deletes a non-final volume with its chapter bodies and rejects deleting the only volume', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const created = await repository.createVolume(index, {
      projectId: 'mist-harbor',
      title: '第二卷',
    });
    const chapter = await repository.createChapter(created.index, {
      projectId: 'mist-harbor',
      volumeId: created.volume.id,
      content: '第二卷正文',
    });

    const updated = await repository.deleteVolume(chapter.index, created.volume.id);

    expect(updated.volumes).not.toHaveProperty(created.volume.id);
    expect(updated.projects['mist-harbor'].volumeIds).not.toContain(created.volume.id);
    expect(updated.chapters).not.toHaveProperty(chapter.chapter.id);
    expect(storage.values.has(chapterStorageKey(chapter.chapter.id))).toBe(false);
    await expect(repository.deleteVolume(updated, 'mist-harbor-volume-1'))
      .rejects.toThrow('至少保留一个卷');
  });

  it('selects the first following chapter after deleting a multi-chapter volume', async () => {
    const repository = createRepository(storage);
    let index = await repository.loadOrInitialize();
    const deletedVolume = await repository.createVolume(index, {
      projectId: 'mist-harbor',
      title: '待删除卷',
    });
    index = deletedVolume.index;
    const deletedFirst = await repository.createChapter(index, {
      projectId: 'mist-harbor',
      volumeId: deletedVolume.volume.id,
    });
    index = deletedFirst.index;
    const deletedSecond = await repository.createChapter(index, {
      projectId: 'mist-harbor',
      volumeId: deletedVolume.volume.id,
    });
    index = deletedSecond.index;
    const followingVolume = await repository.createVolume(index, {
      projectId: 'mist-harbor',
      title: '后续卷',
    });
    index = followingVolume.index;
    const followingFirst = await repository.createChapter(index, {
      projectId: 'mist-harbor',
      volumeId: followingVolume.volume.id,
    });
    index = followingFirst.index;
    const followingSecond = await repository.createChapter(index, {
      projectId: 'mist-harbor',
      volumeId: followingVolume.volume.id,
    });
    index = await repository.saveSelection(
      followingSecond.index,
      'mist-harbor',
      deletedSecond.chapter.id,
    );

    const updated = await repository.deleteVolume(index, deletedVolume.volume.id);

    expect(updated.activeChapterId).toBe(followingFirst.chapter.id);
  });

  it('rejects creating a chapter in another project volume', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    await expect(repository.createChapter(index, {
      projectId: 'mist-harbor',
      volumeId: 'summer-orbit-volume-1',
    })).rejects.toThrow('可用卷');
  });

  it('searches the full project across chapter titles, bodies and unsaved overrides', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();

    const bodyMatches = await repository.searchProject(index, {
      projectId: 'mist-harbor',
      query: '防波堤',
    });
    const titleMatches = await repository.searchProject(index, {
      projectId: 'mist-harbor',
      query: '守钟人',
    });
    const overrideMatches = await repository.searchProject(index, {
      projectId: 'mist-harbor',
      query: '尚未保存的暗号',
      contentOverrides: { 'chapter-3': '这里藏着尚未保存的暗号。' },
    });

    expect(bodyMatches.matches[0]).toMatchObject({
      chapterId: 'chapter-2',
      field: 'content',
    });
    expect(titleMatches.matches).toContainEqual(expect.objectContaining({
      chapterId: 'chapter-4',
      field: 'chapter-title',
    }));
    expect(overrideMatches.matches[0]?.excerpt).toContain('尚未保存的暗号');
    expect(await repository.readChapter('chapter-3')).not.toContain('尚未保存的暗号');
  });

  it('returns one volume-level result for a matching volume, including an empty volume', async () => {
    const repository = createRepository(storage);
    const index = await repository.loadOrInitialize();
    const emptyVolume = await repository.createVolume(index, {
      projectId: 'mist-harbor',
      title: '空白测试卷',
    });

    const emptyResult = await repository.searchProject(emptyVolume.index, {
      projectId: 'mist-harbor',
      query: '空白测试卷',
    });
    const existingVolume = emptyVolume.index.volumes['mist-harbor-volume-1'];
    const existingResult = await repository.searchProject(emptyVolume.index, {
      projectId: 'mist-harbor',
      query: existingVolume.title,
    });

    expect(emptyResult.matches).toEqual([
      expect.objectContaining({
        kind: 'volume',
        volumeId: emptyVolume.volume.id,
        field: 'volume-title',
      }),
    ]);
    expect(existingResult.matches.filter((match) => match.field === 'volume-title'))
      .toHaveLength(1);
  });

  it('reorders volumes and moves chapters without changing chapter ids or bodies', async () => {
    const repository = createRepository(storage);
    let index = await repository.loadOrInitialize();
    const created = await repository.createVolume(index, {
      projectId: 'mist-harbor',
      title: '第二卷',
    });
    index = await repository.reorderVolume(created.index, created.volume.id, 0);
    expect(index.projects['mist-harbor'].volumeIds[0]).toBe(created.volume.id);

    const originalBody = await repository.readChapter('chapter-1');
    index = await repository.moveChapter(index, 'chapter-1', created.volume.id, 0);
    expect(index.volumes[created.volume.id].chapterIds).toEqual(['chapter-1']);
    expect(index.chapters['chapter-1'].volumeId).toBe(created.volume.id);
    expect(await repository.readChapter('chapter-1')).toBe(originalBody);
  });

  it('updates chapter status, reorders timeline events and imports collections in batches', async () => {
    const repository = createRepository(storage);
    let index = await repository.loadOrInitialize();
    index = await repository.updateChapterStatus(index, 'chapter-1', 'final');
    index = await repository.reorderTimelineEvent(index, 'timeline-berth', 0);
    expect(index.chapters['chapter-1'].status).toBe('final');
    expect(index.timelineEvents['timeline-berth'].order).toBe(0);

    const canon = await repository.importCanonEntries(index, 'mist-harbor', [{
      type: 'item', name: '铜钥匙', summary: '批量导入', content: '只出现一次',
    }]);
    const timeline = await repository.importTimelineEvents(canon.index, 'mist-harbor', [{
      timeLabel: '次日', title: '钥匙出现', description: '', kind: 'chapter',
      sourceChapterId: 'chapter-1',
    }]);
    expect(canon.count).toBe(1);
    expect(timeline.count).toBe(1);
    expect(Object.values(timeline.index.canonEntries)).toContainEqual(
      expect.objectContaining({ name: '铜钥匙' }),
    );
    expect(Object.values(timeline.index.timelineEvents)).toContainEqual(
      expect.objectContaining({ title: '钥匙出现', sourceChapterId: 'chapter-1' }),
    );
  });

  it('replaces literal text across chapter bodies and refreshes revision metadata', async () => {
    const repository = createRepository(storage);
    let index = await repository.loadOrInitialize();
    index = await repository.saveChapter(index, 'chapter-1', '旧词和旧词');
    const previousRevision = index.chapters['chapter-1'].revision;

    const result = await repository.replaceProjectText(index, 'mist-harbor', '旧词', '新词');

    expect(result.replacementCount).toBe(2);
    expect(result.changedChapterIds).toEqual(['chapter-1']);
    expect(await repository.readChapter('chapter-1')).toBe('新词和新词');
    expect(result.index.chapters['chapter-1'].revision).toBe(previousRevision + 1);
  });
});
