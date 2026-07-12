import { beforeEach, describe, expect, it } from 'vitest';
import { partializeUiState, useUiStore } from './uiStore';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});

describe('uiStore drawer display mode', () => {
  beforeEach(() => {
    storage.clear();
    useUiStore.setState({
      drawerExpanded: false,
      drawerFullscreen: false,
      view: 'workspace',
      settingsSection: 'models',
      settingsDirty: false,
    });
  });

  it('defaults to half height and updates fullscreen mode explicitly', () => {
    expect(useUiStore.getState().drawerFullscreen).toBe(false);

    useUiStore.getState().setDrawerFullscreen(true);

    expect(useUiStore.getState().drawerFullscreen).toBe(true);
  });

  it('persists fullscreen preference but not expanded state', () => {
    const persisted = partializeUiState({
      ...useUiStore.getState(),
      drawerExpanded: true,
      drawerFullscreen: true,
    });

    expect(persisted.drawerFullscreen).toBe(true);
    expect(persisted).not.toHaveProperty('drawerExpanded');
  });

  it('tracks settings navigation during the current session', () => {
    useUiStore.getState().setView('settings');
    useUiStore.getState().setSettingsSection('tools');
    useUiStore.getState().setSettingsDirty(true);

    expect(useUiStore.getState().view).toBe('settings');
    expect(useUiStore.getState().settingsSection).toBe('tools');
    expect(useUiStore.getState().settingsDirty).toBe(true);
  });

  it('does not persist settings navigation state', () => {
    const persisted = partializeUiState({
      ...useUiStore.getState(),
      view: 'settings',
      settingsSection: 'tools',
      settingsDirty: true,
    });

    expect(persisted).not.toHaveProperty('view');
    expect(persisted).not.toHaveProperty('settingsSection');
    expect(persisted).not.toHaveProperty('settingsDirty');
  });
});
