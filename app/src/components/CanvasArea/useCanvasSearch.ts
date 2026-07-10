import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactFlowInstance, Node } from '@xyflow/react';
import type { InputRef } from 'antd';
import type { AgentNodeData, Canvas } from '../../stores/canvasStore';

interface UseCanvasSearchParams {
  canvas?: Canvas;
  setCenter: ReactFlowInstance['setCenter'];
  getZoom: ReactFlowInstance['getZoom'];
}

export function useCanvasSearch({
  canvas,
  setCenter,
  getZoom,
}: UseCanvasSearchParams) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const searchInputRef = useRef<InputRef>(null);

  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !canvas) return [] as string[];
    return canvas.nodes
      .filter((n) => !n.hidden)
      .filter((n) =>
        String((n.data as AgentNodeData)?.label ?? '')
          .toLowerCase()
          .includes(q),
      )
      .map((n) => n.id);
  }, [query, canvas]);

  const displayNodes = useMemo<Node[]>(() => {
    const base = canvas?.nodes ?? [];
    if (matchIds.length === 0) return base;
    const set = new Set(matchIds);
    const current = matchIds[Math.min(activeIdx, matchIds.length - 1)];
    return base.map((n) =>
      set.has(n.id)
        ? {
            ...n,
            className: `${n.className ?? ''} canvas-search-match${
              n.id === current ? ' canvas-search-match--active' : ''
            }`.trim(),
          }
        : n,
    );
  }, [canvas?.nodes, matchIds, activeIdx]);

  const goToMatch = useCallback(
    (idx: number) => {
      const id = matchIds[idx];
      if (!id) return;
      const node = canvas?.nodes.find((n) => n.id === id);
      if (!node) return;
      const w = (node.measured?.width ?? node.width ?? 90) as number;
      const h = (node.measured?.height ?? node.height ?? 40) as number;
      setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: getZoom(),
        duration: 300,
      });
    },
    [matchIds, canvas, setCenter, getZoom],
  );

  useEffect(() => {
    if (!searchOpen || matchIds.length === 0) return;
    setActiveIdx(0);
    goToMatch(0);
  }, [matchIds, searchOpen, goToMatch]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    searchInputRef.current?.focus();
  }, []);

  const gotoNext = useCallback(() => {
    if (matchIds.length === 0) return;
    const i = (Math.min(activeIdx, matchIds.length - 1) + 1) % matchIds.length;
    setActiveIdx(i);
    goToMatch(i);
  }, [activeIdx, goToMatch, matchIds.length]);

  const gotoPrev = useCallback(() => {
    if (matchIds.length === 0) return;
    const cur = Math.min(activeIdx, matchIds.length - 1);
    const i = (cur - 1 + matchIds.length) % matchIds.length;
    setActiveIdx(i);
    goToMatch(i);
  }, [activeIdx, goToMatch, matchIds.length]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setActiveIdx(0);
  }, []);

  return {
    searchOpen,
    searchInputRef,
    query,
    setQuery,
    matchIds,
    activeIdx,
    displayNodes,
    openSearch,
    gotoNext,
    gotoPrev,
    closeSearch,
  };
}
