import { afterEach, describe, expect, it, vi } from 'vitest';
import { startToolStatusPolling } from './toolPolling';

describe('startToolStatusPolling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks immediately and stops polling when disposed', () => {
    vi.useFakeTimers();
    const check = vi.fn();

    const dispose = startToolStatusPolling(check, 3000);
    vi.advanceTimersByTime(6000);
    dispose();
    vi.advanceTimersByTime(6000);

    expect(check).toHaveBeenCalledTimes(3);
  });

  it('does not overlap slow asynchronous checks', async () => {
    vi.useFakeTimers();
    let resolveFirst: (() => void) | undefined;
    const firstCheck = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const check = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstCheck)
      .mockResolvedValue(undefined);

    const dispose = startToolStatusPolling(check, 3000);
    vi.advanceTimersByTime(6000);

    expect(check).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await firstCheck;
    await Promise.resolve();
    vi.advanceTimersByTime(3000);

    expect(check).toHaveBeenCalledTimes(2);
    dispose();
  });

});
