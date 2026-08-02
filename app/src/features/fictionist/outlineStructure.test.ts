import { describe, expect, it } from 'vitest';
import { createEmptyFictionProjectOutline, isSafeFictionistId } from './domain';
import { applyOutlineStructureChange, createOutlineNodeId } from './outlineStructure';

function populatedOutline() {
  let outline = createEmptyFictionProjectOutline();
  outline = applyOutlineStructureChange(outline, {
    type: 'add-volume',
    id: 'outline-volume-1',
    title: '第一卷纲',
  });
  outline = applyOutlineStructureChange(outline, {
    type: 'add-volume',
    id: 'outline-volume-2',
    title: '第二卷纲',
  });
  outline = applyOutlineStructureChange(outline, {
    type: 'add-chapter',
    id: 'outline-chapter-1',
    volumeId: 'outline-volume-1',
    title: '第一章纲',
  });
  outline = applyOutlineStructureChange(outline, {
    type: 'add-chapter',
    id: 'outline-chapter-2',
    volumeId: 'outline-volume-1',
    title: '第二章纲',
  });
  return outline;
}

describe('fictionist outline structure', () => {
  it('creates independent volume and chapter nodes with safe ids', () => {
    const outline = populatedOutline();

    expect(outline.volumeIds).toEqual(['outline-volume-1', 'outline-volume-2']);
    expect(outline.volumes['outline-volume-1'].chapterIds).toEqual([
      'outline-chapter-1',
      'outline-chapter-2',
    ]);
    expect(outline.chapters['outline-chapter-1']).toMatchObject({
      id: 'outline-chapter-1',
      title: '第一章纲',
      objective: '',
    });
    expect(isSafeFictionistId(createOutlineNodeId('outline-volume'))).toBe(true);
    expect(isSafeFictionistId(createOutlineNodeId('outline-chapter'))).toBe(true);
  });

  it('renames and reorders outline nodes without mutating the previous draft', () => {
    const original = populatedOutline();
    const renamed = applyOutlineStructureChange(original, {
      type: 'rename-chapter',
      id: 'outline-chapter-1',
      title: '雨夜来信',
    });
    const reordered = applyOutlineStructureChange(renamed, {
      type: 'move-chapter',
      id: 'outline-chapter-1',
      targetVolumeId: 'outline-volume-1',
      targetIndex: 1,
    });

    expect(original.chapters['outline-chapter-1'].title).toBe('第一章纲');
    expect(renamed.chapters['outline-chapter-1'].title).toBe('雨夜来信');
    expect(reordered.volumes['outline-volume-1'].chapterIds).toEqual([
      'outline-chapter-2',
      'outline-chapter-1',
    ]);
  });

  it('deletes only outline nodes and keeps external manuscript links as plain references', () => {
    const original = applyOutlineStructureChange(populatedOutline(), {
      type: 'link-chapter',
      id: 'outline-chapter-1',
      linkedChapterId: 'chapter-3',
      linkedVolumeId: 'mist-harbor-volume-1',
    });
    const withoutChapter = applyOutlineStructureChange(original, {
      type: 'delete-chapter',
      id: 'outline-chapter-1',
    });
    const withoutVolume = applyOutlineStructureChange(original, {
      type: 'delete-volume',
      id: 'outline-volume-1',
    });

    expect(original.chapters['outline-chapter-1'].linkedChapterId).toBe('chapter-3');
    expect(withoutChapter.chapters).not.toHaveProperty('outline-chapter-1');
    expect(withoutVolume.volumes).not.toHaveProperty('outline-volume-1');
    expect(withoutVolume.chapters).not.toHaveProperty('outline-chapter-2');
  });

  it('moves a chapter outline between volume outlines and can unlink it', () => {
    const original = applyOutlineStructureChange(populatedOutline(), {
      type: 'link-chapter',
      id: 'outline-chapter-1',
      linkedChapterId: 'chapter-3',
      linkedVolumeId: 'mist-harbor-volume-1',
    });
    const moved = applyOutlineStructureChange(original, {
      type: 'move-chapter',
      id: 'outline-chapter-1',
      targetVolumeId: 'outline-volume-2',
      targetIndex: 0,
    });
    const unlinked = applyOutlineStructureChange(moved, {
      type: 'unlink-chapter',
      id: 'outline-chapter-1',
    });

    expect(moved.volumes['outline-volume-1'].chapterIds).toEqual(['outline-chapter-2']);
    expect(moved.volumes['outline-volume-2'].chapterIds).toEqual(['outline-chapter-1']);
    expect(unlinked.chapters['outline-chapter-1']).not.toHaveProperty('linkedChapterId');
  });
});
