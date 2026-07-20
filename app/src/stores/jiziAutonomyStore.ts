import { create } from 'zustand';
import type { MasterAction, MasterPlanStep } from '../lib/masterActions';
import { observeJiziProject, type JiziProjectObservation } from '../lib/jiziProjectObservation';
import { formatJiziObservation } from '../lib/jiziProjectObservation';
import { createJiziTask, reduceJiziTask } from '../lib/jiziAutonomy/reducer';
import type { JiziAutonomyEvent, JiziAutonomyTask } from '../lib/jiziAutonomy/types';
import { fingerprintJiziObservation, verifyPlanStep } from '../lib/jiziAutonomy/verifier';
import { requestAutonomyPendingPlan } from '../lib/jiziAutonomy/pendingBridge';
import { planJiziTurnWithLLM } from '../lib/jiziTurnPlanner';
import { useUiStore } from './uiStore';
import { useModelStore } from './modelStore';
import { getProvider } from '../lib/providers';

interface JiziAutonomyRun {
  task: JiziAutonomyTask;
  steps: MasterPlanStep[];
}

interface JiziAutonomyState {
  runs: Record<string, JiziAutonomyRun>;
  start: (sessionId: string, goal: string, steps: MasterPlanStep[], observation: JiziProjectObservation) => void;
  dispatch: (sessionId: string, event: JiziAutonomyEvent) => void;
  cancel: (sessionId: string) => void;
  finishAction: (sessionId: string, action: MasterAction, ok: boolean, error?: string) => Promise<void>;
}

export const useJiziAutonomyStore = create<JiziAutonomyState>((set, get) => ({
  runs: {},
  start: (sessionId, goal, steps, observation) => {
    let task = createJiziTask(goal);
    task = reduceJiziTask(task, {
      type: 'observed',
      fingerprint: fingerprintJiziObservation(observation),
    });
    task = reduceJiziTask(task, {
      type: 'plan-ready',
      destructive: steps.some(
        (step) => step.type === 'delete-canvas' || step.type === 'delete-tool',
      ),
    });
    set((state) => ({
      runs: { ...state.runs, [sessionId]: { task, steps } },
    }));
  },
  dispatch: (sessionId, event) =>
    set((state) => {
      const run = state.runs[sessionId];
      if (!run) return state;
      return {
        runs: {
          ...state.runs,
          [sessionId]: { ...run, task: reduceJiziTask(run.task, event) },
        },
      };
    }),
  cancel: (sessionId) => get().dispatch(sessionId, { type: 'cancelled' }),
  finishAction: async (sessionId, action, ok, error) => {
    const run = get().runs[sessionId];
    if (!run || action.type !== 'plan') return;
    let observation: JiziProjectObservation | undefined;
    if (!ok) {
      get().dispatch(sessionId, {
        type: 'step-failed',
        retryable: true,
        error: error || '计划执行失败',
      });
    } else {
      get().dispatch(sessionId, {
        type: 'step-succeeded',
        count: run.steps.length,
        evidence: `事务已执行 ${run.steps.length} 个步骤。`,
      });
      try {
        observation = await observeJiziProject();
        const checks = run.steps.map((step) => verifyPlanStep(step, observation!));
        get().dispatch(sessionId, {
          type: 'verified',
          ok: checks.every((check) => check.ok),
          evidence: checks.map((check) => check.evidence).join('；'),
        });
      } catch (verifyError) {
        get().dispatch(sessionId, {
          type: 'verified',
          ok: false,
          evidence: verifyError instanceof Error ? verifyError.message : '验证失败',
        });
      }
    }
    if (get().runs[sessionId]?.task.status !== 'replanning') return;
    try {
      observation ??= await observeJiziProject();
      get().dispatch(sessionId, {
        type: 'observed',
        fingerprint: fingerprintJiziObservation(observation),
      });
      const current = get().runs[sessionId];
      if (current?.task.status !== 'planning') return;
      const selected = useUiStore.getState().masterModel;
      const config = selected
        ? useModelStore.getState().configs.find((item) => item.id === selected.configId)
        : undefined;
      if (!selected || !config?.apiKey) throw new Error('没有可用于重新规划的姬子模型');
      const provider = getProvider(config.providerId);
      const decision = await planJiziTurnWithLLM(
        `${current.task.goal}\n\n上次验证未通过：${current.task.evidence.slice(-1)[0] ?? '未知原因'}。请根据当前现场重新规划剩余步骤。`,
        [],
        { api: provider?.api ?? 'openai', baseURL: config.baseURL, apiKey: config.apiKey },
        selected.modelId,
        {
          runtimeContext: formatJiziObservation(observation),
          allowSearch: false,
          allowChoice: false,
          allowActions: true,
        },
      );
      if (decision.kind !== 'action') throw new Error('重新规划没有产生可执行计划');
      const latest = get().runs[sessionId];
      if (latest?.task.status !== 'planning') return;
      const nextTask = reduceJiziTask(latest.task, {
        type: 'plan-ready',
        destructive: decision.action.steps.some(
          (step) => step.type === 'delete-canvas' || step.type === 'delete-tool',
        ),
      });
      set((state) => ({
        runs: {
          ...state.runs,
          [sessionId]: { task: nextTask, steps: decision.action.steps },
        },
      }));
      requestAutonomyPendingPlan(sessionId, decision.action);
    } catch (replanError) {
      get().dispatch(sessionId, {
        type: 'replan-failed',
        error: replanError instanceof Error ? replanError.message : '重新规划失败',
      });
    }
  },
}));
