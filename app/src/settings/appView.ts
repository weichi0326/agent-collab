import type { AppView } from '../stores/uiStore';

export interface WorkspaceLayerState {
  mounted: boolean;
  inert: boolean;
}

export interface WorkspaceInteractionState {
  hotkeysEnabled: boolean;
  deleteKeyCode: string[] | null;
}

export function appViewLabel(view: AppView): string {
  if (view === 'fictionist') return '小说家';
  if (view === 'reports') return '报告中心';
  if (view === 'settings') return '设置';
  return '工作台';
}

export function workspaceLayerState(view: AppView): WorkspaceLayerState {
  if (view === 'reports' || view === 'fictionist') {
    return { mounted: false, inert: false };
  }
  return {
    mounted: true,
    inert: view === 'settings',
  };
}

export function workspaceInteractionState(view: AppView): WorkspaceInteractionState {
  const enabled = view === 'workspace';
  return {
    hotkeysEnabled: enabled,
    deleteKeyCode: enabled ? ['Delete', 'Backspace'] : null,
  };
}
