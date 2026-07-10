// 本地时间格式化工具。两种粒度:完整日期时间(画布保存/运行记录)与仅时钟(模型测试时刻)。

export const pad = (n: number): string => String(n).padStart(2, '0');

// YYYY-MM-DD HH:MM:SS
export function datetime(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// HH:MM:SS
export function clockTime(d: Date = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// yyyymmddhhmmss(运行记录/只读快照 tab 命名用,紧凑无分隔)
export function stamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
