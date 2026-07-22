import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../stores/uiStore';
import { registerAppViewGuard, requestAppView } from './appNavigation';

const cleanups: Array<() => void> = [];
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});

beforeEach(() => {
  storage.clear();
  useUiStore.setState({ view: 'workspace' });
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe('app navigation', () => {
  it('navigates immediately when no guard is registered', async () => {
    await expect(requestAppView('reports')).resolves.toBe(true);
    expect(useUiStore.getState().view).toBe('reports');
  });

  it('navigates when the active guard allows leaving', async () => {
    cleanups.push(registerAppViewGuard(async ({ currentView, nextView }) => {
      expect(currentView).toBe('workspace');
      expect(nextView).toBe('fictionist');
      return true;
    }));

    await expect(requestAppView('fictionist')).resolves.toBe(true);
    expect(useUiStore.getState().view).toBe('fictionist');
  });

  it('keeps the current view when the active guard rejects leaving', async () => {
    cleanups.push(registerAppViewGuard(() => false));

    await expect(requestAppView('settings')).resolves.toBe(false);
    expect(useUiStore.getState().view).toBe('workspace');
  });

  it('keeps the current view when the active guard throws', async () => {
    cleanups.push(registerAppViewGuard(() => {
      throw new Error('save failed');
    }));

    await expect(requestAppView('settings')).resolves.toBe(false);
    expect(useUiStore.getState().view).toBe('workspace');
  });

  it('stops consulting a guard after it is unregistered', async () => {
    const unregister = registerAppViewGuard(() => false);
    unregister();

    await expect(requestAppView('settings')).resolves.toBe(true);
    expect(useUiStore.getState().view).toBe('settings');
  });
});
