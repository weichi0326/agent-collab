import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DrawerModeSwitch,
  masterDrawerClassName,
} from './MasterAgentDrawer';

vi.mock('./MasterAgentPanel', () => ({
  default: () => <div>chat</div>,
}));
vi.mock('./MasterSessionRail', () => ({
  default: () => <div>sessions</div>,
}));
vi.mock('./MasterConfigModal', () => ({
  default: () => null,
}));

describe('MasterAgentDrawer display mode', () => {
  it('renders an accessible half/fullscreen switch', () => {
    const halfHtml = renderToStaticMarkup(
      <DrawerModeSwitch fullscreen={false} onChange={() => undefined} />,
    );
    const fullHtml = renderToStaticMarkup(
      <DrawerModeSwitch fullscreen onChange={() => undefined} />,
    );

    expect(halfHtml).toContain('role="switch"');
    expect(halfHtml).toContain('aria-label="姬子显示模式，当前半屏"');
    expect(halfHtml).toContain('半屏');
    expect(fullHtml).toContain('aria-label="姬子显示模式，当前全屏"');
    expect(fullHtml).toContain('全屏');
  });

  it('applies fullscreen class only while expanded in fullscreen mode', () => {
    expect(masterDrawerClassName(true, false)).toBe('master-drawer');
    expect(masterDrawerClassName(false, true)).toBe('master-drawer');
    expect(masterDrawerClassName(true, true)).toBe(
      'master-drawer master-drawer--fullscreen',
    );
  });
});
