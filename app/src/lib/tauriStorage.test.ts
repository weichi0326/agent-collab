import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

import { clearProjectStorageData, PROJECT_STORAGE_KEYS } from './tauriStorage';

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

  it('clears persisted workflow policies with the other project stores', async () => {
    expect(PROJECT_STORAGE_KEYS).toContain('multi-agent-workflow-policies');

    await clearProjectStorageData();

    expect(invokeMock).toHaveBeenCalledWith('storage_remove', {
      key: 'multi-agent-workflow-policies',
    });
  });
});
