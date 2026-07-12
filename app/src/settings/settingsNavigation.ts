import type { AppView } from '../stores/uiStore';

export function requiresSettingsLeaveConfirmation(dirty: boolean): boolean {
  return dirty;
}

export function canAutoNavigateToWorkspace(
  view: AppView,
  settingsDirty: boolean,
): boolean {
  return view !== 'settings' || !settingsDirty;
}
