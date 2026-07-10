import { useCanvasStore } from '../../stores/canvasStore';
import type { AgentNodeRef } from '../../stores/agentStore';

export function countAgentRefs(agentId: string): number {
  const s = useCanvasStore.getState();
  let n = 0;
  for (const c of s.canvases) {
    for (const node of c.nodes) {
      if ((node.data as AgentNodeRef)?.agentId === agentId) n++;
    }
  }
  for (const sc of s.savedCanvases) {
    for (const node of sc.nodes) {
      if ((node.data as AgentNodeRef)?.agentId === agentId) n++;
    }
  }
  return n;
}
