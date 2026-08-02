import type { Edge, Node } from '@xyflow/react';
import { uid } from '../../lib/id';
import type { ModelRef } from '../../lib/modelRef';
import type { AgentNodeData } from '../../stores/canvasStore';
import { professionalAgentNodeData } from '../professionalPackages/domain';
import { FICTIONIST_AGENT_IDS, findFictionistAgent } from './agents';
import { createOutlineNodeId } from './outlineStructure';
import {
  MAX_OUTLINE_DETAILS_CHARS,
  MAX_OUTLINE_FIELD_CHARS,
  canonEntriesForProject,
  createEmptyFictionChapterOutline,
  createEmptyFictionProjectOutline,
  createEmptyFictionVolumeOutline,
  timelineEventsForProject,
  type FictionChapterOutline,
  type FictionistIndex,
  type FictionProject,
  type FictionProjectOutline,
  type FictionStoryOutline,
  type FictionVolumeOutline,
} from './domain';

export const FICTIONIST_OUTLINE_WORKFLOW_KEYS = {
  import: 'fictionist.outline-import',
  optimize: 'fictionist.outline-optimize',
} as const;

export type FictionistOutlineWorkflowKey =
  (typeof FICTIONIST_OUTLINE_WORKFLOW_KEYS)[keyof typeof FICTIONIST_OUTLINE_WORKFLOW_KEYS];
export type FictionOutlineTaskOperation = 'import' | 'optimize';
export type FictionOutlineImportStrategy = 'replace' | 'append';
export type FictionOutlineOptimizationIntensity = 'conservative' | 'balanced' | 'rewrite';
export type FictionOutlineTaskTarget =
  | { kind: 'story' }
  | { kind: 'volume'; id: string }
  | { kind: 'chapter'; id: string };

export const OUTLINE_IMPORT_TASK_TYPE = 'outline-import';
export const OUTLINE_OPTIMIZE_TASK_TYPE = 'outline-optimize';
export const OUTLINE_RESULT_ROLE = 'fictionist.outline-draft';
export const MAX_OUTLINE_WORKFLOW_SOURCE_CHARS = 60_000;

export interface FictionOutlineTaskPayload {
  operation: FictionOutlineTaskOperation;
  projectId: string;
  target: FictionOutlineTaskTarget;
  targetLabel: string;
  sourceOutlineUpdatedAt: string;
  sourceName?: string;
  optimizationGoals?: string[];
  intensity?: FictionOutlineOptimizationIntensity;
}

export interface FictionOutlineWorkflowVolumeResult extends FictionVolumeOutline {
  id: string;
  title?: string;
  isNew?: boolean;
}

export interface FictionOutlineWorkflowChapterResult extends FictionChapterOutline {
  id: string;
  title?: string;
  volumeId?: string;
  isNew?: boolean;
}

export interface FictionOutlineWorkflowResult {
  story: FictionStoryOutline | null;
  volumes: FictionOutlineWorkflowVolumeResult[];
  chapters: FictionOutlineWorkflowChapterResult[];
  changeSummary: string[];
}

const STORY_KEYS = [
  'premise',
  'theme',
  'protagonistGoal',
  'coreConflict',
  'endingDirection',
  'details',
] as const;
const VOLUME_KEYS = ['summary', 'objective', 'turningPoint', 'climax', 'details'] as const;
const CHAPTER_KEYS = [
  'summary',
  'objective',
  'pointOfView',
  'conflict',
  'keyEvents',
  'clues',
  'hook',
  'details',
] as const;

function stringProperties(keys: readonly string[]): Record<string, { type: 'string' }> {
  return Object.fromEntries(keys.map((key) => [key, { type: 'string' as const }]));
}

export function outlineResultSchemaText(operation: FictionOutlineTaskOperation): string {
  const importing = operation === 'import';
  return JSON.stringify({
    type: 'object',
    required: ['story', 'volumes', 'chapters', 'changeSummary'],
    properties: {
      story: {
        type: ['object', 'null'],
        required: STORY_KEYS,
        properties: stringProperties(STORY_KEYS),
      },
      volumes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', ...(importing ? ['title'] : []), ...VOLUME_KEYS],
          properties: {
            id: { type: 'string' },
            ...(importing ? { title: { type: 'string' } } : {}),
            ...stringProperties(VOLUME_KEYS),
          },
        },
      },
      chapters: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', ...(importing ? ['volumeId', 'title'] : []), ...CHAPTER_KEYS],
          properties: {
            id: { type: 'string' },
            ...(importing ? {
              volumeId: { type: 'string' },
              title: { type: 'string' },
            } : {}),
            ...stringProperties(CHAPTER_KEYS),
          },
        },
      },
      changeSummary: { type: 'array', items: { type: 'string' } },
    },
  }, null, 2);
}

export function applyOutlineTaskRuntimeContract(
  data: AgentNodeData,
  operation: FictionOutlineTaskOperation,
): AgentNodeData {
  const constraint = operation === 'import'
    ? '【本次任务结构约束】已有卷章必须复用正式 ID；原文中明确存在的新卷章允许使用 new-volume-*、new-chapter-* 临时 ID，并必须填写标题与所属卷。此约束优先于旧版提示词中禁止新增结构的要求。'
    : '【本次任务结构约束】只能修改任务快照目标范围内的已有大纲，必须复用正式 ID，不得新建、删除或移动卷纲和章纲。';
  return {
    ...data,
    systemPrompt: [data.systemPrompt?.trim(), constraint].filter(Boolean).join('\n\n'),
    ...(data.resultRole === OUTLINE_RESULT_ROLE
      ? { outputSchemaText: outlineResultSchemaText(operation) }
      : {}),
  };
}

export function isFictionistOutlineTaskPayload(
  value: unknown,
): value is FictionOutlineTaskPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const target = record.target;
  return (record.operation === 'import' || record.operation === 'optimize')
    && typeof record.projectId === 'string'
    && typeof record.targetLabel === 'string'
    && typeof record.sourceOutlineUpdatedAt === 'string'
    && Boolean(target)
    && typeof target === 'object'
    && !Array.isArray(target)
    && ['story', 'volume', 'chapter'].includes(
      String((target as { kind?: unknown }).kind),
    );
}

export function outlineTargetValue(target: FictionOutlineTaskTarget): string {
  return target.kind === 'story' ? 'story' : `${target.kind}:${target.id}`;
}

export function outlineTargetFromValue(value: string): FictionOutlineTaskTarget | null {
  if (value === 'story') return { kind: 'story' };
  const separator = value.indexOf(':');
  if (separator < 1 || separator === value.length - 1) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === 'volume' || kind === 'chapter') return { kind, id };
  return null;
}

export function outlineTargetLabel(
  index: FictionistIndex,
  target: FictionOutlineTaskTarget,
): string {
  if (target.kind === 'story') return '全书大纲';
  for (const project of Object.values(index.projects)) {
    const outline = project.outline;
    if (target.kind === 'volume' && outline?.volumes[target.id]) {
      return outline.volumes[target.id].title;
    }
    if (target.kind === 'chapter' && outline?.chapters[target.id]) {
      return outline.chapters[target.id].title;
    }
  }
  return target.kind === 'volume' ? '已删除的卷纲' : '已删除的章纲';
}

export function outlineTargetExists(
  index: FictionistIndex,
  projectId: string,
  target: FictionOutlineTaskTarget,
): boolean {
  const outline = index.projects[projectId]?.outline;
  if (target.kind === 'story') return Boolean(index.projects[projectId]);
  if (target.kind === 'volume') {
    return Boolean(outline?.volumeIds.includes(target.id) && outline.volumes[target.id]);
  }
  return Boolean(outline && Object.values(outline.volumes)
    .some((volume) => volume.chapterIds.includes(target.id)) && outline.chapters[target.id]);
}

function appendImportedText(current: string | undefined, imported: string): string {
  return current?.trim() ? `${current.trim()}\n\n${imported}` : imported;
}

export function applyDirectOutlineImport(
  outline: FictionProjectOutline,
  index: FictionistIndex,
  projectId: string,
  target: FictionOutlineTaskTarget,
  sourceText: string,
  strategy: FictionOutlineImportStrategy,
): FictionProjectOutline {
  const normalized = sourceText.replace(/^\uFEFF/u, '').trim();
  if (!normalized) throw new Error('导入的大纲文件为空');
  if (Array.from(normalized).length > MAX_OUTLINE_DETAILS_CHARS) {
    throw new Error(`大纲文件不能超过 ${MAX_OUTLINE_DETAILS_CHARS} 个字符`);
  }
  if (!outlineTargetExists(index, projectId, target)) throw new Error('导入目标已不存在');
  if (target.kind === 'story') {
    return {
      ...outline,
      details: strategy === 'append'
        ? appendImportedText(outline.details, normalized)
        : normalized,
    };
  }
  if (target.kind === 'volume') {
    const current = outline.volumes[target.id] ?? createEmptyFictionVolumeOutline();
    return {
      ...outline,
      volumes: {
        ...outline.volumes,
        [target.id]: {
          ...current,
          details: strategy === 'append'
            ? appendImportedText(current.details, normalized)
            : normalized,
        },
      },
    };
  }
  const current = outline.chapters[target.id] ?? createEmptyFictionChapterOutline();
  return {
    ...outline,
    chapters: {
      ...outline.chapters,
      [target.id]: {
        ...current,
        details: strategy === 'append'
          ? appendImportedText(current.details, normalized)
          : normalized,
      },
    },
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Use one stable user-facing error for malformed model output.
  }
  throw new Error('工作流没有返回可识别的结构化大纲');
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxChars = MAX_OUTLINE_FIELD_CHARS,
): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`${label}不是文本`);
  const normalized = value.trim();
  if (Array.from(normalized).length > maxChars) {
    throw new Error(`${label}不能超过 ${maxChars} 个字符`);
  }
  return normalized;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxChars = MAX_OUTLINE_FIELD_CHARS,
): string | undefined {
  return record[key] === undefined ? undefined : readString(record, key, label, maxChars);
}

function readStory(value: unknown): FictionStoryOutline | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('全书大纲结果结构无效');
  }
  const record = value as Record<string, unknown>;
  return {
    premise: readString(record, 'premise', '一句话梗概'),
    theme: readString(record, 'theme', '主题表达'),
    protagonistGoal: readString(record, 'protagonistGoal', '主角目标'),
    coreConflict: readString(record, 'coreConflict', '核心冲突'),
    endingDirection: readString(record, 'endingDirection', '结局方向'),
    details: readString(record, 'details', '全书详细大纲', MAX_OUTLINE_DETAILS_CHARS),
  };
}

function readItems<T>(
  value: unknown,
  label: string,
  read: (record: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}结果不是列表`);
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label}结果包含无效项目`);
    }
    return read(item as Record<string, unknown>);
  });
}

function assertTargetScope(
  index: FictionistIndex,
  projectId: string,
  target: FictionOutlineTaskTarget,
  result: FictionOutlineWorkflowResult,
  operation: FictionOutlineTaskOperation,
): void {
  if (!outlineTargetExists(index, projectId, target)) throw new Error('大纲任务目标已不存在');
  const outline = index.projects[projectId]?.outline ?? createEmptyFictionProjectOutline();
  const proposedVolumeIds = new Set(result.volumes
    .filter((volume) => !outline.volumes[volume.id])
    .map((volume) => volume.id));
  const seenVolumeIds = new Set<string>();
  const seenChapterIds = new Set<string>();
  if (target.kind !== 'story' && result.story) throw new Error('结果包含目标范围之外的全书大纲');
  for (const volume of result.volumes) {
    const current = outline.volumes[volume.id];
    if (seenVolumeIds.has(volume.id)) throw new Error(`结果包含重复的卷纲 ID：${volume.id}`);
    seenVolumeIds.add(volume.id);
    volume.isNew = !current;
    if (!current) {
      if (operation === 'optimize') throw new Error(`优化任务不能新建卷纲：${volume.id}`);
      if (target.kind !== 'story') throw new Error('只有全书大纲导入可以新建卷纲');
      if (!/^new-volume-[a-z0-9-]+$/u.test(volume.id)) {
        throw new Error('新卷纲必须使用 new-volume- 开头的临时 ID');
      }
      if (!volume.title?.trim()) throw new Error(`新卷纲缺少标题：${volume.id}`);
    }
    if (target.kind === 'volume' && volume.id !== target.id) {
      throw new Error('结果包含目标范围之外的卷纲');
    }
    if (target.kind === 'chapter') throw new Error('章节优化结果不应包含卷纲');
  }
  for (const chapter of result.chapters) {
    const current = outline.chapters[chapter.id];
    if (seenChapterIds.has(chapter.id)) throw new Error(`结果包含重复的章纲 ID：${chapter.id}`);
    seenChapterIds.add(chapter.id);
    chapter.isNew = !current;
    if (!current) {
      if (operation === 'optimize') throw new Error(`优化任务不能新建章纲：${chapter.id}`);
      if (target.kind === 'chapter') throw new Error('单章导入不能新建章纲');
      if (!/^new-chapter-[a-z0-9-]+$/u.test(chapter.id)) {
        throw new Error('新章纲必须使用 new-chapter- 开头的临时 ID');
      }
      if (!chapter.title?.trim()) throw new Error(`新章纲缺少标题：${chapter.id}`);
      if (!chapter.volumeId) throw new Error(`新章纲缺少所属卷：${chapter.id}`);
      if (!outline.volumes[chapter.volumeId] && !proposedVolumeIds.has(chapter.volumeId)) {
        throw new Error(`新章纲引用了不存在的卷纲：${chapter.volumeId}`);
      }
      if (target.kind === 'volume' && chapter.volumeId !== target.id) {
        throw new Error('结果包含目标卷之外的新章纲');
      }
    } else if (chapter.volumeId) {
      const currentVolume = Object.values(outline.volumes).find(
        (volume) => volume.chapterIds.includes(chapter.id),
      );
      if (currentVolume?.id !== chapter.volumeId) {
        throw new Error('导入任务不能移动已有章纲');
      }
    }
    if (target.kind === 'volume' && !outline.volumes[target.id]?.chapterIds.includes(chapter.id)) {
      if (!chapter.isNew) throw new Error('结果包含目标卷之外的章节纲要');
    }
    if (target.kind === 'chapter' && chapter.id !== target.id) {
      throw new Error('结果包含目标范围之外的章节纲要');
    }
  }
  if (target.kind === 'story' && !result.story) throw new Error('结果缺少全书大纲');
  if (target.kind === 'volume' && !result.volumes.some((item) => item.id === target.id)) {
    throw new Error('结果缺少目标卷纲');
  }
  if (target.kind === 'chapter' && !result.chapters.some((item) => item.id === target.id)) {
    throw new Error('结果缺少目标章节纲要');
  }
}

export function parseOutlineWorkflowResult(
  content: string,
  index: FictionistIndex,
  projectId: string,
  target: FictionOutlineTaskTarget,
  operation: FictionOutlineTaskOperation = 'optimize',
): FictionOutlineWorkflowResult {
  const record = parseJsonObject(content);
  const result: FictionOutlineWorkflowResult = {
    story: readStory(record.story),
    volumes: readItems(record.volumes, '卷纲', (item) => ({
      id: readString(item, 'id', '卷 ID', 64),
      title: readOptionalString(item, 'title', '卷纲标题'),
      summary: readString(item, 'summary', '本卷概述'),
      objective: readString(item, 'objective', '阶段目标'),
      turningPoint: readString(item, 'turningPoint', '关键转折'),
      climax: readString(item, 'climax', '高潮与收束'),
      details: readString(item, 'details', '本卷详细大纲', MAX_OUTLINE_DETAILS_CHARS),
    })),
    chapters: readItems(record.chapters, '章节纲要', (item) => ({
      id: readString(item, 'id', '章节 ID', 64),
      volumeId: readOptionalString(item, 'volumeId', '所属卷 ID', 64),
      title: readOptionalString(item, 'title', '章纲标题'),
      summary: readString(item, 'summary', '本章概述'),
      objective: readString(item, 'objective', '本章目标'),
      pointOfView: readString(item, 'pointOfView', '视角人物'),
      conflict: readString(item, 'conflict', '本章冲突'),
      keyEvents: readString(item, 'keyEvents', '关键事件'),
      clues: readString(item, 'clues', '线索与伏笔'),
      hook: readString(item, 'hook', '结尾钩子'),
      details: readString(item, 'details', '本章详细大纲', MAX_OUTLINE_DETAILS_CHARS),
    })),
    changeSummary: [],
  };
  if (Array.isArray(record.changeSummary)) {
    result.changeSummary = record.changeSummary.map((item, index) => {
      if (typeof item !== 'string' || !item.trim()) throw new Error(`第 ${index + 1} 条修改说明无效`);
      return item.trim().slice(0, 500);
    });
  }
  assertTargetScope(index, projectId, target, result, operation);
  return result;
}

export function applyOutlineWorkflowResult(
  outline: FictionProjectOutline,
  result: FictionOutlineWorkflowResult,
  createNodeId: typeof createOutlineNodeId = createOutlineNodeId,
): FictionProjectOutline {
  const next: FictionProjectOutline = {
    ...outline,
    ...(result.story ?? outline),
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
  const volumeIdMap = new Map<string, string>();
  const occupiedIds = new Set([...Object.keys(next.volumes), ...Object.keys(next.chapters)]);
  const allocateId = (prefix: 'outline-volume' | 'outline-chapter') => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = createNodeId(prefix);
      if (!occupiedIds.has(id)) {
        occupiedIds.add(id);
        return id;
      }
    }
    throw new Error('无法为导入的大纲生成唯一 ID');
  };

  for (const item of result.volumes) {
    const { id, title, isNew: _isNew, ...fields } = item;
    const current = next.volumes[id];
    if (current) {
      next.volumes[id] = { ...current, ...fields, ...(title ? { title } : {}) };
      volumeIdMap.set(id, id);
      continue;
    }
    const localId = allocateId('outline-volume');
    volumeIdMap.set(id, localId);
    next.volumeIds.push(localId);
    next.volumes[localId] = {
      id: localId,
      title: title?.trim() || '未命名卷纲',
      chapterIds: [],
      ...fields,
    };
  }

  for (const item of result.chapters) {
    const {
      id,
      title,
      volumeId,
      isNew: _isNew,
      ...fields
    } = item;
    const current = next.chapters[id];
    if (current) {
      next.chapters[id] = { ...current, ...fields, ...(title ? { title } : {}) };
      continue;
    }
    const parentVolumeId = volumeId ? (volumeIdMap.get(volumeId) ?? volumeId) : undefined;
    const parentVolume = parentVolumeId ? next.volumes[parentVolumeId] : undefined;
    if (!parentVolume) throw new Error(`导入章纲的所属卷不存在：${volumeId ?? id}`);
    const localId = allocateId('outline-chapter');
    parentVolume.chapterIds.push(localId);
    next.chapters[localId] = {
      id: localId,
      title: title?.trim() || '未命名章纲',
      ...fields,
    };
  }
  return next;
}

function relevantOutline(
  outline: FictionProjectOutline,
  target: FictionOutlineTaskTarget,
): unknown {
  if (target.kind === 'story') return outline;
  if (target.kind === 'volume') {
    const volume = outline.volumes[target.id];
    return {
      volume: outline.volumes[target.id] ?? createEmptyFictionVolumeOutline(),
      chapters: Object.fromEntries((volume?.chapterIds ?? []).map((id) => [
        id,
        outline.chapters[id] ?? createEmptyFictionChapterOutline(),
      ])),
    };
  }
  return outline.chapters[target.id] ?? createEmptyFictionChapterOutline();
}

function bounded(value: string, maxChars: number): string {
  return Array.from(value).length <= maxChars
    ? value
    : `${Array.from(value).slice(0, maxChars).join('')}\n\n[内容过长，已截断]`;
}

export function buildOutlineTaskSnapshot(input: {
  operation: FictionOutlineTaskOperation;
  project: FictionProject;
  index: FictionistIndex;
  outline?: FictionProjectOutline;
  target: FictionOutlineTaskTarget;
  sourceName?: string;
  sourceText?: string;
  optimizationGoals?: string[];
  intensity?: FictionOutlineOptimizationIntensity;
  requirements?: string;
}): string {
  const outline = input.outline ?? createEmptyFictionProjectOutline();
  const targetLabel = outlineTargetLabel(input.index, input.target);
  const structure = outline.volumeIds.map((volumeId) => {
    const volume = outline.volumes[volumeId];
    return {
      id: volumeId,
      title: volume?.title ?? '未知卷纲',
      chapters: (volume?.chapterIds ?? []).map((chapterId) => ({
        id: chapterId,
        title: outline.chapters[chapterId]?.title ?? '未知章纲',
      })),
    };
  });
  const intensityLabels: Record<FictionOutlineOptimizationIntensity, string> = {
    conservative: '保守调整',
    balanced: '适度优化',
    rewrite: '大幅重构',
  };
  const sections = [
    `# 小说大纲${input.operation === 'import' ? '整理导入' : '优化'}任务`,
    `- 作品：${input.project.title}`,
    `- 题材：${input.project.genre}`,
    `- 目标范围：${targetLabel}`,
    `- 操作：${input.operation === 'import' ? '把本地大纲整理成软件结构' : '优化现有大纲'}`,
    input.operation === 'optimize'
      ? `- 修改强度：${intensityLabels[input.intensity ?? 'balanced']}`
      : '',
    input.optimizationGoals?.length
      ? `- 优化方向：${input.optimizationGoals.join('、')}`
      : '',
    input.requirements?.trim() ? `- 用户补充要求：${input.requirements.trim()}` : '',
    `## 当前大纲结构（已有内容必须复用这些 ID）\n${JSON.stringify(structure, null, 2)}`,
    `## 当前目标范围大纲\n${bounded(JSON.stringify(
      relevantOutline(outline, input.target),
      null,
      2,
    ), MAX_OUTLINE_WORKFLOW_SOURCE_CHARS)}`,
    `## 正式设定库\n${bounded(JSON.stringify(
      canonEntriesForProject(input.index, input.project.id),
      null,
      2,
    ), 20_000)}`,
    `## 已登记时间线\n${bounded(JSON.stringify(
      timelineEventsForProject(input.index, input.project.id),
      null,
      2,
    ), 20_000)}`,
  ];
  if (input.operation === 'import') {
    sections.push(
      `## 本地文件：${input.sourceName?.trim() || '未命名大纲'}\n${bounded(
        input.sourceText?.trim() || '',
        MAX_OUTLINE_WORKFLOW_SOURCE_CHARS,
      )}`,
    );
  }
  sections.push(input.operation === 'import'
    ? '## 输出约束\n只整理目标范围并保留原意与明确事实。已有卷纲、章纲必须复用“当前大纲结构”中的 ID；原文中明确存在但当前结构中没有的卷纲或章纲，可使用 new-volume-1、new-chapter-1 这类临时 ID 提议新增。每个卷纲必须输出 title，每个章纲必须输出 title 和所属 volumeId。story 仅在目标为全书大纲时输出对象，否则输出 null。'
    : '## 输出约束\n只修改目标范围；保留原意与明确事实；所有卷纲、章纲必须使用“当前大纲结构”中的 ID，不得自行创建结构。story 仅在目标为全书大纲时输出对象，否则输出 null。');
  return sections.filter(Boolean).join('\n\n');
}

function taskNode(
  agentId: string,
  modelRef: ModelRef | null,
  snapshot: string,
  overrides: Partial<AgentNodeData>,
): Node<AgentNodeData> {
  const agent = findFictionistAgent(agentId);
  if (!agent) throw new Error(`小说家专业 Agent 未注册：${agentId}`);
  return {
    id: uid('node'),
    type: 'agent',
    position: { x: 0, y: 180 },
    data: professionalAgentNodeData(agent, modelRef, {
      dataSourceMode: 'inline',
      inlineDataSource: { name: '小说大纲任务快照', content: snapshot },
      capabilities: {
        ...agent.capabilities,
        input: {
          ...agent.capabilities?.input,
          enabled: true,
          contentMode: 'full',
          includeSupplementalSources: true,
          maxInputChars: 120_000,
          oversizeStrategy: 'truncate',
        },
      },
      ...overrides,
    }),
  };
}

export function buildOutlineWorkflowGraph(
  operation: FictionOutlineTaskOperation,
  snapshot: string,
  modelRef: ModelRef | null,
): { nodes: Node<AgentNodeData>[]; edges: Edge[] } {
  const formatter = taskNode(FICTIONIST_AGENT_IDS.outlineFormatter, modelRef, snapshot, {
    label: operation === 'import' ? '标准化大纲' : '输出优化大纲',
    description: '把分析结果转换为小说家可确认写入的结构化大纲。',
    resultRole: OUTLINE_RESULT_ROLE,
    outputSchemaText: outlineResultSchemaText(operation),
    systemPrompt: `你负责把上游分析整理为小说家软件可写入的 JSON。严格匹配输出 Schema，保留输入中的正式事实和 ID，只输出 JSON，不要添加 Markdown 代码块。${operation === 'import'
      ? '识别原文中的卷章结构；新结构使用 new-volume-*、new-chapter-* 临时 ID，并填写标题与所属卷。无法准确拆分的部分放入对应 details 字段。'
      : '根据用户选择的强度优化，但不得改动目标范围之外的大纲。'}`,
  });
  if (operation === 'import') {
    const analyzer = taskNode(FICTIONIST_AGENT_IDS.outlineDesigner, modelRef, snapshot, {
      label: '识别本地大纲结构',
      description: '识别原文中的全书、卷和章节层级，映射已有结构并提出缺少的卷纲、章纲。',
      systemPrompt: '分析本地大纲的故事核心、卷级推进、章节安排和未能映射的原文。已有卷章必须复用任务快照提供的 ID；原文中明确存在的新卷章使用任务约定的临时 ID 提议新增；给下游提供清晰、完整的整理建议。',
    });
    analyzer.position = { x: 80, y: 180 };
    formatter.position = { x: 440, y: 180 };
    return {
      nodes: [analyzer, formatter],
      edges: [{ id: uid('edge'), source: analyzer.id, target: formatter.id }],
    };
  }
  const diagnosis = taskNode(FICTIONIST_AGENT_IDS.storyArchitect, modelRef, snapshot, {
    label: '诊断大纲问题',
    description: '从主线、冲突、人物目标和结构完整性诊断选定范围。',
    systemPrompt: '诊断选定大纲范围的结构问题。逐项说明主线、人物目标、冲突升级、节奏、伏笔和收束中有证据的问题；遵守用户选择的修改强度，不修改正式设定。',
  });
  const optimizer = taskNode(FICTIONIST_AGENT_IDS.outlineDesigner, modelRef, snapshot, {
    label: '优化选定大纲',
    description: '根据诊断和用户要求生成优化方案。',
    systemPrompt: '根据上游诊断优化选定范围的大纲。保留任务快照中的作品事实与现有 ID，明确每项修改解决什么问题，并把完整优化结果交给下游标准化。',
  });
  diagnosis.position = { x: 40, y: 180 };
  optimizer.position = { x: 380, y: 180 };
  formatter.position = { x: 720, y: 180 };
  return {
    nodes: [diagnosis, optimizer, formatter],
    edges: [
      { id: uid('edge'), source: diagnosis.id, target: optimizer.id },
      { id: uid('edge'), source: optimizer.id, target: formatter.id },
    ],
  };
}
