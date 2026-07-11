import { describe, expect, it } from 'vitest';
import type { SearchResult } from './searchClient';
import { parseQualityReply } from './jiziSearchQuality';

const results: SearchResult[] = [1, 2, 3, 4].map((index) => ({
  title: `结果 ${index}`,
  link: `https://example.com/${index}`,
  snippet: `摘要 ${index}`,
}));

describe('parseQualityReply', () => {
  it('respects an explicit empty keep list', () => {
    const report = parseQualityReply('{"keep":[],"summary":"都不相关"}', results);
    expect(report.kept).toEqual([]);
    expect(report.droppedCount).toBe(4);
    expect(report.summary).toBe('都不相关');
  });

  it('keeps valid unique indexes in model order', () => {
    const report = parseQualityReply('{"keep":[3,1,3]}', results);
    expect(report.kept.map((item) => item.title)).toEqual(['结果 3', '结果 1']);
  });

  it('falls back only when JSON or keep field is invalid', () => {
    expect(parseQualityReply('{}', results).kept).toEqual(results.slice(0, 3));
    expect(parseQualityReply('{"keep":["1"]}', results).kept).toEqual(results.slice(0, 3));
    expect(parseQualityReply('not-json', results).kept).toEqual(results.slice(0, 3));
  });
});
