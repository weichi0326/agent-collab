import { readFileSync } from 'node:fs';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MasterAgentDrawer from './MasterAgentDrawer';
import { JiziSettingsPanel } from './MasterConfigModal';
import MasterSessionRail from './MasterSessionRail';
import {
  masterDrawerClassName,
  masterDrawerContentClassName,
  shouldKeepDrawerContentOpen,
  shouldScheduleDrawerUnmount,
} from './masterDrawerDisplay';
import { useUiStore } from '../stores/uiStore';

const storage = new Map<string, string>();
const drawerSource = readFileSync(new URL('./MasterAgentDrawer.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});

vi.mock('./MasterAgentPanel', () => ({
  default: () => <div>chat</div>,
}));

describe('MasterAgentDrawer display mode', () => {
  beforeEach(() => {
    storage.clear();
    useUiStore.setState({
      drawerExpanded: false,
      drawerFullscreen: false,
      view: 'workspace',
    });
  });

  it('renders the half/fullscreen switch in Jizi settings', () => {
    const html = renderToStaticMarkup(
      <App>
        <JiziSettingsPanel onDirtyChange={() => undefined} />
      </App>,
    );

    expect(html).toContain('显示模式');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="姬子显示模式，当前半屏"');
  });

  it('does not render the display mode switch in the drawer control bar', () => {
    useUiStore.setState({ drawerExpanded: true });

    const html = renderToStaticMarkup(
      <App>
        <MasterAgentDrawer />
      </App>,
    );

    expect(html).not.toContain('姬子显示模式');
  });

  it('keeps the drawer root in flow and removes side gutters in fullscreen mode', () => {
    expect(masterDrawerClassName(true, false)).toBe(
      'master-drawer master-agent-drawer--pearl master-agent-drawer--half',
    );
    expect(masterDrawerClassName(false, true)).toBe(
      'master-drawer master-agent-drawer--pearl master-agent-drawer--fullscreen',
    );
    expect(masterDrawerClassName(true, true)).toBe(
      'master-drawer master-agent-drawer--pearl master-agent-drawer--fullscreen',
    );
    expect(styles).toMatch(
      /\.master-agent-drawer--fullscreen\s*\{[^}]*margin:\s*0;[^}]*border-radius:\s*0;/s,
    );
  });

  it('applies fullscreen positioning only to the content overlay', () => {
    expect(masterDrawerClassName(false, true, true)).toBe(
      'master-drawer master-agent-drawer--pearl master-agent-drawer--fullscreen',
    );
    expect(masterDrawerContentClassName(true, true, false)).toBe(
      'master-drawer__content master-drawer__content--open master-drawer__content--fullscreen',
    );
    expect(masterDrawerContentClassName(false, true, true)).toBe(
      'master-drawer__content master-drawer__content--open master-drawer__content--fullscreen master-drawer__content--fullscreen-closing',
    );
    expect(masterDrawerContentClassName(false, true, false)).toBe(
      'master-drawer__content master-drawer__content--fullscreen-collapsed',
    );
    expect(shouldKeepDrawerContentOpen(false, true)).toBe(true);
    expect(shouldKeepDrawerContentOpen(false, false)).toBe(false);
  });

  it('finishes fullscreen closing from the content overlay lifecycle', () => {
    expect(drawerSource).toContain(
      'const [fullscreenClosing, setFullscreenClosing] = useState(false);',
    );
    expect(drawerSource).toContain(
      'masterDrawerClassName(expanded, fullscreen, fullscreenClosing)',
    );
    expect(drawerSource).toMatch(
      /masterDrawerContentClassName\(\s*expanded,\s*fullscreen,\s*fullscreenClosing,?\s*\)/,
    );
    expect(drawerSource).toMatch(
      /className=\{masterDrawerContentClassName\([^)]*\)\}[\s\S]*onAnimationEnd=\{finishFullscreenClose\}/,
    );
  });

  it('clips only the fullscreen content overlay without transforming the workspace', () => {
    expect(styles).toContain('@keyframes master-drawer-content-fullscreen-exit');
    expect(styles).toMatch(
      /\.master-drawer\s*\{[^}]*position:\s*relative;/s,
    );
    expect(styles).toMatch(
      /\.master-drawer__content--fullscreen\s*\{[^}]*position:\s*absolute;[^}]*top:\s*26px;[^}]*width:\s*100vw;[^}]*height:\s*calc\(100vh - 78px\);/s,
    );
    expect(styles).toMatch(
      /\.master-drawer__content--fullscreen-closing\s*\{[^}]*animation:\s*master-drawer-content-fullscreen-exit var\(--motion-page\) var\(--motion-ease-out\) both;[^}]*pointer-events:\s*none;/s,
    );
    expect(styles).toMatch(
      /\.master-drawer__content--fullscreen-collapsed\s*\{[^}]*transition:\s*none;/s,
    );
    expect(styles).toMatch(
      /@keyframes master-drawer-content-fullscreen-exit\s*\{[^]*clip-path:\s*inset\(0 0 100% 0\);[^]*\}/s,
    );
    expect(styles).not.toContain('.master-drawer--fullscreen {');
  });

  it('does not unmount preserved chat state while settings covers the workspace', () => {
    expect(
      shouldScheduleDrawerUnmount({
        expanded: false,
        mounted: true,
        anySending: false,
        view: 'settings',
      }),
    ).toBe(false);
    expect(
      shouldScheduleDrawerUnmount({
        expanded: false,
        mounted: true,
        anySending: false,
        view: 'workspace',
      }),
    ).toBe(true);
  });
});

describe('MasterAgentDrawer settings entry', () => {
  it('keeps session creation while omitting the legacy Jizi settings gear', () => {
    const html = renderToStaticMarkup(
      <App>
        <MasterSessionRail />
      </App>,
    );

    expect(html).toContain('session-rail__new');
    expect(html).not.toContain('session-rail__config');
  });
});
