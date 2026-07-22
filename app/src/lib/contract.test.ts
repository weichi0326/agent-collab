// P1-4 契约测试(单一守门人):跨语言比对前后端契约,任一端漂移即红。
// 不引入运行时共享文件,而是把「一致性」固化成测试——各端保留各自定义,
// 这里 readFileSync 解析源文件并断言四轴一致:
//   1. 工具名   :TOOL_REGISTRY(toolRegistry.ts) ↔ BUILTIN_META(dynamic.py)
//   2. 服务版本 :EXPECTED_PYTHON_SERVICE_VERSION(pythonClient.ts) ↔ LLM_CALLING_VERSION(llm_calling.py)
//   3. 网络权限 :tauri.conf connect-src ↔ capabilities http allow;且前端会请求的 LLM/搜索域名都被放行
//   4. 模型策略 :providers.ts 的地址符合模型端点规则，Python LLM 调用使用共享网络策略
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseModelBaseUrl } from './modelEndpoint';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

const toolRegistrySrc = read('./toolRegistry.ts');
const providersSrc = read('./providers.ts');
const searchClientSrc = read('./searchClient.ts');
const pythonClientSrc = read('./pythonClient.ts');
const dynamicSrc = read('../../../python/tools/dynamic.py');
const llmCallingSrc = read('../../../python/tools/llm_calling.py');
const agentNodeCapabilitiesSrc = read('./agentNodeCapabilities.ts');
const networkPolicySrc = read('../../../python/network_policy.py');
const tauriConf = JSON.parse(read('../../src-tauri/tauri.conf.json'));
const capabilities = JSON.parse(read('../../src-tauri/capabilities/default.json'));

/** host 归一:去 scheme、去 /* 与路径,保留端口(http://localhost:18081/* → localhost:18081)。 */
function toHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}
function capture(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[1]);
}

// ── 工具名 ──
const feToolNames = new Set(capture(toolRegistrySrc, /value: '([a-z0-9-]+)'/g));
const pyToolNames = new Set(capture(dynamicSrc, /\{"name": "([a-z0-9-]+)"/g));

// ── 服务版本 ──
const expectedVer = capture(
  pythonClientSrc,
  /EXPECTED_PYTHON_SERVICE_VERSION\s*=\s*'([^']+)'/g,
)[0];
const llmVer = capture(llmCallingSrc, /LLM_CALLING_VERSION\s*=\s*"([^"]+)"/g)[0];

// ── 前端会请求的域名 ──
const feLlmUrls = new Set(capture(providersSrc, /baseURL: '(https:\/\/[^']+)'/g));
const feLlmHosts = new Set([...feLlmUrls].map(toHost));
const feSearchHosts = new Set(
  capture(searchClientSrc, /(https:\/\/[a-z0-9.-]+)/g).map(toHost),
);

// ── Tauri 允许域名(两份 allow-list)──
const csp: string = tauriConf.app.security.csp;
const connectSeg = csp.split(';').find((s: string) => s.includes('connect-src')) ?? '';
const connectHosts = new Set(capture(connectSeg, /(https?:\/\/[^\s]+)/g).map(toHost));
const connectAllowsAllHttps = /(?:^|\s)https:(?:\s|$)/.test(connectSeg);

interface HttpPerm {
  identifier: string;
  allow: { url: string }[];
}
const httpPerm = (capabilities.permissions as unknown[]).find(
  (p): p is HttpPerm =>
    typeof p === 'object' && p !== null && (p as HttpPerm).identifier === 'http:default',
);
const capHosts = new Set((httpPerm?.allow ?? []).map((a) => toHost(a.url)));
const capAllowsAllHttps = capHosts.has('*');

describe('契约:解析非空守卫(防空集互等的假通过)', () => {
  it('各源都解析出预期数量', () => {
    expect(feToolNames.size).toBe(5);
    expect(pyToolNames.size).toBe(5);
    expect(feLlmHosts.size).toBe(13);
    expect(feSearchHosts.size).toBe(3);
    expect(connectHosts.size).toBeGreaterThan(0);
    expect(capHosts.size).toBeGreaterThan(0);
    expect(networkPolicySrc).toContain('def validate_model_base_url');
    expect(expectedVer).toBeTruthy();
    expect(llmVer).toBeTruthy();
  });
});

describe('契约:前后端工具名一致', () => {
  it('TOOL_REGISTRY 与 dynamic.BUILTIN_META 工具名集合相同', () => {
    expect([...feToolNames].sort()).toEqual([...pyToolNames].sort());
  });
});

describe('契约:服务版本握手一致', () => {
  it('EXPECTED_PYTHON_SERVICE_VERSION === LLM_CALLING_VERSION', () => {
    expect(expectedVer).toEqual(llmVer);
  });
});

describe('契约:Tauri 两份允许域名 lockstep', () => {
  it('connect-src(prod) 与 capabilities http allow 的 host 集合相同', () => {
    expect(connectAllowsAllHttps).toBe(true);
    expect(capAllowsAllHttps).toBe(true);
    expect([...connectHosts].sort()).toEqual(
      [...capHosts].filter((host) => host !== '*').sort(),
    );
  });
});

describe('契约:前端会请求的域名都被放行', () => {
  const feAll = [...feLlmHosts, ...feSearchHosts];
  it.each(feAll)('%s 在 connect-src 中', (h) => {
    expect(connectHosts.has(h)).toBe(true);
  });
  it.each(feAll)('%s 在 capabilities 中', (h) => {
    expect(capAllowsAllHttps || capHosts.has(h)).toBe(true);
  });
});

describe('契约:模型输出 token 上限一致', () => {
  it('前端可配置上限与 Python 实际请求上限相同', () => {
    const frontendLimit = capture(
      agentNodeCapabilitiesSrc,
      /NODE_MAX_TOKENS_MAX\s*=\s*([\d_]+)/g,
    )[0];
    const pythonLimit = capture(
      llmCallingSrc,
      /MAX_TOKENS_LIMIT\s*=\s*([\d_]+)/g,
    )[0];

    expect(frontendLimit).toBeTruthy();
    expect(Number(pythonLimit.replaceAll('_', ''))).toEqual(
      Number(frontendLimit.replaceAll('_', '')),
    );
  });
});

describe('契约:模型端点使用共享公网策略', () => {
  it.each([...feLlmUrls])('%s 符合模型端点 URL 规则', (url) => {
    expect(() => parseModelBaseUrl(url)).not.toThrow();
  });

  it('Python LLM 调用使用共享网络策略而非域名白名单', () => {
    expect(llmCallingSrc).toContain(
      'from network_policy import validate_model_base_url as _validate_base_url',
    );
    expect(llmCallingSrc).toContain('base_url = _validate_base_url(base_url_raw)');
    expect(llmCallingSrc).not.toContain('_ALLOWED_DOMAINS');
  });
});
