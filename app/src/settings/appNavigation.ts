import { useUiStore, type AppView } from '../stores/uiStore';

export interface AppViewTransition {
  currentView: AppView;
  nextView: AppView;
}

export type AppViewGuard = (
  transition: AppViewTransition,
) => boolean | Promise<boolean>;

let activeGuard: AppViewGuard | null = null;

export function registerAppViewGuard(guard: AppViewGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

export async function requestAppView(nextView: AppView): Promise<boolean> {
  const currentView = useUiStore.getState().view;
  if (currentView === nextView) return true;

  if (activeGuard) {
    try {
      if (!(await activeGuard({ currentView, nextView }))) return false;
    } catch {
      return false;
    }
  }

  useUiStore.getState().setView(nextView);
  return true;
}
