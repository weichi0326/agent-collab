import { describe, expect, it } from 'vitest';
import type { Canvas, SavedCanvas } from '../stores/canvasStore';
import {
  FICTIONIST_TABS_DEFAULT_EXPANDED,
  fictionistCanvasDisplayName,
  isFictionistCanvas,
  partitionCanvasTabs,
} from './canvasTabGroups';

const ordinary: Canvas = { id: 'ordinary', name: '普通画布', nodes: [], edges: [] };
const systemWorkflow: Canvas = {
  id: 'system',
  name: 'AI 起草 · 主流程',
  nodes: [],
  edges: [],
  workflowRef: {
    packageId: 'fictionist',
    workflowId: 'workflow-1',
    systemWorkflow: { key: 'fictionist.chapter-draft', version: 1 },
  },
};
const taskCanvas: Canvas = {
  id: 'task',
  name: '明日之后 · AI 起草',
  nodes: [],
  edges: [],
  origin: { packageId: 'fictionist', taskId: 'task-1', taskType: 'draft-chapter' },
};

describe('canvas package tabs', () => {
  it('classifies system workflows and task canvases as fictionist canvases', () => {
    expect(isFictionistCanvas(ordinary)).toBe(false);
    expect(isFictionistCanvas(systemWorkflow)).toBe(true);
    expect(isFictionistCanvas(taskCanvas)).toBe(true);
  });

  it('partitions fictionist tabs into a collapsed group by default', () => {
    const groups = partitionCanvasTabs([ordinary, systemWorkflow, taskCanvas]);

    expect(FICTIONIST_TABS_DEFAULT_EXPANDED).toBe(false);
    expect(groups.ordinary.map((canvas) => canvas.id)).toEqual(['ordinary']);
    expect(groups.fictionist.map((canvas) => canvas.id)).toEqual(['system', 'task']);
  });

  it('normalizes legacy system and task canvas names for display', () => {
    expect(fictionistCanvasDisplayName({
      ...systemWorkflow,
      name: 'AI 起草本章 · 1号主流程',
    })).toBe('AI 起草 · 主流程');
    expect(fictionistCanvasDisplayName({
      ...systemWorkflow,
      name: 'AI 起草本章 · 2号保底流程',
      workflowRef: {
        ...systemWorkflow.workflowRef!,
        systemWorkflow: { key: 'fictionist.chapter-draft', version: 2 },
      },
    })).toBe('AI 起草 · 备用流程');
    expect(fictionistCanvasDisplayName({
      ...taskCanvas,
      name: '明日之后 · AI 起草本章',
    })).toBe('明日之后 · AI 起草');
  });

  it('uses the same package grouping for saved canvases', () => {
    const savedSystemWorkflow: SavedCanvas = {
      ...systemWorkflow,
      savedAt: '2026-07-24 10:00',
    };
    const savedOrdinary: SavedCanvas = {
      ...ordinary,
      savedAt: '2026-07-24 10:01',
    };

    const groups = partitionCanvasTabs([savedSystemWorkflow, savedOrdinary]);

    expect(groups.fictionist.map((canvas) => canvas.id)).toEqual(['system']);
    expect(groups.ordinary.map((canvas) => canvas.id)).toEqual(['ordinary']);
  });
});
