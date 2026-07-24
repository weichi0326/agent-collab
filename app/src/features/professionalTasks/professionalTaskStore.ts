import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '../../lib/id';
import { createProjectStorage } from '../../lib/tauriStorage';
import {
  taskMatchesOrigin,
  type ProfessionalTask,
  type ProfessionalTaskHistoryDescriptor,
  type ProfessionalTaskOrigin,
  type ProfessionalTaskOutput,
  type ProfessionalTaskSourceRef,
} from './domain';

export interface CreateProfessionalTaskInput {
  packageId: string;
  taskType: string;
  taskLabel: string;
  sourceLabel: string;
  sourceRefs: ProfessionalTaskSourceRef[];
  contextSnapshot: ProfessionalTask['contextSnapshot'];
  expectedResult: ProfessionalTask['expectedResult'];
  historyDescriptor?: ProfessionalTaskHistoryDescriptor;
  packagePayload: Record<string, unknown>;
}

interface ProfessionalTaskState {
  tasks: Record<string, ProfessionalTask>;
  focusedTaskId: string | null;
  createTask: (input: CreateProfessionalTaskInput) => ProfessionalTaskOrigin;
  removeTask: (taskId: string) => void;
  removePackageTasks: (packageId: string) => void;
  linkCanvas: (origin: ProfessionalTaskOrigin, canvasId: string) => void;
  markRunStarted: (
    origin: ProfessionalTaskOrigin,
    runId: string,
    runCanvasId: string,
  ) => void;
  markRunSucceeded: (
    origin: ProfessionalTaskOrigin,
    outputs: ProfessionalTaskOutput[],
  ) => void;
  markRunFailed: (origin: ProfessionalTaskOrigin, message: string) => void;
  markRunInterrupted: (origin: ProfessionalTaskOrigin) => void;
  clearFallbackAttempt: (origin: ProfessionalTaskOrigin) => void;
  markFallbackStarted: (
    origin: ProfessionalTaskOrigin,
    fallbackCanvasId: string,
    primaryError: string,
  ) => void;
  markFallbackFinished: (
    origin: ProfessionalTaskOrigin,
    status: 'succeeded' | 'failed' | 'cancelled',
    fallbackError?: string,
  ) => void;
  invalidateOutputs: (origin: ProfessionalTaskOrigin, paths: string[]) => void;
  markAccepted: (taskId: string) => void;
  markDiscarded: (taskId: string) => void;
  focusTask: (taskId: string | null) => void;
  recoverInterrupted: () => number;
}

function now(): string {
  return new Date().toISOString();
}

function updateByOrigin(
  tasks: Record<string, ProfessionalTask>,
  origin: ProfessionalTaskOrigin,
  update: (task: ProfessionalTask) => ProfessionalTask,
): Record<string, ProfessionalTask> {
  const task = tasks[origin.taskId];
  if (!task || !taskMatchesOrigin(task, origin)) return tasks;
  return { ...tasks, [task.id]: update(task) };
}

export const useProfessionalTaskStore = create<ProfessionalTaskState>()(
  persist(
    (set) => ({
      tasks: {},
      focusedTaskId: null,

      createTask: (input) => {
        const id = uid('task');
        const timestamp = now();
        const task: ProfessionalTask = {
          ...input,
          id,
          status: 'preparing',
          outputs: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        set((state) => ({
          tasks: { ...state.tasks, [id]: task },
          focusedTaskId: id,
        }));
        return { packageId: input.packageId, taskId: id, taskType: input.taskType };
      },

      removeTask: (taskId) => set((state) => {
        const { [taskId]: _removed, ...tasks } = state.tasks;
        return {
          tasks,
          focusedTaskId: state.focusedTaskId === taskId ? null : state.focusedTaskId,
        };
      }),

      removePackageTasks: (packageId) => set((state) => {
        const tasks = Object.fromEntries(
          Object.entries(state.tasks).filter(([, task]) => task.packageId !== packageId),
        );
        const focusedTask = state.focusedTaskId ? state.tasks[state.focusedTaskId] : undefined;
        return {
          tasks,
          focusedTaskId: focusedTask?.packageId === packageId ? null : state.focusedTaskId,
        };
      }),

      linkCanvas: (origin, canvasId) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => ({
          ...task,
          canvasId,
          runId: undefined,
          runCanvasId: undefined,
          status: 'ready',
          outputs: [],
          errorMessage: undefined,
          updatedAt: now(),
        })),
      })),

      markRunStarted: (origin, runId, runCanvasId) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => ({
          ...task,
          runId,
          runCanvasId,
          status: 'running',
          outputs: [],
          errorMessage: undefined,
          updatedAt: now(),
        })),
      })),

      markRunSucceeded: (origin, outputs) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => {
          const expected = outputs.filter((output) =>
            output.resultRole === task.expectedResult.role
            && output.outputFormat === task.expectedResult.outputFormat
            && output.content.trim(),
          );
          const valid = expected.length === 1;
          return {
            ...task,
            outputs,
            status: valid ? 'review_required' : 'failed',
            errorMessage: valid
              ? undefined
              : `需要唯一的 ${task.expectedResult.role} ${task.expectedResult.outputFormat} 结果，实际得到 ${expected.length} 个`,
            updatedAt: now(),
          };
        }),
      })),

      markRunFailed: (origin, message) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => ({
          ...task,
          status: 'failed',
          errorMessage: message,
          updatedAt: now(),
        })),
      })),

      markRunInterrupted: (origin) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => ({
          ...task,
          status: 'interrupted',
          errorMessage: '任务运行已中止，可以返回画布重新运行',
          updatedAt: now(),
        })),
      })),

      clearFallbackAttempt: (origin) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => ({
          ...task,
          fallbackAttempt: undefined,
          updatedAt: now(),
        })),
      })),

      markFallbackStarted: (origin, fallbackCanvasId, primaryError) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => ({
          ...task,
          fallbackAttempt: {
            status: 'running',
            fallbackCanvasId,
            primaryError,
            startedAt: now(),
          },
          updatedAt: now(),
        })),
      })),

      markFallbackFinished: (origin, status, fallbackError) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => {
          if (!task.fallbackAttempt) return task;
          return {
            ...task,
            fallbackAttempt: {
              ...task.fallbackAttempt,
              status,
              fallbackError,
              finishedAt: now(),
            },
            updatedAt: now(),
          };
        }),
      })),

      invalidateOutputs: (origin, paths) => set((state) => ({
        tasks: updateByOrigin(state.tasks, origin, (task) => {
          const removed = new Set(paths);
          const invalidated = task.outputs.some((output) =>
            (output.path && removed.has(output.path))
            || (output.dataPath && removed.has(output.dataPath)),
          );
          return invalidated
            ? {
                ...task,
                status: 'failed',
                errorMessage: '任务草稿产物已被移除，请重新运行画布',
                updatedAt: now(),
              }
            : task;
        }),
      })),

      markAccepted: (taskId) => set((state) => {
        const task = state.tasks[taskId];
        if (!task) return state;
        return {
          tasks: {
            ...state.tasks,
            [taskId]: { ...task, status: 'accepted', updatedAt: now() },
          },
          focusedTaskId: state.focusedTaskId === taskId ? null : state.focusedTaskId,
        };
      }),

      markDiscarded: (taskId) => set((state) => {
        const task = state.tasks[taskId];
        if (!task) return state;
        return {
          tasks: {
            ...state.tasks,
            [taskId]: { ...task, status: 'discarded', updatedAt: now() },
          },
          focusedTaskId: state.focusedTaskId === taskId ? null : state.focusedTaskId,
        };
      }),

      focusTask: (focusedTaskId) => set({ focusedTaskId }),

      recoverInterrupted: () => {
        let count = 0;
        set((state) => {
          const tasks = Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => {
            if (task.status !== 'running') return [id, task];
            count++;
            return [id, {
              ...task,
              status: 'interrupted' as const,
              errorMessage: '应用上次退出时任务仍在运行，请重新运行画布',
              updatedAt: now(),
            }];
          }));
          return { tasks };
        });
        return count;
      },
    }),
    {
      name: 'multi-agent-professional-tasks',
      storage: createProjectStorage(),
      version: 1,
      partialize: (state) => ({
        tasks: state.tasks,
        focusedTaskId: state.focusedTaskId,
      }),
    },
  ),
);
