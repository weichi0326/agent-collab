import { sanitizePathSegment } from '../pathNames';

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return '未知错误';
}

export function dateFromDateTime(value?: string): Date | undefined {
  const match = value?.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const d = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

// 可中断等待:到点 resolve;signal.abort 时清定时器并抛 AbortError(走既有 isAbortError catch)。
// 定时节点倒计时用它,否则点「停止运行」后节点会空转到计时结束。
export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function safeFileName(name: string): string {
  return sanitizePathSegment(name, 48, 'agent');
}

export function joinPath(root: string, ...parts: string[]): string {
  const sep = root.includes('/') && !root.includes('\\') ? '/' : '\\';
  const normalizedParts = parts.flatMap((p) =>
    p
      .split(/[\\/]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
  return [root.replace(/[\\/]+$/, ''), ...normalizedParts].join(sep);
}

export function compactText(value: string, max = 90): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function markdownToParagraphs(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\d+[.)]\s+/, '')
        .trim(),
    )
    .filter(Boolean);
}

export function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export function tableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    if (Array.isArray(row)) return row.map((cell) => String(cell ?? ''));
    return [String(row ?? '')];
  });
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
