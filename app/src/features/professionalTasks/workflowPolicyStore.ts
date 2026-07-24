import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../../lib/tauriStorage';

export interface WorkflowPolicy {
  fallbackEnabled: boolean;
}

interface WorkflowPolicyState {
  policies: Record<string, WorkflowPolicy>;
  setFallbackEnabled: (packageId: string, workflowKey: string, enabled: boolean) => void;
  removePackagePolicies: (packageId: string) => void;
}

export function workflowPolicyId(packageId: string, workflowKey: string): string {
  return `${packageId}:${workflowKey}`;
}

export function isWorkflowFallbackEnabled(
  packageId: string,
  workflowKey: string,
  policies = useWorkflowPolicyStore.getState().policies,
): boolean {
  return policies[workflowPolicyId(packageId, workflowKey)]?.fallbackEnabled ?? false;
}

export const useWorkflowPolicyStore = create<WorkflowPolicyState>()(
  persist(
    (set) => ({
      policies: {},
      setFallbackEnabled: (packageId, workflowKey, fallbackEnabled) => set((state) => ({
        policies: {
          ...state.policies,
          [workflowPolicyId(packageId, workflowKey)]: { fallbackEnabled },
        },
      })),
      removePackagePolicies: (packageId) => set((state) => ({
        policies: Object.fromEntries(
          Object.entries(state.policies).filter(([id]) => !id.startsWith(`${packageId}:`)),
        ),
      })),
    }),
    {
      name: 'multi-agent-workflow-policies',
      storage: createProjectStorage(),
      version: 1,
      partialize: (state) => ({ policies: state.policies }),
    },
  ),
);
