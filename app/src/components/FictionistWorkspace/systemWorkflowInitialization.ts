import {
  ensureFictionistSystemWorkflows as reconcileFictionistSystemWorkflows,
} from '../../features/fictionist/systemWorkflows';
import { useCanvasStore } from '../../stores/canvasStore';

export function ensureFictionistSystemWorkflows(): void {
  reconcileFictionistSystemWorkflows();
}

/**
 * Waits for persisted canvases before installing package templates. Registering
 * first and checking second closes the race where hydration finishes between
 * those two operations.
 */
export function subscribeFictionistWorkflowInitialization(): () => void {
  let active = true;
  const initialize = () => {
    if (active) ensureFictionistSystemWorkflows();
  };
  const unsubscribe = useCanvasStore.persist.onFinishHydration(initialize);
  if (useCanvasStore.persist.hasHydrated()) initialize();
  return () => {
    active = false;
    unsubscribe();
  };
}
