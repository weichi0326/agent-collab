import { describe, expect, it } from 'vitest';
import type { FictionChapter, FictionProject } from './domain';
import { FICTIONIST_AGENT_IDS } from './agents';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
} from './chapterInsights';
import {
  buildContinuationGraph,
  buildContinuationSnapshot,
  CHAPTER_DRAFT_RESULT_ROLE,
  continuationPayload,
  DRAFT_CHAPTER_TASK_TYPE,
} from './continuation';

const project: FictionProject = {
  id: 'project-1',
  title: '潮汐来信',
  genre: '悬疑',
  status: 'drafting',
  volumeIds: ['volume-1'],
  canonEntryCount: 0,
  coverTone: 'teal',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};

const chapter: FictionChapter = {
  id: 'chapter-1',
  projectId: project.id,
  volumeId: 'volume-1',
  title: '钟塔停摆',
  status: 'draft',
  wordCount: 4,
  revision: 3,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};

describe('fictionist continuation template', () => {
  it('freezes real chapter content and user requirements into the snapshot', () => {
    const snapshot = buildContinuationSnapshot({
      project,
      chapter,
      proposedChapterTitle: '明日之后',
      chapterContent: '雾中传来钟声。',
      nextChapterGoal: '进入钟塔',
      writingRequirements: '保持第三人称限知',
      targetWordCount: 2500,
      canonEntries: [{
        id: 'canon-1',
        projectId: project.id,
        type: 'rule',
        name: '钟塔规则',
        summary: '停电时机械钟停止。',
        content: '只有旧海关钟塔仍会运行。',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      }],
      timelineEvents: [{
        id: 'timeline-1',
        projectId: project.id,
        timeLabel: '今晚 · 02:14',
        title: '港区停电',
        description: '所有机械钟同时停止。',
        kind: 'confirmed',
        order: 0,
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      }],
    });

    expect(snapshot).toContain('来源修订号：3');
    expect(snapshot).toContain('目标章节：明日之后');
    expect(snapshot).toContain('下一章目标：进入钟塔');
    expect(snapshot).toContain('预计字数：约 2500 字');
    expect(snapshot).toContain('正式设定库');
    expect(snapshot).toContain('钟塔规则');
    expect(snapshot).toContain('已登记时间线');
    expect(snapshot).toContain('港区停电');
    expect(snapshot).toContain('雾中传来钟声。');
  });

  it('creates context, writing, canon-check and final nodes with stable result roles', () => {
    const graph = buildContinuationGraph('固定上下文', {
      configId: 'config-1',
      modelId: 'model-1',
    });

    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(graph.nodes.filter((node) => node.data.inlineDataSource?.content === '固定上下文'))
      .toHaveLength(3);
    expect(graph.nodes.map((node) => node.data.professionalAgentId)).toEqual([
      FICTIONIST_AGENT_IDS.contextAnalyst,
      FICTIONIST_AGENT_IDS.chapterWriter,
      FICTIONIST_AGENT_IDS.continuityReviewer,
      FICTIONIST_AGENT_IDS.finalEditor,
    ]);
    expect(graph.nodes.filter((node) => node.data.resultRole === CHAPTER_CONTEXT_RESULT_ROLE))
      .toHaveLength(1);
    expect(graph.nodes.filter((node) => node.data.resultRole === CHAPTER_CANON_CHECK_RESULT_ROLE))
      .toHaveLength(1);
    expect(graph.nodes.filter((node) => node.data.resultRole === CHAPTER_DRAFT_RESULT_ROLE))
      .toHaveLength(1);
    expect(graph.nodes.filter((node) =>
      node.data.professionalAgentId === FICTIONIST_AGENT_IDS.chapterWriter
      || node.data.professionalAgentId === FICTIONIST_AGENT_IDS.continuityReviewer)
      .every((node) => node.data.capabilities?.input?.includeSupplementalSources))
      .toBe(true);
    expect(graph.nodes.every((node) => node.data.modelRef?.modelId === 'model-1')).toBe(true);
  });

  it('builds an explicit current-chapter drafting task for an empty first chapter', () => {
    const request = {
      mode: 'draft-current' as const,
      proposedChapterTitle: '雨夜来信',
      project,
      chapter: { ...chapter, title: '第一章', wordCount: 0, revision: 0 },
      chapterContent: '',
      nextChapterGoal: '让主角在雨夜收到匿名来信',
      writingRequirements: '第三人称限知',
      targetWordCount: 2000,
    };
    const snapshot = buildContinuationSnapshot(request);
    const graph = buildContinuationGraph(snapshot, {
      configId: 'config-1',
      modelId: 'model-1',
    }, request.mode);

    expect(DRAFT_CHAPTER_TASK_TYPE).toBe('draft-chapter');
    expect(snapshot).toContain('# 小说章节起草任务上下文');
    expect(snapshot).toContain('目标章节：雨夜来信');
    expect(snapshot).toContain('本章目标：让主角在雨夜收到匿名来信');
    expect(snapshot).not.toContain('来源章节正文');
    const writer = graph.nodes.find(
      (node) => node.data.professionalAgentId === FICTIONIST_AGENT_IDS.chapterWriter,
    );
    expect(writer?.data.label).toBe('章节起草作者');
    expect(writer?.data.systemPrompt).toContain('起草目标章节');
  });

  it('keeps the custom chapter title in the task payload', () => {
    const payload = continuationPayload({
      project,
      chapter,
      proposedChapterTitle: '钟楼之下',
      chapterContent: '雾中传来钟声。',
      nextChapterGoal: '',
      writingRequirements: '',
      targetWordCount: 2000,
    });

    expect(payload.proposedChapterTitle).toBe('钟楼之下');
  });
});
