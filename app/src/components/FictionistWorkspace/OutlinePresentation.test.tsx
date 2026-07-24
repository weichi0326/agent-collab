import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyFictionProjectOutline } from '../../features/fictionist/domain';
import type { FictionOutlineWorkflowResult } from '../../features/fictionist/outlineWorkflows';
import OutlineEditor from './OutlineEditor';
import { OutlineReviewContent } from './OutlineWorkflowDialogs';

describe('fictionist outline presentation', () => {
  it('keeps the detailed outline in a dedicated wide editor beside structured fields', () => {
    const html = renderToStaticMarkup(
      <OutlineEditor
        projectTitle="雾港来信"
        target={{ kind: 'story' }}
        outline={{
          ...createEmptyFictionProjectOutline(),
          premise: '记者调查一封来自未来的信。',
          details: '第一幕：记者抵达雾港。',
        }}
        dirty={false}
        saving={false}
        onStoryChange={vi.fn()}
        onVolumeChange={vi.fn()}
        onChapterChange={vi.fn()}
        onSave={vi.fn()}
        onImport={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    expect(html).toContain('fictionist-outline-workspace');
    expect(html).toContain('fictionist-outline-structured');
    expect(html).toContain('fictionist-outline-details');
    expect(html).toContain('aria-label="详细大纲"');
    expect(html).toContain('第一幕：记者抵达雾港。');
  });

  it('renders analyzed results as named Chinese sections without JSON or internal ids', () => {
    const result: FictionOutlineWorkflowResult = {
      story: {
        premise: '记者调查一封来自未来的信。',
        theme: '选择与代价',
        protagonistGoal: '阻止港口事故',
        coreConflict: '真相会伤害她最信任的人',
        endingDirection: '公开真相并承担代价',
        details: '第一幕调查，第二幕对抗，第三幕抉择。',
      },
      volumes: [{
        id: 'volume-private-id',
        summary: '查明来信来源',
        objective: '建立谜团',
        turningPoint: '预言第一次应验',
        climax: '主角找到寄信人',
        details: '本卷分为十二章。',
      }],
      chapters: [{
        id: 'chapter-private-id',
        summary: '记者收到来信',
        objective: '引出核心谜团',
        pointOfView: '林砚',
        conflict: '来信内容无人相信',
        keyEvents: '收到来信；前往码头',
        clues: '蓝色墨迹',
        hook: '信上出现明天的日期',
        details: '场景一：报社。场景二：七号泊位。',
      }],
      changeSummary: ['补全了主线冲突。'],
    };
    const html = renderToStaticMarkup(
      <OutlineReviewContent
        targetLabel="全书大纲"
        result={result}
        volumeLabels={{ 'volume-private-id': '第一卷 · 潮汐失语' }}
        chapterLabels={{ 'chapter-private-id': '第一章 · 七号泊位' }}
      />,
    );

    expect(html).toContain('故事总纲');
    expect(html).toContain('第一卷 · 潮汐失语');
    expect(html).toContain('第一章 · 七号泊位');
    expect(html).toContain('一句话梗概');
    expect(html).toContain('详细大纲');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('volume-private-id');
    expect(html).not.toContain('chapter-private-id');
    expect(html).not.toContain('&quot;premise&quot;');
  });
});
