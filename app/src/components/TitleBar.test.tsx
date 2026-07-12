import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  PrimaryViewActions,
  restoreSettingsButtonFocus,
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

  it('labels the primary view navigation for the Pearl shell', () => {
    const html = renderToStaticMarkup(
      <PrimaryViewActions
        view="workspace"
        onWorkspace={noop}
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

  it('preserves report refresh and output actions', () => {
    const html = renderToStaticMarkup(
      <PrimaryViewActions
        view="reports"
        onWorkspace={noop}
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
