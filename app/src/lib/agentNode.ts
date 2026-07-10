import type { Node } from '@xyflow/react';
import type { AgentNodeData } from '../stores/canvasStore';

export function nodeLabel(node: Node, fallback = 'Agent'): string {
  const data = node.data as AgentNodeData;
  return (typeof data.label === 'string' && data.label.trim()) || fallback;
}
