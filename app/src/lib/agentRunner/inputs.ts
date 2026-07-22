import type { Node } from '@xyflow/react';
import type { AgentNodeData, Canvas } from '../../stores/canvasStore';
import type { ChatImage } from '../llmClient';
import { executeTool, listTools, unwrapToolResult } from '../pythonClient';
import type { CollectedInput, JsonObject, JsonSchema, NodeOutput } from './types';
import { outputFormatForNode, outputSpecForFormat } from './outputFormats';
import {
  assertCustomSchema,
  parseSchemaText,
  schemaTextFromNode,
  validateAgainstSchema,
} from './schema';
import { parseJsonReply } from './structuredOutput';
import { callNodeModelWithPrompt } from './modelCalls';
import { nodeLabel } from '../agentNode';
import { getToolDef } from '../toolRegistry';
import { normalizeToolTags } from '../toolTagMigration';
import {
  applyInputLengthPolicy,
  inputCapability,
  selectUpstreamIds,
} from '../agentNodeCapabilities';

function pathExt(path: string): string {
  return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
}

// 位图后缀 → media_type;矢量/未知格式不在内(视觉模型只吃位图)。
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

function isImagePath(path: string): boolean {
  return pathExt(path) in IMAGE_MEDIA_TYPES;
}

function imageMediaType(path: string): string {
  return IMAGE_MEDIA_TYPES[pathExt(path)] ?? 'image/png';
}

function toolForInputPath(path: string): string {
  const ext = pathExt(path);
  if (ext === 'doc') {
    throw new Error(`暂不支持读取旧版 Word 文档：${path}，请另存为 .docx 后重试。`);
  }
  if (ext === 'docx') return 'docx';
  if (ext === 'pdf') return 'pdf-read';
  if (['xlsx', 'xlsm', 'xls'].includes(ext)) return 'excel';
  return 'file'; // 图片文件也走 file(binary_b64 读 base64)
}

export async function ensureRequiredTools(canvas: Canvas): Promise<void> {
  const required = new Set<string>(['llm-calling', 'file']);
  for (const node of canvas.nodes) {
    // 门控/定时节点不调工具,不贡献 required。
    const nd = node.data as AgentNodeData;
    if (nd.gateType || typeof nd.timerSeconds === 'number') continue;
    required.add(outputSpecForFormat(outputFormatForNode(node)).tool);
    const data = node.data as AgentNodeData;
    for (const file of Array.isArray(data.dataSourceFiles)
      ? data.dataSourceFiles
      : []) {
      required.add(toolForInputPath(file));
    }
    for (const path of Array.isArray(data.dataSourceHistoryPaths)
      ? data.dataSourceHistoryPaths
      : []) {
      required.add(toolForInputPath(path));
    }
    for (const tag of Array.isArray(data.toolTags) ? data.toolTags : []) {
      if (typeof tag === 'string' && tag.trim()) required.add(tag.trim());
    }
  }

  const available = new Set(await listTools());
  const missing = [...required].filter((tool) => !available.has(tool));
  if (missing.length > 0) {
    throw new Error(
      `Python 工具服务缺少：${missing.join('、')}。` +
        '请重启应用或 Python 服务，让最新工具生效后再运行。',
    );
  }
}

// 门控失败的稳定标记: 门控错误消息以此开头, 姬子编排层据此识别"缺工具标签"类失败,
// 从而走"自动补已有标签"而非"造新工具"分支。
export const MISSING_TOOL_TAG_MARKER = '缺少工具标签';

// 计算节点运行时"面向用户的"必需工具标签(canonical value):
// 产物写工具(按输出格式) + 输入读工具(仅无上游时按数据源扩展名)。
// 刻意不含 llm-calling(每个 Agent 节点的本质能力) 与 data.json 的 file 写入(系统内部信封),
// 故 docx/xlsx 节点只需声明 docx/excel, 无需额外声明 file。
export function requiredToolTagsForNode(canvas: Canvas, node: Node): string[] {
  // 门控/定时节点不调工具,无必需标签。
  const ctrl = node.data as AgentNodeData;
  if (ctrl.gateType || typeof ctrl.timerSeconds === 'number') return [];
  const required = new Set<string>();
  required.add(outputSpecForFormat(outputFormatForNode(node)).tool);

  const hasUpstream = canvas.edges.some((e) => e.target === node.id);
  const data = node.data as AgentNodeData;
  const input = inputCapability(data.capabilities?.input);
  if (!hasUpstream || (input.enabled && input.includeSupplementalSources)) {
    const paths = [
      ...(Array.isArray(data.dataSourceFiles) ? data.dataSourceFiles : []),
      ...(Array.isArray(data.dataSourceHistoryPaths) ? data.dataSourceHistoryPaths : []),
    ];
    for (const path of paths) required.add(toolForInputPath(path));
  }
  return [...required];
}

// 严格能力门控: 节点必须显式声明它运行时会用到的工具标签, 否则拒绝执行。
// 缺失时抛出以 MISSING_TOOL_TAG_MARKER 开头的错误(消息列中文 label 便于用户理解)。
// 节点声明侧先经 normalizeToolTags 归一, 兼容历史读写分离旧标签(file-write→file 等)。
export function ensureNodeCapabilities(canvas: Canvas, node: Node): void {
  // 门控/定时节点不调工具,无能力门控。
  const ctrl = node.data as AgentNodeData;
  if (ctrl.gateType || typeof ctrl.timerSeconds === 'number') return;
  const required = requiredToolTagsForNode(canvas, node);
  const declared = new Set(normalizeToolTags((node.data as AgentNodeData).toolTags));
  const missing = required.filter((tag) => !declared.has(tag));
  if (missing.length === 0) return;
  const labels = missing.map((tag) => getToolDef(tag)?.label ?? tag);
  throw new Error(
    `${MISSING_TOOL_TAG_MARKER}：节点「${nodeLabel(node)}」缺少 ${labels.join('、')}。` +
      '请在属性面板为该节点勾选这些工具，或由姬子自动补齐。',
  );
}

// 运行前数据来源预检: 没有上游节点 + 没有手动数据源(文件/URL/历史产物)的节点禁止运行。
// 直接 throw 让 TitleBar 的 message.error 提示用户; 不走 orchestratorStore(那是工具缺失专用通道)。
export function ensureDataSources(canvas: Canvas): void {
  const offenders: string[] = [];
  for (const node of canvas.nodes) {
    const hasUpstream = canvas.edges.some((e) => e.target === node.id);
    // 定时节点不读数据源,且无上游也合法(纯定时器起点)。
    if (typeof (node.data as AgentNodeData).timerSeconds === 'number') continue;
    // 门控节点不读数据源,但要求至少一个上游连接(否则门控无意义)。
    if ((node.data as AgentNodeData).gateType) {
      if (!hasUpstream) offenders.push(`${nodeLabel(node)}（门控节点需要至少一个上游连接）`);
      continue;
    }
    if (hasUpstream) continue;
    const data = node.data as AgentNodeData;
    const mode = data.dataSourceMode ?? 'file';
    let hasManual = false;
    if (mode === 'url') {
      hasManual = !!(data.dataSourceUrl && data.dataSourceUrl.trim());
    } else if (mode === 'history') {
      hasManual =
        Array.isArray(data.dataSourceHistoryPaths) &&
        data.dataSourceHistoryPaths.length > 0;
    } else {
      hasManual =
        Array.isArray(data.dataSourceFiles) && data.dataSourceFiles.length > 0;
    }
    if (!hasManual) offenders.push(nodeLabel(node));
  }
  if (offenders.length > 0) {
    throw new Error(
      `以下节点没有数据来源，无法运行：${offenders.join('、')}。` +
        '请为这些节点选择文件 / 网页 URL / 历史产物，或连接上游节点后再运行。',
    );
  }
}

interface XlsxComment {
  sheet?: unknown;
  cell?: unknown;
  text?: unknown;
  author?: unknown;
}
interface XlsxImage {
  media_type?: unknown;
  data_b64?: unknown;
}

function rowsToText(rows: unknown[][], sheet?: unknown): string {
  const body = rows
    .map((row) => row.map((cell) => String(cell ?? '')).join('\t'))
    .join('\n');
  return typeof sheet === 'string' ? `工作表：${sheet}\n${body}` : body;
}

function commentsToText(comments: XlsxComment[]): string {
  if (comments.length === 0) return '';
  const lines = comments.map((c) => {
    const loc = `${c.sheet ? `${c.sheet}!` : ''}${c.cell ?? ''}`;
    const author = c.author ? `（${c.author}）` : '';
    return `【批注】${loc}${author}：${c.text ?? ''}`;
  });
  return `## 单元格批注\n${lines.join('\n')}`;
}

function xlsxImagesToChatImages(images: XlsxImage[]): ChatImage[] {
  const out: ChatImage[] = [];
  for (const img of images) {
    if (typeof img.media_type === 'string' && typeof img.data_b64 === 'string') {
      out.push({ mediaType: img.media_type, base64: img.data_b64 });
    }
  }
  return out;
}

// 读一个数据源为可携带图像的输入。图片文件走 file binary_b64;Excel 走 read_rich
// 拿正文+批注+内嵌图片;其余(docx/pdf/纯文本)只出文本。
async function readSourceInput(
  path: string,
  signal?: AbortSignal,
): Promise<CollectedInput> {
  if (isImagePath(path)) {
    const res = await executeTool(
      'file',
      { path, action: 'read', mode: 'binary_b64' },
      signal,
    );
    const result = unwrapToolResult<{ data?: unknown }>(res, `读取图片失败：${path}`);
    if (typeof result.data !== 'string') {
      throw new Error(`图片读取结果格式异常：${path}`);
    }
    const name = path.split(/[\\/]/).pop() ?? path;
    return {
      text: `[图片] ${name}`,
      images: [{ mediaType: imageMediaType(path), base64: result.data }],
    };
  }

  const toolName = toolForInputPath(path);
  if (toolName === 'excel') {
    const res = await executeTool('excel', { path, action: 'read_rich' }, signal);
    const result = unwrapToolResult<{
      sheet?: unknown;
      rows?: unknown;
      comments?: unknown;
      images?: unknown;
    }>(res, `读取文件失败：${path}`);
    const rows = Array.isArray(result.rows) ? (result.rows as unknown[][]) : [];
    const comments = Array.isArray(result.comments)
      ? (result.comments as XlsxComment[])
      : [];
    const rawImages = Array.isArray(result.images)
      ? (result.images as XlsxImage[])
      : [];
    const parts = [rowsToText(rows, result.sheet), commentsToText(comments)].filter(
      Boolean,
    );
    return { text: parts.join('\n\n'), images: xlsxImagesToChatImages(rawImages) };
  }

  let params: Record<string, unknown> = { path, action: 'read', mode: 'text' };
  if (toolName === 'docx') {
    params = { path, action: 'read' };
  } else if (toolName === 'pdf-read') {
    params = { path, action: 'text' };
  }
  const res = await executeTool(toolName, params, signal);
  const result = unwrapToolResult<{ content?: unknown }>(res, `读取文件失败：${path}`);
  if (typeof result.content !== 'string') {
    throw new Error(`文件读取结果格式异常：${path}`);
  }
  return { text: result.content, images: [] };
}

function sourcePayload(sourceId: string, output: NodeOutput): JsonObject {
  return {
    nodeId: sourceId,
    label: output.label,
    summary: output.summary,
    data: output.structuredData,
    content: output.content,
  };
}

async function convertInputToSchema(
  node: Node,
  schema: JsonSchema,
  payload: JsonObject,
  validationErrors: string[],
  signal?: AbortSignal,
): Promise<JsonObject> {
  const label = nodeLabel(node);
  const prompt = [
    `当前节点收到的前序输出不符合它的输入 schema。`,
    '请把输入转换成目标 schema 要求的一个 JSON 对象。只返回 JSON，不要解释，不要 Markdown 代码块。',
    `目标 JSON Schema：\n${JSON.stringify(schema, null, 2)}`,
    `当前校验问题：${validationErrors.join('；')}`,
    `前序输出：\n${JSON.stringify(payload, null, 2).slice(0, 16000)}`,
  ].join('\n\n');
  const reply = await callNodeModelWithPrompt(node, prompt, signal);
  const parsed = parseJsonReply(reply, label, outputFormatForNode(node));
  assertCustomSchema(parsed, schema, label, '输入');
  return parsed;
}

async function schemaMatchedInputSection(
  node: Node,
  sources: string[],
  outputs: Map<string, NodeOutput>,
  schema: JsonSchema,
  signal?: AbortSignal,
): Promise<string> {
  const payload = {
    sources: sources.map((sourceId) => {
      const output = outputs.get(sourceId);
      if (!output) throw new Error(`前序节点尚无输出：${sourceId}`);
      return sourcePayload(sourceId, output);
    }),
  };
  const directErrors = validateAgainstSchema(payload, schema);
  const matched =
    directErrors.length === 0
      ? payload
      : await convertInputToSchema(node, schema, payload, directErrors, signal);
  return `## Schema 匹配输入\n${JSON.stringify(matched, null, 2)}`;
}

function textInput(text: string): CollectedInput {
  return { text, images: [] };
}

function upstreamInputSection(
  output: NodeOutput,
  mode: ReturnType<typeof inputCapability>['contentMode'],
): string {
  const parts = [`## 前序节点：${output.label}`];
  if (mode === 'structured') {
    parts.push(
      output.structuredData
        ? `### 结构化内容\n${JSON.stringify(output.structuredData, null, 2)}`
        : '### 结构化内容\n该上游节点没有结构化输出。',
    );
  } else if (mode === 'summary') {
    parts.push(`### 摘要\n${output.summary || output.content}`);
  } else {
    parts.push(`### 正文\n${output.content}`);
  }
  return parts.join('\n\n');
}

async function collectManualInput(
  data: AgentNodeData,
  signal?: AbortSignal,
): Promise<CollectedInput | null> {
  const sections: string[] = [];
  const images: ChatImage[] = [];
  if (data.dataSourceMode === 'url') {
    if (data.dataSourceUrl?.trim()) {
      throw new Error('网页 URL 数据源暂未支持，请改用文件或历史产物。');
    }
    return null;
  }
  if (data.dataSourceMode === 'history') {
    const historyPaths = Array.isArray(data.dataSourceHistoryPaths)
      ? data.dataSourceHistoryPaths
      : [];
    for (const path of historyPaths) {
      const src = await readSourceInput(path, signal);
      sections.push(`## 历史产物：${path}\n${src.text}`);
      images.push(...src.images);
    }
  } else {
    const files = Array.isArray(data.dataSourceFiles) ? data.dataSourceFiles : [];
    for (const file of files) {
      const src = await readSourceInput(file, signal);
      sections.push(`## 文件：${file}\n${src.text}`);
      images.push(...src.images);
    }
  }
  return sections.length > 0 ? { text: sections.join('\n\n'), images } : null;
}

async function applyConfiguredInputLength(
  node: Node,
  input: CollectedInput,
  signal?: AbortSignal,
): Promise<CollectedInput> {
  const capability = (node.data as AgentNodeData).capabilities?.input;
  const result = applyInputLengthPolicy(input.text, capability);
  if (result.kind === 'ready') return { ...input, text: result.text };

  const summary = await callNodeModelWithPrompt(
    node,
    [
      `请将以下输入压缩到不超过 ${result.maxChars} 个字符。`,
      '必须保留任务目标、关键事实、约束条件、数字与上下游标识。只输出压缩后的输入，不要解释。',
      result.text,
    ].join('\n\n'),
    signal,
  );
  return { ...input, text: summary.slice(0, result.maxChars) };
}

export async function collectInput(
  node: Node,
  sources: string[],
  outputs: Map<string, NodeOutput>,
  signal?: AbortSignal,
): Promise<CollectedInput> {
  const data = node.data as AgentNodeData;
  const inputConfig = inputCapability(data.capabilities?.input);
  const sections: string[] = [];
  const images: ChatImage[] = [];
  const selectedSources = selectUpstreamIds(sources, data.capabilities?.input);

  if (selectedSources.length > 0) {
    const inputSchema = parseSchemaText(schemaTextFromNode(node, 'inputSchemaText'), nodeLabel(node));
    if (inputSchema) {
      sections.push(await schemaMatchedInputSection(node, selectedSources, outputs, inputSchema, signal));
    }
    for (const sourceId of selectedSources) {
      const output = outputs.get(sourceId);
      if (!output) throw new Error(`前序节点尚无输出：${sourceId}`);
      sections.push(upstreamInputSection(output, inputConfig.contentMode));
    }
    if (inputConfig.enabled && inputConfig.includeSupplementalSources) {
      const supplemental = await collectManualInput(data, signal);
      if (supplemental) {
        sections.push(supplemental.text);
        images.push(...supplemental.images);
      }
    }
    return applyConfiguredInputLength(
      node,
      { text: sections.join('\n\n'), images },
      signal,
    );
  }

  const manual = await collectManualInput(data, signal);
  const emptyMessage = data.dataSourceMode === 'history'
    ? '当前节点选择了历史产物数据来源，但未选中任何历史文件。'
    : '当前节点没有前序输入或手动数据源。';
  return applyConfiguredInputLength(node, manual ?? textInput(emptyMessage), signal);
}
