import { pad, stamp } from '../../lib/time';
import { uid } from '../../lib/id';
import type { Canvas, SavedCanvas } from './types';

function letterFromIndex(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    x--;
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

function indexFromLetters(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function nextDefaultName(canvases: Canvas[]): string {
  const used = canvases
    .map((c) => {
      const m = c.name.match(/^画布([A-Z]+)$/);
      return m ? indexFromLetters(m[1]) : -1;
    })
    .filter((i) => i >= 0);
  const max = used.length ? Math.max(...used) : -1;
  return '画布' + letterFromIndex(max + 1);
}

export function makeCanvas(existing: Canvas[]): Canvas {
  return { id: uid('c'), name: nextDefaultName(existing), nodes: [], edges: [] };
}

export function isDefaultCanvasName(name: string): boolean {
  return /^画布[A-Z]+$/.test(name.trim());
}

// 统一的画布命名校验:所有命名入口(首次保存/另存为/关闭前保存/重命名已保存画布)共用。
// 重命名场景传 excludeSavedId 以排除自身,避免与自己重名报错。
export function validateCanvasName(
  name: string,
  savedCanvases: SavedCanvas[],
  opts?: { excludeSavedId?: string },
): { ok: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: '请输入画布名称' };
  if (isDefaultCanvasName(trimmed)) {
    return { ok: false, error: '请改成自定义名称,不能直接使用默认名' };
  }
  const clash = savedCanvases.some(
    (sc) => sc.id !== opts?.excludeSavedId && sc.name === trimmed,
  );
  if (clash) return { ok: false, error: '已存在同名画布,请换一个名称' };
  return { ok: true };
}

function safeOutputPathSegment(name: string, max = 72): string {
  const cleaned = Array.from(name)
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, max);
  return cleaned || 'untitled';
}

function outputCanvasFolderName(canvasName: string, d: Date): string {
  const cleaned = safeOutputPathSegment(canvasName, 96);
  return /_\d{14}$/.test(cleaned) ? cleaned : `${cleaned}_${stamp(d)}`;
}

export function outputFolderName(
  canvasName: string,
  agentName: string,
  d: Date = new Date(),
): string {
  const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const day = `${month}-${pad(d.getDate())}`;
  return [
    month,
    day,
    outputCanvasFolderName(canvasName, d),
    safeOutputPathSegment(agentName),
  ].join('/');
}
