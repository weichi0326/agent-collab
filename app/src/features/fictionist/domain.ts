export const FICTIONIST_SCHEMA_VERSION = 1 as const;

export type FictionProjectStatus = 'drafting' | 'paused' | 'archived';
export type FictionChapterStatus = 'outline' | 'draft' | 'revised' | 'final';
export type FictionCoverTone = 'teal' | 'blue' | 'red' | 'gold';

export interface FictionProject {
  id: string;
  title: string;
  genre: string;
  status: FictionProjectStatus;
  volumeIds: string[];
  canonEntryCount: number;
  coverTone: FictionCoverTone;
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
  activeProjectId: string | null;
  activeChapterId: string | null;
  updatedAt: string;
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

export function projectWordCount(index: FictionistIndex, projectId: string): number {
  return chaptersForProject(index, projectId).reduce(
    (total, chapter) => total + chapter.wordCount,
    0,
  );
}
