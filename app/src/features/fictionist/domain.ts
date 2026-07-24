export const FICTIONIST_SCHEMA_VERSION = 1 as const;

export type FictionProjectStatus = 'drafting' | 'paused' | 'archived';
export type FictionChapterStatus = 'outline' | 'draft' | 'revised' | 'final';
export type FictionCoverTone = 'teal' | 'blue' | 'red' | 'gold';
export type FictionCanonEntryType =
  | 'character'
  | 'location'
  | 'organization'
  | 'item'
  | 'rule';
export type FictionTimelineEventKind = 'background' | 'confirmed' | 'chapter';
export const MAX_OUTLINE_FIELD_CHARS = 2000;
export const MAX_OUTLINE_DETAILS_CHARS = 60_000;

export interface FictionCanonEntry {
  id: string;
  projectId: string;
  type: FictionCanonEntryType;
  name: string;
  summary: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface FictionTimelineEvent {
  id: string;
  projectId: string;
  timeLabel: string;
  title: string;
  description: string;
  kind: FictionTimelineEventKind;
  sourceChapterId?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface FictionStoryOutline {
  premise: string;
  theme: string;
  protagonistGoal: string;
  coreConflict: string;
  endingDirection: string;
  details?: string;
}

export interface FictionVolumeOutline {
  summary: string;
  objective: string;
  turningPoint: string;
  climax: string;
  details?: string;
}

export interface FictionChapterOutline {
  summary: string;
  objective: string;
  pointOfView: string;
  conflict: string;
  keyEvents: string;
  clues: string;
  hook: string;
  details?: string;
}

export interface FictionProjectOutline extends FictionStoryOutline {
  volumes: Record<string, FictionVolumeOutline>;
  chapters: Record<string, FictionChapterOutline>;
  updatedAt: string;
}

export interface FictionProject {
  id: string;
  title: string;
  genre: string;
  status: FictionProjectStatus;
  volumeIds: string[];
  canonEntryCount: number;
  coverTone: FictionCoverTone;
  coverImage?: string;
  outline?: FictionProjectOutline;
  createdAt: string;
  updatedAt: string;
}

export interface FictionVolume {
  id: string;
  projectId: string;
  title: string;
  chapterIds: string[];
}

export interface FictionChapter {
  id: string;
  projectId: string;
  volumeId: string;
  title: string;
  status: FictionChapterStatus;
  wordCount: number;
  revision: number;
  sourceTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FictionistIndex {
  schemaVersion: typeof FICTIONIST_SCHEMA_VERSION;
  projects: Record<string, FictionProject>;
  volumes: Record<string, FictionVolume>;
  chapters: Record<string, FictionChapter>;
  canonEntries: Record<string, FictionCanonEntry>;
  timelineEvents: Record<string, FictionTimelineEvent>;
  activeProjectId: string | null;
  activeChapterId: string | null;
  updatedAt: string;
}

export function createEmptyFictionVolumeOutline(): FictionVolumeOutline {
  return { summary: '', objective: '', turningPoint: '', climax: '', details: '' };
}

export function createEmptyFictionChapterOutline(): FictionChapterOutline {
  return {
    summary: '',
    objective: '',
    pointOfView: '',
    conflict: '',
    keyEvents: '',
    clues: '',
    hook: '',
    details: '',
  };
}

export function createEmptyFictionProjectOutline(): FictionProjectOutline {
  return {
    premise: '',
    theme: '',
    protagonistGoal: '',
    coreConflict: '',
    endingDirection: '',
    details: '',
    volumes: {},
    chapters: {},
    updatedAt: '',
  };
}

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function isSafeFictionistId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id);
}

export function countFictionWords(content: string): number {
  return Array.from(content).filter((character) => !/\s/u.test(character)).length;
}

export function chaptersForProject(
  index: FictionistIndex,
  projectId: string,
): FictionChapter[] {
  const project = index.projects[projectId];
  if (!project) return [];
  return project.volumeIds.flatMap((volumeId) => {
    const volume = index.volumes[volumeId];
    if (!volume) return [];
    return volume.chapterIds.flatMap((chapterId) => {
      const chapter = index.chapters[chapterId];
      return chapter ? [chapter] : [];
    });
  });
}

export function chapterAfterDeletion(
  index: FictionistIndex,
  projectId: string,
  deletedChapterIds: ReadonlySet<string>,
  activeChapterId: string,
): string | null {
  const chapters = chaptersForProject(index, projectId);
  const activePosition = chapters.findIndex((chapter) => chapter.id === activeChapterId);
  if (activePosition < 0) {
    return chapters.find((chapter) => !deletedChapterIds.has(chapter.id))?.id ?? null;
  }
  for (let position = activePosition + 1; position < chapters.length; position += 1) {
    if (!deletedChapterIds.has(chapters[position].id)) return chapters[position].id;
  }
  for (let position = activePosition - 1; position >= 0; position -= 1) {
    if (!deletedChapterIds.has(chapters[position].id)) return chapters[position].id;
  }
  return null;
}

export function projectWordCount(index: FictionistIndex, projectId: string): number {
  return chaptersForProject(index, projectId).reduce(
    (total, chapter) => total + chapter.wordCount,
    0,
  );
}

export function canonEntriesForProject(
  index: FictionistIndex,
  projectId: string,
): FictionCanonEntry[] {
  return Object.values(index.canonEntries ?? {})
    .filter((entry) => entry.projectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function timelineEventsForProject(
  index: FictionistIndex,
  projectId: string,
): FictionTimelineEvent[] {
  return Object.values(index.timelineEvents ?? {})
    .filter((event) => event.projectId === projectId)
    .sort((left, right) => left.order - right.order || left.updatedAt.localeCompare(right.updatedAt));
}
