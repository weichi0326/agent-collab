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
    const projectId = await first.store.getState().createProject('群星沉入海底', '长篇奇幻');
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
    expect(second.store.getState().dirty).toBe(false);
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

  it('keeps master usable when fictionist hydration fails', async () => {
    const { store } = setup(storage);
    storage.values.set(FICTIONIST_INDEX_KEY, '{invalid');

    await store.getState().hydrate();

    expect(store.getState().hydrationState).toBe('error');
    expect(store.getState().errorMessage).toBeTruthy();
  });
});
