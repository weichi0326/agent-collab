import {
  getProjectStorageItem,
  removeProjectStorageItem,
  setProjectStorageItem,
} from '../../lib/tauriStorage';
import {
  FICTIONIST_SCHEMA_VERSION,
  countFictionWords,
  isSafeFictionistId,
  type FictionChapter,
  type FictionistIndex,
} from './domain';
import { createDemoFictionistData } from './fixtures';

export const FICTIONIST_INDEX_KEY = 'multi-agent-fictionist-index';
export const FICTIONIST_RECOVERY_KEY = 'multi-agent-fictionist-recovery';
export const MAX_CHAPTER_CONTENT_BYTES = 8 * 1024 * 1024;

export interface FictionistStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

interface RepositoryOptions {
  now?: () => string;
  createId?: (prefix: 'project' | 'volume' | 'chapter') => string;
}

interface ChapterRecoveryRecord {
  schemaVersion: 1;
  chapterId: string;
  content: string;
  targetIndex: FictionistIndex;
}

export interface CreateProjectInput {
  title: string;
  genre: string;
}

export interface CreateChapterInput {
  projectId: string;
  title?: string;
}

export interface CreateChapterResult {
  index: FictionistIndex;
  chapter: FictionChapter;
}

const defaultStorage: FictionistStorage = {
  getItem: getProjectStorageItem,
  setItem: setProjectStorageItem,
  removeItem: removeProjectStorageItem,
};

function defaultCreateId(prefix: 'project' | 'volume' | 'chapter'): string {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart.slice(0, 32)}`;
}

function cloneIndex(index: FictionistIndex): FictionistIndex {
  return JSON.parse(JSON.stringify(index)) as FictionistIndex;
}

function assertSafeId(id: string, label: string): void {
  if (!isSafeFictionistId(id)) throw new Error(`${label}不是安全的 ASCII ID`);
}

function parseIndex(raw: string): FictionistIndex {
  const parsed = JSON.parse(raw) as Partial<FictionistIndex>;
  if (parsed.schemaVersion !== FICTIONIST_SCHEMA_VERSION) {
    throw new Error(`不支持的小说索引版本：${String(parsed.schemaVersion)}`);
  }
  if (!parsed.projects || !parsed.volumes || !parsed.chapters) {
    throw new Error('小说索引缺少必要数据');
  }
  return parsed as FictionistIndex;
}

function assertChapterContentSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_CHAPTER_CONTENT_BYTES) {
    throw new Error('章节正文不能超过 8 MiB');
  }
}

function normalizeText(value: string, maxLength: number, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  if (Array.from(normalized).length > maxLength) {
    throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  }
  return normalized;
}

export function chapterStorageKey(chapterId: string): string {
  assertSafeId(chapterId, '章节 ID');
  return `multi-agent-fictionist-chapter-${chapterId}`;
}

export function createFictionistRepository(
  storage: FictionistStorage = defaultStorage,
  options: RepositoryOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? defaultCreateId;

  const writeIndex = (index: FictionistIndex) =>
    storage.setItem(FICTIONIST_INDEX_KEY, JSON.stringify(index));

  const replayRecovery = async (): Promise<void> => {
    const raw = await storage.getItem(FICTIONIST_RECOVERY_KEY);
    if (!raw) return;
    const recovery = JSON.parse(raw) as ChapterRecoveryRecord;
    if (recovery.schemaVersion !== 1) throw new Error('不支持的小说恢复记录版本');
    assertSafeId(recovery.chapterId, '章节 ID');
    parseIndex(JSON.stringify(recovery.targetIndex));
    assertChapterContentSize(recovery.content);
    await storage.setItem(chapterStorageKey(recovery.chapterId), recovery.content);
    await writeIndex(recovery.targetIndex);
    await storage.removeItem(FICTIONIST_RECOVERY_KEY);
  };

  const commitChapter = async (
    targetIndex: FictionistIndex,
    chapterId: string,
    content: string,
  ): Promise<FictionistIndex> => {
    assertChapterContentSize(content);
    const recovery: ChapterRecoveryRecord = {
      schemaVersion: 1,
      chapterId,
      content,
      targetIndex,
    };
    await storage.setItem(FICTIONIST_RECOVERY_KEY, JSON.stringify(recovery));
    await storage.setItem(chapterStorageKey(chapterId), content);
    await writeIndex(targetIndex);
    await storage.removeItem(FICTIONIST_RECOVERY_KEY);
    return targetIndex;
  };

  return {
    async loadOrInitialize(): Promise<FictionistIndex> {
      await replayRecovery();
      const raw = await storage.getItem(FICTIONIST_INDEX_KEY);
      if (raw) return parseIndex(raw);

      const seed = createDemoFictionistData();
      for (const [chapterId, content] of Object.entries(seed.chapterContents)) {
        await storage.setItem(chapterStorageKey(chapterId), content);
      }
      await writeIndex(seed.index);
      return cloneIndex(seed.index);
    },

    async readChapter(chapterId: string): Promise<string> {
      return (await storage.getItem(chapterStorageKey(chapterId))) ?? '';
    },

    async createProject(
      index: FictionistIndex,
      input: CreateProjectInput,
    ): Promise<FictionistIndex> {
      const title = normalizeText(input.title, 40, '作品名称');
      const genre = input.genre.trim() || '未设置题材';
      if (Array.from(genre).length > 30) throw new Error('题材不能超过 30 个字符');
      const projectId = createId('project');
      const volumeId = createId('volume');
      assertSafeId(projectId, '作品 ID');
      assertSafeId(volumeId, '卷 ID');
      if (index.projects[projectId] || index.volumes[volumeId]) {
        throw new Error('生成的小说数据 ID 已存在');
      }
      const timestamp = now();
      const updated = cloneIndex(index);
      updated.projects[projectId] = {
        id: projectId,
        title,
        genre,
        status: 'paused',
        volumeIds: [volumeId],
        canonEntryCount: 0,
        coverTone: 'gold',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      updated.volumes[volumeId] = {
        id: volumeId,
        projectId,
        title: '第一卷',
        chapterIds: [],
      };
      updated.updatedAt = timestamp;
      await writeIndex(updated);
      return updated;
    },

    async createChapter(
      index: FictionistIndex,
      input: CreateChapterInput,
    ): Promise<CreateChapterResult> {
      const project = index.projects[input.projectId];
      if (!project) throw new Error('作品不存在');
      const volumeId = project.volumeIds[0];
      const volume = index.volumes[volumeId];
      if (!volume) throw new Error('作品缺少可用卷');
      const chapterId = createId('chapter');
      assertSafeId(chapterId, '章节 ID');
      if (index.chapters[chapterId]) throw new Error('生成的章节 ID 已存在');
      const chapterNumber = volume.chapterIds.length + 1;
      const timestamp = now();
      const chapter: FictionChapter = {
        id: chapterId,
        projectId: project.id,
        volumeId,
        title: input.title?.trim() || `未命名章节 ${chapterNumber}`,
        status: 'draft',
        wordCount: 0,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const updated = cloneIndex(index);
      updated.chapters[chapterId] = chapter;
      updated.volumes[volumeId].chapterIds.push(chapterId);
      updated.projects[project.id].updatedAt = timestamp;
      updated.activeProjectId = project.id;
      updated.activeChapterId = chapterId;
      updated.updatedAt = timestamp;
      await commitChapter(updated, chapterId, '');
      return { index: updated, chapter };
    },

    async saveChapter(
      index: FictionistIndex,
      chapterId: string,
      content: string,
    ): Promise<FictionistIndex> {
      const chapter = index.chapters[chapterId];
      if (!chapter) throw new Error('章节不存在');
      assertChapterContentSize(content);
      const timestamp = now();
      const updated = cloneIndex(index);
      updated.chapters[chapterId] = {
        ...chapter,
        wordCount: countFictionWords(content),
        revision: chapter.revision + 1,
        updatedAt: timestamp,
      };
      updated.projects[chapter.projectId].updatedAt = timestamp;
      updated.updatedAt = timestamp;
      return commitChapter(updated, chapterId, content);
    },

    async saveSelection(
      index: FictionistIndex,
      projectId: string | null,
      chapterId: string | null,
    ): Promise<FictionistIndex> {
      if (projectId && !index.projects[projectId]) throw new Error('作品不存在');
      if (chapterId) {
        const chapter = index.chapters[chapterId];
        if (!chapter || chapter.projectId !== projectId) throw new Error('章节不属于当前作品');
      }
      const updated = cloneIndex(index);
      updated.activeProjectId = projectId;
      updated.activeChapterId = chapterId;
      updated.updatedAt = now();
      await writeIndex(updated);
      return updated;
    },
  };
}

export type FictionistRepository = ReturnType<typeof createFictionistRepository>;

export const fictionistRepository = createFictionistRepository();
