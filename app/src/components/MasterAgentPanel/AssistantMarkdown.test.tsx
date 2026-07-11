import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from './AssistantMarkdown';

describe('AssistantMarkdown', () => {
  it('renders GFM structure and safe external links', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        content={'## 标题\n\n- 列表\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[官网](https://example.com)'}
      />,
    );

    expect(html).toContain('<h2>标题</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });

  it('does not render raw HTML or unsafe links', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown content={'<script>alert(1)</script>\n\n[危险](javascript:alert(1))'} />,
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });
});
