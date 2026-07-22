import { invoke, isTauri } from '@tauri-apps/api/core';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const validatedOrigins = new Map<string, Promise<void>>();

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isForbiddenIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isForbiddenIpv6(hostname: string): boolean {
  if (!hostname.includes(':')) return false;
  const lower = hostname.toLowerCase();
  const nat64 = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (nat64) {
    const high = Number.parseInt(nat64[1], 16);
    const low = Number.parseInt(nat64[2], 16);
    return isForbiddenIpv4(
      `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`,
    );
  }
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith('ff') ||
    lower.startsWith('2001:db8:')
  );
}

export interface ParsedModelBaseUrl {
  baseURL: string;
  hostname: string;
  port: number;
  local: boolean;
  origin: string;
}

export function parseModelBaseUrl(value: string): ParsedModelBaseUrl {
  const raw = value.trim();
  if (!raw) throw new Error('请填写请求接口 URL');
  if (raw.length > 2_048) throw new Error('请求接口 URL 过长');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('请求接口 URL 格式不正确');
  }

  const hostname = normalizedHostname(url.hostname);
  const local = LOCAL_HOSTS.has(hostname);
  if (url.username || url.password) throw new Error('请求接口 URL 不能包含用户名或密码');
  if (url.hash || url.search) throw new Error('请求接口 URL 不能包含查询参数或片段');
  if (!hostname) throw new Error('请求接口 URL 缺少主机名');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('自定义模型仅允许公网 HTTPS 地址；HTTP 只允许 localhost 本地服务');
  }
  if (!local && (isForbiddenIpv4(hostname) || isForbiddenIpv6(hostname))) {
    throw new Error('请求接口不能指向私网、回环、链路本地或保留地址');
  }

  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  return {
    baseURL: raw.replace(/\/+$/, ''),
    hostname,
    port: url.port ? Number(url.port) : defaultPort,
    local,
    origin: url.origin,
  };
}

export async function validateModelBaseUrl(value: string): Promise<string> {
  const parsed = parseModelBaseUrl(value);
  if (!isTauri()) return parsed.baseURL;

  let pending = validatedOrigins.get(parsed.origin);
  if (!pending) {
    pending = invoke<void>('validate_model_host', {
      hostname: parsed.hostname,
      port: parsed.port,
      allowLocal: parsed.local,
    }).catch((error) => {
      validatedOrigins.delete(parsed.origin);
      throw new Error(String(error));
    });
    validatedOrigins.set(parsed.origin, pending);
  }
  await pending;
  if (validatedOrigins.get(parsed.origin) === pending) {
    validatedOrigins.delete(parsed.origin);
  }
  return parsed.baseURL;
}
