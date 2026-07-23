import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

import { clearProjectStorageData } from './tauriStorage';

describe('clearProjectStorageData', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it('clears dynamic fictionist files through the controlled cleanup command', async () => {
    await clearProjectStorageData();

    expect(invokeMock).toHaveBeenCalledWith('clear_selected_app_data', {
      input: { itemIds: ['fictionist'] },
    });
  });
});
