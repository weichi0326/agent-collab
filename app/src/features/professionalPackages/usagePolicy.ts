import type { ProfessionalAgentDefinition } from './domain';
import type { Canvas } from '../../stores/canvasStore';
import {
  taskMatchesOrigin,
  type ProfessionalTask,
} from '../professionalTasks/domain';

export interface ProfessionalAgentUsageContext {
  task?: {
    packageId: string;
    taskType: string;
  };
  systemWorkflow?: {
    packageId: string;
    key: string;
  };
}

export type ProfessionalAgentUsageDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export function professionalAgentUsageDecision(
  definition: ProfessionalAgentDefinition,
  context: ProfessionalAgentUsageContext,
): ProfessionalAgentUsageDecision {
  const policy = definition.usagePolicy;
  if (!policy) return { allowed: true };

  const allowedTask = context.task?.packageId === definition.packageId
    && policy.allowedTaskTypes.includes(context.task.taskType);
  const allowedSystemWorkflow = context.systemWorkflow?.packageId === definition.packageId
    && policy.allowedSystemWorkflowKeys.includes(context.systemWorkflow.key);

  return allowedTask || allowedSystemWorkflow
    ? { allowed: true }
    : { allowed: false, reason: policy.reason };
}

export function professionalAgentCanvasUsageDecision(
  definition: ProfessionalAgentDefinition,
  canvas: Pick<Canvas, 'origin' | 'workflowRef'> | undefined,
  tasks: Record<string, ProfessionalTask>,
): ProfessionalAgentUsageDecision {
  const origin = canvas?.origin;
  const task = origin ? tasks[origin.taskId] : undefined;
  const systemWorkflow = canvas?.workflowRef?.systemWorkflow;

  return professionalAgentUsageDecision(definition, {
    ...(task && origin && taskMatchesOrigin(task, origin)
      ? { task: { packageId: task.packageId, taskType: task.taskType } }
      : {}),
    ...(systemWorkflow && canvas?.workflowRef
      ? {
          systemWorkflow: {
            packageId: canvas.workflowRef.packageId,
            key: systemWorkflow.key,
          },
        }
      : {}),
  });
}
