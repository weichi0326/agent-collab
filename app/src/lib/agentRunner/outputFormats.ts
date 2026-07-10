import type { Node } from '@xyflow/react';
import type {
  AgentNodeData,
  AgentOutputFormat,
  Canvas,
} from '../../stores/canvasStore';
import type { OutputSpec } from './types';
import { nodeLabel } from '../agentNode';
import { safeFileName } from './utils';

export function outputFormatForNode(node: Node): AgentOutputFormat {
  // 门控节点不写产物,返回 markdown 占位让 outputSpecForFormat 不崩(永不真用)。
  if ((node.data as AgentNodeData).gateType) return 'markdown';
  const value = (node.data as AgentNodeData).outputFormat;
  if (
    value === 'docx' ||
    value === 'xlsx' ||
    value === 'mindmap' ||
    value === 'markdown'
  ) {
    return value;
  }
  return 'markdown';
}

export function outputSpecForFormat(format: AgentOutputFormat): OutputSpec {
  switch (format) {
    case 'docx':
      return { extension: 'docx', tool: 'docx', title: 'Word' };
    case 'xlsx':
      return { extension: 'xlsx', tool: 'excel', title: 'Excel' };
    case 'mindmap':
      return { extension: 'html', tool: 'file', title: '思维导图' };
    case 'markdown':
    default:
      return { extension: 'md', tool: 'file', title: 'Markdown' };
  }
}

export function outputFolderLabelForNode(
  canvas: Canvas,
  node: Node,
  label: string,
  format: AgentOutputFormat,
): string {
  const sameLabelNodes = canvas.nodes.filter((candidate) => nodeLabel(candidate) === label);
  if (sameLabelNodes.length <= 1) return label;

  const formatLabel = outputSpecForFormat(format).title;
  const sameFormatNodes = sameLabelNodes.filter(
    (candidate) => outputFormatForNode(candidate) === format,
  );
  if (sameFormatNodes.length <= 1) return `${label}-${formatLabel}`;

  const index = sameFormatNodes.findIndex((candidate) => candidate.id === node.id);
  return `${label}-${formatLabel}-${index >= 0 ? index + 1 : safeFileName(node.id).slice(-4)}`;
}
