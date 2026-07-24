import type { Edge, Node } from '@xyflow/react';
import { uid } from '../../lib/id';
import type { ModelRef } from '../../lib/modelRef';
import type { AgentNodeData } from '../../stores/canvasStore';
import { professionalAgentNodeData } from '../professionalPackages/domain';
import { FICTIONIST_AGENT_IDS, findFictionistAgent } from './agents';
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

export interface FictionOutlineWorkflowResult {
  story: FictionStoryOutline | null;
  volumes: Array<FictionVolumeOutline & { id: string }>;
  chapters: Array<FictionChapterOutline & { id: string }>;
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

export const OUTLINE_RESULT_SCHEMA_TEXT = JSON.stringify({
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
        required: ['id', ...VOLUME_KEYS],
        properties: { id: { type: 'string' }, ...stringProperties(VOLUME_KEYS) },
      },
    },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', ...CHAPTER_KEYS],
        properties: { id: { type: 'string' }, ...stringProperties(CHAPTER_KEYS) },
      },
    },
    changeSummary: { type: 'array', items: { type: 'string' } },
  },
}, null, 2);

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
  if (target.kind === 'volume') return index.volumes[target.id]?.title ?? '已删除的卷';
  return index.chapters[target.id]?.title ?? '已删除的章节';
}

function targetExists(index: FictionistIndex, projectId: string, target: FictionOutlineTaskTarget) {
  if (target.kind === 'story') return Boolean(index.projects[projectId]);
  if (target.kind === 'volume') return index.volumes[target.id]?.projectId === projectId;
  return index.chapters[target.id]?.projectId === projectId;
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
  if (!targetExists(index, projectId, target)) throw new Error('导入目标已不存在');
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
): void {
  if (!targetExists(index, projectId, target)) throw new Error('大纲任务目标已不存在');
  if (target.kind !== 'story' && result.story) throw new Error('结果包含目标范围之外的全书大纲');
  for (const volume of result.volumes) {
    const current = index.volumes[volume.id];
    if (!current || current.projectId !== projectId) throw new Error(`结果引用了不存在的卷：${volume.id}`);
    if (target.kind === 'volume' && volume.id !== target.id) {
      throw new Error('结果包含目标范围之外的卷纲');
    }
    if (target.kind === 'chapter') throw new Error('章节优化结果不应包含卷纲');
  }
  for (const chapter of result.chapters) {
    const current = index.chapters[chapter.id];
    if (!current || current.projectId !== projectId) {
      throw new Error(`结果引用了不存在的章节：${chapter.id}`);
    }
    if (target.kind === 'volume' && current.volumeId !== target.id) {
      throw new Error('结果包含目标卷之外的章节纲要');
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
): FictionOutlineWorkflowResult {
  const record = parseJsonObject(content);
  const result: FictionOutlineWorkflowResult = {
    story: readStory(record.story),
    volumes: readItems(record.volumes, '卷纲', (item) => ({
      id: readString(item, 'id', '卷 ID', 64),
      summary: readString(item, 'summary', '本卷概述'),
      objective: readString(item, 'objective', '阶段目标'),
      turningPoint: readString(item, 'turningPoint', '关键转折'),
      climax: readString(item, 'climax', '高潮与收束'),
      details: readString(item, 'details', '本卷详细大纲', MAX_OUTLINE_DETAILS_CHARS),
    })),
    chapters: readItems(record.chapters, '章节纲要', (item) => ({
      id: readString(item, 'id', '章节 ID', 64),
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
  assertTargetScope(index, projectId, target, result);
  return result;
}

export function applyOutlineWorkflowResult(
  outline: FictionProjectOutline,
  result: FictionOutlineWorkflowResult,
): FictionProjectOutline {
  const story = result.story ?? outline;
  return {
    ...outline,
    ...story,
    volumes: result.volumes.reduce(
      (volumes, item) => {
        const { id, ...fields } = item;
        volumes[id] = fields;
        return volumes;
      },
      { ...outline.volumes },
    ),
    chapters: result.chapters.reduce(
      (chapters, item) => {
        const { id, ...fields } = item;
        chapters[id] = fields;
        return chapters;
      },
      { ...outline.chapters },
    ),
  };
}

function relevantOutline(
  outline: FictionProjectOutline,
  index: FictionistIndex,
  target: FictionOutlineTaskTarget,
): unknown {
  if (target.kind === 'story') return outline;
  if (target.kind === 'volume') {
    const volume = index.volumes[target.id];
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
  const structure = input.project.volumeIds.map((volumeId) => {
    const volume = input.index.volumes[volumeId];
    return {
      id: volumeId,
      title: volume?.title ?? '未知卷',
      chapters: (volume?.chapterIds ?? []).map((chapterId) => ({
        id: chapterId,
        title: input.index.chapters[chapterId]?.title ?? '未知章节',
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
    `## 当前作品结构（必须复用这些 ID，不得虚构卷或章节）\n${JSON.stringify(structure, null, 2)}`,
    `## 当前目标范围大纲\n${bounded(JSON.stringify(
      relevantOutline(outline, input.index, input.target),
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
  sections.push(
    '## 输出约束\n只修改目标范围；保留原意与明确事实；所有卷、章节必须使用“当前作品结构”中的 ID。story 仅在目标为全书大纲时输出对象，否则输出 null。无法对应到现有卷或章节的内容保留在目标范围的 details 字段，不得自行创建 ID。',
  );
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
    outputSchemaText: OUTLINE_RESULT_SCHEMA_TEXT,
    systemPrompt: `你负责把上游分析整理为小说家软件可写入的 JSON。严格匹配输出 Schema，保留输入中的正式事实和 ID，只输出 JSON，不要添加 Markdown 代码块。${operation === 'import'
      ? '本地原文无法准确拆分的部分放入对应 details 字段。'
      : '根据用户选择的强度优化，但不得改动目标范围之外的大纲。'}`,
  });
  if (operation === 'import') {
    const analyzer = taskNode(FICTIONIST_AGENT_IDS.outlineDesigner, modelRef, snapshot, {
      label: '识别本地大纲结构',
      description: '识别原文中的全书、卷和章节层级，并映射到现有作品结构。',
      systemPrompt: '分析本地大纲的故事核心、卷级推进、章节安排和未能映射的原文。必须复用任务快照提供的卷 ID 与章节 ID，不得虚构结构；给下游提供清晰、完整的整理建议。',
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
