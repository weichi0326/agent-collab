/**
 * 超时与外部 AbortSignal 的合并工具（M1 重构）。
 * 原先 llmClient.ts / searchClient.ts / pythonClient.ts 各自实现了相同逻辑，
 * 现统一到此处。
 */

/**
 * 创建一个合并了内置超时和外部 AbortSignal 的新 AbortSignal。
 * 任一触发（超时到达或外部 abort）都会中止请求。
 *
 * @param ms        超时毫秒数
 * @param external  可选的外部 AbortSignal（如来自用户点击"停止"的控制器）
 * @returns         `signal`：传给 fetch 的合并信号；`done`：请求完成后必须调用的清理函数
 */
export function createTimeoutSignal(
  ms: number,
  external?: AbortSignal,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener('abort', onAbort);
    }
  }

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    },
  };
}
