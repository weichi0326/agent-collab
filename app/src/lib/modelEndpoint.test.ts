import { describe, expect, it } from 'vitest';
import { parseModelBaseUrl } from './modelEndpoint';

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
});
