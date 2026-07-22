import { create, type StateCreator } from 'zustand';
import { chaptersForProject, type FictionistIndex } from './domain';
import { createDemoFictionistData } from './fixtures';
import {
  fictionistRepository,
  type FictionistRepository,
} from './repository';

export type FictionistHydrationState = 'idle' | 'loading' | 'ready' | 'error';
export type FictionistSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface FictionistState {
  index: FictionistIndex;
  activeProjectId: string | null;
  activeChapterId: string | null;
  chapterContent: string;
  savedChapterContent: string;
  dirty: boolean;
  hydrationState: FictionistHydrationState;
  saveState: FictionistSaveState;
  errorMessage: string | null;

  hydrate: () => Promise<void>;
  createProject: (title: string, genre: string) => Promise<string | null>;
  openProject: (projectId: string) => Promise<boolean>;
  createChapter: () => Promise<string | null>;
  selectChapter: (chapterId: string) => Promise<boolean>;
  updateChapterContent: (content: string) => void;
  saveCurrentChapter: () => Promise<boolean>;
  discardCurrentChanges: () => void;
  clearError: () => void;
}

function readableError(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason;
  return '小说数据操作失败';
}

function initialState() {
  const seed = createDemoFictionistData();
  const chapterId = seed.index.activeChapterId;
  const content = chapterId ? seed.chapterContents[chapterId] ?? '' : '';
  return {
    index: seed.index,
    activeProjectId: seed.index.activeProjectId,
    activeChapterId: chapterId,
    chapterContent: content,
    savedChapterContent: content,
    dirty: false,
    hydrationState: 'idle' as const,
    saveState: 'idle' as const,
    errorMessage: null,
  };
}

export function createFictionistState(
  repository: FictionistRepository,
): StateCreator<FictionistState> {
  let hydrationPromise: Promise<void> | null = null;

  return (set, get) => ({
    ...initialState(),

    hydrate: async () => {
      if (get().hydrationState === 'ready') return;
      if (hydrationPromise) return hydrationPromise;
      set({ hydrationState: 'loading', errorMessage: null });
      hydrationPromise = (async () => {
        try {
          const index = await repository.loadOrInitialize();
          const fallbackProjectId = Object.keys(index.projects)[0] ?? null;
          const activeProjectId = index.activeProjectId && index.projects[index.activeProjectId]
            ? index.activeProjectId
            : fallbackProjectId;
          const projectChapters = activeProjectId
            ? chaptersForProject(index, activeProjectId)
            : [];
          const activeChapterId = index.activeChapterId
            && projectChapters.some((chapter) => chapter.id === index.activeChapterId)
            ? index.activeChapterId
            : projectChapters[0]?.id ?? null;
          const chapterContent = activeChapterId
            ? await repository.readChapter(activeChapterId)
            : '';
          set({
            index,
            activeProjectId,
            activeChapterId,
            chapterContent,
            savedChapterContent: chapterContent,
            dirty: false,
            hydrationState: 'ready',
            saveState: 'idle',
            errorMessage: null,
          });
        } catch (reason) {
          set({
            hydrationState: 'error',
            saveState: 'error',
            errorMessage: readableError(reason),
          });
        } finally {
          hydrationPromise = null;
        }
      })();
      return hydrationPromise;
    },

    createProject: async (title, genre) => {
      if (get().dirty && !(await get().saveCurrentChapter())) return null;
      const beforeIds = new Set(Object.keys(get().index.projects));
      try {
        const index = await repository.createProject(get().index, { title, genre });
        const projectId = Object.keys(index.projects).find((id) => !beforeIds.has(id)) ?? null;
        set({ index, errorMessage: null });
        return projectId;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    openProject: async (projectId) => {
      if (get().dirty && !(await get().saveCurrentChapter())) return false;
      const { index } = get();
      if (!index.projects[projectId]) {
        set({ errorMessage: '作品不存在' });
        return false;
      }
      const chapterId = chaptersForProject(index, projectId)[0]?.id ?? null;
      try {
        const content = chapterId ? await repository.readChapter(chapterId) : '';
        const updated = await repository.saveSelection(index, projectId, chapterId);
        set({
          index: updated,
          activeProjectId: projectId,
          activeChapterId: chapterId,
          chapterContent: content,
          savedChapterContent: content,
          dirty: false,
          saveState: 'idle',
          errorMessage: null,
        });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    createChapter: async () => {
      if (get().dirty && !(await get().saveCurrentChapter())) return null;
      const { activeProjectId, index } = get();
      if (!activeProjectId) {
        set({ errorMessage: '请先选择作品' });
        return null;
      }
      try {
        const result = await repository.createChapter(index, { projectId: activeProjectId });
        set({
          index: result.index,
          activeProjectId,
          activeChapterId: result.chapter.id,
          chapterContent: '',
          savedChapterContent: '',
          dirty: false,
          saveState: 'saved',
          errorMessage: null,
        });
        return result.chapter.id;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    selectChapter: async (chapterId) => {
      if (chapterId === get().activeChapterId) return true;
      if (get().dirty && !(await get().saveCurrentChapter())) return false;
      const { activeProjectId, index } = get();
      const chapter = index.chapters[chapterId];
      if (!chapter || chapter.projectId !== activeProjectId) {
        set({ errorMessage: '章节不属于当前作品' });
        return false;
      }
      try {
        const content = await repository.readChapter(chapterId);
        const updated = await repository.saveSelection(index, activeProjectId, chapterId);
        set({
          index: updated,
          activeChapterId: chapterId,
          chapterContent: content,
          savedChapterContent: content,
          dirty: false,
          saveState: 'idle',
          errorMessage: null,
        });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    updateChapterContent: (chapterContent) => {
      if (!get().activeChapterId) return;
      set({
        chapterContent,
        dirty: chapterContent !== get().savedChapterContent,
        saveState: 'idle',
        errorMessage: null,
      });
    },

    saveCurrentChapter: async () => {
      const { activeChapterId, chapterContent, dirty, index } = get();
      if (!activeChapterId || !dirty) return true;
      set({ saveState: 'saving', errorMessage: null });
      try {
        const updated = await repository.saveChapter(index, activeChapterId, chapterContent);
        set({
          index: updated,
          savedChapterContent: chapterContent,
          dirty: false,
          saveState: 'saved',
          errorMessage: null,
        });
        return true;
      } catch (reason) {
        set({
          dirty: true,
          saveState: 'error',
          errorMessage: readableError(reason),
        });
        return false;
      }
    },

    discardCurrentChanges: () => {
      set({
        chapterContent: get().savedChapterContent,
        dirty: false,
        saveState: 'idle',
        errorMessage: null,
      });
    },

    clearError: () => set({ errorMessage: null }),
  });
}

export const useFictionistStore = create<FictionistState>()(
  createFictionistState(fictionistRepository),
);
