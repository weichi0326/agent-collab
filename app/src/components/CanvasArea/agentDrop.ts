import type { Node, XYPosition } from '@xyflow/react';
import { findProfessionalAgent } from '../../features/professionalPackages/agentRegistry';
import { professionalAgentNodeData } from '../../features/professionalPackages/domain';
import { professionalAgentCanvasUsageDecision } from '../../features/professionalPackages/usagePolicy';
import type { ProfessionalTask } from '../../features/professionalTasks/domain';
import { uid } from '../../lib/id';
import { normalizeToolTags } from '../../lib/toolTagMigration';
import type { AgentDef } from '../../stores/agentStore';
import type { AgentNodeData, Canvas } from '../../stores/canvasStore';

interface AgentDragPayload {
  agentId?: string;
  professionalAgentId?: string;
  name?: string;
}

export function buildAgentNodeFromDrop(
  raw: string,
  position: XYPosition,
  agents: readonly AgentDef[],
): Node<AgentNodeData> | null {
  let payload: AgentDragPayload;
  try {
    payload = JSON.parse(raw) as AgentDragPayload;
  } catch {
    return null;
  }
  if (typeof payload.name !== 'string' || !payload.name.trim()) return null;

  const professionalDef = typeof payload.professionalAgentId === 'string'
    ? findProfessionalAgent(payload.professionalAgentId)
    : undefined;
  if (payload.professionalAgentId && !professionalDef) return null;
  const def = typeof payload.agentId === 'string'
    ? agents.find((agent) => agent.id === payload.agentId)
    : undefined;

  return {
    id: uid('node'),
    type: 'agent',
    position,
    data: professionalDef
      ? professionalAgentNodeData(professionalDef)
      : {
          agentId: payload.agentId,
          label: def?.name ?? payload.name.trim(),
          description: def?.description ?? '',
          systemPrompt: def?.systemPrompt ?? '',
          toolTags: normalizeToolTags(def?.toolTags),
          modelRef: def?.modelRef ?? null,
          inputSchemaText: def?.inputSchemaText ?? '',
          outputSchemaText: def?.outputSchemaText ?? '',
        },
  };
}

export function agentNodeDropRestriction(
  node: Node<AgentNodeData>,
  canvas: Pick<Canvas, 'origin' | 'workflowRef'> | undefined,
  tasks: Record<string, ProfessionalTask>,
): string | undefined {
  const professionalAgentId = node.data.professionalAgentId;
  if (!professionalAgentId) return undefined;
  const definition = findProfessionalAgent(professionalAgentId);
  if (!definition) return '该专业 Agent 已不可用。';
  const decision = professionalAgentCanvasUsageDecision(definition, canvas, tasks);
  return decision.allowed ? undefined : decision.reason;
}
