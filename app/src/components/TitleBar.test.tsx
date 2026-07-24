import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  PrimaryViewActions,
  restoreSettingsButtonFocus,
  WorkspaceTabs,
} from './TitleBar';

const noop = () => undefined;
const titleBarSource = readFileSync(new URL('./TitleBar.tsx', import.meta.url), 'utf8');

describe('title bar primary view actions', () => {
  it('restores focus to Settings after returning from settings', () => {
    const target = { focus: vi.fn() };
    restoreSettingsButtonFocus('settings', 'workspace', target);

    expect(target.focus).toHaveBeenCalledOnce();
  });

  it('does not move focus for unrelated view changes', () => {
    const target = { focus: vi.fn() };
    restoreSettingsButtonFocus('reports', 'workspace', target);
    restoreSettingsButtonFocus('workspace', 'reports', target);

    expect(target.focus).not.toHaveBeenCalled();
  });

  it('opens settings directly from the workspace without a menu', () => {
    const html = renderToStaticMarkup(
      <PrimaryViewActions
        view="workspace"
        onWorkspace={noop}
        onFictionist={noop}
        onReports={noop}
        onSettings={noop}
        onRefreshReports={noop}
        onOpenOutput={noop}
      />,
    );

    expect(html).toContain('报告中心');
    expect(html).toContain('设置');
    expect(html).not.toContain('aria-haspopup');
  });

  it('shows the workflow center return action only when requested', () => {
    const hidden = renderToStaticMarkup(
      <PrimaryViewActions
        view="workspace"
        onWorkspace={noop}
        onFictionist={noop}
        onReports={noop}
        onSettings={noop}
        onRefreshReports={noop}
        onOpenOutput={noop}
      />,
    );
    const visible = renderToStaticMarkup(
      <PrimaryViewActions
        view="workspace"
        onWorkspace={noop}
        onFictionist={noop}
        onReports={noop}
        onSettings={noop}
        onRefreshReports={noop}
        onOpenOutput={noop}
        onWorkflowCenter={noop}
        showWorkflowReturn
      />,
    );

    expect(hidden).not.toContain('返回工作流中心');
    expect(visible).toContain('返回工作流中心');
  });

  it('renders workspaces as top-level tabs', () => {
    const html = renderToStaticMarkup(
      <WorkspaceTabs view="fictionist" onWorkspace={noop} onFictionist={noop} />,
    );

    expect(html).toContain('工作台');
    expect(html).toContain('小说家');
    expect(html).toContain('title-bar__workspace-tabs');
    expect(html).toContain('aria-current="page"');
  });

  it('labels the primary view navigation for the Pearl shell', () => {
    const html = renderToStaticMarkup(
      <PrimaryViewActions
        view="workspace"
        onWorkspace={noop}
        onFictionist={noop}
        onReports={noop}
        onSettings={noop}
        onRefreshReports={noop}
        onOpenOutput={noop}
      />,
    );

    expect(html).toContain('aria-label="一级页面"');
    expect(html).toContain('title-bar__view-nav');
  });

  it('marks low-frequency workspace actions for compact desktop layout', () => {
    expect(titleBarSource).toContain('title-bar__compact-action');
    expect(titleBarSource).toContain('title-bar__save-as');
  });

  it('shows only the return action while settings is active', () => {
    const html = renderToStaticMarkup(
      <PrimaryViewActions
        view="settings"
        onWorkspace={noop}
        onFictionist={noop}
        onReports={noop}
        onSettings={noop}
        onRefreshReports={noop}
        onOpenOutput={noop}
      />,
    );

    expect(html).toContain('返回工作台');
    expect(html).not.toContain('报告中心');
    expect(html).not.toContain('打开输出目录');
  });

  it('keeps utility navigation while fictionist is active', () => {
    const html = renderToStaticMarkup(
      <PrimaryViewActions
        view="fictionist"
        onWorkspace={noop}
        onFictionist={noop}
        onReports={noop}
        onSettings={noop}
        onRefreshReports={noop}
        onOpenOutput={noop}
      />,
    );

    expect(html).toContain('报告中心');
    expect(html).toContain('设置');
    expect(html).not.toContain('返回工作台');
  });

  it('preserves report refresh and output actions', () => {
    const html = renderToStaticMarkup(
      <PrimaryViewActions
        view="reports"
        onWorkspace={noop}
        onFictionist={noop}
        onReports={noop}
        onSettings={noop}
        onRefreshReports={noop}
        onOpenOutput={noop}
      />,
    );

    expect(html).toContain('返回工作台');
    expect(html).toContain('刷新');
    expect(html).toContain('打开输出目录');
  });
});
