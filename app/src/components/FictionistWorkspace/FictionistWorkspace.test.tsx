import { App as AntdApp } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FictionistWorkspace from './FictionistWorkspace';

describe('fictionist workspace mock', () => {
  it('renders the library as a categorized bookshelf', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <FictionistWorkspace />
      </AntdApp>,
    );

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
    const html = renderToStaticMarkup(
      <AntdApp>
        <FictionistWorkspace initialSection="chapters" />
      </AntdApp>,
    );

    expect(html).toContain('作品功能');
    expect(html).toContain('正文');
    expect(html).toContain('设定库');
    expect(html).toContain('时间线');
    expect(html).toContain('工作流');
    expect(html).toContain('返回书架');
    expect(html).toContain('返回书库切换作品');
    expect(html).not.toContain('书架分类');
  });
});
