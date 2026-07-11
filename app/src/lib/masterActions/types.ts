import type { AgentOutputFormat } from '../../stores/canvasStore';
import type {
  InstallToolPayload,
  ToolMetaCapability,
  ToolMetaImplementation,
} from '../pythonClient';

export interface MasterAgentConfigPatch {
  name?: string;
  description?: string;
  systemPrompt?: string;
  toolTags?: string[];
  modelRef?: { configId: string; modelId: string } | null;
}

export type MasterPlanStep =
  | { type: 'create-canvas'; name?: string }
  | { type: 'rename-active-canvas'; name: string }
  | { type: 'create-agent'; name: string }
  | {
      type: 'add-node';
      label: string;
      agentQuery?: string;
      outputFormat?: AgentOutputFormat;
    }
  | { type: 'connect-nodes'; source: string; target: string }
  | { type: 'delete-node'; label: string }
  | {
      type: 'set-node-output-format';
      label: string;
      outputFormat: AgentOutputFormat;
    }
  | { type: 'update-agent'; agentId: string; patch: MasterAgentConfigPatch }
  | {
      type: 'update-node-agent-config';
      canvasId: string;
      nodeId: string;
      patch: MasterAgentConfigPatch;
    }
  | { type: 'delete-canvas'; canvasId: string }
  | { type: 'overwrite-tool'; payload: InstallToolPayload }
  | { type: 'delete-tool'; toolName: string }
  | { type: 'run-active-canvas' };

export type MasterAction =
  | { type: 'run-active-canvas' }
  // 就地重跑只读运行副本 tab 上的失败节点及其下游(姬子补已注册标签后零确认自动触发)。
  | {
      type: 'rerun-canvas-node';
      runTabId: string;
      nodeId: string;
      sourceCanvasId: string;
    }
  | { type: 'create-canvas'; name?: string }
  | {
      type: 'create-workflow-canvas';
      name?: string;
      nodes: { label: string; agentQuery?: string }[];
      connectSequential?: boolean;
    }
  | { type: 'rename-active-canvas'; name: string }
  | { type: 'create-agent'; name: string }
  // 造工具：需整段 Python 代码人工审阅，作为独立动作，不进 plan step。
  | {
      type: 'create-tool';
      name: string;
      description: string;
      tags: string[];
      dependencies: string[];
      implementation?: ToolMetaImplementation;
      capabilities?: ToolMetaCapability[];
      smokeTestParams?: Record<string, unknown>;
      code: string;
    }
  | { type: 'plan'; summary?: string; steps: MasterPlanStep[] };

