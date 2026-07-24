import type { Node } from '@xyflow/react';
import type { ProfessionalTask, ProfessionalTaskOutput } from '../professionalTasks/domain';
import type { AgentNodeData } from '../../stores/canvasStore';
import type { FictionChapter } from './domain';
import { FICTIONIST_PACKAGE_ID } from './package';

export const CHAPTER_CONTEXT_RESULT_ROLE = 'fictionist.chapter-context-analysis';
export const CHAPTER_CANON_CHECK_RESULT_ROLE = 'fictionist.chapter-canon-check';

export interface ChapterInsightResult {
  task?: ProfessionalTask;
  contextOutput?: ProfessionalTaskOutput;
  canonCheckOutput?: ProfessionalTaskOutput;
}

export interface ChapterInsightNodeAvailability {
  context: boolean;
  canonCheck: boolean;
}

function taskTargetsChapter(task: ProfessionalTask, chapter: FictionChapter): boolean {
  if (task.packageId !== FICTIONIST_PACKAGE_ID
    || (task.taskType !== 'draft-chapter' && task.taskType !== 'continue-chapter')
    || task.packagePayload.projectId !== chapter.projectId) return false;
  if (chapter.sourceTaskId === task.id) return true;
  if (task.packagePayload.targetChapterId === chapter.id) return true;
  return task.taskType === 'draft-chapter'
    && task.packagePayload.sourceChapterId === chapter.id;
}

export function chapterInsightResult(
  tasks: Record<string, ProfessionalTask>,
  chapter: FictionChapter | null,
): ChapterInsightResult {
  if (!chapter) return {};
  const task = Object.values(tasks)
    .filter((candidate) => taskTargetsChapter(candidate, chapter))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!task) return {};
  return {
    task,
    contextOutput: task.outputs.find(
      (output) => output.resultRole === CHAPTER_CONTEXT_RESULT_ROLE,
    ),
    canonCheckOutput: task.outputs.find(
      (output) => output.resultRole === CHAPTER_CANON_CHECK_RESULT_ROLE,
    ),
  };
}

export function chapterInsightNodeAvailability(
  nodes: readonly Node[] | undefined,
): ChapterInsightNodeAvailability | undefined {
  if (!nodes) return undefined;
  const roles = new Set(nodes.map((node) => (node.data as AgentNodeData).resultRole));
  return {
    context: roles.has(CHAPTER_CONTEXT_RESULT_ROLE),
    canonCheck: roles.has(CHAPTER_CANON_CHECK_RESULT_ROLE),
  };
}
