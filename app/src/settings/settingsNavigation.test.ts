import { describe, expect, it } from 'vitest';
import {
  canAutoNavigateToWorkspace,
  requiresSettingsLeaveConfirmation,
} from './settingsNavigation';

describe('settings navigation decisions', () => {
  it('requires confirmation only for an unsaved active draft', () => {
    expect(requiresSettingsLeaveConfirmation(true)).toBe(true);
    expect(requiresSettingsLeaveConfirmation(false)).toBe(false);
  });

  it('prevents non-UI navigation from bypassing a dirty settings draft', () => {
    expect(canAutoNavigateToWorkspace('settings', true)).toBe(false);
    expect(canAutoNavigateToWorkspace('settings', false)).toBe(true);
    expect(canAutoNavigateToWorkspace('workspace', true)).toBe(true);
  });
});
