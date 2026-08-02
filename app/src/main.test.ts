import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('global app feedback placement', () => {
  it('centers transient messages as a group in the viewport', () => {
    expect(mainSource).toContain("top: '50%'");
    expect(mainSource).toContain("listContent: { transform: 'translateY(-50%)' }");
    expect(mainSource).toMatch(/<AntApp\s+message=\{\{/u);
  });
});
