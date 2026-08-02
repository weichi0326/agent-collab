import {
  createEmptyFictionChapterOutline,
  createEmptyFictionVolumeOutline,
  type FictionProjectOutline,
} from './domain';

export type OutlineStructureChange =
  | { type: 'add-volume'; id: string; title: string }
  | { type: 'rename-volume'; id: string; title: string }
  | { type: 'move-volume'; id: string; targetIndex: number }
  | { type: 'delete-volume'; id: string }
  | { type: 'add-chapter'; id: string; volumeId: string; title: string }
  | { type: 'rename-chapter'; id: string; title: string }
  | { type: 'move-chapter'; id: string; targetVolumeId: string; targetIndex: number }
  | { type: 'delete-chapter'; id: string }
  | {
      type: 'link-chapter';
      id: string;
      linkedChapterId: string;
      linkedVolumeId: string;
    }
  | { type: 'unlink-chapter'; id: string };

function cloneOutline(outline: FictionProjectOutline): FictionProjectOutline {
  return {
    ...outline,
    volumeIds: [...outline.volumeIds],
    volumes: Object.fromEntries(Object.entries(outline.volumes).map(([id, volume]) => [
      id,
      { ...volume, chapterIds: [...volume.chapterIds] },
    ])),
    chapters: Object.fromEntries(Object.entries(outline.chapters).map(([id, chapter]) => [
      id,
      { ...chapter },
    ])),
  };
}

function requiredTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) throw new Error('大纲名称不能为空');
  return normalized;
}

function boundedIndex(targetIndex: number, length: number): number {
  return Math.max(0, Math.min(Math.trunc(targetIndex), length));
}

export function createOutlineNodeId(prefix: 'outline-volume' | 'outline-chapter'): string {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${randomPart.slice(0, 32)}`;
}

export function applyOutlineStructureChange(
  outline: FictionProjectOutline,
  change: OutlineStructureChange,
): FictionProjectOutline {
  const next = cloneOutline(outline);
  switch (change.type) {
    case 'add-volume': {
      if (next.volumes[change.id]) throw new Error('卷纲 ID 已存在');
      next.volumeIds.push(change.id);
      next.volumes[change.id] = {
        id: change.id,
        title: requiredTitle(change.title),
        chapterIds: [],
        ...createEmptyFictionVolumeOutline(),
      };
      return next;
    }
    case 'rename-volume': {
      const volume = next.volumes[change.id];
      if (!volume) throw new Error('卷纲不存在');
      volume.title = requiredTitle(change.title);
      return next;
    }
    case 'move-volume': {
      const currentIndex = next.volumeIds.indexOf(change.id);
      if (currentIndex < 0) throw new Error('卷纲不存在');
      const [volumeId] = next.volumeIds.splice(currentIndex, 1);
      next.volumeIds.splice(boundedIndex(change.targetIndex, next.volumeIds.length), 0, volumeId);
      return next;
    }
    case 'delete-volume': {
      const volume = next.volumes[change.id];
      if (!volume) throw new Error('卷纲不存在');
      next.volumeIds = next.volumeIds.filter((id) => id !== change.id);
      for (const chapterId of volume.chapterIds) delete next.chapters[chapterId];
      delete next.volumes[change.id];
      return next;
    }
    case 'add-chapter': {
      const volume = next.volumes[change.volumeId];
      if (!volume) throw new Error('卷纲不存在');
      if (next.chapters[change.id]) throw new Error('章纲 ID 已存在');
      volume.chapterIds.push(change.id);
      next.chapters[change.id] = {
        id: change.id,
        title: requiredTitle(change.title),
        ...createEmptyFictionChapterOutline(),
      };
      return next;
    }
    case 'rename-chapter': {
      const chapter = next.chapters[change.id];
      if (!chapter) throw new Error('章纲不存在');
      chapter.title = requiredTitle(change.title);
      return next;
    }
    case 'move-chapter': {
      const targetVolume = next.volumes[change.targetVolumeId];
      const sourceVolume = Object.values(next.volumes).find(
        (volume) => volume.chapterIds.includes(change.id),
      );
      if (!next.chapters[change.id] || !sourceVolume) throw new Error('章纲不存在');
      if (!targetVolume) throw new Error('目标卷纲不存在');
      sourceVolume.chapterIds = sourceVolume.chapterIds.filter((id) => id !== change.id);
      const targetIds = targetVolume.id === sourceVolume.id
        ? sourceVolume.chapterIds
        : targetVolume.chapterIds;
      targetIds.splice(boundedIndex(change.targetIndex, targetIds.length), 0, change.id);
      return next;
    }
    case 'delete-chapter': {
      if (!next.chapters[change.id]) throw new Error('章纲不存在');
      for (const volume of Object.values(next.volumes)) {
        volume.chapterIds = volume.chapterIds.filter((id) => id !== change.id);
      }
      delete next.chapters[change.id];
      return next;
    }
    case 'link-chapter': {
      const chapter = next.chapters[change.id];
      const volume = Object.values(next.volumes).find(
        (item) => item.chapterIds.includes(change.id),
      );
      if (!chapter || !volume) throw new Error('章纲不存在');
      chapter.linkedChapterId = change.linkedChapterId;
      volume.linkedVolumeId = change.linkedVolumeId;
      return next;
    }
    case 'unlink-chapter': {
      const chapter = next.chapters[change.id];
      if (!chapter) throw new Error('章纲不存在');
      delete chapter.linkedChapterId;
      return next;
    }
  }
}
