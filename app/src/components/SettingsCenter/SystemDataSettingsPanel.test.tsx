import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { App as AntdApp } from 'antd';
import { describe, expect, it } from 'vitest';
import { cleanupLocationDirectories, cleanupLocationDirectory } from './cleanupLocation';
import SystemDataSettingsPanel from './SystemDataSettingsPanel';

const source = readFileSync(new URL('./SystemDataSettingsPanel.tsx', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../App.css', import.meta.url), 'utf8');

describe('system data settings panel', () => {
  it('uses settings rows instead of the deprecated Ant Design List', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <SystemDataSettingsPanel />
      </AntdApp>,
    );

    expect(html).not.toContain('ant-list');
    expect(html).toContain('桌面状态仅在桌面应用中可用');
    expect(html).toContain('分类清理软件数据');
    expect(html).toContain('扫描可清理内容');
    expect(html).toContain('重要数据会在执行前二次确认');
    expect(html).not.toContain('点击后不二次确认');
    expect(html).not.toContain('无法读取系统快照');
  });

  it('renders the cleanup selection as a centered pearl themed modal instead of an inline panel', () => {
    expect(source).toContain('<Modal');
    expect(source).toContain('open={cleanupPanelOpen}');
    expect(source).toContain('className="system-settings-cleanup-modal"');
    expect(source).toContain('centered');
    expect(source).toContain('width={1280}');
    expect(source).toContain('system-settings-cleanup-summary');
    expect(source).toContain('system-settings-cleanup-summary-card');
    expect(source).toContain('system-settings-cleanup-group');
    expect(source).toContain('system-settings-cleanup-card');
    expect(source).toContain('system-settings-cleanup-scope');
    expect(source).toContain('system-settings-cleanup-warning');
    expect(source).toContain('system-settings-cleanup-important-tag');
    expect(source).toContain('system-settings-cleanup-danger-button');
    expect(source).not.toContain('className="system-settings-cleanup-panel"');
  });

  it('derives cleanup groups and selected important state before rendering the modal', () => {
    expect(source).toContain('const normalCleanupItems = useMemo');
    expect(source).toContain('const importantCleanupItems = useMemo');
    expect(source).toContain('const selectedCleanupItems = useMemo');
    expect(source).toContain('const selectedImportantCleanupItems = useMemo');
    expect(source).toContain('const selectedCleanupUsage = useMemo');
    expect(source).toContain('const protectedImportantCount = useMemo');
  });

  it('keeps cleanup copy focused on risk grouping and pearl-theme visual hierarchy', () => {
    expect(source).toContain('默认清理');
    expect(source).toContain('重要保护');
    expect(source).toContain('预计释放');
    expect(source).toContain('普通缓存');
    expect(source).toContain('重要数据');
    expect(source).toContain('默认保护');
    expect(source).not.toContain('查看路径');
    expect(source).toContain('已选择重要数据，清理前会再次确认。');
  });

  it('uses a wider two-column cleanup layout on desktop screens', () => {
    expect(source).toContain('width={1280}');
    expect(appCss).toMatch(/\.system-settings-cleanup-list\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/u);
    expect(appCss).not.toContain('system-settings-cleanup-detail-path');
    expect(appCss).not.toContain('system-settings-cleanup-path-toggle');
  });

  it('centers the important-data confirmation dialog', () => {
    expect(source).toMatch(/Modal\.confirm\(\{[\s\S]*?centered:\s*true[\s\S]*?title:\s*'确认清理重要数据？'/u);
    expect(source).toContain('item.impact');
    expect(source).toContain('清理后会失去');
  });

  it('opens cleanup data locations through the existing local path helper at the parent directory', () => {
    expect(source).toContain("import { openLocalPath } from '../../lib/outputDirectory';");
    expect(source).toContain("import { cleanupLocationOptions } from './cleanupLocation';");
    expect(cleanupLocationDirectory('C:/agent-collab/data/multi-agent-canvas.json')).toBe('C:/agent-collab/data');
    expect(cleanupLocationDirectories('C:/agent-collab/data/a.json；C:/agent-collab/data/b.json')).toEqual(['C:/agent-collab/data']);
    expect(cleanupLocationDirectories('C:/agent-collab/data/a.json；C:/Users/Admin/AppData/Local/com.agent-collab')).toHaveLength(2);
    expect(source).toContain('const locations = cleanupLocationOptions(item.label, item.path)');
    expect(source).toContain('await openLocalPath(locations[0].path)');
    expect(source).toContain("title: '选择数据位置'");
    expect(source).toContain('location.label');
    expect(source).toContain('location.description');
    expect(source).toContain('location.path');
    expect(appCss).toMatch(/\.system-settings-cleanup-location-option\.ant-btn\s*\{[^}]*justify-content:\s*flex-start;/u);
    expect(appCss).toMatch(/\.system-settings-cleanup-location-option__main\s*\{[^}]*width:\s*100%;/u);
    expect(source).toContain('打开数据位置失败');
    expect(source).toContain('查看数据位置');
    expect(source).toContain('onClick={() => void handleOpenCleanupLocation(item)}');
    expect(source).not.toContain('openSystemPath');
    expect(source).not.toContain('cleanupDetailItem');
    expect(source).not.toContain('open={cleanupDetailItem !== null}');
    expect(source).not.toContain('copyable={{ text: path }}');
    expect(source).not.toContain('查看明细');
    expect(source).not.toContain('统计完整');
    expect(source).toContain('大小可能不完整');
  });

  it('uses a red filled tag for important cleanup categories', () => {
    expect(source).toContain('system-settings-cleanup-important-tag');
    expect(appCss).toMatch(/\.system-settings-cleanup-important-tag\s*\{[\s\S]*?background:\s*var\(--pearl-danger\)[\s\S]*?color:\s*#fff/u);
  });
});
