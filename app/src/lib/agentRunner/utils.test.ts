import { describe, expect, it } from 'vitest';
import { safeFileName } from './utils';

describe('safeFileName', () => {
  it('does not split a Unicode character at the length boundary', () => {
    const name = `${'a'.repeat(47)}😀`;

    expect(safeFileName(name)).toBe(name);
  });

  it('removes Windows-invalid trailing dots', () => {
    expect(safeFileName('report.')).toBe('report');
  });
});
