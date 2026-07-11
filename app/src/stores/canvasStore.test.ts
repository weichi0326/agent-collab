import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Canvas, RunRecord, SavedCanvas } from './canvas/types';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

let useCanvasStore: typeof import('./canvasStore').useCanvasStore;

function canvases(count: number): Canvas[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `canvas-${index}`,
    name: `画布 ${index}`,
    nodes: [],
    edges: [],
  }));
}

beforeAll(async () => {
  ({ useCanvasStore } = await import('./canvasStore'));
});

beforeEach(() => {
  memory.clear();
  useCanvasStore.setState({
    canvases: canvases(20),
    activeId: 'canvas-7',
    savedCanvases: [],
    runHistory: [],
    history: {},
  });
});

describe('canvas open limit', () => {
  it('rejects creating and importing without changing the active canvas', () => {
    const state = useCanvasStore.getState();
    expect(state.addCanvas()).toBeNull();
    expect(state.importCanvas('导入画布', [], [])).toBe(false);
    expect(useCanvasStore.getState().canvases).toHaveLength(20);
    expect(useCanvasStore.getState().activeId).toBe('canvas-7');
  });

  it('rejects opening saved and historical canvases at the limit', () => {
    const saved: SavedCanvas = {
      id: 'saved-1',
      name: '已保存画布',
      nodes: [],
      edges: [],
      savedAt: '2026-07-11 00:00:00',
    };
    const run: RunRecord = {
      id: 'run-1',
      canvasId: 'source-1',
      canvasName: '历史画布',
      time: '2026-07-11 00:00:00',
      stamp: '20260711000000',
      nodes: [],
      edges: [],
    };
    useCanvasStore.setState({ savedCanvases: [saved], runHistory: [run] });

    expect(useCanvasStore.getState().openSaved(saved.id)).toBe('limit');
    expect(useCanvasStore.getState().openRun(run.id)).toBe('limit');
    expect(useCanvasStore.getState().canvases).toHaveLength(20);
    expect(useCanvasStore.getState().activeId).toBe('canvas-7');
  });

  it('still activates an already-open canvas at the limit', () => {
    const current = useCanvasStore.getState().canvases;
    current[12] = { ...current[12], savedId: 'saved-open' };
    useCanvasStore.setState({ canvases: current });

    expect(useCanvasStore.getState().openSaved('saved-open')).toBe('activated');
    expect(useCanvasStore.getState().activeId).toBe('canvas-12');
  });

  it('rejects a run snapshot at 20 and permits it as the twentieth tab', () => {
    expect(useCanvasStore.getState().createRun('canvas-0')).toBeNull();
    expect(useCanvasStore.getState().runHistory).toHaveLength(0);

    useCanvasStore.setState({ canvases: canvases(19), activeId: 'canvas-0' });
    expect(useCanvasStore.getState().createRun('canvas-0')).not.toBeNull();
    expect(useCanvasStore.getState().canvases).toHaveLength(20);
    expect(useCanvasStore.getState().runHistory).toHaveLength(1);
  });
});
