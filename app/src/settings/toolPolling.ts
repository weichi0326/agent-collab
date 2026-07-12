export function startToolStatusPolling(
  check: () => void | Promise<void>,
  intervalMs: number,
): () => void {
  let disposed = false;
  let checking = false;

  const runCheck = () => {
    if (disposed || checking) return;

    checking = true;
    try {
      const result = check();
      if (result) {
        void Promise.resolve(result)
          .catch(() => undefined)
          .finally(() => {
            checking = false;
          });
      } else {
        checking = false;
      }
    } catch {
      checking = false;
    }
  };

  runCheck();
  const timer = setInterval(runCheck, intervalMs);
  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
