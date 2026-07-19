import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import {
  advanceWelcome,
  canSkipOnboarding,
  createInitialOnboardingState,
  type OnboardingStage,
  type OnboardingStateSnapshot,
} from './onboardingState';

export const ONBOARDING_VERSION = 1;

interface OnboardingStore extends OnboardingStateSnapshot {
  modelStep: number;
  capabilityStep: number;
  tutorialStep: number;
  tutorialCanvasId: string | null;
  tutorialAgentIds: [string, string] | null;
  nextWelcome: () => void;
  setStage: (stage: OnboardingStage) => void;
  setModelStep: (step: number) => void;
  setCapabilityStep: (step: number) => void;
  setTutorialStep: (step: number) => void;
  setTutorialResources: (
    canvasId: string,
    agentIds: [string, string],
  ) => void;
  skip: () => void;
  complete: () => void;
  restart: (stage: OnboardingStage) => void;
}

const initialProgress = {
  ...createInitialOnboardingState(),
  modelStep: 0,
  capabilityStep: 0,
  tutorialStep: 0,
  tutorialCanvasId: null,
  tutorialAgentIds: null,
};

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      ...initialProgress,
      nextWelcome: () => set((state) => advanceWelcome(state)),
      setStage: (stage) => set({ status: 'active', stage }),
      setModelStep: (modelStep) => set({ modelStep }),
      setCapabilityStep: (capabilityStep) => set({ capabilityStep }),
      setTutorialStep: (tutorialStep) => set({ tutorialStep }),
      setTutorialResources: (tutorialCanvasId, tutorialAgentIds) =>
        set({ tutorialCanvasId, tutorialAgentIds }),
      skip: () =>
        set((state) =>
          canSkipOnboarding(state)
            ? {
                status: 'skipped',
                tutorialCanvasId: null,
                tutorialAgentIds: null,
              }
            : state,
        ),
      complete: () =>
        set({
          status: 'completed',
          stage: 'finish',
          tutorialCanvasId: null,
          tutorialAgentIds: null,
        }),
      restart: (stage) =>
        set({
          ...initialProgress,
          status: stage === 'welcome' ? 'pending' : 'active',
          stage,
        }),
    }),
    {
      name: 'multi-agent-onboarding',
      storage: createProjectStorage(),
      version: ONBOARDING_VERSION,
    },
  ),
);
