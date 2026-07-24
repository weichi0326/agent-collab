import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { safeFileName } from '../../lib/agentRunner/utils';
import { executeTool } from '../../lib/pythonClient';
import type {
  FictionCanonEntryType,
  FictionistIndex,
  FictionTimelineEventKind,
} from './domain';
import { fictionistRepository } from './repository';

const SCHEMA_VERSION = 1;
const CANON_TYPES = new Set<FictionCanonEntryType>([
  'character', 'location', 'organization', 'item', 'rule',
]);
const TIMELINE_KINDS = new Set<FictionTimelineEventKind>([
  'background', 'confirmed', 'chapter',
]);

export interface CanonTransferEntry {
  type: FictionCanonEntryType;
  name: string;
  summary: string;
  content: string;
}

export interface TimelineTransferEntry {
  timeLabel: string;
  title: string;
  description: string;
  kind: FictionTimelineEventKind;
  sourceChapterTitle?: string;
  order: number;
}

type CollectionKind = 'fictionist-canon' | 'fictionist-timeline';

interface CollectionEnvelope<T> {
  kind: CollectionKind;
  schema: number;
  projectTitle: string;
  exportedAt: string;
  entries: T[];
}

interface FictionTextVolume {
  title: string;
  chapters: Array<{ title: string; content: string }>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseEnvelope(text: string, kind: CollectionKind): CollectionEnvelope<unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  if (!value || typeof value !== 'object') throw new Error('导入文件结构无效');
  const envelope = value as Partial<CollectionEnvelope<unknown>>;
  if (envelope.kind !== kind) throw new Error('文件类型与当前导入入口不匹配');
  if (typeof envelope.schema === 'number' && envelope.schema > SCHEMA_VERSION) {
    throw new Error('文件版本高于当前软件支持版本');
  }
  if (!Array.isArray(envelope.entries) || envelope.entries.length > 5000) {
    throw new Error('导入条目无效或超过 5000 条限制');
  }
  return envelope as CollectionEnvelope<unknown>;
}

export function parseCanonTransfer(text: string): CanonTransferEntry[] {
  return parseEnvelope(text, 'fictionist-canon').entries.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`第 ${index + 1} 条设定无效`);
    const item = value as Partial<CanonTransferEntry>;
    if (!CANON_TYPES.has(item.type as FictionCanonEntryType)) {
      throw new Error(`第 ${index + 1} 条设定类型无效`);
    }
    return {
      type: item.type as FictionCanonEntryType,
      name: requiredString(item.name, `第 ${index + 1} 条设定名称`),
      summary: optionalString(item.summary),
      content: optionalString(item.content),
    };
  });
}

export function parseTimelineTransfer(text: string): TimelineTransferEntry[] {
  return parseEnvelope(text, 'fictionist-timeline').entries.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`第 ${index + 1} 条事件无效`);
    const item = value as Partial<TimelineTransferEntry>;
    if (!TIMELINE_KINDS.has(item.kind as FictionTimelineEventKind)) {
      throw new Error(`第 ${index + 1} 条事件类型无效`);
    }
    return {
      timeLabel: requiredString(item.timeLabel, `第 ${index + 1} 条时间标记`),
      title: requiredString(item.title, `第 ${index + 1} 条事件名称`),
      description: optionalString(item.description),
      kind: item.kind as FictionTimelineEventKind,
      sourceChapterTitle: optionalString(item.sourceChapterTitle) || undefined,
      order: Number.isFinite(item.order) ? Number(item.order) : index,
    };
  });
}

export async function exportFictionCollection<T>(
  kind: CollectionKind,
  projectTitle: string,
  entries: T[],
): Promise<'ok' | 'cancelled'> {
  if (!isTauri()) throw new Error('导出需在桌面端使用');
  const label = kind === 'fictionist-canon' ? '设定库' : '时间线';
  const target = await save({
    title: `导出${label}`,
    defaultPath: `${safeFileName(projectTitle) || 'novel'}-${label}.json`,
    filters: [{ name: `${label}数据`, extensions: ['json'] }],
  });
  if (!target) return 'cancelled';
  const envelope: CollectionEnvelope<T> = {
    kind,
    schema: SCHEMA_VERSION,
    projectTitle,
    exportedAt: new Date().toISOString(),
    entries,
  };
  const result = await executeTool('file-write', {
    path: target,
    content: JSON.stringify(envelope, null, 2),
    mode: 'overwrite',
    mkdir: true,
    atomic: true,
    allow_outside_roots: true,
  });
  if (!result.ok) throw new Error(result.error || '写入导出文件失败');
  return 'ok';
}

export function buildFictionProjectText(
  projectTitle: string,
  volumes: readonly FictionTextVolume[],
): string {
  const sections = volumes.flatMap((volume) => [
    volume.title,
    ...volume.chapters.flatMap((chapter) => [chapter.title, chapter.content.trimEnd()]),
  ]);
  return [`《${projectTitle}》`, ...sections].join('\n\n').trimEnd() + '\n';
}

export async function exportFictionProjectText(
  index: FictionistIndex,
  projectId: string,
): Promise<'ok' | 'cancelled'> {
  if (!isTauri()) throw new Error('导出需在桌面端使用');
  const project = index.projects[projectId];
  if (!project) throw new Error('要导出的作品不存在');

  const volumes = await Promise.all(project.volumeIds.flatMap((volumeId) => {
    const volume = index.volumes[volumeId];
    if (!volume) return [];
    return [Promise.all(volume.chapterIds.flatMap((chapterId) => {
      const chapter = index.chapters[chapterId];
      return chapter
        ? [fictionistRepository.readChapter(chapterId).then((content) => ({
            title: chapter.title,
            content,
          }))]
        : [];
    })).then((chapters) => ({ title: volume.title, chapters }))];
  }));
  const target = await save({
    title: '导出小说正文',
    defaultPath: `${safeFileName(project.title) || 'novel'}.txt`,
    filters: [{ name: '纯文本小说', extensions: ['txt'] }],
  });
  if (!target) return 'cancelled';
  const result = await executeTool('file-write', {
    path: target,
    content: buildFictionProjectText(project.title, volumes),
    mode: 'overwrite',
    mkdir: true,
    atomic: true,
    allow_outside_roots: true,
  });
  if (!result.ok) throw new Error(result.error || '写入小说文件失败');
  return 'ok';
}
