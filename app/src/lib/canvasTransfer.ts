import { save } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import type { Node, Edge } from '@xyflow/react';
import { executeTool } from './pythonClient';
import { safeFileName } from './agentRunner/utils';
import { normalizeToolTags } from './toolTagMigration';
import { uid } from './id';
import type { ExportResult } from './agentTransfer';
import type { AgentNodeData, AgentOutputFormat } from '../stores/canvas/types';
import { readRoutePoints, type RoutePoint } from './orthogonalRoute';

export const CANVAS_EXPORT_KIND = 'canvas-export';
export const CANVAS_EXPORT_SCHEMA = 1;
// 导入是不可信文件的系统边界:给节点数量与画布名长度设护栏,防损坏/恶意文件卡死渲染或撑破 UI。
const IMPORT_MAX_NODES = 500;
const IMPORT_MAX_NAME_LEN = 40; // 与重命名弹窗 maxLength 对齐

const OUTPUT_FORMATS: readonly AgentOutputFormat[] = ['markdown', 'docx', 'xlsx', 'mindmap'];
function normalizeOutputFormat(v: unknown): AgentOutputFormat | undefined {
  return OUTPUT_FORMATS.includes(v as AgentOutputFormat) ? (v as AgentOutputFormat) : undefined;
}
const GATE_TYPES: readonly ('or' | 'and' | 'nor')[] = ['or', 'and', 'nor'];
function normalizeGateType(v: unknown): 'or' | 'and' | 'nor' | undefined {
  return GATE_TYPES.includes(v as 'or' | 'and' | 'nor') ? (v as 'or' | 'and' | 'nor') : undefined;
}
function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// 可移植的画布信封:整张画布连带每个节点的完整能力快照(提示词/标签/schema/输出格式),
// 但剥离本机路径(dataSourceFiles/historyPaths/outputPath)、运行态(lastOutput/runState)、
// 派生 UI 态(collapsed…)与 modelRef(configId 换机器无意义,只留 modelHint 供导入者重选)。
interface ExportNodeData {
  label?: string;
  description?: string;
  systemPrompt?: string;
  systemPromptSourceName?: string;
  outputRuleEnabled?: boolean;
  outputRuleText?: string;
  outputRuleSourceName?: string;
  toolTags?: string[];
  inputSchemaText?: string;
  outputSchemaText?: string;
  outputFormat?: AgentOutputFormat;
  dataSourceMode?: 'url';
  dataSourceUrl?: string;
  modelHint: string | null;
  // 门控节点(type='gate')专用:or=任一上游成功→通过;and=全部成功→通过;nor=全部非成功→通过。
  gateType?: 'or' | 'and' | 'nor';
  // 定时节点(type='timer')专用:倒计时秒数(1-86400)。
  timerSeconds?: number;
}

interface ExportNode {
  id: string; // 原始 id,仅用于导入时把连线映射到新节点
  type?: string;
  position: { x: number; y: number };
  data: ExportNodeData;
}

interface ExportEdge {
  source: string; // 原始节点 id
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  routePoints?: RoutePoint[];
}

export interface CanvasExportEnvelope {
  kind: typeof CANVAS_EXPORT_KIND;
  schema: number;
  exportedAt: string;
  canvas: {
    name: string;
    nodes: ExportNode[];
    edges: ExportEdge[];
  };
}

export interface CanvasExportInput {
  name: string;
  nodes: Node[];
  edges: Edge[];
}

function exportNodeData(data: AgentNodeData): ExportNodeData {
  return {
    label: data.label,
    description: data.description,
    systemPrompt: data.systemPrompt,
    systemPromptSourceName: data.systemPromptSourceName,
    outputRuleEnabled: data.outputRuleEnabled,
    outputRuleText: data.outputRuleText,
    outputRuleSourceName: data.outputRuleSourceName,
    toolTags: Array.isArray(data.toolTags) ? [...data.toolTags] : undefined,
    inputSchemaText: data.inputSchemaText,
    outputSchemaText: data.outputSchemaText,
    outputFormat: data.outputFormat,
    // 只有 url 数据来源可跨机器保留;file/history 是本机路径,剥离后节点回到「无数据来源」由用户重设。
    dataSourceMode: data.dataSourceMode === 'url' ? 'url' : undefined,
    dataSourceUrl: data.dataSourceMode === 'url' ? data.dataSourceUrl : undefined,
    modelHint: data.modelRef?.modelId ?? null,
    gateType: data.gateType,
    timerSeconds: typeof data.timerSeconds === 'number' ? data.timerSeconds : undefined,
  };
}

export function buildCanvasExport(input: CanvasExportInput): CanvasExportEnvelope {
  return {
    kind: CANVAS_EXPORT_KIND,
    schema: CANVAS_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    canvas: {
      name: input.name,
      nodes: input.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
        data: exportNodeData((n.data ?? {}) as AgentNodeData),
      })),
      edges: input.edges.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        type: e.type,
        routePoints: readRoutePoints(e.data?.routePoints),
      })),
    },
  };
}

// 弹系统保存框选路径,走 Python file-write 落盘(与全项目文件写出一致,允许写沙箱外)。
export async function exportCanvasToFile(input: CanvasExportInput): Promise<ExportResult> {
  if (!isTauri()) {
    return { status: 'error', message: '导出需在桌面端使用' };
  }
  const defaultName = `${safeFileName(input.name) || 'canvas'}.canvas.json`;
  let target: string | null;
  try {
    target = await save({
      title: '导出画布',
      defaultPath: defaultName,
      filters: [{ name: '画布定义', extensions: ['json'] }],
    });
  } catch (e) {
    console.error('[exportCanvasToFile save]', e);
    return { status: 'error', message: '打开保存对话框失败' };
  }
  if (!target) return { status: 'cancelled' };

  const content = JSON.stringify(buildCanvasExport(input), null, 2);
  const res = await executeTool('file-write', {
    path: target,
    content,
    mode: 'overwrite',
    mkdir: true,
    atomic: true,
    allow_outside_roots: true,
  });
  if (!res.ok) {
    return { status: 'error', message: res.error || '写入文件失败' };
  }
  const written = (res.result as { path?: unknown }).path;
  return { status: 'ok', path: typeof written === 'string' ? written : target };
}

// ---- 导入 ----

export interface CanvasImportResult {
  name: string;
  nodes: Node[];
  edges: Edge[];
  droppedTags: string[]; // 本机不存在、已被剔除的工具标签(去重)
  clearedModelCount: number; // 被清空 modelRef、需用户重选模型的节点数
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// 解析导入文件文本为可重建的画布。knownTags 由调用方从工具库(内置+已装自定义)提供,
// 缺失的工具标签会被剔除并回报;节点 id / 边 id 全部重新生成避免与现有画布碰撞;
// modelRef 一律置空由用户重选。校验不过直接抛错。
export function parseCanvasImport(text: string, knownTags: string[]): CanvasImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('文件内容不是有效的画布导出对象');
  }
  const env = parsed as Partial<CanvasExportEnvelope>;
  if (env.kind !== CANVAS_EXPORT_KIND) {
    throw new Error('这不是一个画布导出文件');
  }
  if (typeof env.schema === 'number' && env.schema > CANVAS_EXPORT_SCHEMA) {
    throw new Error(`文件版本(schema ${env.schema})高于当前支持,请升级应用后再导入`);
  }
  const canvas = env.canvas;
  if (!canvas || typeof canvas !== 'object' || !Array.isArray(canvas.nodes)) {
    throw new Error('文件缺少画布节点数据');
  }
  if (canvas.nodes.length > IMPORT_MAX_NODES) {
    throw new Error(`画布节点数(${canvas.nodes.length})超过上限 ${IMPORT_MAX_NODES},文件可能已损坏`);
  }
  const name = asString(canvas.name).trim().slice(0, IMPORT_MAX_NAME_LEN);
  if (!name) {
    throw new Error('画布名称为空,无法导入');
  }

  const known = new Set(knownTags);
  const droppedSet = new Set<string>();
  let clearedModelCount = 0;

  const idMap = new Map<string, string>();
  const nodes: Node[] = canvas.nodes.map((n) => {
    const src = (n ?? {}) as Partial<ExportNode>;
    const nid = uid('node');
    if (typeof src.id === 'string') idMap.set(src.id, nid);
    const d = (src.data ?? {}) as ExportNodeData;

    // 归一旧读写分离标签(file-read/docx-write…)再按本机已知标签过滤,未知项剔除并回报。
    const rawTags = normalizeToolTags(d.toolTags);
    const toolTags = rawTags.filter((t) => known.has(t));
    rawTags.filter((t) => !known.has(t)).forEach((t) => droppedSet.add(t));

    if (d.modelHint) clearedModelCount++;

    const data: AgentNodeData = {
      label: asString(d.label) || 'Agent',
      description: asString(d.description),
      systemPrompt: asString(d.systemPrompt),
      systemPromptSourceName: asString(d.systemPromptSourceName) || undefined,
      outputRuleEnabled: d.outputRuleEnabled === true,
      outputRuleText: asString(d.outputRuleText),
      outputRuleSourceName: asString(d.outputRuleSourceName) || undefined,
      toolTags,
      modelRef: null,
      inputSchemaText: asString(d.inputSchemaText),
      outputSchemaText: asString(d.outputSchemaText),
      outputFormat: normalizeOutputFormat(d.outputFormat),
    };
    // 门控节点:归一 gateType,非法值落 undefined(导入后属性面板会显示 OR 默认)。
    const gateType = normalizeGateType(d.gateType);
    if (gateType) {
      data.gateType = gateType;
      // 门控节点不调 LLM/工具/无数据源,清掉无关字段避免脏数据。
      data.toolTags = [];
      data.systemPrompt = '';
      data.outputRuleEnabled = false;
      data.outputRuleText = '';
      data.outputRuleSourceName = undefined;
      data.inputSchemaText = '';
      data.outputSchemaText = '';
      data.outputFormat = undefined;
    }
    // 定时节点:归一 timerSeconds 到 1-86400,清掉无关字段避免脏数据。
    if (typeof d.timerSeconds === 'number' && Number.isFinite(d.timerSeconds)) {
      data.timerSeconds = Math.min(86400, Math.max(1, Math.floor(d.timerSeconds)));
      data.toolTags = [];
      data.systemPrompt = '';
      data.outputRuleEnabled = false;
      data.outputRuleText = '';
      data.outputRuleSourceName = undefined;
      data.inputSchemaText = '';
      data.outputSchemaText = '';
      data.outputFormat = undefined;
    }
    if (d.dataSourceMode === 'url' && asString(d.dataSourceUrl)) {
      data.dataSourceMode = 'url';
      data.dataSourceUrl = asString(d.dataSourceUrl);
    }

    return {
      id: nid,
      type: typeof src.type === 'string' ? src.type : undefined,
      position: {
        x: finiteOr(src.position?.x, 0),
        y: finiteOr(src.position?.y, 0),
      },
      data,
      selected: false,
    } as Node;
  });

  const rawEdges = Array.isArray(canvas.edges) ? canvas.edges : [];
  const edges: Edge[] = [];
  for (const e of rawEdges) {
    const src = (e ?? {}) as Partial<ExportEdge>;
    const source = idMap.get(asString(src.source));
    const target = idMap.get(asString(src.target));
    // 只保留两端都映射到新节点的连线,丢弃悬空边。
    if (!source || !target) continue;
    edges.push({
      id: uid('edge'),
      source,
      target,
      sourceHandle: src.sourceHandle ?? undefined,
      targetHandle: src.targetHandle ?? undefined,
      type: typeof src.type === 'string' ? src.type : undefined,
      data: {
        routePoints: readRoutePoints(src.routePoints),
      },
      selected: false,
    } as Edge);
  }

  return {
    name,
    nodes,
    edges,
    droppedTags: [...droppedSet],
    clearedModelCount,
  };
}
