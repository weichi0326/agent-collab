import type { SearchResult } from './searchClient';
import { readWebPage, type WebPageContent } from './pythonClient';

type PageReader = (url: string, signal?: AbortSignal) => Promise<WebPageContent>;

function authorityFor(url: string): 'official' | 'community' | 'unknown' {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.startsWith('docs.') || host.startsWith('developer.') || host.startsWith('support.')) {
      return 'official';
    }
    if (host.includes('community') || host.includes('forum') || host.includes('reddit')) {
      return 'community';
    }
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

export async function enrichSearchResults(
  results: SearchResult[],
  reader: PageReader = readWebPage,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const selected = results.slice(0, 4);
  const enriched: SearchResult[] = [];
  for (let index = 0; index < selected.length; index += 2) {
    const batch = selected.slice(index, index + 2);
    const rows = await Promise.all(
      batch.map(async (result): Promise<SearchResult> => {
        try {
          const page = await reader(result.link, signal);
          const excerpt = page.text.replace(/\s+/g, ' ').trim().slice(0, 2_000);
          if (!excerpt) throw new Error('empty body');
          return {
            ...result,
            excerpt,
            contentMode: 'body',
            authority: authorityFor(page.url || result.link),
          };
        } catch {
          return {
            ...result,
            excerpt: result.snippet,
            contentMode: 'snippet',
            authority: authorityFor(result.link),
          };
        }
      }),
    );
    enriched.push(...rows);
  }
  return [...enriched, ...results.slice(4)];
}
