// 全局运行中止注册表:key = 传给 runCanvas 的源画布 id(与 incident.canvasId 一致)。
// runCanvas 只拿到 signal、无法自注册,故由持有 AbortController 的调用方(TitleBar 手动运行)
// 在启动运行时注册、结束时注销;编排层「忽略」失败节点时据此停止对应画布运行。
// 姬子自愈重跑会把 incident 置为 repairing(不进问题列表、不可被忽略),故此表只需覆盖手动运行。
const runControllers = new Map<string, AbortController>();

export function registerRunController(canvasId: string, controller: AbortController): void {
  runControllers.set(canvasId, controller);
}

// 仅当登记的仍是同一个 controller 时才注销,避免误删后一次运行注册的新 controller。
export function unregisterRunController(canvasId: string, controller: AbortController): void {
  if (runControllers.get(canvasId) === controller) runControllers.delete(canvasId);
}

// 中止指定源画布正在进行的运行;有活跃运行并已发出中止返回 true,否则(已结束/未注册)返回 false。
export function abortRunByCanvasId(canvasId: string): boolean {
  const controller = runControllers.get(canvasId);
  if (!controller) return false;
  controller.abort();
  return true;
}
