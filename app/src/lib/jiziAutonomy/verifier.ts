import type { JiziProjectObservation } from '../jiziProjectObservation';
import type { MasterAgentConfigPatch, MasterPlanStep } from '../masterActions';

export interface JiziStepVerification {
  ok: boolean;
  supported: boolean;
  evidence: string;
  retryable: boolean;
}

export function fingerprintJiziObservation(
  observation: JiziProjectObservation,
): string {
  return JSON.stringify({
    activeCanvasId: observation.activeCanvasId,
    canvases: observation.canvases.map((canvas) => ({
      id: canvas.id,
      name: canvas.name,
      run: canvas.run,
      nodes: canvas.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        agentId: node.agentId,
        toolTags: node.toolTags,
        modelRef: node.modelRef,
        outputFormat: node.outputFormat,
        run: node.run,
      })),
      edges: canvas.edges,
    })),
    agents: observation.agents,
    tools: observation.tools.map((tool) => ({ name: tool.name, loadError: tool.loadError })),
  });
}

function patchMatches(
  value: {
    name?: string;
    label?: string;
    description: string;
    systemPrompt: string;
    toolTags: string[];
    modelRef: { configId: string; modelId: string } | null;
  },
  patch: MasterAgentConfigPatch,
): boolean {
  if (patch.name && (value.name ?? value.label) !== patch.name) return false;
  if (patch.description !== undefined && value.description !== patch.description) return false;
  if (patch.systemPrompt !== undefined && value.systemPrompt !== patch.systemPrompt) return false;
  if (patch.toolTags && !patch.toolTags.every((tag) => value.toolTags.includes(tag))) return false;
  if (patch.modelRef !== undefined && JSON.stringify(value.modelRef) !== JSON.stringify(patch.modelRef)) return false;
  return true;
}

function result(ok: boolean, evidence: string, retryable = true): JiziStepVerification {
  return { ok, supported: true, evidence, retryable: ok ? false : retryable };
}

export function verifyPlanStep(
  step: MasterPlanStep,
  observation: JiziProjectObservation,
): JiziStepVerification {
  const active = observation.canvases.find(
    (canvas) => canvas.id === observation.activeCanvasId,
  );
  switch (step.type) {
    case 'create-canvas': {
      const found = step.name
        ? observation.canvases.find((canvas) => canvas.name === step.name)
        : active;
      return result(!!found, found ? `已观察到画布 [${found.id}]。` : '未观察到新画布。');
    }
    case 'rename-active-canvas':
      return result(active?.name === step.name, `当前画布名称：${active?.name ?? '无'}。`);
    case 'create-agent': {
      const found = observation.agents.find((agent) => agent.name === step.name);
      return result(!!found, found ? `已观察到 Agent [${found.id}]。` : '未观察到目标 Agent。');
    }
    case 'update-agent': {
      const agent = observation.agents.find((item) => item.id === step.agentId);
      return result(!!agent && patchMatches(agent, step.patch), agent ? `Agent [${agent.id}] 配置已读取。` : '目标 Agent 不存在。');
    }
    case 'update-node-agent-config': {
      const node = observation.canvases
        .find((canvas) => canvas.id === step.canvasId)
        ?.nodes.find((item) => item.id === step.nodeId);
      return result(!!node && patchMatches(node, step.patch), node ? `节点 [${node.id}] 配置已读取。` : '目标节点不存在。');
    }
    case 'delete-canvas': {
      const absent = !observation.canvases.some((canvas) => canvas.id === step.canvasId);
      return result(absent, absent ? '目标画布已不存在。' : '目标画布仍然存在。');
    }
    case 'delete-tool': {
      const absent = !observation.tools.some((tool) => tool.name === step.toolName);
      return result(absent, absent ? '目标工具已不存在。' : '目标工具仍然存在。');
    }
    case 'overwrite-tool': {
      const tool = observation.tools.find((item) => item.name === step.payload.name);
      return result(!!tool, tool ? `已观察到工具「${tool.name}」。` : '覆盖后的工具不存在。');
    }
    case 'add-node': {
      const node = active?.nodes.find((item) => item.label === step.label);
      return result(!!node, node ? `已观察到节点 [${node.id}]。` : '未观察到目标节点。');
    }
    case 'delete-node': {
      const absent = !active?.nodes.some((item) => item.label === step.label);
      return result(!!absent, absent ? '目标节点已不存在。' : '目标节点仍然存在。');
    }
    case 'set-node-output-format': {
      const node = active?.nodes.find((item) => item.label === step.label);
      return result(node?.outputFormat === step.outputFormat, `节点输出格式：${node?.outputFormat ?? '无'}。`);
    }
    case 'connect-nodes': {
      const source = active?.nodes.find((item) => item.label === step.source);
      const target = active?.nodes.find((item) => item.label === step.target);
      const edge = active?.edges.find((item) => item.sourceId === source?.id && item.targetId === target?.id);
      return result(!!edge, edge ? `已观察到连线 [${edge.id}]。` : '未观察到目标连线。');
    }
    case 'run-active-canvas': {
      const status = active?.run.status ?? 'missing';
      return result(status === 'success', `画布运行状态：${status}${active?.run.message ? `；${active.run.message}` : ''}。`, status !== 'running');
    }
  }
}
