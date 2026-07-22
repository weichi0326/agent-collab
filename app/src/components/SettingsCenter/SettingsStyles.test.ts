import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../../App.css', import.meta.url), 'utf8');

describe('settings keyboard styles', () => {
  it('defines the Pearl Order color, radius, glass, and motion contracts', () => {
    expect(styles).toContain('--pearl-bg: #f3f5f3;');
    expect(styles).toContain('--pearl-surface: rgba(251, 252, 251, 0.94);');
    expect(styles).toContain('--pearl-text-secondary: #59635e;');
    expect(styles).toContain('--pearl-text-tertiary: #737d77;');
    expect(styles).toContain('--pearl-accent: #6f8980;');
    expect(styles).toContain('--radius-panel: 20px;');
    expect(styles).toContain('--radius-dialog: 24px;');
    expect(styles).toContain('--glass-blur: 22px;');
    expect(styles).toContain('--motion-page: 340ms;');
  });

  it('keeps reduced-motion support in the global stylesheet', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('uses flat Pearl workspace surfaces and a glass canvas toolbar', () => {
    expect(styles).toMatch(
      /\.agent-sidebar,\s*\.right-panel\s*\{[^}]*background:\s*var\(--pearl-surface\)/s,
    );
    expect(styles).toMatch(
      /\.canvas-toolbar,\s*\.react-flow__controls\s*\{[^}]*backdrop-filter:\s*blur\(/s,
    );
  });

  it('uses a flat Pearl settings layout without nested section cards', () => {
    expect(styles).toMatch(
      /\.settings-center\s*\{[^}]*background:\s*var\(--pearl-bg\)/s,
    );
    expect(styles).toMatch(
      /\.settings-content\s*\{[^}]*background:\s*var\(--pearl-surface-solid\)/s,
    );
    expect(styles).toMatch(
      /\.settings-nav__item--active[^}]*background:\s*var\(--pearl-accent-soft\)/s,
    );
  });

  it('defines the supported compact desktop layout without shrinking text', () => {
    expect(styles).toMatch(/@media \(max-width: 1199px\)/);
    expect(styles).toContain('grid-template-columns: 196px minmax(0, 1fr);');
    expect(styles).toContain('--compact-workspace-gap: 8px;');
  });

  it('keeps the report page unframed around its individual data cards', () => {
    expect(styles).toMatch(
      /\.report-center\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
  });

  it('keeps desktop settings and report copy readable', () => {
    expect(styles).toMatch(/\.settings-nav__item-copy span\s*\{[^}]*font-size:\s*12px;/s);
    expect(styles).toMatch(/\.report-center__subtitle,[\s\S]*font-size:\s*14px;/s);
    expect(styles).toMatch(/\.report-token-row\s*\{[^}]*font-size:\s*14px;/s);
  });

  it('reveals model delete actions within a focused row', () => {
    expect(styles).toMatch(
      /\.mc-inst:focus-within\s+\.mc-inst__del\s*\{\s*visibility:\s*visible;/,
    );
  });

  it('keeps a clear focus indicator on model delete actions', () => {
    expect(styles).toMatch(
      /\.mc-inst__del:focus-visible\s*\{[^}]*outline:\s*2px solid #[0-9a-f]{6};[^}]*outline-offset:\s*2px;/s,
    );
  });
});
