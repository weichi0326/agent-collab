import { useCanvasStore } from '../../stores/canvasStore';

export function useSelectedNodeContext() {
  const activeId = useCanvasStore((s) => s.activeId);
  const selectedNodeId = useCanvasStore((s) => {
    const canvas = s.canvases.find((c) => c.id === s.activeId);
    return canvas?.nodes.find((n) => n.selected)?.id ?? null;
  });
  const canvas = useCanvasStore((s) =>
    s.canvases.find((c) => c.id === activeId),
  );
  const node = useCanvasStore((s) => {
    if (!selectedNodeId) return undefined;
    const current = s.canvases.find((c) => c.id === activeId);
    return current?.nodes.find((n) => n.id === selectedNodeId);
  });

  return { activeId, selectedNodeId, canvas, node };
}
