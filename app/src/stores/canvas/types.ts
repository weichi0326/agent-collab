import type { Edge, Node } from '@xyflow/react';
import type {
  ProfessionalTaskHistoryDescriptor,
  ProfessionalTaskOrigin,
} from '../../features/professionalTasks/domain';

export type AgentRunStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped';

export interface AgentRunState {
  status: AgentRunStatus;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export type CanvasRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface CanvasRunState {
  status: CanvasRunStatus;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  total?: number;
  completed?: number;
  failed?: number;
  skipped?: number;
}

/**
 * A saved canvas that belongs to a professional package workspace.
 * This is deliberately separate from ProfessionalTaskOrigin: reusable
 * workflows are not execution tasks and must not enter the task lifecycle.
 */
export interface CanvasWorkflowRef {
  packageId: string;
  /**
   * Legacy project-only workflows keep this value. Package workflows omit it
   * and can be reused by every project opened by the professional package.
   */
  projectId?: string;
  workflowId: string;
  /**
   * Optional metadata for package-provided workflows. Keeping this optional
   * preserves compatibility with user-created and legacy workflow records.
   */
  systemWorkflow?: {
    key: string;
    version: 1 | 2;
    templateRevision?: number;
  };
  /** The system workflow used to create a one-off professional task canvas. */
  sourceWorkflow?: {
    key: string;
    version: 1 | 2;
    workflowId?: string;
    contentSignature?: string;
    fallbackEnabled?: boolean;
  };
}

export type AgentOutputFormat = 'txt' | 'markdown' | 'docx' | 'xlsx' | 'mindmap';

export interface NodeInputCapability {
  enabled?: boolean;
  selectionMode?: 'all' | 'selected';
  selectedUpstreamIds?: string[];
  upstreamOrder?: string[];
  contentMode?: 'structured' | 'summary' | 'full';
  includeSupplementalSources?: boolean;
  maxInputChars?: number;
  oversizeStrategy?: 'error' | 'truncate' | 'summarize';
}

export interface NodeGenerationCapability {
  enabled?: boolean;
  maxTokens?: number;
  temperature?: number | null;
  fallbackModelRef?: { configId: string; modelId: string } | null;
  retryOnEmpty?: boolean;
}

export interface NodeExecutionCapability {
  enabled?: boolean;
  retryCount?: number;
  timeoutSeconds?: number;
  allowManualRerun?: boolean;
}

export interface NodeValidationCapability {
  enabled?: boolean;
  minChars?: number | null;
  maxChars?: number | null;
  requiredTerms?: string[];
  forbiddenTerms?: string[];
  onFailure?: 'fail' | 'retry';
}

export interface AgentNodeCapabilities {
  input?: NodeInputCapability;
  generation?: NodeGenerationCapability;
  execution?: NodeExecutionCapability;
  validation?: NodeValidationCapability;
}

export interface AgentNodeData {
  label?: string;
  collapsed?: boolean;
  collapsible?: boolean;
  hiddenCount?: number;
  agentId?: string;
  professionalAgentId?: string;
  professionalPackageId?: string;
  description?: string;
  systemPrompt?: string;
  systemPromptSourceName?: string;
  outputRuleEnabled?: boolean;
  outputRuleText?: string;
  outputRuleSourceName?: string;
  resultRole?: string;
  capabilities?: AgentNodeCapabilities;
  toolTags?: string[];
  modelRef?: { configId: string; modelId: string } | null;
  inputSchemaText?: string;
  outputSchemaText?: string;
  dataSourceMode?: 'file' | 'url' | 'history' | 'inline';
  dataSourceFiles?: string[];
  dataSourceUrl?: string;
  dataSourceHistoryPaths?: string[];
  inlineDataSource?: { name: string; content: string };
  outputPath?: string;
  outputFormat?: AgentOutputFormat;
  lastOutput?: {
    folderName: string;
    runAt: string;
    items: { name: string; path?: string; summary?: string; deleted?: boolean }[];
  } | null;
  runState?: AgentRunState;
  // 门控节点（type='gate'）专用：or=任一上游成功→通过；and=全部成功→通过；nor=全部非成功→通过。
  // gate 节点不调 LLM/工具/无数据源，通过则聚合上游输出透传给下游，不通过则自身 skipped。
  gateType?: 'or' | 'and' | 'nor';
  // 定时节点（type='timer'）专用：倒计时秒数（1-86400，即 24 小时内）。上游全部通过后开始倒计时，
  // 计时完毕透传上游产物并放行下游；无上游时作为纯定时器，运行开始即倒计时。
  timerSeconds?: number;
  [key: string]: unknown;
}

export type AgentNode = Node<AgentNodeData>;

export interface Canvas {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  savedId?: string;
  readOnly?: boolean;
  runId?: string;
  lockClose?: boolean;
  runState?: CanvasRunState;
  origin?: ProfessionalTaskOrigin;
  workflowRef?: CanvasWorkflowRef;
  // 右上角运行状态卡是否被用户收起(仅终态可收起);收起后显示为可点击的小色标胶囊。
  runCardCollapsed?: boolean;
}

export interface SavedCanvas {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  savedAt: string;
  readOnly?: boolean;
  origin?: ProfessionalTaskOrigin;
  workflowRef?: CanvasWorkflowRef;
}

export interface RunRecord {
  id: string;
  canvasId: string;
  canvasName: string;
  time: string;
  stamp: string;
  nodes: Node[];
  edges: Edge[];
  runState?: CanvasRunState;
  history?: ProfessionalTaskHistoryDescriptor & {
    packageId?: string;
    sequence: number;
    displayName: string;
  };
  origin?: ProfessionalTaskOrigin;
  workflowRef?: CanvasWorkflowRef;
}

export interface CreatedRun {
  runId: string;
  canvasId: string;
}

export interface CreatedWorkflowCanvas {
  canvasId: string;
  savedId: string;
  workflowId: string;
}

export interface CreatedSavedWorkflowCanvas {
  savedId: string;
  workflowId: string;
}

export type CanvasOpenResult = 'opened' | 'activated' | 'limit' | 'not-found';

export interface Snapshot {
  nodes: Node[];
  edges: Edge[];
  name: string;
  // 全局单调递增序号:用于跨画布裁剪撤销历史总量时按最旧优先淘汰。
  seq: number;
}

// 同时打开的画布 tab 软上限(仅防标签栏/内存失控);运行并发另有 MAX_CONCURRENT_RUNS 管控。
export const MAX_CANVASES = 20;

export function canvasLimitMessage(maxCanvases = MAX_CANVASES): string {
  return `最多只能同时打开 ${maxCanvases} 个画布，请先关闭一个再继续`;
}
