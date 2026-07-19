import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('onboarding integration', () => {
  it('hydrates and mounts onboarding with the application shell', () => {
    const app = source('../../App.tsx');
    const storage = source('../../lib/tauriStorage.ts');
    expect(app).toContain('useOnboardingStore');
    expect(app).toContain('<OnboardingController />');
    expect(storage).toContain("'multi-agent-onboarding'");
  });

  it('exposes stable targets for setup and the real canvas workflow', () => {
    const settingsCenter = source('../SettingsCenter/SettingsCenter.tsx');
    const combined = [
      settingsCenter,
      source('../ModelConfigModal.tsx'),
      source('../ModelConfigModal/ModelList.tsx'),
      source('../LeftSidebar/AgentLibrary.tsx'),
      source('../CanvasArea.tsx'),
      source('../PropertiesPanel.tsx'),
      source('../TitleBar.tsx'),
      source('../MasterAgentDrawer.tsx'),
    ].join('\n');

    [
      'settings-models',
      'settings-search',
      'settings-tools',
      'settings-jizi',
    ].forEach((target) => {
      expect(settingsCenter).toContain(`'${target}'`);
    });
    expect(settingsCenter).toContain('data-onboarding={');

    [
      'model-provider-list',
      'model-credentials',
      'model-list',
      'model-test',
      'canvas-surface',
      'properties-panel',
      'canvas-save',
      'canvas-run',
      'jizi-entry',
      'jizi-panel',
    ].forEach((target) => {
      expect(combined).toContain(`data-onboarding="${target}"`);
    });
    expect(combined).toContain('data-agent-id={a.id}');
  });

  it('provides a help button that can restart onboarding', () => {
    const titleBar = source('../TitleBar.tsx');
    expect(titleBar).toContain('QuestionCircleOutlined');
    expect(titleBar).toContain("restart('welcome')");
    expect(titleBar).toContain('新手引导');
  });

  it('hides the tour while the skip confirmation modal is open', () => {
    const controller = source('./OnboardingController.tsx');
    expect(controller).toContain(
      "surface === 'tour' && !skipConfirmOpen",
    );
  });

  it('centers the welcome modal in the viewport', () => {
    const controller = source('./OnboardingController.tsx');
    expect(controller).toMatch(/centered\s+width=\{960\}/);
  });

  it('uses the current Ant Design mask API without browser warnings', () => {
    const controller = source('./OnboardingController.tsx');
    expect(controller).not.toContain('maskClosable');
    expect(controller).toContain('mask={{ closable: false }}');
  });

  it('blocks interactions outside the current guided regions', () => {
    const controller = source('./OnboardingController.tsx');
    expect(controller).toContain("document.addEventListener('click'");
    expect(controller).toContain('event.preventDefault()');
    expect(controller).toContain('event.stopPropagation()');
  });

  it('does not intercept the native drag chain between an allowed card and canvas', () => {
    const controller = source('./OnboardingController.tsx');
    expect(controller).not.toContain("'dragstart'");
    expect(controller).not.toContain("'dragover'");
    expect(controller).not.toContain("'drop'");
  });

  it('uses a pointer-transparent visual mask for every guided step', () => {
    const controller = source('./OnboardingController.tsx');
    expect(controller).toContain('<OnboardingInteractionMask');
    expect(controller).toContain('mask={false}');
    expect(controller).toContain('tourOpen && (');
  });
});
