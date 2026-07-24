import type { Edge, Node } from '@xyflow/react';
import { uid } from '../../lib/id';
import type { ModelRef } from '../../lib/modelRef';
import type { AgentNodeData } from '../../stores/canvasStore';
import { professionalAgentNodeData } from '../professionalPackages/domain';
import { FICTIONIST_AGENT_IDS, findFictionistAgent } from './agents';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
} from './chapterInsights';
import type {
  FictionCanonEntry,
  FictionChapter,
  FictionProject,
  FictionProjectOutline,
  FictionTimelineEvent,
} from './domain';

export { FICTIONIST_PACKAGE_ID } from './package';
export const CONTINUE_CHAPTER_TASK_TYPE = 'continue-chapter';
export const DRAFT_CHAPTER_TASK_TYPE = 'draft-chapter';
export const CHAPTER_DRAFT_RESULT_ROLE = 'fictionist.chapter-draft';
export type ChapterWritingMode = 'continue' | 'draft-current';

export interface FictionistContinuationPayload extends Record<string, unknown> {
  writingMode?: ChapterWritingMode;
  workflowKey?: string;
  workflowVersion?: 1 | 2;
  projectId: string;
  sourceChapterId: string;
  sourceVolumeId: string;
  sourceRevision: number;
  targetChapterId?: string;
  targetRevision?: number;
  proposedChapterTitle: string;
  targetWordCount: number;
}

export interface ContinuationRequest {
  mode?: ChapterWritingMode;
  workflowKey?: string;
  workflowVersion?: 1 | 2;
  proposedChapterTitle?: string;
  project: FictionProject;
  chapter: FictionChapter;
  chapterContent: string;
  nextChapterGoal: string;
  writingRequirements: string;
  targetWordCount: number;
  targetChapter?: FictionChapter;
  canonEntries?: FictionCanonEntry[];
  timelineEvents?: FictionTimelineEvent[];
  projectOutline?: FictionProjectOutline;
}

const MAX_REFERENCE_CONTEXT_CHARS = 60_000;

function boundedReferenceContext(request: ContinuationRequest): string[] {
  const sections: string[] = [];
  const outline = request.projectOutline;
  if (outline) {
    const targetChapterId = request.targetChapter?.id ?? request.chapter.id;
    const chapterOutline = outline.chapters[targetChapterId]
      ?? outline.chapters[request.chapter.id];
    sections.push([
      '## 已保存大纲',
      '',
      `- 一句话梗概：${outline.premise || '未填写'}`,
      `- 主题：${outline.theme || '未填写'}`,
      `- 主角目标：${outline.protagonistGoal || '未填写'}`,
      `- 核心冲突：${outline.coreConflict || '未填写'}`,
      `- 结局方向：${outline.endingDirection || '未填写'}`,
      ...(chapterOutline ? [
        `- 相关章节摘要：${chapterOutline.summary || '未填写'}`,
        `- 相关章节目标：${chapterOutline.objective || '未填写'}`,
        `- 视角人物：${chapterOutline.pointOfView || '未填写'}`,
        `- 章节冲突：${chapterOutline.conflict || '未填写'}`,
        `- 关键事件：${chapterOutline.keyEvents || '未填写'}`,
        `- 线索与伏笔：${chapterOutline.clues || '未填写'}`,
        `- 结尾钩子：${chapterOutline.hook || '未填写'}`,
      ] : []),
    ].join('\n'));
  }
  const canonEntries = request.canonEntries ?? [];
  if (canonEntries.length > 0) {
    sections.push([
      '## 正式设定库',
      '',
      ...canonEntries.map((entry) => [
        `### ${entry.name}（${entry.type}）`,
        entry.summary ? `摘要：${entry.summary}` : '',
        entry.content || '（没有详细内容）',
      ].filter(Boolean).join('\n')),
    ].join('\n\n'));
  }
  const timelineEvents = request.timelineEvents ?? [];
  if (timelineEvents.length > 0) {
    sections.push([
      '## 已登记时间线',
      '',
      ...timelineEvents.map((event) =>
        `- ${event.timeLabel}｜${event.title}${event.description ? `：${event.description}` : ''}`),
    ].join('\n'));
  }
  const content = sections.join('\n\n').trim();
  if (!content) return ['## 作品参考资料', '', '（当前未保存大纲、正式设定或时间线事件）'];
  if (content.length <= MAX_REFERENCE_CONTEXT_CHARS) return content.split('\n');
  return [
    ...content.slice(0, MAX_REFERENCE_CONTEXT_CHARS).split('\n'),
    '',
    `（作品参考资料超过 ${MAX_REFERENCE_CONTEXT_CHARS.toLocaleString()} 字，后续内容已截断）`,
  ];
}

export function buildContinuationSnapshot(request: ContinuationRequest): string {
  const mode = request.mode ?? 'continue';
  const draftingCurrent = mode === 'draft-current';
  const proposedChapterTitle = request.proposedChapterTitle?.trim()
    || (draftingCurrent
      ? request.chapter.title
      : request.targetChapter?.title ?? '新建下一章');
  const goal = request.nextChapterGoal.trim()
    || (draftingCurrent ? '建立开篇情境，引出主要人物和核心矛盾' : '自然承接上一章，推进主要矛盾');
  const requirements = request.writingRequirements.trim() || '保持人物认知、叙事视角和既有事实一致';
  return [
    draftingCurrent ? '# 小说章节起草任务上下文' : '# 小说续写任务上下文',
    '',
    `- 作品：${request.project.title}`,
    `- 题材：${request.project.genre}`,
    draftingCurrent
      ? `- 目标章节：${proposedChapterTitle}`
      : `- 来源章节：${request.chapter.title}`,
    draftingCurrent
      ? `- 目标修订号：${request.chapter.revision}`
      : `- 来源修订号：${request.chapter.revision}`,
    ...(draftingCurrent ? [] : [`- 目标章节：${proposedChapterTitle}`]),
    `- ${draftingCurrent ? '本章' : '下一章'}目标：${goal}`,
    `- 预计字数：约 ${request.targetWordCount} 字`,
    `- 写作要求：${requirements}`,
    '',
    ...boundedReferenceContext(request),
    '',
    draftingCurrent ? '## 当前章节正文状态' : '## 来源章节正文',
    '',
    request.chapterContent.trim()
      || (draftingCurrent ? '（当前章节为空，等待起草）' : '（来源章节暂无正文）'),
  ].join('\n');
}

export function continuationPayload(request: ContinuationRequest): FictionistContinuationPayload {
  const mode = request.mode ?? 'continue';
  const targetChapter = mode === 'draft-current' ? request.chapter : request.targetChapter;
  return {
    writingMode: mode,
    workflowKey: request.workflowKey,
    workflowVersion: request.workflowVersion,
    projectId: request.project.id,
    sourceChapterId: request.chapter.id,
    sourceVolumeId: request.chapter.volumeId,
    sourceRevision: request.chapter.revision,
    targetChapterId: targetChapter?.id,
    targetRevision: targetChapter?.revision,
    proposedChapterTitle: request.proposedChapterTitle?.trim()
      || targetChapter?.title
      || '未命名章节',
    targetWordCount: request.targetWordCount,
  };
}

export function isFictionistContinuationPayload(
  value: Record<string, unknown>,
): value is FictionistContinuationPayload {
  return (value.writingMode === undefined
      || value.writingMode === 'continue'
      || value.writingMode === 'draft-current')
    && typeof value.projectId === 'string'
    && (value.workflowKey === undefined || typeof value.workflowKey === 'string')
    && (value.workflowVersion === undefined || value.workflowVersion === 1 || value.workflowVersion === 2)
    && typeof value.sourceChapterId === 'string'
    && typeof value.sourceVolumeId === 'string'
    && typeof value.sourceRevision === 'number'
    && (value.targetChapterId === undefined || typeof value.targetChapterId === 'string')
    && (value.targetRevision === undefined || typeof value.targetRevision === 'number')
    && typeof value.proposedChapterTitle === 'string'
    && typeof value.targetWordCount === 'number';
}

export function chapterWritingMode(payload: FictionistContinuationPayload): ChapterWritingMode {
  return payload.writingMode ?? 'continue';
}

export function isFictionistChapterWritingTaskType(taskType: string): boolean {
  return taskType === CONTINUE_CHAPTER_TASK_TYPE || taskType === DRAFT_CHAPTER_TASK_TYPE;
}

export function buildContinuationGraph(
  snapshot: string,
  modelRef: ModelRef | null,
  mode: ChapterWritingMode = 'continue',
): { nodes: Node<AgentNodeData>[]; edges: Edge[] } {
  const draftingCurrent = mode === 'draft-current';
  const contextId = uid('node');
  const writerId = uid('node');
  const reviewerId = uid('node');
  const editorId = uid('node');
  const contextAnalyst = findFictionistAgent(FICTIONIST_AGENT_IDS.contextAnalyst);
  const writer = findFictionistAgent(FICTIONIST_AGENT_IDS.chapterWriter);
  const reviewer = findFictionistAgent(FICTIONIST_AGENT_IDS.continuityReviewer);
  const editor = findFictionistAgent(FICTIONIST_AGENT_IDS.finalEditor);
  if (!contextAnalyst || !writer || !reviewer || !editor) {
    throw new Error('小说家专业 Agent 注册不完整');
  }
  const taskContext = {
    name: draftingCurrent ? '章节起草任务上下文快照' : '续写任务上下文快照',
    content: snapshot,
  };
  const nodes: Node<AgentNodeData>[] = [
    {
      id: contextId,
      type: 'agent',
      position: { x: 40, y: 180 },
      data: professionalAgentNodeData(contextAnalyst, modelRef, {
        label: '上下文分析',
        description: '从任务快照提取人物、场景、线索和本章约束。',
        dataSourceMode: 'inline',
        inlineDataSource: taskContext,
        resultRole: CHAPTER_CONTEXT_RESULT_ROLE,
      }),
    },
    {
      id: writerId,
      type: 'agent',
      position: { x: 360, y: 180 },
      data: professionalAgentNodeData(writer, modelRef, {
        label: draftingCurrent ? '章节起草作者' : '续写作者',
        description: draftingCurrent
          ? '根据不可变的任务上下文起草当前空白章节。'
          : '根据不可变的任务上下文续写下一章初稿。',
        dataSourceMode: 'inline',
        inlineDataSource: taskContext,
      }),
    },
    {
      id: reviewerId,
      type: 'agent',
      position: { x: 680, y: 180 },
      data: professionalAgentNodeData(reviewer, modelRef, {
        label: '设定检查',
        description: '对照正式设定、时间线和大纲检查章节初稿。',
        dataSourceMode: 'inline',
        inlineDataSource: taskContext,
        resultRole: CHAPTER_CANON_CHECK_RESULT_ROLE,
      }),
    },
    {
      id: editorId,
      type: 'agent',
      position: { x: 1000, y: 180 },
      data: professionalAgentNodeData(editor, modelRef, {
        label: '综合定稿',
        description: '综合章节初稿和设定检查结果，输出唯一的待确认草稿。',
        resultRole: CHAPTER_DRAFT_RESULT_ROLE,
      }),
    },
  ];
  return {
    nodes,
    edges: [
      { id: uid('edge'), source: contextId, target: writerId },
      { id: uid('edge'), source: writerId, target: reviewerId },
      { id: uid('edge'), source: writerId, target: editorId },
      { id: uid('edge'), source: reviewerId, target: editorId },
    ],
  };
}
