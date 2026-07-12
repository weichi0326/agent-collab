import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../../App.css', import.meta.url), 'utf8');
const panelSource = readFileSync(
  new URL('../PropertiesPanel.tsx', import.meta.url),
  'utf8',
);

describe('upstream node source layout', () => {
  it('stays on one row until the available width is exhausted', () => {
    expect(styles).toMatch(
      /\.node-source--upstream\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*center;/s,
    );
    expect(styles).toMatch(
      /\.node-source--upstream\s+\.node-source__hint\s*\{[^}]*margin-bottom:\s*0;/s,
    );
    expect(styles).toMatch(
      /\.node-source--upstream\s+\.node-source__ups\s*\{[^}]*display:\s*contents;/s,
    );
  });

  it('uses a concise upstream source label', () => {
    expect(panelSource).toContain('来自前序节点：');
    expect(panelSource).not.toContain('来自前序节点(不可修改)：');
  });
});
