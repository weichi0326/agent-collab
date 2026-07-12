import { renderToStaticMarkup } from 'react-dom/server';
import { App as AntdApp } from 'antd';
import { describe, expect, it } from 'vitest';
import { TOOL_REGISTRY } from '../lib/toolRegistry';
import {
  TOOL_CONFIG_MODAL_CLASS_NAME,
  ToolSettingsPanel,
} from './ToolConfigModal';

describe('tool settings list controls', () => {
  it('uses the shared Pearl dialog shell', () => {
    expect(TOOL_CONFIG_MODAL_CLASS_NAME).toBe('tool-config-modal pearl-dialog');
  });

  it('uses native buttons so Enter and Space both activate tools', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <ToolSettingsPanel active={false} />
      </AntdApp>,
    );

    const toolButtons = html.match(/<button type="button" class="tc-tool-item[^"]*"/g) ?? [];
    expect(toolButtons).toHaveLength(TOOL_REGISTRY.length);
    expect(html).not.toContain('<div class="tc-tool-item');
    expect(html).not.toContain('role="button"');
  });
});
