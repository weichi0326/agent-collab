import { create, type StateCreator } from 'zustand';
import {
  chapterAfterDeletion,
  chaptersForProject,
  type FictionChapterStatus,
  type FictionistIndex,
} from './domain';
import { createDemoFictionistData } from './fixtures';
import {
  fictionistRepository,
  type FictionistRepository,
  type SearchProjectResult,
  type ReplaceProjectTextResult,
  type CreateCanonEntryInput,
  type CreateTimelineEventInput,
  type UpdateTimelineEventInput,
  type UpdateCanonEntryInput,
  type UpdateProjectOutlineInput,
  type UpdateProjectInput,
} from './repository';
import type { ChapterWritingMode } from './continuation';

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
  createProject: (title: string, genre: string, coverImage?: string) => Promise<string | null>;
  updateProject: (projectId: string, input: UpdateProjectInput) => Promise<boolean>;
  createCanonEntry: (
    input: Omit<CreateCanonEntryInput, 'projectId'>,
    projectId?: string,
  ) => Promise<string | null>;
  importCanonEntries: (
    projectId: string,
    inputs: UpdateCanonEntryInput[],
  ) => Promise<number | null>;
  updateCanonEntry: (entryId: string, input: UpdateCanonEntryInput) => Promise<boolean>;
  deleteCanonEntry: (entryId: string) => Promise<boolean>;
  createTimelineEvent: (
    input: Omit<CreateTimelineEventInput, 'projectId'>,
    projectId?: string,
  ) => Promise<string | null>;
  importTimelineEvents: (
    projectId: string,
    inputs: UpdateTimelineEventInput[],
  ) => Promise<number | null>;
  updateTimelineEvent: (eventId: string, input: UpdateTimelineEventInput) => Promise<boolean>;
  reorderTimelineEvent: (eventId: string, targetIndex: number) => Promise<boolean>;
  deleteTimelineEvent: (eventId: string) => Promise<boolean>;
  saveProjectOutline: (
    projectId: string,
    input: UpdateProjectOutlineInput,
  ) => Promise<boolean>;
  renameProject: (projectId: string, title: string) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<boolean>;
  createVolume: (title?: string) => Promise<string | null>;
  renameVolume: (volumeId: string, title: string) => Promise<boolean>;
  reorderVolume: (volumeId: string, targetIndex: number) => Promise<boolean>;
  deleteVolume: (volumeId: string) => Promise<boolean>;
  openProject: (projectId: string) => Promise<boolean>;
  createChapter: (volumeId?: string) => Promise<string | null>;
  renameChapter: (chapterId: string, title: string) => Promise<boolean>;
  updateChapterStatus: (chapterId: string, status: FictionChapterStatus) => Promise<boolean>;
  moveChapter: (chapterId: string, targetVolumeId: string, targetIndex: number) => Promise<boolean>;
  deleteChapter: (chapterId: string) => Promise<boolean>;
  selectChapter: (chapterId: string) => Promise<boolean>;
  searchCurrentProject: (query: string) => Promise<SearchProjectResult | null>;
  replaceCurrentProjectText: (
    search: string,
    replacement: string,
  ) => Promise<ReplaceProjectTextResult | null>;
  updateChapterContent: (content: string) => void;
  saveCurrentChapter: () => Promise<boolean>;
  acceptContinuationDraft: (
    input: AcceptContinuationDraftInput,
  ) => Promise<AcceptContinuationDraftResult>;
  discardCurrentChanges: () => void;
  clearError: () => void;
}

export interface AcceptContinuationDraftInput {
  writingMode?: ChapterWritingMode;
  taskId: string;
  projectId: string;
  sourceChapterId: string;
  sourceRevision: number;
  targetChapterId?: string;
  targetRevision?: number;
  title: string;
  content: string;
}

export type AcceptContinuationDraftResult =
  | { ok: true; chapterId: string }
  | { ok: false; reason: 'save' | 'source-changed' | 'order-conflict' | 'invalid'; message: string };

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

    createProject: async (title, genre, coverImage) => {
      if (get().dirty && !(await get().saveCurrentChapter())) return null;
      const beforeIds = new Set(Object.keys(get().index.projects));
      try {
        const index = await repository.createProject(get().index, { title, genre, coverImage });
        const projectId = Object.keys(index.projects).find((id) => !beforeIds.has(id)) ?? null;
        set({ index, errorMessage: null });
        return projectId;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    updateProject: async (projectId, input) => {
      try {
        const index = await repository.updateProject(get().index, projectId, input);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    createCanonEntry: async (input, requestedProjectId) => {
      const { activeProjectId, index } = get();
      const projectId = requestedProjectId ?? activeProjectId;
      if (!projectId) {
        set({ errorMessage: '请先选择作品' });
        return null;
      }
      try {
        const result = await repository.createCanonEntry(index, {
          ...input,
          projectId,
        });
        set({ index: result.index, errorMessage: null });
        return result.entry.id;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    importCanonEntries: async (projectId, inputs) => {
      try {
        const result = await repository.importCanonEntries(get().index, projectId, inputs);
        set({ index: result.index, errorMessage: null });
        return result.count;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    updateCanonEntry: async (entryId, input) => {
      try {
        const index = await repository.updateCanonEntry(get().index, entryId, input);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    deleteCanonEntry: async (entryId) => {
      try {
        const index = await repository.deleteCanonEntry(get().index, entryId);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    createTimelineEvent: async (input, requestedProjectId) => {
      const { activeProjectId, index } = get();
      const projectId = requestedProjectId ?? activeProjectId;
      if (!projectId) {
        set({ errorMessage: '请先选择作品' });
        return null;
      }
      try {
        const result = await repository.createTimelineEvent(index, {
          ...input,
          projectId,
        });
        set({ index: result.index, errorMessage: null });
        return result.event.id;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    importTimelineEvents: async (projectId, inputs) => {
      try {
        const result = await repository.importTimelineEvents(get().index, projectId, inputs);
        set({ index: result.index, errorMessage: null });
        return result.count;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    updateTimelineEvent: async (eventId, input) => {
      try {
        const index = await repository.updateTimelineEvent(get().index, eventId, input);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    reorderTimelineEvent: async (eventId, targetIndex) => {
      try {
        const index = await repository.reorderTimelineEvent(get().index, eventId, targetIndex);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    deleteTimelineEvent: async (eventId) => {
      try {
        const index = await repository.deleteTimelineEvent(get().index, eventId);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    saveProjectOutline: async (projectId, input) => {
      try {
        const index = await repository.updateProjectOutline(get().index, projectId, input);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    renameProject: async (projectId, title) => {
      try {
        const index = await repository.renameProject(get().index, projectId, title);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    deleteProject: async (projectId) => {
      const deletingActiveProject = get().activeProjectId === projectId;
      try {
        const index = await repository.deleteProject(get().index, projectId);
        if (!deletingActiveProject) {
          set({ index, errorMessage: null });
          return true;
        }
        const activeProjectId = index.activeProjectId;
        const activeChapterId = index.activeChapterId;
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
          saveState: 'idle',
          errorMessage: null,
        });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    createVolume: async (title) => {
      const { activeProjectId, index } = get();
      if (!activeProjectId) {
        set({ errorMessage: '请先选择作品' });
        return null;
      }
      try {
        const result = await repository.createVolume(index, { projectId: activeProjectId, title });
        set({ index: result.index, errorMessage: null });
        return result.volume.id;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    renameVolume: async (volumeId, title) => {
      try {
        const index = await repository.renameVolume(get().index, volumeId, title);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    reorderVolume: async (volumeId, targetIndex) => {
      try {
        const index = await repository.reorderVolume(get().index, volumeId, targetIndex);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    deleteVolume: async (volumeId) => {
      const { index, activeChapterId } = get();
      const volume = index.volumes[volumeId];
      if (!volume) {
        set({ errorMessage: '卷不存在' });
        return false;
      }
      const deletedChapterIds = new Set(volume.chapterIds);
      const deletesActiveChapter = Boolean(
        activeChapterId && deletedChapterIds.has(activeChapterId),
      );
      let fallbackChapterId: string | null = null;
      let fallbackContent = '';
      if (deletesActiveChapter && activeChapterId) {
        fallbackChapterId = chapterAfterDeletion(
          index,
          volume.projectId,
          deletedChapterIds,
          activeChapterId,
        );
        try {
          fallbackContent = fallbackChapterId
            ? await repository.readChapter(fallbackChapterId)
            : '';
        } catch (reason) {
          set({ errorMessage: readableError(reason) });
          return false;
        }
      }
      try {
        const updated = await repository.deleteVolume(index, volumeId);
        if (!deletesActiveChapter) {
          set({ index: updated, errorMessage: null });
          return true;
        }
        set({
          index: updated,
          activeChapterId: fallbackChapterId,
          chapterContent: fallbackContent,
          savedChapterContent: fallbackContent,
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

    createChapter: async (volumeId) => {
      if (get().dirty && !(await get().saveCurrentChapter())) return null;
      const { activeProjectId, index } = get();
      if (!activeProjectId) {
        set({ errorMessage: '请先选择作品' });
        return null;
      }
      try {
        const result = await repository.createChapter(index, {
          projectId: activeProjectId,
          volumeId,
        });
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

    renameChapter: async (chapterId, title) => {
      try {
        const index = await repository.renameChapter(get().index, chapterId, title);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    updateChapterStatus: async (chapterId, status) => {
      try {
        const index = await repository.updateChapterStatus(get().index, chapterId, status);
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    moveChapter: async (chapterId, targetVolumeId, targetIndex) => {
      try {
        const index = await repository.moveChapter(
          get().index,
          chapterId,
          targetVolumeId,
          targetIndex,
        );
        set({ index, errorMessage: null });
        return true;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return false;
      }
    },

    deleteChapter: async (chapterId) => {
      const { index, activeChapterId } = get();
      const chapter = index.chapters[chapterId];
      if (!chapter) {
        set({ errorMessage: '章节不存在' });
        return false;
      }
      const deletesActiveChapter = activeChapterId === chapterId;
      let fallbackChapterId: string | null = null;
      let fallbackContent = '';
      if (deletesActiveChapter) {
        fallbackChapterId = chapterAfterDeletion(
          index,
          chapter.projectId,
          new Set([chapterId]),
          chapterId,
        );
        try {
          fallbackContent = fallbackChapterId
            ? await repository.readChapter(fallbackChapterId)
            : '';
        } catch (reason) {
          set({ errorMessage: readableError(reason) });
          return false;
        }
      }
      try {
        const updated = await repository.deleteChapter(index, chapterId);
        if (!deletesActiveChapter) {
          set({ index: updated, errorMessage: null });
          return true;
        }
        set({
          index: updated,
          activeChapterId: fallbackChapterId,
          chapterContent: fallbackContent,
          savedChapterContent: fallbackContent,
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

    searchCurrentProject: async (query) => {
      const { index, activeProjectId, activeChapterId, chapterContent, dirty } = get();
      if (!activeProjectId) {
        set({ errorMessage: '请先选择作品' });
        return null;
      }
      const contentOverrides = dirty && activeChapterId
        ? { [activeChapterId]: chapterContent }
        : undefined;
      try {
        const result = await repository.searchProject(index, {
          projectId: activeProjectId,
          query,
          contentOverrides,
        });
        set({ errorMessage: null });
        return result;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
      }
    },

    replaceCurrentProjectText: async (search, replacement) => {
      const { index, activeProjectId, activeChapterId } = get();
      if (!activeProjectId) {
        set({ errorMessage: '当前没有打开的作品' });
        return null;
      }
      try {
        const result = await repository.replaceProjectText(
          index,
          activeProjectId,
          search,
          replacement,
        );
        const activeChanged = Boolean(
          activeChapterId && result.changedChapterIds.includes(activeChapterId),
        );
        const activeContent = activeChanged && activeChapterId
          ? await repository.readChapter(activeChapterId)
          : undefined;
        set({
          index: result.index,
          ...(activeContent !== undefined
            ? {
                chapterContent: activeContent,
                savedChapterContent: activeContent,
                dirty: false,
                saveState: 'saved' as const,
              }
            : {}),
          errorMessage: null,
        });
        return result;
      } catch (reason) {
        set({ errorMessage: readableError(reason) });
        return null;
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
        set((state) => {
          if (state.activeChapterId !== activeChapterId) {
            return { index: updated, errorMessage: null };
          }
          const unchanged = state.chapterContent === chapterContent;
          return {
            index: updated,
            savedChapterContent: chapterContent,
            dirty: !unchanged,
            saveState: unchanged ? 'saved' : 'idle',
            errorMessage: null,
          };
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

    acceptContinuationDraft: async (input) => {
      if (get().dirty && !(await get().saveCurrentChapter())) {
        return { ok: false, reason: 'save', message: '当前章节保存失败，草稿尚未写入' };
      }
      const { index } = get();
      const writingMode = input.writingMode ?? 'continue';
      const source = index.chapters[input.sourceChapterId];
      if (!source || source.projectId !== input.projectId) {
        return { ok: false, reason: 'invalid', message: '续写任务的来源章节已不存在' };
      }
      if (source.revision !== input.sourceRevision) {
        return {
          ok: false,
          reason: 'source-changed',
          message: `来源章节已从修订 ${input.sourceRevision} 变为 ${source.revision}，请重新创建续写任务`,
        };
      }
      if (writingMode === 'draft-current') {
        if (input.targetChapterId !== source.id
          || input.targetRevision !== source.revision
          || source.wordCount !== 0) {
          return {
            ok: false,
            reason: 'source-changed',
            message: '当前章节已经发生变化或不再为空，请重新创建起草任务',
          };
        }
        if (!input.content.trim()) {
          return { ok: false, reason: 'invalid', message: '待确认草稿为空，不能写入章节' };
        }
        try {
          const updated = await repository.acceptChapterDraft(index, {
            chapterId: source.id,
            title: input.title,
            content: input.content,
            sourceTaskId: input.taskId,
          });
          const acceptedChapter = updated.chapters[source.id];
          set({
            index: updated,
            activeProjectId: input.projectId,
            activeChapterId: acceptedChapter.id,
            chapterContent: input.content,
            savedChapterContent: input.content,
            dirty: false,
            saveState: 'saved',
            errorMessage: null,
          });
          return { ok: true, chapterId: acceptedChapter.id };
        } catch (reason) {
          const message = readableError(reason);
          set({ errorMessage: message });
          return { ok: false, reason: 'save', message };
        }
      }
      const volume = index.volumes[source.volumeId];
      const sourcePosition = volume?.chapterIds.indexOf(source.id) ?? -1;
      const nextChapterId = sourcePosition >= 0 ? volume?.chapterIds[sourcePosition + 1] : undefined;
      if (!volume || sourcePosition < 0) {
        return { ok: false, reason: 'invalid', message: '来源章节的卷信息已不存在' };
      }
      if (input.targetChapterId) {
        const target = index.chapters[input.targetChapterId];
        if (!target
          || target.id !== nextChapterId
          || volume.chapterIds.at(-1) !== target.id
          || target.revision !== input.targetRevision
          || target.wordCount !== 0) {
          return {
            ok: false,
            reason: 'order-conflict',
            message: '目标占位章节已经变化，请确认章序后重新创建续写任务',
          };
        }
      } else if (volume.chapterIds.at(-1) !== source.id) {
        return {
          ok: false,
          reason: 'order-conflict',
          message: '来源章节之后已经存在其他章节，请确认章序后重新创建续写任务',
        };
      }
      if (!input.content.trim()) {
        return { ok: false, reason: 'invalid', message: '待确认草稿为空，不能保存为章节' };
      }
      try {
        const result = input.targetChapterId
          ? {
              index: await repository.acceptChapterDraft(index, {
                chapterId: input.targetChapterId,
                title: input.title,
                content: input.content,
                sourceTaskId: input.taskId,
              }),
              chapter: index.chapters[input.targetChapterId],
            }
          : await repository.createChapter(index, {
              projectId: input.projectId,
              volumeId: source.volumeId,
              title: input.title,
              content: input.content,
              sourceTaskId: input.taskId,
            });
        const acceptedChapter = result.index.chapters[result.chapter.id];
        set({
          index: result.index,
          activeProjectId: input.projectId,
          activeChapterId: acceptedChapter.id,
          chapterContent: input.content,
          savedChapterContent: input.content,
          dirty: false,
          saveState: 'saved',
          errorMessage: null,
        });
        return { ok: true, chapterId: acceptedChapter.id };
      } catch (reason) {
        const message = readableError(reason);
        set({ errorMessage: message });
        return { ok: false, reason: 'save', message };
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
