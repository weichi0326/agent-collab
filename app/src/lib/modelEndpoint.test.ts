import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseModelBaseUrl } from './modelEndpoint';

const policyCases = JSON.parse(
  readFileSync(
    new URL('../../../security/ssrf-policy-cases.json', import.meta.url),
    'utf8',
  ),
) as { modelBaseUrls: Array<{ url: string; allowed: boolean }> };

describe('parseModelBaseUrl', () => {
  it('allows public HTTPS and explicit local services', () => {
    expect(parseModelBaseUrl('https://llm.example.com/v1').baseURL).toBe(
      'https://llm.example.com/v1',
    );
    expect(parseModelBaseUrl('http://localhost:11434/v1').local).toBe(true);
    expect(parseModelBaseUrl('http://127.0.0.1:8000/v1').local).toBe(true);
  });

  it('rejects public HTTP and private or credential-bearing URLs', () => {
    expect(() => parseModelBaseUrl('http://llm.example.com/v1')).toThrow('HTTPS');
    expect(() => parseModelBaseUrl('https://192.168.1.10/v1')).toThrow('私网');
    expect(() => parseModelBaseUrl('https://user:pass@llm.example.com/v1')).toThrow(
      '用户名或密码',
    );
    expect(() => parseModelBaseUrl('https://llm.example.com/v1?token=secret')).toThrow(
      '查询参数',
    );
  });

  it('matches the shared model endpoint policy cases', () => {
    for (const item of policyCases.modelBaseUrls) {
      const parse = () => parseModelBaseUrl(item.url);
      if (item.allowed) expect(parse, item.url).not.toThrow();
      else expect(parse, item.url).toThrow();
    }
  });
});
