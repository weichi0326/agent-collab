import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { ensureCompatiblePythonServiceMock, executeToolMock, recordMasterMock } =
  vi.hoisted(() => ({
    ensureCompatiblePythonServiceMock: vi.fn(),
    executeToolMock: vi.fn(),
    recordMasterMock: vi.fn(),
  }));

vi.mock('./pythonClient', () => ({
  ensureCompatiblePythonService: ensureCompatiblePythonServiceMock,
  executeTool: executeToolMock,
  unwrapToolResult: (res: { ok: boolean; result?: unknown; error?: string }, fallback: string) => {
    if (!res.ok) throw new Error(res.error || fallback);
    return res.result;
  },
}));

vi.mock('./modelEndpoint', () => ({
  validateModelBaseUrl: vi.fn(async (baseURL: string) => baseURL),
}));

vi.mock('../stores/tokenStatsStore', () => ({
  useTokenStatsStore: {
    getState: () => ({ recordMaster: recordMasterMock }),
  },
}));

describe('llmClient Python model proxy', () => {
  beforeEach(() => {
    ensureCompatiblePythonServiceMock.mockReset();
    ensureCompatiblePythonServiceMock.mockResolvedValue(undefined);
    executeToolMock.mockReset();
    recordMasterMock.mockReset();
  });

  it('lists models through llm-calling instead of a direct model request', async () => {
    executeToolMock.mockResolvedValue({
      ok: true,
      result: { models: ['model-a', 'model-b'] },
    });
    const { listModels } = await import('./llmClient');

    await expect(listModels({
      api: 'openai',
      baseURL: 'https://api.example.test/v1/',
      apiKey: 'key',
    })).resolves.toEqual(['model-a', 'model-b']);

    expect(ensureCompatiblePythonServiceMock).toHaveBeenCalledOnce();
    expect(executeToolMock).toHaveBeenCalledWith(
      'llm-calling',
      {
        action: 'list_models',
        api: 'openai',
        base_url: 'https://api.example.test/v1',
        api_key: 'key',
      },
      expect.any(AbortSignal),
    );
  });

  it('preserves Anthropic chat payloads while using llm-calling', async () => {
    executeToolMock.mockResolvedValue({
      ok: true,
      result: { reply: 'ok', usage: { total: 2 } },
    });
    const { chat } = await import('./llmClient');

    await expect(chat({
      cfg: { api: 'anthropic', baseURL: 'https://api.example.test', apiKey: 'key' },
      model: 'claude-test',
      system: 'system prompt',
      text: 'hello',
      images: [{ mediaType: 'image/png', base64: 'abc' }],
      history: [{ role: 'assistant', content: 'previous' }],
      scene: 'master-reply',
    })).resolves.toBe('ok');

    expect(executeToolMock).toHaveBeenCalledWith(
      'llm-calling',
      expect.objectContaining({
        api: 'anthropic',
        base_url: 'https://api.example.test',
        api_key: 'key',
        model: 'claude-test',
        max_tokens: 30000,
        system: [{
          type: 'text',
          text: 'system prompt',
          cache_control: { type: 'ephemeral' },
        }],
        messages: [
          { role: 'assistant', content: 'previous' },
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'abc' },
              },
              { type: 'text', text: 'hello' },
            ],
          },
        ],
      }),
      expect.any(AbortSignal),
    );
    expect(recordMasterMock).toHaveBeenCalledWith(
      'claude-test',
      2,
      'master-reply',
    );
  });

  it('preserves OpenAI-compatible multimodal messages', async () => {
    executeToolMock.mockResolvedValue({
      ok: true,
      result: { reply: 'ok', usage: { total: 3 } },
    });
    const { chat } = await import('./llmClient');

    await chat({
      cfg: { api: 'openai', baseURL: 'https://api.example.test/v1', apiKey: 'key' },
      model: 'gpt-test',
      system: 'system prompt',
      text: 'hello',
      images: [{ mediaType: 'image/jpeg', base64: 'xyz' }],
      history: [{ role: 'user', content: 'previous' }],
      scene: 'turn-plan',
    });

    expect(executeToolMock).toHaveBeenCalledWith(
      'llm-calling',
      expect.objectContaining({
        api: 'openai',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'previous' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello' },
              {
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,xyz' },
              },
            ],
          },
        ],
      }),
      expect.any(AbortSignal),
    );
  });

  it('has no direct external model HTTP client import', () => {
    const source = readFileSync(new URL('./llmClient.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('@tauri-apps/plugin-http');
    expect(source).not.toContain('tauriFetch');
  });
});
