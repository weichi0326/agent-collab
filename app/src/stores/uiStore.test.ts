import { beforeEach, describe, expect, it } from 'vitest';
import { JIZI_MIN, JIZI_MAX, partializeUiState, useUiStore } from './uiStore';

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
      workspaceReturn: null,
      fictionistEntrySection: null,
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

  it('keeps workflow canvas return context transient', () => {
    useUiStore.getState().setWorkspaceReturn({
      target: 'fictionist-workflows',
      canvasId: 'canvas-workflow-1',
    });
    useUiStore.getState().setFictionistEntrySection('workflows');

    expect(useUiStore.getState().workspaceReturn?.canvasId).toBe('canvas-workflow-1');
    expect(useUiStore.getState().fictionistEntrySection).toBe('workflows');

    const persisted = partializeUiState(useUiStore.getState());
    expect(persisted).not.toHaveProperty('workspaceReturn');
    expect(persisted).not.toHaveProperty('fictionistEntrySection');
  });
});

describe('uiStore jizi placement', () => {
  beforeEach(() => {
    storage.clear();
    useUiStore.setState({
      jiziPlacement: 'top',
      jiziWidth: 360,
      jiziSideCollapsed: false,
    });
  });

  it('defaults to top placement, 360 width, not collapsed', () => {
    expect(useUiStore.getState().jiziPlacement).toBe('top');
    expect(useUiStore.getState().jiziWidth).toBe(360);
    expect(useUiStore.getState().jiziSideCollapsed).toBe(false);
  });

  it('switches placement and toggles collapse', () => {
    useUiStore.getState().setJiziPlacement('side');
    useUiStore.getState().setJiziSideCollapsed(true);
    expect(useUiStore.getState().jiziPlacement).toBe('side');
    expect(useUiStore.getState().jiziSideCollapsed).toBe(true);
  });

  it('clamps jizi width to [JIZI_MIN, JIZI_MAX]', () => {
    useUiStore.getState().setJiziWidth(10);
    expect(useUiStore.getState().jiziWidth).toBe(JIZI_MIN);
    useUiStore.getState().setJiziWidth(99999);
    expect(useUiStore.getState().jiziWidth).toBe(JIZI_MAX);
  });

  it('persists placement, width and collapse preference', () => {
    const persisted = partializeUiState({
      ...useUiStore.getState(),
      jiziPlacement: 'side',
      jiziWidth: 400,
      jiziSideCollapsed: true,
    });
    expect(persisted.jiziPlacement).toBe('side');
    expect(persisted.jiziWidth).toBe(400);
    expect(persisted.jiziSideCollapsed).toBe(true);
  });
});
