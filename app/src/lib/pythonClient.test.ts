import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ''),
  isTauri: () => true,
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fetchMock }));

import { listTools } from './pythonClient';

describe('listTools', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns the successful tool list', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(['file', 'docx']), { status: 200 }));
    await expect(listTools()).resolves.toEqual(['file', 'docx']);
  });

  it('does not disguise HTTP errors as an empty tool list', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(listTools()).rejects.toThrow('工具服务');
  });

  it('rejects a malformed successful response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tools: [] }), { status: 200 }));
    await expect(listTools()).rejects.toThrow('无效的工具列表');
  });
});
