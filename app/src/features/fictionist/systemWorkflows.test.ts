import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '../../stores/canvasStore';
import { FICTIONIST_AGENT_IDS } from './agents';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
} from './chapterInsights';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});
import {
  ensureFictionistSystemWorkflows,
  FICTIONIST_OUTLINE_WORKFLOW_SPECS,
  FICTIONIST_SYSTEM_WORKFLOW_SPECS,
  FICTIONIST_WRITING_WORKFLOW_SPECS,
  FICTIONIST_WRITING_WORKFLOW_KEYS,
  isSystemWorkflowModified,
  isFictionistSystemWorkflow,
  systemWorkflowName,
  systemWorkflowScope,
  systemWorkflowTemplate,
  systemWorkflowTemplateForSpec,
} from './systemWorkflows';

beforeEach(() => {
  useCanvasStore.setState({
    canvases: [],
    activeId: '',
    savedCanvases: [],
    runHistory: [],
    history: {},
  });
});

describe('fictionist system workflows', () => {
  it('defines independent draft and continuation workflows', () => {
    expect(FICTIONIST_SYSTEM_WORKFLOW_SPECS).toHaveLength(4);
    expect(FICTIONIST_WRITING_WORKFLOW_SPECS.map((spec) => spec.key)).toEqual([
      FICTIONIST_WRITING_WORKFLOW_KEYS.draft,
      FICTIONIST_WRITING_WORKFLOW_KEYS.continue,
    ]);
    expect(FICTIONIST_WRITING_WORKFLOW_SPECS.map((spec) => spec.taskType)).toEqual([
      'draft-chapter',
      'continue-chapter',
    ]);
    expect(FICTIONIST_OUTLINE_WORKFLOW_SPECS.map((spec) => spec.taskType)).toEqual([
      'outline-import',
      'outline-optimize',
    ]);
  });

  it('creates scoped primary and fallback references', () => {
    const spec = FICTIONIST_SYSTEM_WORKFLOW_SPECS[0];
    const primary = systemWorkflowScope(spec.key, 1);
    const fallback = systemWorkflowScope(spec.key, 2);

    expect(systemWorkflowName(spec, 1)).toBe('AI 起草 · 主流程');
    expect(systemWorkflowName(spec, 2)).toBe('AI 起草 · 备用流程');
    expect(primary).not.toHaveProperty('projectId');
    expect(isFictionistSystemWorkflow({ ...primary, workflowId: 'workflow-1' }, spec.key, 1)).toBe(true);
    expect(isFictionistSystemWorkflow({ ...fallback, workflowId: 'workflow-2' }, spec.key, 2)).toBe(true);
    expect(isFictionistSystemWorkflow({
      ...primary,
      projectId: 'legacy-project',
      workflowId: 'legacy-workflow',
    }, spec.key, 1)).toBe(false);
  });

  it('builds a usable graph for both writing modes', () => {
    for (const spec of FICTIONIST_WRITING_WORKFLOW_SPECS) {
      const graph = systemWorkflowTemplate(spec.mode);
      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(4);
      expect(graph.nodes.every((node) => node.type === 'agent')).toBe(true);
      expect(graph.nodes.some((node) => node.data.resultRole === CHAPTER_CONTEXT_RESULT_ROLE))
        .toBe(true);
      expect(graph.nodes.some((node) => node.data.resultRole === CHAPTER_CANON_CHECK_RESULT_ROLE))
        .toBe(true);
    }
  });

  it('builds package workflows for outline import and optimization', () => {
    expect(FICTIONIST_OUTLINE_WORKFLOW_SPECS.map((spec) => {
      const graph = systemWorkflowTemplateForSpec(spec);
      return [graph.nodes.length, graph.edges.length];
    })).toEqual([[2, 1], [3, 2]]);
  });

  it('upgrades a revision-one primary graph without replacing user prompt edits', () => {
    const spec = FICTIONIST_WRITING_WORKFLOW_SPECS[0];
    const currentTemplate = systemWorkflowTemplate(spec.mode);
    const writer = currentTemplate.nodes.find(
      (node) => node.data.professionalAgentId === FICTIONIST_AGENT_IDS.chapterWriter,
    )!;
    const finalEditor = currentTemplate.nodes.find(
      (node) => node.data.professionalAgentId === FICTIONIST_AGENT_IDS.finalEditor,
    )!;
    useCanvasStore.setState({
      savedCanvases: [{
        id: 'legacy-primary',
        name: 'AI 起草本章 · 1号主流程',
        nodes: [
          { ...writer, data: { ...writer.data, systemPrompt: '用户自定义写作提示词' } },
          finalEditor,
        ],
        edges: [{ id: 'legacy-edge', source: writer.id, target: finalEditor.id }],
        savedAt: '2026-07-23 00:00:00',
        workflowRef: {
          ...systemWorkflowScope(spec.key, 1),
          workflowId: 'legacy-workflow',
          systemWorkflow: { key: spec.key, version: 1, templateRevision: 1 },
        },
      }],
    });

    ensureFictionistSystemWorkflows();

    const migrated = useCanvasStore.getState().savedCanvases.find(
      (canvas) => canvas.id === 'legacy-primary',
    )!;
    expect(migrated.nodes).toHaveLength(4);
    expect(migrated.edges).toHaveLength(4);
    expect(migrated.name).toBe('AI 起草 · 主流程');
    expect(migrated.workflowRef?.systemWorkflow?.templateRevision).toBe(2);
    expect(migrated.nodes.find(
      (node) => node.data.professionalAgentId === FICTIONIST_AGENT_IDS.chapterWriter,
    )?.data.systemPrompt).toBe('用户自定义写作提示词');
  });

  it('ensures exactly one saved canvas for every primary and fallback workflow', () => {
    expect(ensureFictionistSystemWorkflows()).toEqual({ ensured: 8, failed: [] });
    const first = useCanvasStore.getState().savedCanvases;
    const firstIds = first.map((canvas) => canvas.id);

    expect(first).toHaveLength(8);
    for (const spec of FICTIONIST_SYSTEM_WORKFLOW_SPECS) {
      expect(first.filter((canvas) => canvas.workflowRef?.systemWorkflow?.key === spec.key))
        .toHaveLength(2);
    }
    expect(first.filter((canvas) => canvas.readOnly)).toHaveLength(4);
    expect(useCanvasStore.getState().canvases).toHaveLength(0);

    expect(ensureFictionistSystemWorkflows()).toEqual({ ensured: 8, failed: [] });
    expect(useCanvasStore.getState().savedCanvases.map((canvas) => canvas.id)).toEqual(firstIds);
  });

  it('ignores layout-only changes when detecting edited system workflows', () => {
    const spec = FICTIONIST_WRITING_WORKFLOW_SPECS[0];
    const graph = systemWorkflowTemplate(spec.mode);
    const moved = graph.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 200, y: node.position.y + 100 },
      measured: { width: 320, height: 180 },
      data: { ...node.data, collapsed: true, hiddenCount: 1 },
    }));

    expect(isSystemWorkflowModified(moved, graph.edges, spec.mode)).toBe(false);
    expect(isSystemWorkflowModified(graph.nodes, graph.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data, routePoints: [{ x: 0, y: 0 }, { x: 20, y: 20 }] },
    })), spec.mode)).toBe(false);
  });

  it('detects execution-affecting node and edge changes', () => {
    const spec = FICTIONIST_WRITING_WORKFLOW_SPECS[0];
    const graph = systemWorkflowTemplate(spec.mode);
    const configured = graph.nodes.map((node, index) => index === 0 ? {
      ...node,
      data: { ...node.data, modelRef: { configId: 'config-1', modelId: 'model-1' } },
    } : node);

    expect(isSystemWorkflowModified(configured, graph.edges, spec.mode)).toBe(true);
    expect(isSystemWorkflowModified(graph.nodes, [], spec.mode)).toBe(true);
  });
});
