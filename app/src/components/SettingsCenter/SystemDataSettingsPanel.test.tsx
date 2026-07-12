import { renderToStaticMarkup } from 'react-dom/server';
import { App as AntdApp } from 'antd';
import { describe, expect, it } from 'vitest';
import SystemDataSettingsPanel from './SystemDataSettingsPanel';

describe('system data settings panel', () => {
  it('uses settings rows instead of the deprecated Ant Design List', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <SystemDataSettingsPanel />
      </AntdApp>,
    );

    expect(html).not.toContain('ant-list');
    expect(html).toContain('桌面状态仅在桌面应用中可用');
    expect(html).not.toContain('无法读取系统快照');
  });
});
