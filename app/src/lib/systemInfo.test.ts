import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

import {
  FRONTEND_VERSION,
  TAURI_VERSION,
  clearSelectedAppData,
  formatByteSize,
  formatDirectoryUsage,
  openSystemDirectory,
  readableSystemError,
  scanCleanableAppData,
} from './systemInfo';

describe('formatByteSize', () => {
  it('formats byte counts for the storage overview', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(1536)).toBe('1.5 KB');
    expect(formatByteSize(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('marks bounded or failed directory scans as incomplete', () => {
    expect(formatDirectoryUsage({ bytes: 1536, complete: true, detail: null })).toBe('1.5 KB');
    expect(formatDirectoryUsage({ bytes: 1536, complete: false, detail: '达到扫描上限' })).toBe('至少 1.5 KB');
  });

  it('preserves string errors returned by Tauri commands', () => {
    expect(readableSystemError('目录无权限', '打开失败')).toBe('目录无权限');
    expect(readableSystemError(new Error('后台离线'), '重启失败')).toBe('后台离线');
    expect(readableSystemError(null, '重启失败')).toBe('重启失败');
  });

  it('opens only an enumerated system directory kind', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await openSystemDirectory('log');

    expect(invokeMock).toHaveBeenCalledWith('open_system_directory', { kind: 'log' });
  });

  it('scans cleanable app data through the categorized command', async () => {
    invokeMock.mockResolvedValueOnce({ items: [] });

    await scanCleanableAppData();

    expect(invokeMock).toHaveBeenCalledWith('scan_cleanable_app_data');
  });

  it('clears selected app data categories through the selective command', async () => {
    invokeMock.mockResolvedValueOnce({ cleared: ['outputs', 'logs'] });

    await clearSelectedAppData(['outputs', 'logs']);

    expect(invokeMock).toHaveBeenCalledWith('clear_selected_app_data', {
      input: { itemIds: ['outputs', 'logs'] },
    });
  });

  it('keeps displayed frontend and Tauri versions synchronized with manifests', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    const cargoToml = readFileSync(
      new URL('../../src-tauri/Cargo.toml', import.meta.url),
      'utf8',
    );
    const tauriVersion = cargoToml.match(/tauri = \{ version = "([^"]+)"/u)?.[1];

    expect(FRONTEND_VERSION).toBe(packageJson.version);
    expect(TAURI_VERSION).toBe(tauriVersion);
  });
});
