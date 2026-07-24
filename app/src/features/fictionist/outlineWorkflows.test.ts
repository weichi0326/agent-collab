import { describe, expect, it } from 'vitest';
import { createEmptyFictionProjectOutline } from './domain';
import { createDemoFictionistData } from './fixtures';
import { FICTIONIST_AGENT_IDS } from './agents';
import {
  OUTLINE_RESULT_ROLE,
  applyDirectOutlineImport,
  applyOutlineWorkflowResult,
  buildOutlineTaskSnapshot,
  buildOutlineWorkflowGraph,
  parseOutlineWorkflowResult,
} from './outlineWorkflows';

function resultJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    story: {
      premise: '主角必须在钟声停止前找到寄信人。',
      theme: '记忆与真相',
      protagonistGoal: '找到寄信人',
      coreConflict: '城市正在主动遗忘事故',
      endingDirection: '主角公开真相',
      details: '第一幕收到来信，第二幕进入钟塔，第三幕公开真相。',
    },
    volumes: [],
    chapters: [],
    changeSummary: ['明确了主角目标。'],
    ...overrides,
  });
}

describe('fictionist outline workflows', () => {
  it('imports local text directly into the selected outline details field', () => {
    const seed = createDemoFictionistData();
    const outline = createEmptyFictionProjectOutline();
    const replaced = applyDirectOutlineImport(
      outline,
      seed.index,
      'mist-harbor',
      { kind: 'story' },
      '本地全书大纲',
      'replace',
    );
    const appended = applyDirectOutlineImport(
      replaced,
      seed.index,
      'mist-harbor',
      { kind: 'story' },
      '补充结局',
      'append',
    );

    expect(replaced.details).toBe('本地全书大纲');
    expect(appended.details).toBe('本地全书大纲\n\n补充结局');
    expect(() => applyDirectOutlineImport(
      outline,
      seed.index,
      'mist-harbor',
      { kind: 'chapter', id: 'missing' },
      '内容',
      'replace',
    )).toThrow('导入目标已不存在');
  });

  it('parses a scoped structured result and merges it without clearing other levels', () => {
    const seed = createDemoFictionistData();
    const outline = createEmptyFictionProjectOutline();
    outline.volumes['mist-harbor-volume-1'] = {
      summary: '保留的卷纲',
      objective: '',
      turningPoint: '',
      climax: '',
      details: '',
    };
    const result = parseOutlineWorkflowResult(
      resultJson(),
      seed.index,
      'mist-harbor',
      { kind: 'story' },
    );
    const merged = applyOutlineWorkflowResult(outline, result);

    expect(merged.premise).toContain('钟声停止前');
    expect(merged.volumes['mist-harbor-volume-1'].summary).toBe('保留的卷纲');
    expect(result.changeSummary).toEqual(['明确了主角目标。']);
  });

  it('rejects results that modify an outline outside the selected scope', () => {
    const seed = createDemoFictionistData();
    expect(() => parseOutlineWorkflowResult(
      resultJson(),
      seed.index,
      'mist-harbor',
      { kind: 'chapter', id: 'chapter-3' },
    )).toThrow('目标范围之外的全书大纲');
  });

  it('builds independent import and optimization graphs with one structured result', () => {
    const importing = buildOutlineWorkflowGraph('import', '任务快照', null);
    const optimizing = buildOutlineWorkflowGraph('optimize', '任务快照', null);

    expect(importing.nodes).toHaveLength(2);
    expect(importing.edges).toHaveLength(1);
    expect(optimizing.nodes).toHaveLength(3);
    expect(optimizing.edges).toHaveLength(2);
    expect(optimizing.nodes.map((node) => node.data.professionalAgentId)).toEqual([
      FICTIONIST_AGENT_IDS.storyArchitect,
      FICTIONIST_AGENT_IDS.outlineDesigner,
      FICTIONIST_AGENT_IDS.outlineFormatter,
    ]);
    expect(importing.nodes.filter((node) => node.data.resultRole === OUTLINE_RESULT_ROLE))
      .toHaveLength(1);
  });

  it('freezes the target, project structure and local source into the task snapshot', () => {
    const seed = createDemoFictionistData();
    const project = seed.index.projects['mist-harbor'];
    const snapshot = buildOutlineTaskSnapshot({
      operation: 'import',
      project,
      index: seed.index,
      outline: project.outline,
      target: { kind: 'story' },
      sourceName: '旧大纲.txt',
      sourceText: '第一卷：港区停电。',
    });

    expect(snapshot).toContain('旧大纲.txt');
    expect(snapshot).toContain('第一卷：港区停电。');
    expect(snapshot).toContain('mist-harbor-volume-1');
    expect(snapshot).toContain('不得自行创建 ID');
  });
});
