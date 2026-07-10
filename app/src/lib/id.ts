// 生成带前缀的唯一 id:前缀 + 时间戳 + 随机数,足以在单端本地场景避免碰撞。
export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}
