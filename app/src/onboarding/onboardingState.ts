import type { ProviderConfig } from '../stores/modelStore';
import type { Canvas } from '../stores/canvas/types';

export type OnboardingStatus = 'pending' | 'active' | 'completed' | 'skipped';
export type OnboardingStage =
  | 'welcome'
  | 'models'
  | 'capabilities'
  | 'tutorial'
  | 'finish';

export interface OnboardingStateSnapshot {
  status: OnboardingStatus;
  stage: OnboardingStage;
  welcomePage: number;
}

export function createInitialOnboardingState(): OnboardingStateSnapshot {
  return { status: 'pending', stage: 'welcome', welcomePage: 0 };
}

export function canSkipOnboarding(state: OnboardingStateSnapshot): boolean {
  return state.stage !== 'welcome';
}

export function advanceWelcome(
  state: OnboardingStateSnapshot,
): OnboardingStateSnapshot {
  if (state.welcomePage < 2) {
    return { ...state, welcomePage: state.welcomePage + 1 };
  }
  return { ...state, status: 'active', stage: 'models' };
}

export function hasValidatedModel(configs: ProviderConfig[]): boolean {
  return configs.some(
    (config) =>
      (config.test.status === 'ok-low' || config.test.status === 'ok-high') &&
      config.models.some((model) => model.enabled),
  );
}

export interface ModelSetupTargetState {
  credentialsVisible: boolean;
  credentialsConfigId: string | null;
  modelListConfigId: string | null;
}

function successfulModelTest(config: ProviderConfig | undefined): boolean {
  return (
    config?.test.status === 'ok-low' || config?.test.status === 'ok-high'
  );
}

export function canAdvanceModelSetupStep(
  step: number,
  configs: ProviderConfig[],
  targets: ModelSetupTargetState,
): boolean {
  if (step === 0) return true;
  if (step === 1) return targets.credentialsVisible;
  if (step === 2) {
    return configs.some((config) => config.id === targets.credentialsConfigId);
  }

  const selectedConfig = configs.find(
    (config) => config.id === targets.modelListConfigId,
  );
  if (step === 3) {
    return !!selectedConfig?.models.some((model) => model.enabled);
  }
  if (step === 4) return successfulModelTest(selectedConfig);
  return false;
}

export function tutorialMilestones(
  canvas: Canvas | undefined,
  agentIds: [string, string],
) {
  const firstNode = canvas?.nodes.find(
    (node) => node.data?.agentId === agentIds[0],
  );
  const secondNode = canvas?.nodes.find(
    (node) => node.data?.agentId === agentIds[1],
  );
  return {
    firstPlaced: !!firstNode,
    secondPlaced: !!secondNode,
    connected:
      !!firstNode &&
      !!secondNode &&
      !!canvas?.edges.some(
        (edge) => edge.source === firstNode.id && edge.target === secondNode.id,
      ),
    saved: !!canvas?.savedId,
    runSucceeded: canvas?.runState?.status === 'success',
  };
}
