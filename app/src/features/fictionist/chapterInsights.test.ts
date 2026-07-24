import { describe, expect, it } from 'vitest';
import type { ProfessionalTask } from '../professionalTasks/domain';
import type { FictionChapter } from './domain';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
  chapterInsightNodeAvailability,
  chapterInsightResult,
} from './chapterInsights';

const chapter: FictionChapter = {
  id: 'chapter-1',
  projectId: 'project-1',
  volumeId: 'volume-1',
  title: '雾中来信',
  status: 'draft',
  wordCount: 100,
  revision: 1,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
};

function writingTask(
  id: string,
  updatedAt: string,
  outputs: ProfessionalTask['outputs'] = [],
): ProfessionalTask {
  return {
    id,
    packageId: 'fictionist',
    taskType: 'draft-chapter',
    taskLabel: 'AI 起草',
    sourceLabel: '《雾中来信》',
    status: 'accepted',
    sourceRefs: [],
    contextSnapshot: { title: '上下文', format: 'markdown', content: '' },
    expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'txt' },
    packagePayload: {
      writingMode: 'draft-current',
      projectId: 'project-1',
      sourceChapterId: 'chapter-1',
      sourceVolumeId: 'volume-1',
      sourceRevision: 1,
      proposedChapterTitle: '雾中来信',
      targetWordCount: 2000,
    },
    outputs,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('fictionist chapter insights', () => {
  it('uses the latest writing task and returns both report outputs', () => {
    const contextOutput = {
      nodeId: 'context',
      resultRole: CHAPTER_CONTEXT_RESULT_ROLE,
      outputFormat: 'markdown',
      label: '上下文分析',
      content: '## 出场人物',
    };
    const checkOutput = {
      nodeId: 'check',
      resultRole: CHAPTER_CANON_CHECK_RESULT_ROLE,
      outputFormat: 'markdown',
      label: '设定检查',
      content: '没有发现冲突。',
    };
    const result = chapterInsightResult({
      old: writingTask('old', '2026-07-23T00:00:00.000Z'),
      latest: writingTask('latest', '2026-07-24T00:00:00.000Z', [contextOutput, checkOutput]),
    }, chapter);

    expect(result.task?.id).toBe('latest');
    expect(result.contextOutput).toEqual(contextOutput);
    expect(result.canonCheckOutput).toEqual(checkOutput);
  });

  it('matches a newly accepted continuation chapter through its source task id', () => {
    const task = {
      ...writingTask('continue-task', '2026-07-24T00:00:00.000Z'),
      taskType: 'continue-chapter',
      packagePayload: {
        ...writingTask('continue-task', '2026-07-24T00:00:00.000Z').packagePayload,
        writingMode: 'continue',
        sourceChapterId: 'previous-chapter',
      },
    };

    expect(chapterInsightResult(
      { [task.id]: task },
      { ...chapter, sourceTaskId: task.id },
    ).task?.id).toBe(task.id);
    expect(chapterInsightResult({ [task.id]: task }, chapter).task).toBeUndefined();
  });

  it('reports whether the executed graph contained each insight node', () => {
    expect(chapterInsightNodeAvailability([
      { id: 'context', position: { x: 0, y: 0 }, data: { resultRole: CHAPTER_CONTEXT_RESULT_ROLE } },
    ])).toEqual({ context: true, canonCheck: false });
    expect(chapterInsightNodeAvailability(undefined)).toBeUndefined();
  });
});
