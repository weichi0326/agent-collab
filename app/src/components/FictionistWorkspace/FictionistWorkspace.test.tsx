import { App as AntdApp } from 'antd';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FictionistWorkspace from './FictionistWorkspace';

type FictionistSection = 'library' | 'chapters' | 'canon' | 'timeline' | 'workflows';
const workspaceSource = readFileSync(
  new URL('./FictionistWorkspace.tsx', import.meta.url),
  'utf8',
);

function renderWorkspace(initialSection?: FictionistSection): string {
  return renderToStaticMarkup(
    <AntdApp>
      <FictionistWorkspace initialSection={initialSection} />
    </AntdApp>,
  );
}

describe('fictionist workspace mock', () => {
  it('renders the library as a categorized bookshelf', () => {
    const html = renderWorkspace();

    expect(html).toContain('我的书库');
    expect(html).toContain('我的书架');
    expect(html).toContain('书库统计');
    expect(html).toContain('总字数');
    expect(html).toContain('章节');
    expect(html).toContain('书架分类');
    expect(html).toContain('悬疑');
    expect(html).not.toContain('新建作品');
    expect((html.match(/新建一本书/g) ?? []).length).toBe(1);
    expect(html).toContain('雾港来信');
    expect(html).toContain('打开《雾港来信》');
    expect(html).not.toContain('作品功能');
    expect(html).not.toContain('设定库');
  });

  it('renders project tools as a second-level workspace after opening a book', () => {
    const html = renderWorkspace('chapters');

    expect(html).toContain('作品功能');
    expect(html).toContain('正文');
    expect(html).toContain('设定库');
    expect(html).toContain('时间线');
    expect(html).toContain('工作流');
    expect(html).toContain('返回书架');
    expect(html).toContain('返回书库切换作品');
    expect(html).not.toContain('书架分类');
  });

  it('renders the chapter editor baseline', () => {
    const html = renderWorkspace('chapters');

    expect(html).toContain('卷与章节');
    expect(html).toContain('章节正文编辑区');
    expect(html).toContain('续写下一章');
    expect(html).toContain('本章上下文');
    expect(html).toContain('七号泊位');
  });

  it('renders the canon baseline', () => {
    const html = renderWorkspace('canon');

    expect(html).toContain('作品事实库');
    expect(html).toContain('设定库');
    expect(html).toContain('新建设定');
    expect(html).toContain('林砚');
    expect(html).toContain('旧海关钟塔');
  });

  it('renders the timeline baseline', () => {
    const html = renderWorkspace('timeline');

    expect(html).toContain('事件与章节同步');
    expect(html).toContain('故事时间线');
    expect(html).toContain('新增事件');
    expect(html).toContain('七号泊位因事故永久封闭');
  });

  it('renders the workflow baseline', () => {
    const html = renderWorkspace('workflows');

    expect(html).toContain('从画布能力组合而来');
    expect(html).toContain('小说工作流');
    expect(html).toContain('在画布中编辑');
    expect(html).toContain('章节连续性检查');
  });

  it('shows a recoverable error instead of sample data when hydration fails', () => {
    expect(workspaceSource).toContain("hydrationState === 'error'");
    expect(workspaceSource).toContain('小说数据加载失败');
    expect(workspaceSource).toContain('重新加载');
  });

  it('renders an intentional empty editor for a project without chapters', () => {
    expect(workspaceSource).toContain("section === 'chapters' && selectedChapter");
    expect(workspaceSource).toContain('这部作品还没有章节');
    expect(workspaceSource).toContain('新建第一个章节后即可开始写作。');
  });

  it('uses real persistence copy for creation and saving', () => {
    expect(workspaceSource).toContain('作品和章节保存在本机');
    expect(workspaceSource).not.toContain('关闭软件后新建内容不会保留');
    expect(workspaceSource).not.toContain('演示：已在书库中新建');
    expect(workspaceSource).not.toContain('演示：已保存');
  });

  it('guards unsaved content when leaving the workspace or closing the window', () => {
    expect(workspaceSource).toContain('registerAppViewGuard');
    expect(workspaceSource).toContain("window.addEventListener('beforeunload'");
    expect(workspaceSource).toContain('saveCurrentChapter');
  });
});
