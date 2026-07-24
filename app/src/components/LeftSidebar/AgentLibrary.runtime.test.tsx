import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentLibrary } from './AgentLibrary';

describe('AgentLibrary runtime render', () => {
  it('renders professional package agents without throwing', () => {
    const html = renderToString(<AgentLibrary />);

    expect(html).toContain('aria-controls="agent-group-fictionist"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="agent-group-fictionist"');
  });
});
