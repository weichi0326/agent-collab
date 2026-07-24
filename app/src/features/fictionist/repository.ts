import {
  getProjectStorageItem,
  removeProjectStorageItem,
  setProjectStorageItem,
} from '../../lib/tauriStorage';
import {
  FICTIONIST_SCHEMA_VERSION,
  MAX_OUTLINE_DETAILS_CHARS,
  MAX_OUTLINE_FIELD_CHARS,
  chapterAfterDeletion,
  chaptersForProject,
  countFictionWords,
  isSafeFictionistId,
  type FictionChapter,
  type FictionChapterStatus,
  type FictionCanonEntry,
  type FictionCanonEntryType,
  type FictionistIndex,
  type FictionTimelineEvent,
  type FictionTimelineEventKind,
  type FictionProjectOutline,
  type FictionProjectStatus,
  type FictionVolume,
} from './domain';
import { createDemoFictionistData } from './fixtures';

export const FICTIONIST_INDEX_KEY = 'multi-agent-fictionist-index';
export const FICTIONIST_RECOVERY_KEY = 'multi-agent-fictionist-recovery';
export const MAX_CHAPTER_CONTENT_BYTES = 8 * 1024 * 1024;
export const MAX_CUSTOM_COVER_DATA_URL_BYTES = 3 * 1024 * 1024;
export const MAX_PROJECT_OUTLINE_BYTES = 2 * 1024 * 1024;
export const MAX_CANON_ENTRY_CONTENT_BYTES = 512 * 1024;
export const MAX_TIMELINE_EVENT_DESCRIPTION_BYTES = 256 * 1024;

export interface FictionistStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

interface RepositoryOptions {
  now?: () => string;
  createId?: (prefix: 'project' | 'volume' | 'chapter' | 'timeline') => string;
  createCanonId?: () => string;
}

interface ChapterRecoveryRecord {
  schemaVersion: 1;
  kind?: 'chapter-write';
  chapterId: string;
  content: string;
  targetIndex: FictionistIndex;
}

interface ContentDeletionRecoveryRecord {
  schemaVersion: 1;
  kind: 'project-delete' | 'volume-delete' | 'chapter-delete';
  chapterIds: string[];
  targetIndex: FictionistIndex;
}

type FictionistRecoveryRecord = ChapterRecoveryRecord | ContentDeletionRecoveryRecord;

export interface CreateProjectInput {
  title: string;
  genre: string;
  coverImage?: string;
}

export interface UpdateProjectInput {
  title: string;
  genre: string;
  status: FictionProjectStatus;
  coverImage?: string;
}

export interface CreateCanonEntryInput {
  projectId: string;
  type: FictionCanonEntryType;
  name: string;
  summary: string;
  content: string;
}

export type UpdateCanonEntryInput = Omit<CreateCanonEntryInput, 'projectId'>;

export interface CreateTimelineEventInput {
  projectId: string;
  timeLabel: string;
  title: string;
  description: string;
  kind: FictionTimelineEventKind;
  sourceChapterId?: string;
  order?: number;
}

export type UpdateTimelineEventInput = Omit<CreateTimelineEventInput, 'projectId' | 'order'> & {
  order?: number;
};

export type UpdateProjectOutlineInput = Omit<FictionProjectOutline, 'updatedAt'>;

export interface CreateChapterInput {
  projectId: string;
  volumeId?: string;
  title?: string;
  content?: string;
  sourceTaskId?: string;
}

export interface CreateChapterResult {
  index: FictionistIndex;
  chapter: FictionChapter;
}

export interface CreateVolumeInput {
  projectId: string;
  title?: string;
}

export interface CreateVolumeResult {
  index: FictionistIndex;
  volume: FictionVolume;
}

export type FictionSearchField = 'chapter-title' | 'content' | 'volume-title';

interface FictionSearchMatchBase {
  volumeId: string;
  volumeTitle: string;
  excerpt: string;
}

export type FictionSearchMatch = FictionSearchMatchBase & (
  | {
      kind: 'volume';
      field: 'volume-title';
    }
  | {
      kind: 'chapter';
      chapterId: string;
      chapterTitle: string;
      field: Exclude<FictionSearchField, 'volume-title'>;
    }
);

export interface SearchProjectInput {
  projectId: string;
  query: string;
  limit?: number;
  contentOverrides?: Readonly<Record<string, string>>;
}

export interface SearchProjectResult {
  matches: FictionSearchMatch[];
  truncated: boolean;
}

export interface ReplaceProjectTextResult {
  index: FictionistIndex;
  replacementCount: number;
  changedChapterIds: string[];
}

export interface AcceptChapterDraftInput {
  chapterId: string;
  title: string;
  content: string;
  sourceTaskId: string;
}

const defaultStorage: FictionistStorage = {
  getItem: getProjectStorageItem,
  setItem: setProjectStorageItem,
  removeItem: removeProjectStorageItem,
};

function defaultCreateId(prefix: 'project' | 'volume' | 'chapter' | 'canon' | 'timeline'): string {
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
  const projectsData = parsed.projects;
  const existingCanonEntries = parsed.canonEntries ?? {};
  const shouldMigrateDemoCanon = Object.keys(existingCanonEntries).length === 0
    && (projectsData['mist-harbor']?.canonEntryCount ?? 0) > 0;
  const legacyCanonEntries = shouldMigrateDemoCanon
    ? Object.fromEntries(
        Object.entries(createDemoFictionistData().index.canonEntries)
          .filter(([_, entry]) => Boolean(projectsData[entry.projectId])),
      )
    : existingCanonEntries;
  const projects = shouldMigrateDemoCanon && projectsData['mist-harbor']
    ? {
        ...projectsData,
        'mist-harbor': {
          ...projectsData['mist-harbor'],
          canonEntryCount: Object.keys(legacyCanonEntries).length,
        },
      }
    : projectsData;
  return {
    ...parsed,
    projects,
    canonEntries: legacyCanonEntries,
    timelineEvents: parsed.timelineEvents ?? {},
  } as FictionistIndex;
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

function normalizeGenre(value: string): string {
  const genre = value.trim() || '未分类';
  if (Array.from(genre).length > 30) throw new Error('作品分类不能超过 30 个字符');
  return genre;
}

function normalizeCustomCover(value?: string): string | undefined {
  const coverImage = value?.trim();
  if (!coverImage) return undefined;
  if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/iu.test(coverImage)) {
    throw new Error('自定义封面只支持 PNG、JPEG 或 WebP 图片');
  }
  if (new TextEncoder().encode(coverImage).byteLength > MAX_CUSTOM_COVER_DATA_URL_BYTES) {
    throw new Error('自定义封面数据不能超过 3 MiB');
  }
  return coverImage;
}

function normalizeOutlineField(
  value: unknown,
  label: string,
  maxChars = MAX_OUTLINE_FIELD_CHARS,
): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (Array.from(normalized).length > maxChars) {
    throw new Error(`${label}不能超过 ${maxChars} 个字符`);
  }
  return normalized;
}

const CANON_ENTRY_TYPES: readonly FictionCanonEntryType[] = [
  'character',
  'location',
  'organization',
  'item',
  'rule',
];

function normalizeCanonEntryType(value: FictionCanonEntryType): FictionCanonEntryType {
  if (!CANON_ENTRY_TYPES.includes(value)) throw new Error('设定类型无效');
  return value;
}

function normalizeCanonEntryContent(value: string): string {
  const normalized = value.trim();
  if (new TextEncoder().encode(normalized).byteLength > MAX_CANON_ENTRY_CONTENT_BYTES) {
    throw new Error('设定正文不能超过 512 KiB');
  }
  return normalized;
}

function normalizeCanonEntrySummary(value: string): string {
  const normalized = value.trim();
  if (Array.from(normalized).length > 240) {
    throw new Error('设定摘要不能超过 240 个字符');
  }
  return normalized;
}

const TIMELINE_EVENT_KINDS: readonly FictionTimelineEventKind[] = [
  'background',
  'confirmed',
  'chapter',
];

function normalizeTimelineEventKind(value: FictionTimelineEventKind): FictionTimelineEventKind {
  if (!TIMELINE_EVENT_KINDS.includes(value)) throw new Error('时间线事件类型无效');
  return value;
}

function normalizeTimelineEventDescription(value: string): string {
  const normalized = value.trim();
  if (new TextEncoder().encode(normalized).byteLength > MAX_TIMELINE_EVENT_DESCRIPTION_BYTES) {
    throw new Error('时间线事件说明不能超过 256 KiB');
  }
  return normalized;
}

function normalizeTimelineSourceChapter(
  index: FictionistIndex,
  projectId: string,
  chapterId?: string,
): string | undefined {
  const normalized = chapterId?.trim();
  if (!normalized) return undefined;
  const chapter = index.chapters[normalized];
  if (!chapter || chapter.projectId !== projectId) throw new Error('时间线章节来源无效');
  return chapter.id;
}

function normalizeTimelineOrder(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error('时间线顺序无效');
  return Math.floor(value);
}

function syncCanonEntryCount(index: FictionistIndex, projectId: string): void {
  const project = index.projects[projectId];
  if (!project) return;
  project.canonEntryCount = Object.values(index.canonEntries)
    .filter((entry) => entry.projectId === projectId)
    .length;
}

function normalizeProjectOutline(
  index: FictionistIndex,
  projectId: string,
  input: UpdateProjectOutlineInput,
  updatedAt: string,
): FictionProjectOutline {
  const project = index.projects[projectId];
  if (!project) throw new Error('作品不存在');
  const volumes: FictionProjectOutline['volumes'] = {};
  const chapters: FictionProjectOutline['chapters'] = {};
  for (const volumeId of project.volumeIds) {
    const volume = index.volumes[volumeId];
    if (!volume || volume.projectId !== projectId) continue;
    const volumeInput = input.volumes?.[volumeId];
    if (volumeInput) {
      volumes[volumeId] = {
        summary: normalizeOutlineField(volumeInput.summary, '本卷概述'),
        objective: normalizeOutlineField(volumeInput.objective, '本卷目标'),
        turningPoint: normalizeOutlineField(volumeInput.turningPoint, '关键转折'),
        climax: normalizeOutlineField(volumeInput.climax, '高潮与收束'),
        details: normalizeOutlineField(
          volumeInput.details,
          '本卷详细大纲',
          MAX_OUTLINE_DETAILS_CHARS,
        ),
      };
    }
    for (const chapterId of volume.chapterIds) {
      const chapter = index.chapters[chapterId];
      if (!chapter || chapter.projectId !== projectId || chapter.volumeId !== volumeId) continue;
      const chapterInput = input.chapters?.[chapterId];
      if (!chapterInput) continue;
      chapters[chapterId] = {
        summary: normalizeOutlineField(chapterInput.summary, '本章概述'),
        objective: normalizeOutlineField(chapterInput.objective, '本章目标'),
        pointOfView: normalizeOutlineField(chapterInput.pointOfView, '视角人物'),
        conflict: normalizeOutlineField(chapterInput.conflict, '本章冲突'),
        keyEvents: normalizeOutlineField(chapterInput.keyEvents, '关键事件'),
        clues: normalizeOutlineField(chapterInput.clues, '线索与伏笔'),
        hook: normalizeOutlineField(chapterInput.hook, '结尾钩子'),
        details: normalizeOutlineField(
          chapterInput.details,
          '本章详细大纲',
          MAX_OUTLINE_DETAILS_CHARS,
        ),
      };
    }
  }
  const outline: FictionProjectOutline = {
    premise: normalizeOutlineField(input.premise, '一句话梗概'),
    theme: normalizeOutlineField(input.theme, '主题表达'),
    protagonistGoal: normalizeOutlineField(input.protagonistGoal, '主角目标'),
    coreConflict: normalizeOutlineField(input.coreConflict, '核心冲突'),
    endingDirection: normalizeOutlineField(input.endingDirection, '结局方向'),
    details: normalizeOutlineField(
      input.details,
      '全书详细大纲',
      MAX_OUTLINE_DETAILS_CHARS,
    ),
    volumes,
    chapters,
    updatedAt,
  };
  if (new TextEncoder().encode(JSON.stringify(outline)).byteLength > MAX_PROJECT_OUTLINE_BYTES) {
    throw new Error('单部作品的大纲数据不能超过 2 MiB');
  }
  return outline;
}

function searchExcerpt(content: string, normalizedContent: string, query: string): string {
  const matchIndex = normalizedContent.indexOf(query);
  const start = Math.max(0, matchIndex - 32);
  const end = Math.min(content.length, matchIndex + query.length + 48);
  const excerpt = content.slice(start, end).replace(/\s+/gu, ' ').trim();
  return `${start > 0 ? '…' : ''}${excerpt}${end < content.length ? '…' : ''}`;
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
  const createCanonId = options.createCanonId ?? (() => defaultCreateId('canon'));

  const writeIndex = (index: FictionistIndex) =>
    storage.setItem(FICTIONIST_INDEX_KEY, JSON.stringify(index));

  const replayRecovery = async (): Promise<void> => {
    const raw = await storage.getItem(FICTIONIST_RECOVERY_KEY);
    if (!raw) return;
    const recovery = JSON.parse(raw) as FictionistRecoveryRecord;
    if (recovery.schemaVersion !== 1) throw new Error('不支持的小说恢复记录版本');
    parseIndex(JSON.stringify(recovery.targetIndex));
    if (recovery.kind === 'project-delete'
      || recovery.kind === 'volume-delete'
      || recovery.kind === 'chapter-delete') {
      if (!Array.isArray(recovery.chapterIds)) {
        throw new Error('小说删除恢复记录缺少章节 ID');
      }
      recovery.chapterIds.forEach((chapterId) => assertSafeId(chapterId, '章节 ID'));
      await writeIndex(recovery.targetIndex);
      for (const chapterId of recovery.chapterIds) {
        await storage.removeItem(chapterStorageKey(chapterId));
      }
      await storage.removeItem(FICTIONIST_RECOVERY_KEY);
      return;
    }
    if (!('chapterId' in recovery) || !('content' in recovery)) {
      throw new Error('小说章节恢复记录缺少必要数据');
    }
    assertSafeId(recovery.chapterId, '章节 ID');
    assertChapterContentSize(recovery.content);
    await storage.setItem(chapterStorageKey(recovery.chapterId), recovery.content);
    await writeIndex(recovery.targetIndex);
    await storage.removeItem(FICTIONIST_RECOVERY_KEY);
  };

  let mutationTail: Promise<void> = Promise.resolve();
  const mutate = <T>(
    fallbackIndex: FictionistIndex,
    operation: (currentIndex: FictionistIndex) => Promise<T>,
  ): Promise<T> => {
    const pending = mutationTail.then(async () => {
      await replayRecovery();
      const persisted = await storage.getItem(FICTIONIST_INDEX_KEY);
      const currentIndex = persisted ? parseIndex(persisted) : fallbackIndex;
      return operation(currentIndex);
    });
    mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
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

  const commitDeletion = async (
    kind: ContentDeletionRecoveryRecord['kind'],
    targetIndex: FictionistIndex,
    chapterIds: string[],
  ): Promise<FictionistIndex> => {
    chapterIds.forEach((chapterId) => assertSafeId(chapterId, '章节 ID'));
    const recovery: ContentDeletionRecoveryRecord = {
      schemaVersion: 1,
      kind,
      chapterIds,
      targetIndex,
    };
    await storage.setItem(FICTIONIST_RECOVERY_KEY, JSON.stringify(recovery));
    await writeIndex(targetIndex);
    try {
      for (const chapterId of chapterIds) {
        await storage.removeItem(chapterStorageKey(chapterId));
      }
      await storage.removeItem(FICTIONIST_RECOVERY_KEY);
    } catch {
      await replayRecovery();
    }
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
      return mutate(index, async (index) => {
        const title = normalizeText(input.title, 40, '作品名称');
        const genre = normalizeGenre(input.genre);
        const coverImage = normalizeCustomCover(input.coverImage);
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
          coverImage,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        updated.canonEntries ??= {};
        updated.timelineEvents ??= {};
        updated.volumes[volumeId] = {
          id: volumeId,
          projectId,
          title: '第一卷',
          chapterIds: [],
        };
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async updateProject(
      index: FictionistIndex,
      projectId: string,
      input: UpdateProjectInput,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const project = index.projects[projectId];
        if (!project) throw new Error('作品不存在');
        if (!['drafting', 'paused', 'archived'].includes(input.status)) {
          throw new Error('书籍状态无效');
        }
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.projects[projectId] = {
          ...project,
          title: normalizeText(input.title, 40, '作品名称'),
          genre: normalizeGenre(input.genre),
          status: input.status,
          coverImage: normalizeCustomCover(input.coverImage),
          updatedAt: timestamp,
        };
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async updateProjectOutline(
      index: FictionistIndex,
      projectId: string,
      input: UpdateProjectOutlineInput,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        if (!index.projects[projectId]) throw new Error('作品不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.projects[projectId].outline = normalizeProjectOutline(
          index,
          projectId,
          input,
          timestamp,
        );
        updated.projects[projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async createCanonEntry(
      index: FictionistIndex,
      input: CreateCanonEntryInput,
    ): Promise<{ index: FictionistIndex; entry: FictionCanonEntry }> {
      return mutate(index, async (index) => {
        const project = index.projects[input.projectId];
        if (!project) throw new Error('作品不存在');
        const entryId = createCanonId();
        assertSafeId(entryId, '设定 ID');
        if (index.canonEntries[entryId]) throw new Error('生成的设定 ID 已存在');
        const timestamp = now();
        const entry: FictionCanonEntry = {
          id: entryId,
          projectId: project.id,
          type: normalizeCanonEntryType(input.type),
          name: normalizeText(input.name, 80, '设定名称'),
          summary: normalizeCanonEntrySummary(input.summary),
          content: normalizeCanonEntryContent(input.content),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const updated = cloneIndex(index);
        updated.canonEntries ??= {};
        updated.canonEntries[entry.id] = entry;
        syncCanonEntryCount(updated, project.id);
        updated.projects[project.id].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return { index: updated, entry };
      });
    },

    async importCanonEntries(
      index: FictionistIndex,
      projectId: string,
      inputs: UpdateCanonEntryInput[],
    ): Promise<{ index: FictionistIndex; count: number }> {
      return mutate(index, async (index) => {
        const project = index.projects[projectId];
        if (!project) throw new Error('作品不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.canonEntries ??= {};
        for (const input of inputs) {
          const id = createCanonId();
          assertSafeId(id, '设定 ID');
          if (updated.canonEntries[id]) throw new Error('生成的设定 ID 已存在');
          updated.canonEntries[id] = {
            id,
            projectId,
            type: normalizeCanonEntryType(input.type),
            name: normalizeText(input.name, 80, '设定名称'),
            summary: normalizeCanonEntrySummary(input.summary),
            content: normalizeCanonEntryContent(input.content),
            createdAt: timestamp,
            updatedAt: timestamp,
          };
        }
        syncCanonEntryCount(updated, projectId);
        updated.projects[projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return { index: updated, count: inputs.length };
      });
    },

    async updateCanonEntry(
      index: FictionistIndex,
      entryId: string,
      input: UpdateCanonEntryInput,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const entry = index.canonEntries[entryId];
        if (!entry) throw new Error('设定不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.canonEntries[entryId] = {
          ...entry,
          type: normalizeCanonEntryType(input.type),
          name: normalizeText(input.name, 80, '设定名称'),
          summary: normalizeCanonEntrySummary(input.summary),
          content: normalizeCanonEntryContent(input.content),
          updatedAt: timestamp,
        };
        syncCanonEntryCount(updated, entry.projectId);
        updated.projects[entry.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async deleteCanonEntry(
      index: FictionistIndex,
      entryId: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const entry = index.canonEntries[entryId];
        if (!entry) throw new Error('设定不存在');
        const updated = cloneIndex(index);
        const timestamp = now();
        delete updated.canonEntries[entryId];
        syncCanonEntryCount(updated, entry.projectId);
        updated.projects[entry.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async createTimelineEvent(
      index: FictionistIndex,
      input: CreateTimelineEventInput,
    ): Promise<{ index: FictionistIndex; event: FictionTimelineEvent }> {
      return mutate(index, async (index) => {
        const project = index.projects[input.projectId];
        if (!project) throw new Error('作品不存在');
        const eventId = createId('timeline');
        assertSafeId(eventId, '时间线事件 ID');
        if (index.timelineEvents?.[eventId]) throw new Error('生成的时间线事件 ID 已存在');
        const timestamp = now();
        const events = Object.values(index.timelineEvents ?? {})
          .filter((event) => event.projectId === project.id);
        const event: FictionTimelineEvent = {
          id: eventId,
          projectId: project.id,
          timeLabel: normalizeText(input.timeLabel, 60, '时间标记'),
          title: normalizeText(input.title, 80, '事件名称'),
          description: normalizeTimelineEventDescription(input.description),
          kind: normalizeTimelineEventKind(input.kind),
          sourceChapterId: normalizeTimelineSourceChapter(index, project.id, input.sourceChapterId),
          order: normalizeTimelineOrder(input.order, events.length),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const updated = cloneIndex(index);
        updated.timelineEvents ??= {};
        updated.timelineEvents[event.id] = event;
        updated.projects[project.id].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return { index: updated, event };
      });
    },

    async importTimelineEvents(
      index: FictionistIndex,
      projectId: string,
      inputs: UpdateTimelineEventInput[],
    ): Promise<{ index: FictionistIndex; count: number }> {
      return mutate(index, async (index) => {
        const project = index.projects[projectId];
        if (!project) throw new Error('作品不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.timelineEvents ??= {};
        const baseOrder = Object.values(updated.timelineEvents)
          .filter((event) => event.projectId === projectId).length;
        inputs.forEach((input, offset) => {
          const id = createId('timeline');
          assertSafeId(id, '时间线事件 ID');
          if (updated.timelineEvents[id]) throw new Error('生成的时间线事件 ID 已存在');
          updated.timelineEvents[id] = {
            id,
            projectId,
            timeLabel: normalizeText(input.timeLabel, 60, '时间标记'),
            title: normalizeText(input.title, 80, '事件名称'),
            description: normalizeTimelineEventDescription(input.description),
            kind: normalizeTimelineEventKind(input.kind),
            sourceChapterId: normalizeTimelineSourceChapter(updated, projectId, input.sourceChapterId),
            order: baseOrder + offset,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
        });
        updated.projects[projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return { index: updated, count: inputs.length };
      });
    },

    async updateTimelineEvent(
      index: FictionistIndex,
      eventId: string,
      input: UpdateTimelineEventInput,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const event = index.timelineEvents?.[eventId];
        if (!event) throw new Error('时间线事件不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.timelineEvents[eventId] = {
          ...event,
          timeLabel: normalizeText(input.timeLabel, 60, '时间标记'),
          title: normalizeText(input.title, 80, '事件名称'),
          description: normalizeTimelineEventDescription(input.description),
          kind: normalizeTimelineEventKind(input.kind),
          sourceChapterId: normalizeTimelineSourceChapter(index, event.projectId, input.sourceChapterId),
          order: normalizeTimelineOrder(input.order, event.order),
          updatedAt: timestamp,
        };
        updated.projects[event.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async reorderTimelineEvent(
      index: FictionistIndex,
      eventId: string,
      targetIndex: number,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const event = index.timelineEvents?.[eventId];
        if (!event) throw new Error('时间线事件不存在');
        const ordered = Object.values(index.timelineEvents ?? {})
          .filter((item) => item.projectId === event.projectId)
          .sort((left, right) => left.order - right.order || left.updatedAt.localeCompare(right.updatedAt));
        const currentIndex = ordered.findIndex((item) => item.id === eventId);
        const boundedIndex = Math.max(0, Math.min(Math.trunc(targetIndex), ordered.length - 1));
        if (currentIndex === boundedIndex) return index;
        const [moved] = ordered.splice(currentIndex, 1);
        ordered.splice(boundedIndex, 0, moved);
        const timestamp = now();
        const updated = cloneIndex(index);
        ordered.forEach((item, order) => {
          updated.timelineEvents[item.id] = {
            ...updated.timelineEvents[item.id],
            order,
            updatedAt: item.id === eventId ? timestamp : updated.timelineEvents[item.id].updatedAt,
          };
        });
        updated.projects[event.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async deleteTimelineEvent(
      index: FictionistIndex,
      eventId: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const event = index.timelineEvents?.[eventId];
        if (!event) throw new Error('时间线事件不存在');
        const updated = cloneIndex(index);
        const timestamp = now();
        delete updated.timelineEvents[eventId];
        updated.projects[event.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async renameProject(
      index: FictionistIndex,
      projectId: string,
      title: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const project = index.projects[projectId];
        if (!project) throw new Error('作品不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.projects[projectId] = {
          ...project,
          title: normalizeText(title, 40, '作品名称'),
          updatedAt: timestamp,
        };
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async deleteProject(
      index: FictionistIndex,
      projectId: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        if (!index.projects[projectId]) throw new Error('作品不存在');
        const updated = cloneIndex(index);
        const chapterIds = Object.values(updated.chapters)
          .filter((chapter) => chapter.projectId === projectId)
          .map((chapter) => chapter.id);
        const chapterIdSet = new Set(chapterIds);
        for (const [volumeId, volume] of Object.entries(updated.volumes)) {
          if (volume.projectId === projectId) delete updated.volumes[volumeId];
        }
        for (const chapterId of chapterIdSet) delete updated.chapters[chapterId];
        for (const [entryId, entry] of Object.entries(updated.canonEntries)) {
          if (entry.projectId === projectId) delete updated.canonEntries[entryId];
        }
        for (const [eventId, event] of Object.entries(updated.timelineEvents ?? {})) {
          if (event.projectId === projectId) delete updated.timelineEvents[eventId];
        }
        delete updated.projects[projectId];

        if (updated.activeProjectId === projectId) {
          const fallbackProjectId = Object.keys(updated.projects)[0] ?? null;
          updated.activeProjectId = fallbackProjectId;
          updated.activeChapterId = fallbackProjectId
            ? chaptersForProject(updated, fallbackProjectId)[0]?.id ?? null
            : null;
        } else if (updated.activeChapterId && chapterIdSet.has(updated.activeChapterId)) {
          updated.activeChapterId = null;
        }
        updated.updatedAt = now();

        return commitDeletion('project-delete', updated, chapterIds);
      });
    },

    async createVolume(
      index: FictionistIndex,
      input: CreateVolumeInput,
    ): Promise<CreateVolumeResult> {
      return mutate(index, async (index) => {
        const project = index.projects[input.projectId];
        if (!project) throw new Error('作品不存在');
        const volumeId = createId('volume');
        assertSafeId(volumeId, '卷 ID');
        if (index.volumes[volumeId]) throw new Error('生成的卷 ID 已存在');
        const timestamp = now();
        const volume: FictionVolume = {
          id: volumeId,
          projectId: project.id,
          title: input.title
            ? normalizeText(input.title, 40, '卷名称')
            : `第${project.volumeIds.length + 1}卷`,
          chapterIds: [],
        };
        const updated = cloneIndex(index);
        updated.volumes[volume.id] = volume;
        updated.projects[project.id].volumeIds.push(volume.id);
        updated.projects[project.id].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return { index: updated, volume };
      });
    },

    async renameVolume(
      index: FictionistIndex,
      volumeId: string,
      title: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const volume = index.volumes[volumeId];
        if (!volume) throw new Error('卷不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.volumes[volumeId].title = normalizeText(title, 40, '卷名称');
        updated.projects[volume.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async reorderVolume(
      index: FictionistIndex,
      volumeId: string,
      targetIndex: number,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const volume = index.volumes[volumeId];
        if (!volume) throw new Error('卷不存在');
        const project = index.projects[volume.projectId];
        const currentIndex = project.volumeIds.indexOf(volumeId);
        const boundedIndex = Math.max(0, Math.min(Math.trunc(targetIndex), project.volumeIds.length - 1));
        if (currentIndex === boundedIndex) return index;
        const timestamp = now();
        const updated = cloneIndex(index);
        const volumeIds = [...project.volumeIds];
        volumeIds.splice(currentIndex, 1);
        volumeIds.splice(boundedIndex, 0, volumeId);
        updated.projects[project.id] = { ...updated.projects[project.id], volumeIds, updatedAt: timestamp };
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async deleteVolume(
      index: FictionistIndex,
      volumeId: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const volume = index.volumes[volumeId];
        if (!volume) throw new Error('卷不存在');
        const project = index.projects[volume.projectId];
        if (!project) throw new Error('卷所属作品不存在');
        if (project.volumeIds.length <= 1) throw new Error('每部作品至少保留一个卷');
        const deletedChapterIds = [...volume.chapterIds];
        const deletedChapterIdSet = new Set(deletedChapterIds);
        const fallbackChapterId = index.activeChapterId
          ? chapterAfterDeletion(index, project.id, deletedChapterIdSet, index.activeChapterId)
          : null;
        const timestamp = now();
        const updated = cloneIndex(index);
        delete updated.volumes[volumeId];
        updated.projects[project.id].volumeIds = project.volumeIds.filter((id) => id !== volumeId);
        for (const chapterId of deletedChapterIds) delete updated.chapters[chapterId];
        const outline = updated.projects[project.id].outline;
        if (outline) {
          delete outline.volumes[volumeId];
          for (const chapterId of deletedChapterIds) delete outline.chapters[chapterId];
          outline.updatedAt = timestamp;
        }
        updated.projects[project.id].updatedAt = timestamp;
        if (updated.activeChapterId && deletedChapterIdSet.has(updated.activeChapterId)) {
          updated.activeChapterId = fallbackChapterId;
        }
        updated.updatedAt = timestamp;
        return commitDeletion('volume-delete', updated, deletedChapterIds);
      });
    },

    async createChapter(
      index: FictionistIndex,
      input: CreateChapterInput,
    ): Promise<CreateChapterResult> {
      return mutate(index, async (index) => {
        const project = index.projects[input.projectId];
        if (!project) throw new Error('作品不存在');
        const existingTaskChapter = input.sourceTaskId
          ? Object.values(index.chapters).find(
              (chapter) => chapter.sourceTaskId === input.sourceTaskId,
            )
          : undefined;
        if (existingTaskChapter) {
          return { index, chapter: existingTaskChapter };
        }
        const volumeId = input.volumeId ?? project.volumeIds[0];
        const volume = index.volumes[volumeId];
        if (!project.volumeIds.includes(volumeId) || !volume || volume.projectId !== project.id) {
          throw new Error('作品缺少可用卷');
        }
        const chapterId = createId('chapter');
        assertSafeId(chapterId, '章节 ID');
        if (index.chapters[chapterId]) throw new Error('生成的章节 ID 已存在');
        const chapterNumber = chaptersForProject(index, project.id).length + 1;
        const timestamp = now();
        const content = input.content ?? '';
        assertChapterContentSize(content);
        const chapter: FictionChapter = {
          id: chapterId,
          projectId: project.id,
          volumeId,
          title: input.title
            ? normalizeText(input.title, 80, '章节名称')
            : `未命名章节 ${chapterNumber}`,
          status: 'draft',
          wordCount: 0,
          revision: 0,
          sourceTaskId: input.sourceTaskId,
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
        updated.chapters[chapterId].wordCount = countFictionWords(content);
        await commitChapter(updated, chapterId, content);
        return { index: updated, chapter };
      });
    },

    async renameChapter(
      index: FictionistIndex,
      chapterId: string,
      title: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const chapter = index.chapters[chapterId];
        if (!chapter) throw new Error('章节不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.chapters[chapterId] = {
          ...chapter,
          title: normalizeText(title, 80, '章节名称'),
          revision: chapter.revision + 1,
          updatedAt: timestamp,
        };
        updated.projects[chapter.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async updateChapterStatus(
      index: FictionistIndex,
      chapterId: string,
      status: FictionChapterStatus,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const chapter = index.chapters[chapterId];
        if (!chapter) throw new Error('章节不存在');
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.chapters[chapterId] = { ...chapter, status, updatedAt: timestamp };
        updated.projects[chapter.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async moveChapter(
      index: FictionistIndex,
      chapterId: string,
      targetVolumeId: string,
      targetIndex: number,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const chapter = index.chapters[chapterId];
        const sourceVolume = chapter ? index.volumes[chapter.volumeId] : undefined;
        const targetVolume = index.volumes[targetVolumeId];
        if (!chapter || !sourceVolume) throw new Error('章节不存在');
        if (!targetVolume || targetVolume.projectId !== chapter.projectId) {
          throw new Error('目标卷不存在或不属于当前作品');
        }
        const sourceIds = [...sourceVolume.chapterIds];
        const sourceIndex = sourceIds.indexOf(chapterId);
        sourceIds.splice(sourceIndex, 1);
        const targetIds = targetVolume.id === sourceVolume.id
          ? sourceIds
          : [...targetVolume.chapterIds];
        const boundedIndex = Math.max(0, Math.min(Math.trunc(targetIndex), targetIds.length));
        targetIds.splice(boundedIndex, 0, chapterId);
        if (targetVolume.id === sourceVolume.id
          && sourceIndex === boundedIndex) return index;
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.volumes[sourceVolume.id] = { ...updated.volumes[sourceVolume.id], chapterIds: sourceIds };
        updated.volumes[targetVolume.id] = { ...updated.volumes[targetVolume.id], chapterIds: targetIds };
        updated.chapters[chapterId] = {
          ...updated.chapters[chapterId],
          volumeId: targetVolume.id,
          updatedAt: timestamp,
        };
        updated.projects[chapter.projectId].updatedAt = timestamp;
        updated.updatedAt = timestamp;
        await writeIndex(updated);
        return updated;
      });
    },

    async deleteChapter(
      index: FictionistIndex,
      chapterId: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        const chapter = index.chapters[chapterId];
        if (!chapter) throw new Error('章节不存在');
        const volume = index.volumes[chapter.volumeId];
        if (!volume || volume.projectId !== chapter.projectId) {
          throw new Error('章节所属卷不存在');
        }
        const fallbackChapterId = chapterAfterDeletion(
          index,
          chapter.projectId,
          new Set([chapterId]),
          chapterId,
        );
        const timestamp = now();
        const updated = cloneIndex(index);
        delete updated.chapters[chapterId];
        updated.volumes[volume.id].chapterIds = volume.chapterIds.filter((id) => id !== chapterId);
        const outline = updated.projects[chapter.projectId].outline;
        if (outline) {
          delete outline.chapters[chapterId];
          outline.updatedAt = timestamp;
        }
        updated.projects[chapter.projectId].updatedAt = timestamp;
        if (updated.activeChapterId === chapterId) {
          updated.activeChapterId = fallbackChapterId;
        }
        updated.updatedAt = timestamp;
        return commitDeletion('chapter-delete', updated, [chapterId]);
      });
    },

    async searchProject(
      index: FictionistIndex,
      input: SearchProjectInput,
    ): Promise<SearchProjectResult> {
      const project = index.projects[input.projectId];
      if (!project) throw new Error('作品不存在');
      const rawQuery = input.query.trim();
      if (!rawQuery) return { matches: [], truncated: false };
      if (Array.from(rawQuery).length > 100) throw new Error('搜索内容不能超过 100 个字符');
      const query = rawQuery.toLocaleLowerCase('zh-CN');
      const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
      const matches: FictionSearchMatch[] = [];
      let truncated = false;
      const addMatch = (match: FictionSearchMatch): boolean => {
        if (matches.length >= limit) {
          truncated = true;
          return false;
        }
        matches.push(match);
        return true;
      };

      for (const volumeId of project.volumeIds) {
        const volume = index.volumes[volumeId];
        if (!volume || volume.projectId !== project.id) continue;
        const volumeMatches = volume.title.toLocaleLowerCase('zh-CN').includes(query);
        if (volumeMatches && !addMatch({
          kind: 'volume',
          volumeId,
          volumeTitle: volume.title,
          field: 'volume-title',
          excerpt: volume.title,
        })) break;
        for (const chapterId of volume.chapterIds) {
          const chapter = index.chapters[chapterId];
          if (!chapter
            || chapter.projectId !== project.id
            || chapter.volumeId !== volume.id) continue;
          const normalizedTitle = chapter.title.toLocaleLowerCase('zh-CN');
          if (normalizedTitle.includes(query)) {
            if (!addMatch({
              kind: 'chapter',
              chapterId,
              volumeId,
              chapterTitle: chapter.title,
              volumeTitle: volume.title,
              field: 'chapter-title',
              excerpt: chapter.title,
            })) break;
            continue;
          }
          const content = input.contentOverrides?.[chapterId]
            ?? await storage.getItem(chapterStorageKey(chapterId))
            ?? '';
          const normalizedContent = content.toLocaleLowerCase('zh-CN');
          if (!normalizedContent.includes(query)) continue;
          if (!addMatch({
            kind: 'chapter',
            chapterId,
            volumeId,
            chapterTitle: chapter.title,
            volumeTitle: volume.title,
            field: 'content',
            excerpt: searchExcerpt(content, normalizedContent, query),
          })) break;
        }
        if (truncated) break;
      }
      return { matches, truncated };
    },

    async replaceProjectText(
      index: FictionistIndex,
      projectId: string,
      search: string,
      replacement: string,
    ): Promise<ReplaceProjectTextResult> {
      return mutate(index, async (index) => {
        if (!index.projects[projectId]) throw new Error('作品不存在');
        if (!search) throw new Error('查找内容不能为空');
        const candidates: Array<{ chapterId: string; content: string; count: number }> = [];
        for (const chapter of chaptersForProject(index, projectId)) {
          const content = await storage.getItem(chapterStorageKey(chapter.id)) ?? '';
          const count = content.split(search).length - 1;
          if (count > 0) candidates.push({ chapterId: chapter.id, content, count });
        }
        if (candidates.length === 0) {
          return { index, replacementCount: 0, changedChapterIds: [] };
        }
        const timestamp = now();
        let updated = cloneIndex(index);
        let replacementCount = 0;
        for (const candidate of candidates) {
          const content = candidate.content.replaceAll(search, replacement);
          assertChapterContentSize(content);
          const chapter = updated.chapters[candidate.chapterId];
          updated.chapters[candidate.chapterId] = {
            ...chapter,
            wordCount: countFictionWords(content),
            revision: chapter.revision + 1,
            updatedAt: timestamp,
          };
          updated.projects[projectId].updatedAt = timestamp;
          updated.updatedAt = timestamp;
          updated = await commitChapter(updated, candidate.chapterId, content);
          replacementCount += candidate.count;
        }
        return {
          index: updated,
          replacementCount,
          changedChapterIds: candidates.map((candidate) => candidate.chapterId),
        };
      });
    },

    async saveChapter(
      index: FictionistIndex,
      chapterId: string,
      content: string,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
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
      });
    },

    async acceptChapterDraft(
      index: FictionistIndex,
      input: AcceptChapterDraftInput,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
        if (Object.values(index.chapters).some(
          (chapter) => chapter.sourceTaskId === input.sourceTaskId,
        )) return index;
        const chapter = index.chapters[input.chapterId];
        if (!chapter) throw new Error('目标章节不存在');
        const title = normalizeText(input.title, 80, '章节名称');
        assertChapterContentSize(input.content);
        const timestamp = now();
        const updated = cloneIndex(index);
        updated.chapters[chapter.id] = {
          ...chapter,
          title,
          status: 'draft',
          wordCount: countFictionWords(input.content),
          revision: chapter.revision + 1,
          sourceTaskId: input.sourceTaskId,
          updatedAt: timestamp,
        };
        updated.projects[chapter.projectId].updatedAt = timestamp;
        updated.activeProjectId = chapter.projectId;
        updated.activeChapterId = chapter.id;
        updated.updatedAt = timestamp;
        return commitChapter(updated, chapter.id, input.content);
      });
    },

    async saveSelection(
      index: FictionistIndex,
      projectId: string | null,
      chapterId: string | null,
    ): Promise<FictionistIndex> {
      return mutate(index, async (index) => {
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
      });
    },
  };
}

export type FictionistRepository = ReturnType<typeof createFictionistRepository>;

export const fictionistRepository = createFictionistRepository();
