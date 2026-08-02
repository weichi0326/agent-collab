import { describe, expect, it } from 'vitest';
import { createEmptyFictionProjectOutline } from './domain';
import { createDemoFictionistData } from './fixtures';
import { FICTIONIST_AGENT_IDS } from './agents';
import {
  OUTLINE_RESULT_ROLE,
  applyDirectOutlineImport,
  applyOutlineTaskRuntimeContract,
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
    outline.volumeIds = ['outline-volume-1'];
    outline.volumes['outline-volume-1'] = {
      id: 'outline-volume-1',
      title: '计划第一卷',
      chapterIds: ['outline-chapter-1'],
      linkedVolumeId: 'mist-harbor-volume-1',
      summary: '保留的卷纲',
      objective: '',
      turningPoint: '',
      climax: '',
      details: '',
    };
    outline.chapters['outline-chapter-1'] = {
      id: 'outline-chapter-1',
      title: '计划第一章',
      linkedChapterId: 'chapter-3',
      summary: '', objective: '', pointOfView: '', conflict: '', keyEvents: '', clues: '', hook: '', details: '',
    };
    seed.index.projects['mist-harbor'].outline = outline;
    const result = parseOutlineWorkflowResult(
      resultJson({
        volumes: [{
          id: 'outline-volume-1',
          summary: '更新后的卷纲', objective: '', turningPoint: '', climax: '', details: '',
        }],
        chapters: [],
      }),
      seed.index,
      'mist-harbor',
      { kind: 'story' },
    );
    const merged = applyOutlineWorkflowResult(outline, result);

    expect(merged.premise).toContain('钟声停止前');
    expect(merged.volumes['outline-volume-1']).toMatchObject({
      id: 'outline-volume-1',
      title: '计划第一卷',
      linkedVolumeId: 'mist-harbor-volume-1',
      summary: '更新后的卷纲',
    });
    expect(result.changeSummary).toEqual(['明确了主角目标。']);
  });

  it('accepts new volume and chapter proposals for a full-book import', () => {
    const seed = createDemoFictionistData();
    seed.index.projects['mist-harbor'].outline = createEmptyFictionProjectOutline();

    const result = parseOutlineWorkflowResult(
      resultJson({
        volumes: [{
          id: 'new-volume-1',
          title: '第一卷 · 雾港来信',
          summary: '记者追查来信来源',
          objective: '建立谜团',
          turningPoint: '预言第一次应验',
          climax: '钟塔在暴雨中停摆',
          details: '全卷共十二章。',
        }],
        chapters: [{
          id: 'new-chapter-1',
          volumeId: 'new-volume-1',
          title: '第一章 · 七号泊位',
          summary: '记者收到来自未来的信',
          objective: '引出核心谜团',
          pointOfView: '林砚',
          conflict: '来信内容无人相信',
          keyEvents: '收到来信；前往码头',
          clues: '蓝色墨迹',
          hook: '信上出现明天的日期',
          details: '场景一：报社。场景二：七号泊位。',
        }],
      }),
      seed.index,
      'mist-harbor',
      { kind: 'story' },
      'import',
    );

    expect(result.volumes[0]).toMatchObject({
      id: 'new-volume-1',
      title: '第一卷 · 雾港来信',
      isNew: true,
    });
    expect(result.chapters[0]).toMatchObject({
      id: 'new-chapter-1',
      volumeId: 'new-volume-1',
      title: '第一章 · 七号泊位',
      isNew: true,
    });
  });

  it('writes imported proposals as independent outline nodes with local ids', () => {
    const outline = createEmptyFictionProjectOutline();
    const result = {
      story: null,
      volumes: [{
        id: 'new-volume-1', title: '新卷纲', isNew: true,
        summary: '卷概述', objective: '', turningPoint: '', climax: '', details: '',
      }],
      chapters: [{
        id: 'new-chapter-1', volumeId: 'new-volume-1', title: '新章纲', isNew: true,
        summary: '章概述', objective: '', pointOfView: '', conflict: '', keyEvents: '', clues: '', hook: '', details: '',
      }],
      changeSummary: ['识别出一卷一章。'],
    };
    const ids = ['outline-volume-imported', 'outline-chapter-imported'];
    const merged = applyOutlineWorkflowResult(outline, result, () => ids.shift()!);

    expect(merged.volumeIds).toEqual(['outline-volume-imported']);
    expect(merged.volumes['outline-volume-imported']).toMatchObject({
      id: 'outline-volume-imported',
      title: '新卷纲',
      chapterIds: ['outline-chapter-imported'],
      summary: '卷概述',
    });
    expect(merged.chapters['outline-chapter-imported']).toMatchObject({
      id: 'outline-chapter-imported',
      title: '新章纲',
      summary: '章概述',
    });
    expect(merged.volumes).not.toHaveProperty('new-volume-1');
    expect(merged.chapters).not.toHaveProperty('new-chapter-1');
  });

  it('rejects structural proposals from optimization tasks', () => {
    const seed = createDemoFictionistData();
    seed.index.projects['mist-harbor'].outline = createEmptyFictionProjectOutline();

    expect(() => parseOutlineWorkflowResult(
      resultJson({
        volumes: [{
          id: 'new-volume-1', title: '不应新增的卷纲',
          summary: '', objective: '', turningPoint: '', climax: '', details: '',
        }],
      }),
      seed.index,
      'mist-harbor',
      { kind: 'story' },
      'optimize',
    )).toThrow('优化任务不能新建卷纲');
  });

  it('rejects results that modify an outline outside the selected scope', () => {
    const seed = createDemoFictionistData();
    const outline = createEmptyFictionProjectOutline();
    outline.volumeIds = ['outline-volume-1'];
    outline.volumes['outline-volume-1'] = {
      id: 'outline-volume-1', title: '第一卷纲', chapterIds: ['outline-chapter-1'],
      summary: '', objective: '', turningPoint: '', climax: '', details: '',
    };
    outline.chapters['outline-chapter-1'] = {
      id: 'outline-chapter-1', title: '第一章纲',
      summary: '', objective: '', pointOfView: '', conflict: '', keyEvents: '', clues: '', hook: '', details: '',
    };
    seed.index.projects['mist-harbor'].outline = outline;
    expect(() => parseOutlineWorkflowResult(
      resultJson(),
      seed.index,
      'mist-harbor',
      { kind: 'chapter', id: 'outline-chapter-1' },
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

  it('adds the current import contract to a saved custom workflow at run time', () => {
    const contracted = applyOutlineTaskRuntimeContract({
      label: '用户自定义整理节点',
      systemPrompt: '保留我的自定义整理规则。',
      resultRole: OUTLINE_RESULT_ROLE,
      outputSchemaText: '{"type":"object"}',
    } as never, 'import');

    expect(contracted.systemPrompt).toContain('保留我的自定义整理规则。');
    expect(contracted.systemPrompt).toContain('new-volume-*');
    expect(contracted.outputSchemaText).toContain('"volumeId"');
    expect(contracted.outputSchemaText).toContain('"title"');
  });

  it('freezes the target, project structure and local source into the task snapshot', () => {
    const seed = createDemoFictionistData();
    const project = seed.index.projects['mist-harbor'];
    const outline = createEmptyFictionProjectOutline();
    outline.volumeIds = ['outline-volume-1'];
    outline.volumes['outline-volume-1'] = {
      id: 'outline-volume-1', title: '计划卷', chapterIds: ['outline-chapter-1'],
      summary: '', objective: '', turningPoint: '', climax: '', details: '',
    };
    outline.chapters['outline-chapter-1'] = {
      id: 'outline-chapter-1', title: '计划章',
      summary: '', objective: '', pointOfView: '', conflict: '', keyEvents: '', clues: '', hook: '', details: '',
    };
    project.outline = outline;
    const snapshot = buildOutlineTaskSnapshot({
      operation: 'import',
      project,
      index: seed.index,
      outline,
      target: { kind: 'story' },
      sourceName: '旧大纲.txt',
      sourceText: '第一卷：港区停电。',
    });

    expect(snapshot).toContain('旧大纲.txt');
    expect(snapshot).toContain('第一卷：港区停电。');
    expect(snapshot).toContain('outline-volume-1');
    expect(snapshot).toContain('outline-chapter-1');
    expect(snapshot).toContain('可使用 new-volume-1、new-chapter-1 这类临时 ID');
  });
});
