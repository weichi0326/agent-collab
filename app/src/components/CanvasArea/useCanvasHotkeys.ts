import { useCallback, useEffect, useRef } from 'react';
import type { ReactFlowInstance, Node, Edge } from '@xyflow/react';
import { uid } from '../../lib/id';
import { useCanvasStore } from '../../stores/canvasStore';
import { getClipboard, setClipboard } from './clipboard';

interface UseCanvasHotkeysParams {
  activeId: string;
  openSearch: () => void;
  screenToFlowPosition: ReactFlowInstance['screenToFlowPosition'];
  onCrossCanvasPaste?: () => void;
}

export function useCanvasHotkeys({
  activeId,
  openSearch,
  screenToFlowPosition,
  onCrossCanvasPaste,
}: UseCanvasHotkeysParams) {
  const crossPasteRef = useRef(onCrossCanvasPaste);
  crossPasteRef.current = onCrossCanvasPaste;
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const screenToFlowRef = useRef(screenToFlowPosition);
  screenToFlowRef.current = screenToFlowPosition;

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  useEffect(() => {
    const { pushHistory, undo, addGraph } = useCanvasStore.getState();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }

      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      ) {
        return;
      }

      if (useCanvasStore.getState().canvases.find((c) => c.id === activeId)?.readOnly)
        return;

      const mod = e.ctrlKey || e.metaKey;

      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        const cv = useCanvasStore
          .getState()
          .canvases.find((c) => c.id === activeId);
        const hasSelection =
          !!cv &&
          (cv.nodes.some((n) => n.selected) ||
            cv.edges.some((ed) => ed.selected));
        if (hasSelection) pushHistory(activeId);
        return;
      }

      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'z') {
        e.preventDefault();
        undo(activeId);
        return;
      }

      if (key === 'c') {
        const cv = useCanvasStore
          .getState()
          .canvases.find((c) => c.id === activeId);
        if (!cv) return;
        const selNodes = cv.nodes.filter((n) => n.selected);
        if (selNodes.length === 0) return;
        const idSet = new Set(selNodes.map((n) => n.id));
        const selEdges = cv.edges.filter(
          (ed) => idSet.has(ed.source) && idSet.has(ed.target),
        );
        setClipboard({
          nodes: selNodes.map((n) => ({ ...n, data: { ...n.data } })),
          edges: selEdges.map((ed) => ({ ...ed })),
          sourceCanvasId: activeId,
        });
        return;
      }

      if (key === 'v') {
        const clipboard = getClipboard();
        if (!clipboard || clipboard.nodes.length === 0) return;
        e.preventDefault();

        if (
          clipboard.sourceCanvasId &&
          clipboard.sourceCanvasId !== activeId
        ) {
          crossPasteRef.current?.();
        }

        const minX = Math.min(...clipboard.nodes.map((n) => n.position.x));
        const minY = Math.min(...clipboard.nodes.map((n) => n.position.y));
        let dx = 32;
        let dy = 32;
        if (mouseRef.current) {
          const target = screenToFlowRef.current(mouseRef.current);
          dx = target.x - minX;
          dy = target.y - minY;
        }
        const idMap = new Map<string, string>();
        const newNodes: Node[] = clipboard.nodes.map((n) => {
          const nid = uid('node');
          idMap.set(n.id, nid);
          return {
            ...n,
            id: nid,
            position: { x: n.position.x + dx, y: n.position.y + dy },
            selected: true,
            data: { ...n.data },
          };
        });
        const newEdges: Edge[] = clipboard.edges.map((ed) => ({
          ...ed,
          id: uid('edge'),
          source: idMap.get(ed.source) ?? ed.source,
          target: idMap.get(ed.target) ?? ed.target,
          selected: true,
        }));
        addGraph(activeId, newNodes, newEdges);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeId, openSearch]);

  return { onMouseMove };
}
