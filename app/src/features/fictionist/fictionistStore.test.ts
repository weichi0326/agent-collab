import { createStore } from 'zustand/vanilla';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFictionistState } from './fictionistStore';
import {
  FICTIONIST_INDEX_KEY,
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

function setup(storage: MemoryStorage) {
  let sequence = 0;
  const repository = createFictionistRepository(storage, {
    now: () => '2026-07-23T01:00:00.000Z',
    createId: (prefix) => `${prefix}-store-${++sequence}`,
  });
  return {
    repository,
    store: createStore(createFictionistState(repository)),
  };
}

describe('fictionist store', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('hydrates the last active project, chapter and body', async () => {
    const { store } = setup(storage);

    await store.getState().hydrate();

    expect(store.getState()).toMatchObject({
      hydrationState: 'ready',
      activeProjectId: 'mist-harbor',
      activeChapterId: 'chapter-3',
      dirty: false,
    });
    expect(store.getState().chapterContent).toContain('七号泊位的铁门');
    expect(store.getState().savedChapterContent).toBe(store.getState().chapterContent);
  });

  it('restores created data and selection in a new store instance', async () => {
    const first = setup(storage);
    await first.store.getState().hydrate();
    const coverImage = 'data:image/webp;base64,UklGRg==';
    const projectId = await first.store.getState().createProject(
      '群星沉入海底',
      '长篇奇幻',
      coverImage,
    );
    expect(projectId).toBeTruthy();
    expect(await first.store.getState().openProject(projectId ?? '')).toBe(true);
    const chapterId = await first.store.getState().createChapter();
    first.store.getState().updateChapterContent('第一章的真实正文');
    expect(await first.store.getState().saveCurrentChapter()).toBe(true);

    const second = setup(storage);
    await second.store.getState().hydrate();

    expect(second.store.getState().activeProjectId).toBe(projectId);
    expect(second.store.getState().activeChapterId).toBe(chapterId);
    expect(second.store.getState().chapterContent).toBe('第一章的真实正文');
    expect(second.store.getState().index.projects[projectId ?? '']?.coverImage).toBe(coverImage);
    expect(second.store.getState().dirty).toBe(false);
  });

  it('renames and deletes books through persistent store actions', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();

    expect(await store.getState().renameProject('mist-harbor', '雾港余烬')).toBe(true);
    expect(store.getState().index.projects['mist-harbor'].title).toBe('雾港余烬');

    expect(await store.getState().deleteProject('mist-harbor')).toBe(true);
    expect(store.getState()).toMatchObject({
      activeProjectId: 'summer-orbit',
      activeChapterId: null,
      chapterContent: '',
      savedChapterContent: '',
      dirty: false,
    });
    expect((await repository.loadOrInitialize()).projects).not.toHaveProperty('mist-harbor');
  });

  it('manages canon entries through the active project', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();

    const entryId = await store.getState().createCanonEntry({
      type: 'character',
      name: '新角色',
      summary: '用于验证持久化的角色。',
      content: '这是角色的完整设定。',
    });
    expect(entryId).toBeTruthy();
    expect(store.getState().index.canonEntries[entryId ?? '']?.name).toBe('新角色');

    expect(await store.getState().updateCanonEntry(entryId ?? '', {
      type: 'character',
      name: '新角色（修订）',
      summary: '更新后的摘要。',
      content: '更新后的完整设定。',
    })).toBe(true);
    expect(store.getState().index.canonEntries[entryId ?? '']?.content).toBe('更新后的完整设定。');

    expect(await store.getState().deleteCanonEntry(entryId ?? '')).toBe(true);
    expect(store.getState().index.canonEntries[entryId ?? '']).toBeUndefined();
    expect((await repository.loadOrInitialize()).canonEntries[entryId ?? '']).toBeUndefined();
  });

  it('manages timeline events through the persistent store', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();

    const eventId = await store.getState().createTimelineEvent({
      timeLabel: '今晚 · 03:10',
      title: '铜钟再次响起',
      description: '声音来自旧海关钟塔。',
      kind: 'chapter',
      sourceChapterId: 'chapter-3',
    });
    expect(eventId).toBeTruthy();
    expect(store.getState().index.timelineEvents[eventId ?? '']).toMatchObject({
      title: '铜钟再次响起',
      sourceChapterId: 'chapter-3',
    });

    expect(await store.getState().updateTimelineEvent(eventId ?? '', {
      timeLabel: '今晚 · 03:12',
      title: '铜钟停止',
      description: '钟声在第三下后停止。',
      kind: 'confirmed',
    })).toBe(true);
    expect(store.getState().index.timelineEvents[eventId ?? '']?.kind).toBe('confirmed');

    expect(await store.getState().deleteTimelineEvent(eventId ?? '')).toBe(true);
    expect(store.getState().index.timelineEvents[eventId ?? '']).toBeUndefined();
    expect((await repository.loadOrInitialize()).timelineEvents[eventId ?? '']).toBeUndefined();
  });

  it('creates a canon entry for the visible project when the active id is stale', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    store.setState({ activeProjectId: 'deleted-project' });

    const entryId = await store.getState().createCanonEntry({
      type: 'rule',
      name: '错位恢复',
      summary: '使用当前可见作品。',
      content: '状态恢复后仍应写入正确作品。',
    }, 'mist-harbor');

    expect(entryId).toBeTruthy();
    expect(store.getState().index.canonEntries[entryId ?? '']?.projectId).toBe('mist-harbor');
  });

  it('updates book metadata and custom cover through the persistent store', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();
    const coverImage = 'data:image/webp;base64,UklGRg==';

    expect(await store.getState().updateProject('mist-harbor', {
      title: '雾港余烬',
      genre: '都市悬疑',
      status: 'paused',
      coverImage,
    })).toBe(true);

    expect(store.getState().index.projects['mist-harbor']).toMatchObject({
      title: '雾港余烬',
      genre: '都市悬疑',
      status: 'paused',
      coverImage,
    });
    expect((await repository.loadOrInitialize()).projects['mist-harbor'].coverImage)
      .toBe(coverImage);
  });

  it('saves a project outline through the persistent store', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();

    expect(await store.getState().saveProjectOutline('mist-harbor', {
      premise: '记者收到一封来自失踪船只的信。',
      theme: '真相的代价',
      protagonistGoal: '找到寄信人',
      coreConflict: '港区势力阻止调查',
      endingDirection: '公开沉船记录',
      volumes: {},
      chapters: {},
    })).toBe(true);

    expect(store.getState().index.projects['mist-harbor'].outline?.premise)
      .toBe('记者收到一封来自失踪船只的信。');
    expect((await repository.loadOrInitialize()).projects['mist-harbor'].outline?.theme)
      .toBe('真相的代价');
  });

  it('marks edits dirty and clears them only after a successful save', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();

    store.getState().updateChapterContent('新的正文');
    expect(store.getState()).toMatchObject({ dirty: true, saveState: 'idle' });

    expect(await store.getState().saveCurrentChapter()).toBe(true);
    expect(store.getState()).toMatchObject({
      dirty: false,
      saveState: 'saved',
      savedChapterContent: '新的正文',
    });
  });

  it('keeps newer typing dirty when an older save finishes', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('先提交的正文');

    const originalSaveChapter = repository.saveChapter.bind(repository);
    let releaseSave!: () => void;
    let markSaveStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    repository.saveChapter = async (...args) => {
      markSaveStarted();
      await saveGate;
      return originalSaveChapter(...args);
    };

    const saving = store.getState().saveCurrentChapter();
    await saveStarted;
    store.getState().updateChapterContent('保存期间继续输入的正文');
    releaseSave();

    expect(await saving).toBe(true);
    expect(await repository.readChapter('chapter-3')).toBe('先提交的正文');
    expect(store.getState()).toMatchObject({
      chapterContent: '保存期间继续输入的正文',
      savedChapterContent: '先提交的正文',
      dirty: true,
      saveState: 'idle',
    });
  });

  it('serializes concurrent chapter creation without losing either chapter', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();
    const originalCreateChapter = repository.createChapter.bind(repository);
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let callCount = 0;
    repository.createChapter = async (...args) => {
      callCount += 1;
      if (callCount === 1) {
        markFirstStarted();
        await firstGate;
      }
      return originalCreateChapter(...args);
    };

    const first = store.getState().createChapter('mist-harbor-volume-1');
    await firstStarted;
    const second = store.getState().createChapter('mist-harbor-volume-1');
    releaseFirst();
    const [firstId, secondId] = await Promise.all([first, second]);

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
    expect(store.getState().index.volumes['mist-harbor-volume-1'].chapterIds)
      .toEqual(expect.arrayContaining([firstId, secondId]));
  });

  it('keeps the draft dirty and exposes an error when persistence fails', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('不能丢失的正文');
    storage.failNextKey = FICTIONIST_INDEX_KEY;

    expect(await store.getState().saveCurrentChapter()).toBe(false);

    expect(store.getState()).toMatchObject({
      dirty: true,
      saveState: 'error',
      chapterContent: '不能丢失的正文',
    });
    expect(store.getState().errorMessage).toContain('write failed');
  });

  it('saves a dirty chapter before selecting another chapter', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('切换前保存');

    expect(await store.getState().selectChapter('chapter-2')).toBe(true);

    expect(await repository.readChapter('chapter-3')).toBe('切换前保存');
    expect(store.getState()).toMatchObject({
      activeChapterId: 'chapter-2',
      dirty: false,
    });
    expect(store.getState().chapterContent).toContain('林砚沿着防波堤');
  });

  it('does not leave the current chapter when the pre-navigation save fails', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('仍在当前章');
    storage.failNextKey = FICTIONIST_INDEX_KEY;

    expect(await store.getState().selectChapter('chapter-2')).toBe(false);

    expect(store.getState()).toMatchObject({
      activeChapterId: 'chapter-3',
      chapterContent: '仍在当前章',
      dirty: true,
    });
  });

  it('opens a project without chapters as an intentional empty editor', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();

    expect(await store.getState().openProject('summer-orbit')).toBe(true);

    expect(store.getState()).toMatchObject({
      activeProjectId: 'summer-orbit',
      activeChapterId: null,
      chapterContent: '',
      dirty: false,
    });
  });

  it('accepts a continuation draft only as a new chapter', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();
    const source = store.getState().index.chapters['chapter-3'];
    const sourceBody = await repository.readChapter(source.id);

    const result = await store.getState().acceptContinuationDraft({
      taskId: 'task-1',
      projectId: source.projectId,
      sourceChapterId: source.id,
      sourceRevision: source.revision,
      targetChapterId: 'chapter-4',
      targetRevision: 0,
      title: '钟塔回声',
      content: '这是新的下一章。',
    });

    expect(result.ok).toBe(true);
    const created = result.ok ? store.getState().index.chapters[result.chapterId] : undefined;
    expect(created).toMatchObject({ title: '钟塔回声', sourceTaskId: 'task-1' });
    expect(store.getState().activeChapterId).toBe(created?.id);
    expect(await repository.readChapter(source.id)).toBe(sourceBody);
    expect(await repository.readChapter(created?.id ?? '')).toBe('这是新的下一章。');
  });

  it('fills an unchanged empty chapter when accepting a current-chapter draft', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();
    const chapterId = await store.getState().createChapter();
    expect(chapterId).toBeTruthy();
    const chapterCount = Object.keys(store.getState().index.chapters).length;
    const chapter = store.getState().index.chapters[chapterId ?? ''];

    const result = await store.getState().acceptContinuationDraft({
      writingMode: 'draft-current',
      taskId: 'task-first-chapter',
      projectId: chapter.projectId,
      sourceChapterId: chapter.id,
      sourceRevision: chapter.revision,
      targetChapterId: chapter.id,
      targetRevision: chapter.revision,
      title: '雨夜来信',
      content: '雨水敲打着阁楼窗户，匿名来信从门缝滑了进来。',
    });

    expect(result).toEqual({ ok: true, chapterId: chapter.id });
    expect(Object.keys(store.getState().index.chapters)).toHaveLength(chapterCount);
    expect(store.getState().index.chapters[chapter.id]).toMatchObject({
      title: '雨夜来信',
      sourceTaskId: 'task-first-chapter',
    });
    expect(await repository.readChapter(chapter.id)).toContain('匿名来信');
  });

  it('blocks an outdated continuation task after the source chapter changes', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    const source = store.getState().index.chapters['chapter-3'];
    store.getState().updateChapterContent('用户后来修改了来源章节');
    expect(await store.getState().saveCurrentChapter()).toBe(true);

    const result = await store.getState().acceptContinuationDraft({
      taskId: 'task-old',
      projectId: source.projectId,
      sourceChapterId: source.id,
      sourceRevision: source.revision,
      title: '不应保存',
      content: '过期草稿',
    });

    expect(result).toMatchObject({ ok: false, reason: 'source-changed' });
  });

  it('blocks a continuation task when another chapter already follows its source', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    const source = store.getState().index.chapters['chapter-3'];
    expect(await store.getState().createChapter()).toBeTruthy();

    const result = await store.getState().acceptContinuationDraft({
      taskId: 'task-old',
      projectId: source.projectId,
      sourceChapterId: source.id,
      sourceRevision: source.revision,
      title: '不应保存',
      content: '章序冲突草稿',
    });

    expect(result).toMatchObject({ ok: false, reason: 'order-conflict' });
  });

  it('keeps master usable when fictionist hydration fails', async () => {
    const { store } = setup(storage);
    storage.values.set(FICTIONIST_INDEX_KEY, '{invalid');

    await store.getState().hydrate();

    expect(store.getState().hydrationState).toBe('error');
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it('manages multiple volumes and creates chapters in the requested volume', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();

    const volumeId = await store.getState().createVolume('第二卷');
    expect(volumeId).toBeTruthy();
    expect(await store.getState().renameVolume(volumeId ?? '', '第二卷 · 回声')).toBe(true);
    const chapterId = await store.getState().createChapter(volumeId ?? undefined);

    expect(store.getState().index.volumes[volumeId ?? '']?.title).toBe('第二卷 · 回声');
    expect(store.getState().index.chapters[chapterId ?? '']?.volumeId).toBe(volumeId);
    expect((await repository.loadOrInitialize()).volumes[volumeId ?? '']?.chapterIds)
      .toContain(chapterId);
  });

  it('renames the current chapter without losing its unsaved body', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('仍未保存的正文');

    expect(await store.getState().renameChapter('chapter-3', '钟塔入口')).toBe(true);

    expect(store.getState()).toMatchObject({
      activeChapterId: 'chapter-3',
      chapterContent: '仍未保存的正文',
      dirty: true,
    });
    expect(store.getState().index.chapters['chapter-3'].title).toBe('钟塔入口');
  });

  it('deletes the active chapter and loads the fallback chapter body', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('确认删除后应丢弃');

    expect(await store.getState().deleteChapter('chapter-3')).toBe(true);

    expect(store.getState()).toMatchObject({
      activeChapterId: 'chapter-4',
      chapterContent: '',
      savedChapterContent: '',
      dirty: false,
    });
  });

  it('deletes another chapter without changing the current unsaved body', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('当前章节仍未保存');

    expect(await store.getState().deleteChapter('chapter-1')).toBe(true);

    expect(store.getState()).toMatchObject({
      activeChapterId: 'chapter-3',
      chapterContent: '当前章节仍未保存',
      dirty: true,
    });
  });

  it('deletes the active volume and falls back without changing another dirty chapter', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    const secondVolumeId = await store.getState().createVolume('第二卷');
    const secondChapterId = await store.getState().createChapter(secondVolumeId ?? undefined);
    expect(secondChapterId).toBeTruthy();
    store.getState().updateChapterContent('第二卷未保存正文');

    expect(await store.getState().deleteVolume(secondVolumeId ?? '')).toBe(true);

    expect(store.getState()).toMatchObject({
      activeChapterId: 'chapter-4',
      chapterContent: '',
      dirty: false,
    });
  });

  it('searches unsaved current content without saving or clearing dirty state', async () => {
    const { repository, store } = setup(storage);
    await store.getState().hydrate();
    store.getState().updateChapterContent('码头墙上写着未保存暗号。');

    const result = await store.getState().searchCurrentProject('未保存暗号');

    expect(result?.matches[0]).toMatchObject({ chapterId: 'chapter-3', field: 'content' });
    expect(store.getState()).toMatchObject({ dirty: true, chapterContent: '码头墙上写着未保存暗号。' });
    expect(await repository.readChapter('chapter-3')).not.toContain('未保存暗号');
  });

  it('keeps AI continuation chapters in the source volume', async () => {
    const { store } = setup(storage);
    await store.getState().hydrate();
    const volumeId = await store.getState().createVolume('第二卷');
    const sourceChapterId = await store.getState().createChapter(volumeId ?? undefined);
    const source = store.getState().index.chapters[sourceChapterId ?? ''];

    const result = await store.getState().acceptContinuationDraft({
      taskId: 'task-volume-2',
      projectId: source.projectId,
      sourceChapterId: source.id,
      sourceRevision: source.revision,
      title: '第二卷续章',
      content: '继续写在第二卷。',
    });

    expect(result.ok).toBe(true);
    const created = result.ok ? store.getState().index.chapters[result.chapterId] : undefined;
    expect(created?.volumeId).toBe(volumeId);
  });
});
