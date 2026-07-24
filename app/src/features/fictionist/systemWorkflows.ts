import type { Node, Edge } from '@xyflow/react';
import { uid } from '../../lib/id';
import { useCanvasStore, type AgentNodeData, type CanvasWorkflowRef } from '../../stores/canvasStore';
import {
  buildContinuationGraph,
  CHAPTER_DRAFT_RESULT_ROLE,
  type ChapterWritingMode,
} from './continuation';
import { FICTIONIST_AGENT_IDS } from './agents';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
} from './chapterInsights';
import {
  buildOutlineWorkflowGraph,
  FICTIONIST_OUTLINE_WORKFLOW_KEYS,
  OUTLINE_IMPORT_TASK_TYPE,
  OUTLINE_OPTIMIZE_TASK_TYPE,
  type FictionistOutlineWorkflowKey,
  type FictionOutlineTaskOperation,
} from './outlineWorkflows';
import { FICTIONIST_PACKAGE_ID } from './package';

export const FICTIONIST_WRITING_WORKFLOW_KEYS = {
  draft: 'fictionist.chapter-draft',
  continue: 'fictionist.chapter-continue',
} as const;

export type FictionistWritingWorkflowKey =
  (typeof FICTIONIST_WRITING_WORKFLOW_KEYS)[keyof typeof FICTIONIST_WRITING_WORKFLOW_KEYS];
export type FictionistSystemWorkflowKey = FictionistWritingWorkflowKey | FictionistOutlineWorkflowKey;

export const FICTIONIST_SYSTEM_WORKFLOW_TEMPLATE_REVISION = 2;

interface FictionistSystemWorkflowSpecBase {
  key: FictionistSystemWorkflowKey;
  kind: 'writing' | 'outline';
  name: string;
  description: string;
  taskType: string;
}

export interface FictionistWritingWorkflowSpec extends FictionistSystemWorkflowSpecBase {
  key: FictionistWritingWorkflowKey;
  kind: 'writing';
  mode: ChapterWritingMode;
}

export interface FictionistOutlineWorkflowSpec extends FictionistSystemWorkflowSpecBase {
  key: FictionistOutlineWorkflowKey;
  kind: 'outline';
  operation: FictionOutlineTaskOperation;
}

export type FictionistSystemWorkflowSpec =
  | FictionistWritingWorkflowSpec
  | FictionistOutlineWorkflowSpec;

export const FICTIONIST_WRITING_WORKFLOW_SPECS: readonly FictionistWritingWorkflowSpec[] = [
  {
    key: FICTIONIST_WRITING_WORKFLOW_KEYS.draft,
    kind: 'writing',
    mode: 'draft-current',
    name: 'AI 起草',
    description: '基于当前章节目标和作品上下文生成初稿。',
    taskType: 'draft-chapter',
  },
  {
    key: FICTIONIST_WRITING_WORKFLOW_KEYS.continue,
    kind: 'writing',
    mode: 'continue',
    name: '续写下一章',
    description: '承接当前章节结尾，生成下一章草稿。',
    taskType: 'continue-chapter',
  },
];

export const FICTIONIST_OUTLINE_WORKFLOW_SPECS: readonly FictionistOutlineWorkflowSpec[] = [
  {
    key: FICTIONIST_OUTLINE_WORKFLOW_KEYS.import,
    kind: 'outline',
    operation: 'import',
    name: '导入大纲整理',
    description: '分析本地大纲并整理为小说家的全书、卷和章节结构。',
    taskType: OUTLINE_IMPORT_TASK_TYPE,
  },
  {
    key: FICTIONIST_OUTLINE_WORKFLOW_KEYS.optimize,
    kind: 'outline',
    operation: 'optimize',
    name: '大纲优化',
    description: '按选定范围、方向和修改强度优化现有大纲。',
    taskType: OUTLINE_OPTIMIZE_TASK_TYPE,
  },
];

export const FICTIONIST_SYSTEM_WORKFLOW_SPECS: readonly FictionistSystemWorkflowSpec[] = [
  ...FICTIONIST_WRITING_WORKFLOW_SPECS,
  ...FICTIONIST_OUTLINE_WORKFLOW_SPECS,
];

export const FICTIONIST_SYSTEM_WORKFLOW_CATALOG_SIGNATURE = [
  FICTIONIST_SYSTEM_WORKFLOW_TEMPLATE_REVISION,
  ...FICTIONIST_SYSTEM_WORKFLOW_SPECS.map((workflow) => `${workflow.key}:${workflow.name}`),
].join(':');

export const SYSTEM_WORKFLOW_CONTEXT_PLACEHOLDER =
  '这是小说家专业包内置工作流模板。只有从小说家正文页发起对应写作任务时，才会注入当前作品、章节和写作要求。';

export function systemWorkflowScope(
  key: FictionistSystemWorkflowKey,
  version: 1 | 2,
): Omit<CanvasWorkflowRef, 'workflowId'> & {
  systemWorkflow: NonNullable<CanvasWorkflowRef['systemWorkflow']>;
} {
  return {
    packageId: FICTIONIST_PACKAGE_ID,
    systemWorkflow: {
      key,
      version,
      templateRevision: FICTIONIST_SYSTEM_WORKFLOW_TEMPLATE_REVISION,
    },
  };
}

export function isFictionistSystemWorkflow(
  ref: CanvasWorkflowRef | undefined,
  key?: FictionistSystemWorkflowKey,
  version?: 1 | 2,
): boolean {
  const system = ref?.systemWorkflow;
  return ref?.packageId === FICTIONIST_PACKAGE_ID
    && ref.projectId === undefined
    && typeof system?.key === 'string'
    && (system.version === 1 || system.version === 2)
    && (!key || system?.key === key)
    && (!version || system?.version === version);
}

export interface FictionistSystemWorkflowEnsureResult {
  ensured: number;
  failed: string[];
}

/**
 * Reconciles the four package-level templates. The canvas store owns the
 * idempotent migration so this entry point is safe to call at startup and
 * again when a writing task discovers a missing template.
 */
export function ensureFictionistSystemWorkflows(): FictionistSystemWorkflowEnsureResult {
  let ensured = 0;
  const failed: string[] = [];
  for (const spec of FICTIONIST_SYSTEM_WORKFLOW_SPECS) {
    for (const version of [1, 2] as const) {
      if (version === 1 && spec.kind === 'writing') migratePrimaryWorkflow(spec);
      const result = useCanvasStore.getState().ensureSavedSystemWorkflowCanvas(
        systemWorkflowName(spec, version),
        systemWorkflowScope(spec.key, version),
        {
          ...systemWorkflowTemplateForSpec(spec),
          readOnly: version === 2,
        },
      );
      if (result) ensured++;
      else failed.push(`${spec.key}:${version}`);
    }
  }
  return { ensured, failed };
}

export function systemWorkflowName(spec: FictionistSystemWorkflowSpec, version: 1 | 2): string {
  return `${spec.name} · ${version === 1 ? '主流程' : '备用流程'}`;
}

export function systemWorkflowTemplate(
  mode: ChapterWritingMode,
): { nodes: Node[]; edges: Edge[] } {
  return buildContinuationGraph(SYSTEM_WORKFLOW_CONTEXT_PLACEHOLDER, null, mode);
}

export function systemWorkflowTemplateForSpec(
  spec: FictionistSystemWorkflowSpec,
): { nodes: Node[]; edges: Edge[] } {
  return spec.kind === 'writing'
    ? systemWorkflowTemplate(spec.mode)
    : buildOutlineWorkflowGraph(spec.operation, SYSTEM_WORKFLOW_CONTEXT_PLACEHOLDER, null);
}

function nodeRole(node: Node): string | undefined {
  return (node.data as AgentNodeData).resultRole;
}

function professionalAgentId(node: Node): string | undefined {
  return (node.data as AgentNodeData).professionalAgentId;
}

function edgeExists(edges: Edge[], source: string, target: string): boolean {
  return edges.some((edge) => edge.source === source && edge.target === target);
}

/** Adds the two report nodes without replacing user-authored prompts or extra nodes. */
export function upgradeWritingWorkflowGraph(
  nodes: Node[],
  edges: Edge[],
  mode: ChapterWritingMode,
): { nodes: Node[]; edges: Edge[] } {
  const writer = nodes.find(
    (node) => professionalAgentId(node) === FICTIONIST_AGENT_IDS.chapterWriter,
  );
  const finalEditor = nodes.find((node) =>
    nodeRole(node) === CHAPTER_DRAFT_RESULT_ROLE
    || professionalAgentId(node) === FICTIONIST_AGENT_IDS.finalEditor,
  );
  if (!writer || !finalEditor) return { nodes, edges };

  const template = systemWorkflowTemplate(mode);
  const templateContext = template.nodes.find(
    (node) => nodeRole(node) === CHAPTER_CONTEXT_RESULT_ROLE,
  );
  const templateReviewer = template.nodes.find(
    (node) => nodeRole(node) === CHAPTER_CANON_CHECK_RESULT_ROLE,
  );
  if (!templateContext || !templateReviewer) return { nodes, edges };

  const legacyDefault = nodes.length === 2
    && edges.length === 1
    && edgeExists(edges, writer.id, finalEditor.id);
  const context = nodes.find((node) => nodeRole(node) === CHAPTER_CONTEXT_RESULT_ROLE)
    ?? templateContext;
  const reviewer = nodes.find((node) => nodeRole(node) === CHAPTER_CANON_CHECK_RESULT_ROLE)
    ?? templateReviewer;
  let upgradedNodes = nodes.map((node) => {
    if (legacyDefault && node.id === writer.id) {
      const data = node.data as AgentNodeData;
      return {
        ...node,
        position: { ...template.nodes[1].position },
        data: {
          ...data,
          capabilities: {
            ...data.capabilities,
            input: {
              ...data.capabilities?.input,
              enabled: true,
              includeSupplementalSources: true,
            },
          },
        },
      };
    }
    if (node.id === finalEditor.id) {
      const data = node.data as AgentNodeData;
      return {
        ...node,
        ...(legacyDefault ? { position: { ...template.nodes[3].position } } : {}),
        data: {
          ...data,
          ...(data.label === '一致性检查与定稿' ? { label: '综合定稿' } : {}),
          ...(data.description === '检查初稿连续性并输出唯一的待确认章节草稿。'
            ? { description: '综合章节初稿和设定检查结果，输出唯一的待确认草稿。' }
            : {}),
        },
      };
    }
    return node;
  });
  if (!upgradedNodes.some((node) => node.id === context.id)) {
    upgradedNodes = [...upgradedNodes, {
      ...context,
      position: legacyDefault
        ? { ...templateContext.position }
        : { x: writer.position.x - 320, y: writer.position.y },
    }];
  }
  if (!upgradedNodes.some((node) => node.id === reviewer.id)) {
    upgradedNodes = [...upgradedNodes, {
      ...reviewer,
      position: legacyDefault
        ? { ...templateReviewer.position }
        : { x: writer.position.x + 320, y: writer.position.y },
    }];
  }

  const upgradedEdges = [...edges];
  for (const [source, target] of [
    [context.id, writer.id],
    [writer.id, reviewer.id],
    [writer.id, finalEditor.id],
    [reviewer.id, finalEditor.id],
  ]) {
    if (!edgeExists(upgradedEdges, source, target)) {
      upgradedEdges.push({ id: uid('edge'), source, target });
    }
  }
  return { nodes: upgradedNodes, edges: upgradedEdges };
}

function migratePrimaryWorkflow(spec: FictionistWritingWorkflowSpec): void {
  const isLegacyPrimary = (canvas: { workflowRef?: CanvasWorkflowRef }) => {
    const system = canvas.workflowRef?.systemWorkflow;
    return canvas.workflowRef?.packageId === FICTIONIST_PACKAGE_ID
      && canvas.workflowRef.projectId === undefined
      && system?.key === spec.key
      && system.version === 1
      && (system.templateRevision ?? 1) < FICTIONIST_SYSTEM_WORKFLOW_TEMPLATE_REVISION;
  };
  useCanvasStore.setState((state) => ({
    savedCanvases: state.savedCanvases.map((canvas) => {
      if (!isLegacyPrimary(canvas)) return canvas;
      const graph = upgradeWritingWorkflowGraph(canvas.nodes, canvas.edges, spec.mode);
      return { ...canvas, nodes: graph.nodes, edges: graph.edges };
    }),
    canvases: state.canvases.map((canvas) => {
      if (!isLegacyPrimary(canvas)) return canvas;
      const graph = upgradeWritingWorkflowGraph(canvas.nodes, canvas.edges, spec.mode);
      return { ...canvas, nodes: graph.nodes, edges: graph.edges };
    }),
  }));
}

const TRANSIENT_NODE_DATA_KEYS = new Set([
  'collapsed',
  'collapsible',
  'hiddenCount',
  'lastOutput',
  'runState',
]);

function stableValue(value: unknown, omittedKeys?: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => !omittedKeys?.has(key) && item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Compares execution-affecting graph content while ignoring node placement,
 * viewport state and generated run metadata.
 */
export function systemWorkflowContentSignature(nodes: Node[], edges: Edge[]): string {
  const nodeKeys = new Map<string, string>();
  const normalizedNodes = nodes.map((node, index) => {
    const data = node.data as AgentNodeData;
    const key = data.professionalAgentId
      ?? data.agentId
      ?? `${node.type ?? 'node'}:${data.label ?? ''}:${index}`;
    nodeKeys.set(node.id, key);
    return {
      key,
      type: node.type,
      parentId: node.parentId,
      data: stableValue(data, TRANSIENT_NODE_DATA_KEYS),
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
  const normalizedEdges = edges.map((edge) => ({
    source: nodeKeys.get(edge.source) ?? edge.source,
    target: nodeKeys.get(edge.target) ?? edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    label: edge.label,
    data: stableValue(edge.data, new Set(['routePoints'])),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({ nodes: normalizedNodes, edges: normalizedEdges });
}

export function isSystemWorkflowModified(
  nodes: Node[],
  edges: Edge[],
  mode: ChapterWritingMode,
): boolean {
  const template = systemWorkflowTemplate(mode);
  return systemWorkflowContentSignature(nodes, edges)
    !== systemWorkflowContentSignature(template.nodes, template.edges);
}

export function isSystemWorkflowSpecModified(
  nodes: Node[],
  edges: Edge[],
  spec: FictionistSystemWorkflowSpec,
): boolean {
  const template = systemWorkflowTemplateForSpec(spec);
  return systemWorkflowContentSignature(nodes, edges)
    !== systemWorkflowContentSignature(template.nodes, template.edges);
}
