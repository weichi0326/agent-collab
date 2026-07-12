import { describe, expect, it } from 'vitest';
import {
  appViewLabel,
  workspaceInteractionState,
  workspaceLayerState,
} from './appView';

describe('workspace layer state', () => {
  it('keeps the workspace mounted but inert under settings', () => {
    expect(workspaceLayerState('settings')).toEqual({
      mounted: true,
      inert: true,
    });
    expect(workspaceLayerState('workspace')).toEqual({
      mounted: true,
      inert: false,
    });
  });

  it('keeps the existing report view isolated from the workspace', () => {
    expect(workspaceLayerState('reports')).toEqual({
      mounted: false,
      inert: false,
    });
  });

  it('labels settings as a first-class application view', () => {
    expect(appViewLabel('workspace')).toBe('工作台');
    expect(appViewLabel('reports')).toBe('报告中心');
    expect(appViewLabel('settings')).toBe('设置');
  });

  it('disables global canvas keyboard behavior outside the workspace', () => {
    expect(workspaceInteractionState('workspace')).toEqual({
      hotkeysEnabled: true,
      deleteKeyCode: ['Delete', 'Backspace'],
    });
    expect(workspaceInteractionState('settings')).toEqual({
      hotkeysEnabled: false,
      deleteKeyCode: null,
    });
    expect(workspaceInteractionState('reports')).toEqual({
      hotkeysEnabled: false,
      deleteKeyCode: null,
    });
  });
});
