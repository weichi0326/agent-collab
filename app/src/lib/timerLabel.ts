// 定时节点时长格式化:秒 → HH:MM:SS,用于画布节点名与属性面板名称同步。
export function formatTimerLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
