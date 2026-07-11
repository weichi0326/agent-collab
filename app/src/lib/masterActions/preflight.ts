import { MAX_CANVASES } from '../../stores/canvas/types';
import type { JiziProjectObservation } from '../jiziProjectObservation';
import type { MasterAgentConfigPatch, MasterPlanStep } from './types';

export type MasterActionRisk = 'read' | 'write' | 'destructive';

export interface JiziPlanValidationIssue {
  stepIndex: number;
  code: string;
  message: string;
}

export interface JiziPlanValidation {
  ok: boolean;
  normalizedSteps: MasterPlanStep[];
  issues: JiziPlanValidationIssue[];
  risk: MasterActionRisk;
  requiresConfirmation: boolean;
  requiresSecondConfirmation: boolean;
}

function promoteRisk(current: MasterActionRisk, next: MasterActionRisk): MasterActionRisk {
  const priority: Record<MasterActionRisk, number> = { read: 0, write: 1, destructive: 2 };
  return priority[next] > priority[current] ? next : current;
}

function validatePatch(
  patch: MasterAgentConfigPatch,
  observation: JiziProjectObservation,
  stepIndex: number,
  issues: JiziPlanValidationIssue[],
): void {
  if (patch.modelRef) {
    const config = observation.models.find(
      (item) => item.configId === patch.modelRef?.configId,
    );
    const model = config?.models.find(
      (item) => item.id === patch.modelRef?.modelId && item.enabled,
    );
    if (!model) {
      issues.push({
        stepIndex,
        code: 'model-unavailable',
        message: '目标模型不存在或未启用。',
      });
    }
  }
  if (patch.toolTags) {
    const available = new Set(
      observation.tools.flatMap((tool) => [tool.name, ...tool.tags]),
    );
    for (const tag of patch.toolTags) {
      if (!available.has(tag)) {
        issues.push({
          stepIndex,
          code: 'tool-unavailable',
          message: `工具标签「${tag}」不可用。`,
        });
      }
    }
  }
}

export function preflightMasterPlan(
  steps: MasterPlanStep[],
  observation: JiziProjectObservation,
): JiziPlanValidation {
  const issues: JiziPlanValidationIssue[] = [];
  let risk: MasterActionRisk = 'read';
  let projectedCanvasCount = observation.canvases.length;
  if (steps.length > 8) {
    issues.push({
      stepIndex: 8,
      code: 'step-limit',
      message: '单个自主任务最多允许 8 个执行步骤。',
    });
  }

  for (const [stepIndex, step] of steps.entries()) {
    if (step.type !== 'run-active-canvas') risk = promoteRisk(risk, 'write');
    switch (step.type) {
      case 'create-canvas':
        projectedCanvasCount += 1;
        if (projectedCanvasCount > MAX_CANVASES) {
          issues.push({ stepIndex, code: 'canvas-limit', message: '同时打开的画布已达到上限。' });
        }
        break;
      case 'update-agent': {
        if (!observation.agents.some((agent) => agent.id === step.agentId)) {
          issues.push({ stepIndex, code: 'agent-not-found', message: '目标 Agent 不存在。' });
        }
        validatePatch(step.patch, observation, stepIndex, issues);
        break;
      }
      case 'update-node-agent-config': {
        const canvas = observation.canvases.find((item) => item.id === step.canvasId);
        if (!canvas) {
          issues.push({ stepIndex, code: 'canvas-not-found', message: '目标画布不存在。' });
        } else if (canvas.readOnly || canvas.run.status === 'running') {
          issues.push({ stepIndex, code: 'canvas-read-only', message: '目标画布不可编辑。' });
        }
        if (!canvas?.nodes.some((node) => node.id === step.nodeId)) {
          issues.push({ stepIndex, code: 'node-not-found', message: '目标节点不存在。' });
        }
        validatePatch(step.patch, observation, stepIndex, issues);
        break;
      }
      case 'delete-canvas': {
        risk = promoteRisk(risk, 'destructive');
        const canvas = observation.canvases.find((item) => item.id === step.canvasId);
        if (!canvas) {
          issues.push({ stepIndex, code: 'canvas-not-found', message: '目标画布不存在。' });
        } else if (canvas.readOnly || canvas.run.status === 'running') {
          issues.push({ stepIndex, code: 'canvas-read-only', message: '目标画布不可删除。' });
        }
        break;
      }
      case 'delete-tool': {
        risk = promoteRisk(risk, 'destructive');
        const tool = observation.tools.find((item) => item.name === step.toolName);
        if (!tool) {
          issues.push({ stepIndex, code: 'tool-not-found', message: '目标工具不存在。' });
        } else if (tool.builtin) {
          issues.push({ stepIndex, code: 'builtin-tool-protected', message: '内置工具不能删除。' });
        }
        break;
      }
      case 'overwrite-tool': {
        const tool = observation.tools.find((item) => item.name === step.payload.name);
        if (!tool) {
          issues.push({ stepIndex, code: 'tool-not-found', message: '只能覆盖已存在的自定义工具。' });
        } else if (tool.builtin) {
          issues.push({ stepIndex, code: 'builtin-tool-protected', message: '内置工具不能覆盖。' });
        }
        if (!step.payload.code.trim()) {
          issues.push({ stepIndex, code: 'tool-code-empty', message: '覆盖工具必须包含代码。' });
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    ok: issues.length === 0,
    normalizedSteps: [...steps],
    issues,
    risk,
    requiresConfirmation: risk !== 'read',
    requiresSecondConfirmation: risk === 'destructive',
  };
}
