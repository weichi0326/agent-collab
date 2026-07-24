export type ProfessionalTaskStatus =
  | 'preparing'
  | 'ready'
  | 'running'
  | 'review_required'
  | 'accepted'
  | 'failed'
  | 'discarded'
  | 'interrupted';

export interface ProfessionalTaskOrigin {
  packageId: string;
  taskId: string;
  taskType: string;
}

export interface ProfessionalTaskSourceRef {
  type: string;
  id: string;
  revision?: number;
}

export interface ProfessionalTaskHistoryDescriptor {
  subjectType: string;
  subjectId?: string;
  subjectLabel: string;
  actionLabel: string;
}

export interface ProfessionalTaskOutput {
  nodeId: string;
  resultRole?: string;
  outputFormat: string;
  label: string;
  summary?: string;
  path?: string;
  dataPath?: string;
  content: string;
}

export interface ProfessionalTaskFallbackAttempt {
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  fallbackCanvasId: string;
  primaryError: string;
  fallbackError?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ProfessionalTask {
  id: string;
  packageId: string;
  taskType: string;
  taskLabel: string;
  sourceLabel: string;
  status: ProfessionalTaskStatus;
  sourceRefs: ProfessionalTaskSourceRef[];
  contextSnapshot: {
    title: string;
    format: 'markdown';
    content: string;
  };
  expectedResult: {
    role: string;
    outputFormat: string;
  };
  historyDescriptor?: ProfessionalTaskHistoryDescriptor;
  packagePayload: Record<string, unknown>;
  canvasId?: string;
  runId?: string;
  runCanvasId?: string;
  outputs: ProfessionalTaskOutput[];
  fallbackAttempt?: ProfessionalTaskFallbackAttempt;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export function taskMatchesOrigin(
  task: ProfessionalTask,
  origin: ProfessionalTaskOrigin,
): boolean {
  return task.id === origin.taskId
    && task.packageId === origin.packageId
    && task.taskType === origin.taskType;
}
