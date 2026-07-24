import type { Node } from '@xyflow/react';
import {
  outputFolderName,
  useCanvasStore,
  type AgentNodeData,
  type AgentOutputFormat,
  type Canvas,
} from '../../stores/canvasStore';
import { datetime } from '../time';
import { executeTool, unwrapToolResult, type ToolResult } from '../pythonClient';
import { getAppOutputDir } from '../outputDirectory';
import type { JsonObject, NodeOutput } from './types';
import {
  outputFolderLabelForNode,
  outputFormatForNode,
  outputSpecForFormat,
} from './outputFormats';
import {
  assertCustomSchema,
  parseSchemaText,
  schemaTextFromNode,
} from './schema';
import {
  assertStructuredSchema,
  buildMindMapHtml,
  buildOutputSummary,
  buildStructuredEnvelope,
  docxFallbackPayload,
  expectedJsonShape,
  parseJsonReply,
  structuredOutputForFormat,
  validateStructuredSchema,
} from './structuredOutput';
import { callNodeModelWithPrompt } from './modelCalls';
import { OUTPUT_MAX_BYTES } from './constants';
import { nodeLabel } from '../agentNode';
import {
  dateFromDateTime,
  errorMessage,
  joinPath,
  safeFileName,
  stringArray,
  tableRows,
  textValue,
} from './utils';

async function parseValidatedJsonReply(
  node: Node,
  reply: string,
  label: string,
  format: AgentOutputFormat,
  signal?: AbortSignal,
): Promise<JsonObject> {
  try {
    const parsed = parseJsonReply(reply, label, format);
    assertStructuredSchema(parsed, label, format);
    return parsed;
  } catch (err) {
    try {
      return await repairStructuredJson(node, reply, label, format, errorMessage(err), signal);
    } catch (repairErr) {
      if (format === 'docx') {
        const fallback = docxFallbackPayload(reply, label);
        assertStructuredSchema(fallback, label, format);
        return fallback;
      }
      throw repairErr;
    }
  }
}

async function repairStructuredJson(
  node: Node,
  reply: string,
  label: string,
  format: AgentOutputFormat,
  reason: string,
  signal?: AbortSignal,
): Promise<JsonObject> {
  const spec = outputSpecForFormat(format);
  const prompt = [
    `当前节点的 ${spec.title} 输出没有通过内置 schema 校验。`,
    '请修复为一个合法 JSON 对象。只返回 JSON，不要解释，不要 Markdown 代码块。',
    `目标 JSON 结构：${expectedJsonShape(format)}`,
    `校验错误：${reason}`,
    `原始回复：\n${reply.slice(0, 12000)}`,
  ].join('\n\n');
  const repaired = await callNodeModelWithPrompt(node, prompt, signal);
  const parsed = parseJsonReply(repaired, label, format);
  const errors = validateStructuredSchema(parsed, format);
  if (errors.length > 0) {
    throw new Error(
      `节点「${label}」的 ${spec.title} JSON 自动修复后仍不符合 schema：${errors.join('；')}`,
    );
  }
  return parsed;
}

function assertOutputSize(text: string, label: string, kind: string): void {
  const bytes = new Blob([text]).size;
  if (bytes > OUTPUT_MAX_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    throw new Error(`节点「${label}」的${kind}约 ${mb}MB，超过 10MB 上限，已中止写入。`);
  }
}

// 从结构化产物或 markdown H1 提取内容概括作为产物文件名; 提取不到回退到节点 label。
// docx/mindmap 用 title, xlsx 用 sheet, markdown 用首个 H1, txt 和其余格式回退 label。
function deriveFileSubject(
  content: string,
  label: string,
  format: AgentOutputFormat,
  structured?: JsonObject,
): string {
  if (structured) {
    if (format === 'xlsx') {
      const sheet = textValue(structured.sheet);
      if (sheet) return sheet;
    } else {
      const title = textValue(structured.title);
      if (title) return title;
    }
  }
  if (format === 'markdown') {
    const h1 = content.match(/^#\s+(.+?)\s*$/m);
    if (h1 && h1[1]) return h1[1];
  }
  return label;
}

export async function persistOutput(
  canvas: Canvas,
  node: Node,
  content: string,
  signal?: AbortSignal,
): Promise<NodeOutput> {
  // 双保险:门控分支已在 executeNode 里 return,不会走到这里。万一走到,直接返回不写产物。
  if ((node.data as AgentNodeData).gateType) {
    return { label: nodeLabel(node), content, nodeId: node.id };
  }
  const label = nodeLabel(node);
  const format = outputFormatForNode(node);
  const spec = outputSpecForFormat(format);
  const outputSchema = format === 'txt'
    ? undefined
    : parseSchemaText(schemaTextFromNode(node, 'outputSchemaText'), label);
  const folderName = outputFolderName(
    canvas.name,
    outputFolderLabelForNode(canvas, node, label, format),
    dateFromDateTime(canvas.runState?.startedAt),
  );
  const runAt = datetime();
  const outputRoot = await getAppOutputDir();
  let fileName: string;
  let path: string;
  let outputContent = content;
  let structuredOutput: JsonObject | undefined;
  let res: ToolResult;

  if (format === 'txt' || format === 'markdown') {
    if (outputSchema) {
      structuredOutput = parseJsonReply(content, label, format);
      assertCustomSchema(structuredOutput, outputSchema, label, '输出');
      outputContent = JSON.stringify(structuredOutput, null, 2);
    }
    fileName = `${safeFileName(deriveFileSubject(content, label, format, structuredOutput))}.${spec.extension}`;
    path = joinPath(outputRoot, folderName, fileName);
    const textBody = format === 'markdown' ? `# ${label}\n\n${outputContent}\n` : outputContent;
    assertOutputSize(textBody, label, `${spec.title} 产物`);
    res = await executeTool(
      'file',
      {
        action: 'write',
        path,
        content: textBody,
        mode: 'overwrite',
        mkdir: true,
        atomic: true,
        allow_outside_roots: true,
        output_root: outputRoot,
        allow_elevated_permission_repair: false,
      },
      signal,
    );
  } else if (format === 'docx') {
    const doc = await parseValidatedJsonReply(node, content, label, format, signal);
    structuredOutput = doc;
    outputContent = JSON.stringify(doc, null, 2);
    fileName = `${safeFileName(deriveFileSubject(content, label, format, structuredOutput))}.${spec.extension}`;
    path = joinPath(outputRoot, folderName, fileName);
    assertOutputSize(outputContent, label, `${spec.title} 产物`);
    res = await executeTool(
      'docx',
      {
        action: 'write',
        path,
        title: textValue(doc.title, label),
        sections: Array.isArray(doc.sections) ? doc.sections : [],
        allow_outside_roots: true,
        output_root: outputRoot,
      },
      signal,
    );
  } else if (format === 'xlsx') {
    const sheetData = await parseValidatedJsonReply(node, content, label, format, signal);
    structuredOutput = sheetData;
    outputContent = JSON.stringify(sheetData, null, 2);
    fileName = `${safeFileName(deriveFileSubject(content, label, format, structuredOutput))}.${spec.extension}`;
    path = joinPath(outputRoot, folderName, fileName);
    assertOutputSize(outputContent, label, `${spec.title} 产物`);
    res = await executeTool(
      'excel',
      {
        action: 'create_table',
        path,
        sheet: textValue(sheetData.sheet, '输出'),
        headers: stringArray(sheetData.headers),
        rows: tableRows(sheetData.rows),
        allow_outside_roots: true,
      },
      signal,
    );
  } else {
    const mindmap = await parseValidatedJsonReply(node, content, label, format, signal);
    structuredOutput = mindmap;
    outputContent = JSON.stringify(mindmap, null, 2);
    fileName = `${safeFileName(deriveFileSubject(content, label, format, structuredOutput))}.${spec.extension}`;
    path = joinPath(outputRoot, folderName, fileName);
    const mindmapHtml = buildMindMapHtml(mindmap);
    assertOutputSize(mindmapHtml, label, `${spec.title} 产物`);
    res = await executeTool(
      'file',
      {
        action: 'write',
        path,
        content: mindmapHtml,
        mode: 'overwrite',
        mkdir: true,
        atomic: true,
        allow_outside_roots: true,
        output_root: outputRoot,
        allow_elevated_permission_repair: false,
      },
      signal,
    );
  }

  const artifactResult = unwrapToolResult<{ path?: unknown; created?: unknown }>(
    res,
    `节点「${label}」写入 ${spec.title} 文件失败。`,
  );
  const resultPath = artifactResult.path ?? artifactResult.created;
  if (typeof resultPath === 'string' && resultPath.trim()) {
    path = resultPath;
  }
  const summary = buildOutputSummary(outputContent, label, format, structuredOutput);
  const structuredData = structuredOutputForFormat(label, format, structuredOutput, path);
  assertCustomSchema(structuredData, outputSchema, label, '输出');
  if (!((format === 'txt' || format === 'markdown') && outputSchema)) {
    assertStructuredSchema(structuredData, label, format);
  }
  const dataFileName = 'data.json';
  let dataPath = joinPath(outputRoot, folderName, dataFileName);
  const dataEnvelope = buildStructuredEnvelope({
    canvas,
    node,
    label,
    format,
    runAt,
    summary,
    artifactName: fileName,
    artifactPath: path,
    data: structuredData,
  });
  const dataEnvelopeText = JSON.stringify(dataEnvelope, null, 2);
  assertOutputSize(dataEnvelopeText, label, '结构化数据');
  const dataRes = await executeTool(
    'file',
    {
      action: 'write',
      path: dataPath,
      content: dataEnvelopeText,
      mode: 'overwrite',
      mkdir: true,
      atomic: true,
      allow_outside_roots: true,
      output_root: outputRoot,
      allow_elevated_permission_repair: false,
    },
    signal,
  );
  const dataResult = unwrapToolResult<{ path?: unknown; created?: unknown }>(
    dataRes,
    `节点「${label}」写入结构化数据失败。`,
  );
  const dataResultPath = dataResult.path ?? dataResult.created;
  if (typeof dataResultPath === 'string' && dataResultPath.trim()) {
    dataPath = dataResultPath;
  }

  useCanvasStore.getState().updateNodeData(canvas.id, node.id, {
    lastOutput: {
      folderName,
      runAt,
      items: [{ name: fileName, path, summary }],
    },
  });

  return {
    label,
    content: outputContent,
    structuredData,
    summary,
    path,
    dataPath,
    nodeId: node.id,
    resultRole: (node.data as AgentNodeData).resultRole,
  };
}
