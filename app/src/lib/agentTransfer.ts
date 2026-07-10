import { save } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import type { AgentDef, AgentDraft } from '../stores/agentStore';
import { executeTool } from './pythonClient';
import { safeFileName } from './agentRunner/utils';
import { normalizeToolTags } from './toolTagMigration';

export const AGENT_EXPORT_KIND = 'agent-export';
export const AGENT_EXPORT_SCHEMA = 1;

// 可移植的 Agent 信封:剥离本机相关字段(id/时间戳),modelRef 置空只留 modelId 作提示,
// 方便跨机器/分享导入时重新在本机选模型,不会指向不存在的 configId。
export interface AgentExportEnvelope {
  kind: typeof AGENT_EXPORT_KIND;
  schema: number;
  exportedAt: string;
  modelHint: string | null; // 导出时选用模型的 modelId,仅供导入者参考,非绑定
  agent: {
    name: string;
    description: string;
    systemPrompt: string;
    toolTags: string[];
    modelRef: null;
    inputSchemaText: string;
    outputSchemaText: string;
    version: number;
  };
}

export function buildAgentExport(agent: AgentDef): AgentExportEnvelope {
  return {
    kind: AGENT_EXPORT_KIND,
    schema: AGENT_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    modelHint: agent.modelRef?.modelId ?? null,
    agent: {
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      toolTags: [...agent.toolTags],
      modelRef: null,
      inputSchemaText: agent.inputSchemaText ?? '',
      outputSchemaText: agent.outputSchemaText ?? '',
      version: agent.version,
    },
  };
}

export type ExportResult =
  | { status: 'ok'; path: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

// 弹系统保存框选路径,走 Python file-write 落盘(与全项目文件写出一致)。
export async function exportAgentToFile(agent: AgentDef): Promise<ExportResult> {
  if (!isTauri()) {
    return { status: 'error', message: '导出需在桌面端使用' };
  }
  const defaultName = `${safeFileName(agent.name) || 'agent'}.agent.json`;
  let target: string | null;
  try {
    target = await save({
      title: '导出 Agent',
      defaultPath: defaultName,
      filters: [{ name: 'Agent 定义', extensions: ['json'] }],
    });
  } catch (e) {
    console.error('[exportAgentToFile save]', e);
    return { status: 'error', message: '打开保存对话框失败' };
  }
  if (!target) return { status: 'cancelled' };

  const content = JSON.stringify(buildAgentExport(agent), null, 2);
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

export interface AgentImportResult {
  draft: AgentDraft;
  droppedTags: string[]; // 本机不存在、已被剔除的工具标签
  modelHint: string | null; // 导出机原用模型 id,供用户重选参考(modelRef 一律置空)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// 解析导入文件文本为可入库的 AgentDraft。knownTags 由调用方从工具库(内置+已装自定义)提供,
// 缺失的工具标签会被剔除并回报,避免选中不存在的工具在运行时报错。校验不过直接抛错。
export function parseAgentImport(text: string, knownTags: string[]): AgentImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('文件内容不是有效的 Agent 导出对象');
  }
  const env = parsed as Partial<AgentExportEnvelope>;
  if (env.kind !== AGENT_EXPORT_KIND) {
    throw new Error('这不是一个 Agent 导出文件');
  }
  if (typeof env.schema === 'number' && env.schema > AGENT_EXPORT_SCHEMA) {
    throw new Error(`文件版本(schema ${env.schema})高于当前支持,请升级应用后再导入`);
  }
  const a = env.agent;
  if (!a || typeof a !== 'object') {
    throw new Error('文件缺少 agent 定义');
  }
  const name = asString(a.name).trim();
  if (!name) {
    throw new Error('Agent 名称为空,无法导入');
  }

  const known = new Set(knownTags);
  // 先把读写分离旧标签(file-read/docx-write…)归一为 file/docx,再按已知标签过滤,
  // 否则老导出文件的旧标签会被当作未知项丢弃。
  const rawTags = normalizeToolTags(a.toolTags);
  const toolTags = rawTags.filter((t) => known.has(t));
  const droppedTags = rawTags.filter((t) => !known.has(t));

  return {
    draft: {
      name,
      description: asString(a.description),
      systemPrompt: asString(a.systemPrompt),
      toolTags,
      modelRef: null,
      inputSchemaText: asString(a.inputSchemaText),
      outputSchemaText: asString(a.outputSchemaText),
    },
    droppedTags,
    modelHint: typeof env.modelHint === 'string' ? env.modelHint : null,
  };
}
