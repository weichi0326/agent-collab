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

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
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
  const projectedCanvases = observation.canvases.map((canvas) => ({
    ...canvas,
    nodes: canvas.nodes.map((node) => ({ ...node })),
    edges: canvas.edges.map((edge) => ({ ...edge })),
  }));
  const projectedAgentNames = new Set(
    observation.agents.map((agent) => normalizedName(agent.name)),
  );
  let projectedActiveId = observation.activeCanvasId;

  const activeCanvas = () =>
    projectedCanvases.find((canvas) => canvas.id === projectedActiveId);
  const editableActiveCanvas = (stepIndex: number) => {
    const canvas = activeCanvas();
    if (!canvas) {
      issues.push({
        stepIndex,
        code: 'active-canvas-missing',
        message: '当前没有打开的画布。',
      });
      return undefined;
    }
    if (canvas.readOnly) {
      issues.push({
        stepIndex,
        code: 'canvas-read-only',
        message: '只读运行画布不可编辑。',
      });
      return undefined;
    }
    if (canvas.run.status === 'running') {
      issues.push({
        stepIndex,
        code: 'canvas-running',
        message: '画布正在运行，暂时不可编辑。',
      });
      return undefined;
    }
    return canvas;
  };
  const findNode = (
    canvas: (typeof projectedCanvases)[number],
    query: string,
  ) => {
    const key = normalizedName(query).replace(/\s+/g, '');
    return (
      canvas.nodes.find(
        (node) => normalizedName(node.label).replace(/\s+/g, '') === key,
      ) ??
      canvas.nodes.find((node) => {
        const label = normalizedName(node.label).replace(/\s+/g, '');
        return label.includes(key) || key.includes(label);
      })
    );
  };
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
        if (
          step.name?.trim() &&
          projectedCanvases.some(
            (canvas) => normalizedName(canvas.name) === normalizedName(step.name!),
          )
        ) {
          issues.push({
            stepIndex,
            code: 'canvas-name-duplicate',
            message: '画布名称已存在。',
          });
        }
        if (projectedCanvases.length + 1 > MAX_CANVASES) {
          issues.push({ stepIndex, code: 'canvas-limit', message: '同时打开的画布已达到上限。' });
        }
        projectedActiveId = `__planned_canvas_${stepIndex}`;
        projectedCanvases.push({
          id: projectedActiveId,
          name: step.name?.trim() || `新画布 ${projectedCanvases.length + 1}`,
          readOnly: false,
          runId: null,
          run: { status: 'idle', message: '' },
          nodes: [],
          edges: [],
        });
        break;
      case 'rename-active-canvas': {
        const canvas = editableActiveCanvas(stepIndex);
        if (!canvas) break;
        if (
          projectedCanvases.some(
            (item) =>
              item.id !== canvas.id &&
              normalizedName(item.name) === normalizedName(step.name),
          )
        ) {
          issues.push({ stepIndex, code: 'canvas-name-duplicate', message: '画布名称已存在。' });
        } else {
          canvas.name = step.name;
        }
        break;
      }
      case 'create-agent': {
        const key = normalizedName(step.name);
        if (projectedAgentNames.has(key)) {
          issues.push({ stepIndex, code: 'agent-name-duplicate', message: 'Agent 名称已存在。' });
        } else {
          projectedAgentNames.add(key);
        }
        break;
      }
      case 'add-node': {
        const canvas = editableActiveCanvas(stepIndex);
        if (!canvas) break;
        canvas.nodes.push({
          id: `__planned_node_${stepIndex}`,
          type: 'agent',
          label: step.label,
          agentId: null,
          description: '',
          systemPrompt: '',
          toolTags: [],
          modelRef: null,
          inputSchemaText: '',
          outputSchemaText: '',
          outputFormat: step.outputFormat ?? null,
          run: { status: 'idle', message: '' },
          lastOutput: null,
        });
        break;
      }
      case 'connect-nodes': {
        const canvas = editableActiveCanvas(stepIndex);
        if (!canvas) break;
        const source = findNode(canvas, step.source);
        const target = findNode(canvas, step.target);
        if (!source || !target) {
          issues.push({ stepIndex, code: 'node-not-found', message: '连线的源节点或目标节点不存在。' });
        } else if (
          canvas.edges.some(
            (edge) => edge.sourceId === source.id && edge.targetId === target.id,
          )
        ) {
          issues.push({ stepIndex, code: 'connection-duplicate', message: '该节点连线已存在。' });
        } else {
          canvas.edges.push({
            id: `__planned_edge_${stepIndex}`,
            sourceId: source.id,
            targetId: target.id,
          });
        }
        break;
      }
      case 'delete-node': {
        const canvas = editableActiveCanvas(stepIndex);
        if (!canvas) break;
        const node = findNode(canvas, step.label);
        if (!node) {
          issues.push({ stepIndex, code: 'node-not-found', message: '目标节点不存在。' });
        } else {
          canvas.nodes = canvas.nodes.filter((item) => item.id !== node.id);
          canvas.edges = canvas.edges.filter(
            (edge) => edge.sourceId !== node.id && edge.targetId !== node.id,
          );
        }
        break;
      }
      case 'set-node-output-format': {
        const canvas = editableActiveCanvas(stepIndex);
        if (!canvas) break;
        const node = findNode(canvas, step.label);
        if (!node) {
          issues.push({ stepIndex, code: 'node-not-found', message: '目标节点不存在。' });
        } else {
          node.outputFormat = step.outputFormat;
        }
        break;
      }
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
        } else {
          const index = projectedCanvases.findIndex((item) => item.id === step.canvasId);
          projectedCanvases.splice(index, 1);
          if (projectedActiveId === step.canvasId) {
            projectedActiveId = projectedCanvases[0]?.id ?? null;
          }
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
      case 'run-active-canvas': {
        const canvas = activeCanvas();
        if (!canvas) {
          issues.push({ stepIndex, code: 'active-canvas-missing', message: '当前没有打开的画布。' });
        } else {
          if (canvas.readOnly) {
            issues.push({ stepIndex, code: 'canvas-read-only', message: '只读运行画布不能再次运行。' });
          }
          if (canvas.run.status === 'running') {
            issues.push({ stepIndex, code: 'canvas-running', message: '画布已在运行中。' });
          }
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
