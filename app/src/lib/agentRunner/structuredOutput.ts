import type { Node } from '@xyflow/react';
import type { AgentOutputFormat, Canvas } from '../../stores/canvasStore';
import type { JsonObject } from './types';
import { OUTPUT_SUMMARY_MAX_CHARS } from './constants';
import { outputSpecForFormat } from './outputFormats';
import {
  compactText,
  escapeHtml,
  markdownToParagraphs,
  stringArray,
  textValue,
} from './utils';

function collectMindMapTitles(node: unknown, out: string[], max = 6): void {
  if (out.length >= max || !node || typeof node !== 'object') return;
  const data = node as JsonObject;
  const title = textValue(data.title);
  if (title) out.push(title);
  const children = Array.isArray(data.children) ? data.children : [];
  for (const child of children) {
    if (out.length >= max) break;
    collectMindMapTitles(child, out, max);
  }
}

function summarizeJsonOutput(data: JsonObject, format: AgentOutputFormat): string {
  if (format === 'docx') {
    const title = textValue(data.title);
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const headings = sections
      .map((section) =>
        section && typeof section === 'object'
          ? textValue((section as JsonObject).heading)
          : '',
      )
      .filter(Boolean)
      .slice(0, 4);
    return compactText(
      [title && `标题：${title}`, headings.length && `章节：${headings.join('、')}`]
        .filter(Boolean)
        .join('；'),
      OUTPUT_SUMMARY_MAX_CHARS,
    );
  }
  if (format === 'xlsx') {
    const sheet = textValue(data.sheet, '输出');
    const headers = stringArray(data.headers).slice(0, 8);
    const rows = Array.isArray(data.rows) ? data.rows.length : 0;
    return compactText(
      `工作表：${sheet}；列：${headers.join('、') || '未命名'}；行数：${rows}`,
      OUTPUT_SUMMARY_MAX_CHARS,
    );
  }
  if (format === 'mindmap') {
    const titles: string[] = [];
    collectMindMapTitles(data, titles);
    return compactText(
      titles.length ? `主题脉络：${titles.join(' > ')}` : '已生成思维导图',
      OUTPUT_SUMMARY_MAX_CHARS,
    );
  }
  return '';
}

function summarizeTextOutput(content: string, label: string): string {
  const h1 = content.match(/^#\s+(.+?)\s*$/m);
  const title = h1?.[1]?.trim() || label;
  return compactText(`${title} 已生成 ${content.length} 字内容`, OUTPUT_SUMMARY_MAX_CHARS);
}

export function buildOutputSummary(
  content: string,
  label: string,
  format: AgentOutputFormat,
  structured?: JsonObject,
): string {
  const structuredSummary = structured
    ? summarizeJsonOutput(structured, format)
    : '';
  return structuredSummary || summarizeTextOutput(content, label);
}

export function structuredOutputForFormat(
  label: string,
  format: AgentOutputFormat,
  structured?: JsonObject,
  artifactPath?: string,
): JsonObject {
  if (structured) return structured;
  return {
    title: label,
    outputFormat: format,
    contentRef: artifactPath
      ? { kind: 'artifact', path: artifactPath }
      : undefined,
  };
}

export function buildStructuredEnvelope(params: {
  canvas: Canvas;
  node: Node;
  label: string;
  format: AgentOutputFormat;
  runAt: string;
  summary: string;
  artifactName: string;
  artifactPath: string;
  data: JsonObject;
}): JsonObject {
  return {
    version: '2.0',
    kind: 'agent-node-output',
    canvas: {
      id: params.canvas.id,
      name: params.canvas.name,
      runId: params.canvas.runId,
      startedAt: params.canvas.runState?.startedAt,
    },
    node: {
      id: params.node.id,
      label: params.label,
      outputFormat: params.format,
    },
    runAt: params.runAt,
    summary: params.summary,
    artifact: {
      name: params.artifactName,
      path: params.artifactPath,
    },
    data: params.data,
  };
}

export function parseJsonReply(
  reply: string,
  label: string,
  format: AgentOutputFormat,
): JsonObject {
  let text = reply.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    text = text.slice(first, last + 1);
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // fall through to a user-facing error below
  }

  throw new Error(`节点「${label}」没有返回可用于生成 ${outputSpecForFormat(format).title} 的 JSON。`);
}

export function docxFallbackPayload(reply: string, label: string): JsonObject {
  const paragraphs = markdownToParagraphs(reply);
  return {
    title: label,
    sections: [
      {
        heading: '输出内容',
        paragraphs: paragraphs.length > 0 ? paragraphs : [reply.trim() || '无内容'],
      },
    ],
  };
}

export function expectedJsonShape(format: AgentOutputFormat): string {
  switch (format) {
    case 'docx':
      return '{"title":"文档标题","sections":[{"heading":"章节标题","paragraphs":["段落"],"table":{"headers":["列名"],"rows":[["单元格"]]}}]}';
    case 'xlsx':
      return '{"sheet":"工作表名称","headers":["列名"],"rows":[["单元格"]]}';
    case 'mindmap':
      return '{"title":"中心主题","children":[{"title":"分支","children":[{"title":"子分支"}]}]}';
    case 'markdown':
    default:
      return '{"title":"标题","outputFormat":"markdown","contentRef":{"kind":"artifact","path":"正文产物路径"}}';
  }
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStringArray(value: unknown, path: string, errors: string[], allowEmpty = false): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`);
    return;
  }
  if (!allowEmpty && value.length === 0) {
    errors.push(`${path} 不能为空`);
  }
  value.forEach((item, index) => {
    if (!nonEmptyString(item)) errors.push(`${path}[${index}] 必须是非空字符串`);
  });
}

function validateTable(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} 必须是对象`);
    return;
  }
  const table = value as JsonObject;
  validateStringArray(table.headers, `${path}.headers`, errors);
  if (!Array.isArray(table.rows)) {
    errors.push(`${path}.rows 必须是二维数组`);
    return;
  }
  table.rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      errors.push(`${path}.rows[${rowIndex}] 必须是数组`);
    }
  });
}

function validateMindMapNode(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} 必须是对象`);
    return;
  }
  const node = value as JsonObject;
  if (!nonEmptyString(node.title)) errors.push(`${path}.title 必须是非空字符串`);
  if (node.children === undefined) return;
  if (!Array.isArray(node.children)) {
    errors.push(`${path}.children 必须是数组`);
    return;
  }
  node.children.forEach((child, index) => {
    validateMindMapNode(child, `${path}.children[${index}]`, errors);
  });
}

export function validateStructuredSchema(
  data: JsonObject,
  format: AgentOutputFormat,
): string[] {
  const errors: string[] = [];
  if (format === 'markdown') {
    if (!nonEmptyString(data.title)) errors.push('title 必须是非空字符串');
    const ref = data.contentRef;
    const refPath = ref && typeof ref === 'object' && !Array.isArray(ref)
      ? (ref as JsonObject).path
      : undefined;
    if (!nonEmptyString(refPath)) errors.push('contentRef.path 必须是非空字符串');
    return errors;
  }

  if (format === 'docx') {
    if (!nonEmptyString(data.title)) errors.push('title 必须是非空字符串');
    if (!Array.isArray(data.sections) || data.sections.length === 0) {
      errors.push('sections 必须是非空数组');
      return errors;
    }
    data.sections.forEach((section, index) => {
      const path = `sections[${index}]`;
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        errors.push(`${path} 必须是对象`);
        return;
      }
      const sectionData = section as JsonObject;
      if (!nonEmptyString(sectionData.heading)) {
        errors.push(`${path}.heading 必须是非空字符串`);
      }
      if (sectionData.paragraphs !== undefined) {
        validateStringArray(sectionData.paragraphs, `${path}.paragraphs`, errors, true);
      }
      if (sectionData.table !== undefined) {
        validateTable(sectionData.table, `${path}.table`, errors);
      }
      if (sectionData.paragraphs === undefined && sectionData.table === undefined) {
        errors.push(`${path} 至少需要 paragraphs 或 table`);
      }
    });
    return errors;
  }

  if (format === 'xlsx') {
    if (data.sheet !== undefined && !nonEmptyString(data.sheet)) {
      errors.push('sheet 如果存在，必须是非空字符串');
    }
    validateStringArray(data.headers, 'headers', errors);
    if (!Array.isArray(data.rows)) {
      errors.push('rows 必须是二维数组');
      return errors;
    }
    data.rows.forEach((row, index) => {
      if (!Array.isArray(row)) errors.push(`rows[${index}] 必须是数组`);
    });
    return errors;
  }

  validateMindMapNode(data, 'root', errors);
  return errors;
}

export function assertStructuredSchema(
  data: JsonObject,
  label: string,
  format: AgentOutputFormat,
): void {
  const errors = validateStructuredSchema(data, format);
  if (errors.length > 0) {
    throw new Error(
      `节点「${label}」的 ${outputSpecForFormat(format).title} JSON 不符合内置 schema：${errors.join('；')}`,
    );
  }
}

function renderMindMapNode(node: unknown): string {
  const data = node && typeof node === 'object' ? (node as JsonObject) : {};
  const title = textValue(data.title, '未命名');
  const children = Array.isArray(data.children) ? data.children : [];
  const childHtml = children.length
    ? `<ul>${children.map((child) => renderMindMapNode(child)).join('')}</ul>`
    : '';
  return `<li><span>${escapeHtml(title)}</span>${childHtml}</li>`;
}

export function buildMindMapHtml(data: JsonObject): string {
  const title = textValue(data.title, '思维导图');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: "Microsoft YaHei", Arial, sans-serif; color: #263238; background: #f7f7f4; }
    main { min-height: 100vh; padding: 40px; box-sizing: border-box; }
    h1 { margin: 0 0 28px; font-size: 28px; font-weight: 650; }
    .map { overflow: auto; padding: 28px; background: #fff; border: 1px solid #e7e2d8; border-radius: 8px; }
    ul { padding-top: 20px; position: relative; display: flex; gap: 18px; justify-content: center; }
    li { list-style: none; text-align: center; position: relative; padding: 20px 8px 0; }
    li::before, li::after { content: ""; position: absolute; top: 0; width: 50%; height: 20px; border-top: 1px solid #b9b1a4; }
    li::before { right: 50%; border-right: 1px solid #b9b1a4; }
    li::after { left: 50%; border-left: 1px solid #b9b1a4; }
    li:only-child::before, li:only-child::after { display: none; }
    li:first-child::before, li:last-child::after { border: 0 none; }
    li:last-child::before { border-radius: 0 8px 0 0; }
    li:first-child::after { border-radius: 8px 0 0 0; }
    span { display: inline-block; max-width: 220px; padding: 10px 14px; border-radius: 8px; background: #eef1ec; border: 1px solid #d7dace; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <section class="map"><ul>${renderMindMapNode(data)}</ul></section>
  </main>
</body>
</html>`;
}
