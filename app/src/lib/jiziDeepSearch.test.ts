import { describe, expect, it } from 'vitest';
import { enrichSearchResults } from './jiziDeepSearch';

describe('enrichSearchResults', () => {
  it('uses bounded body excerpts and falls back to snippets per result', async () => {
    const results = [
      { title: '官方文档', snippet: '旧摘要', link: 'https://docs.example.com/a' },
      { title: '社区文章', snippet: '可用摘要', link: 'https://community.example.com/b' },
    ];
    const enriched = await enrichSearchResults(results, async (url) => {
      if (url.includes('community')) throw new Error('blocked');
      return { url, contentType: 'text/html', text: '正文证据 '.repeat(1_000) };
    });

    expect(enriched[0].contentMode).toBe('body');
    expect(enriched[0].excerpt!.length).toBeLessThanOrEqual(2_000);
    expect(enriched[0].authority).toBe('official');
    expect(enriched[1]).toMatchObject({
      contentMode: 'snippet',
      excerpt: '可用摘要',
    });
  });
});
