import { App as AntdApp } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../ModelConfigModal', () => ({
  ModelSettingsPanel: () => <div>model-panel</div>,
}));
vi.mock('../SearchConfigModal', () => ({
  SearchSettingsPanel: () => <div>search-panel</div>,
}));
vi.mock('../MasterConfigModal', () => ({
  JiziSettingsPanel: () => <div>jizi-panel</div>,
}));
vi.mock('../ToolConfigModal', () => ({
  ToolSettingsPanel: () => <div>tool-panel</div>,
}));
vi.mock('./SystemDataSettingsPanel', () => ({
  default: () => <div>system-panel</div>,
}));

import {
  default as SettingsCenter,
  focusSettingsEntry,
  SettingsCenterNavigation,
  SettingsCenterPanel,
} from './SettingsCenter';
import LiveAnnouncement from '../LiveAnnouncement';

describe('settings center navigation', () => {
  it('focuses the search field before falling back to the page heading', () => {
    const searchInput = { focus: vi.fn() };
    const pageHeading = { focus: vi.fn() };
    focusSettingsEntry(searchInput, pageHeading);

    expect(searchInput.focus).toHaveBeenCalledOnce();
    expect(pageHeading.focus).not.toHaveBeenCalled();

    focusSettingsEntry(null, pageHeading);
    expect(pageHeading.focus).toHaveBeenCalledOnce();
  });

  it('renders polite page announcements for assistive technology', () => {
    const html = renderToStaticMarkup(
      <LiveAnnouncement message="当前页面：设置" />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('当前页面：设置');
  });

  it('announces the active settings section', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <SettingsCenter />
      </AntdApp>,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('当前设置分区：模型服务');
  });

  it('uses the shared Pearl page heading hierarchy', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <SettingsCenter />
      </AntdApp>,
    );

    expect(html).toContain('settings-content__kicker');
    expect(html).toContain('settings-content__title');
    expect(html).toContain('settings-content__subtitle');
  });

  it('renders all five approved settings destinations', () => {
    const html = renderToStaticMarkup(
      <SettingsCenterNavigation
        query=""
        section="models"
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('模型服务');
    expect(html).toContain('联网搜索');
    expect(html).toContain('姬子配置');
    expect(html).toContain('工具库');
    expect(html).toContain('系统与数据');
    expect(html).not.toContain('Skill 管理');
  });

  it('filters navigation to matching existing pages', () => {
    const html = renderToStaticMarkup(
      <SettingsCenterNavigation
        query="日志"
        section="models"
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('系统与数据');
    expect(html).not.toContain('模型服务');
    expect(html).not.toContain('工具库');
  });

  it.each([
    ['models', 'model-panel'],
    ['search', 'search-panel'],
    ['jizi', 'jizi-panel'],
    ['tools', 'tool-panel'],
    ['system', 'system-panel'],
  ] as const)('maps %s to its existing settings panel', (section, marker) => {
    const html = renderToStaticMarkup(
      <SettingsCenterPanel
        section={section}
        onDirtyChange={() => undefined}
      />,
    );

    expect(html).toContain(marker);
  });
});
