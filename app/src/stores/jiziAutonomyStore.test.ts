import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  observeJiziProject,
  type JiziProjectObservation,
} from '../lib/jiziProjectObservation';
import { createJiziTask } from '../lib/jiziAutonomy/reducer';
import { fingerprintJiziObservation, verifyPlanStep } from '../lib/jiziAutonomy/verifier';
import { planJiziTurnWithLLM } from '../lib/jiziTurnPlanner';
import { requestAutonomyPendingPlan } from '../lib/jiziAutonomy/pendingBridge';
import { useJiziAutonomyStore } from './jiziAutonomyStore';

vi.mock('../lib/jiziProjectObservation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/jiziProjectObservation')>();
  return { ...actual, observeJiziProject: vi.fn() };
});

vi.mock('../lib/jiziAutonomy/verifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/jiziAutonomy/verifier')>();
  return { ...actual, verifyPlanStep: vi.fn() };
});

vi.mock('../lib/jiziTurnPlanner', () => ({ planJiziTurnWithLLM: vi.fn() }));
vi.mock('../lib/jiziAutonomy/pendingBridge', () => ({
  requestAutonomyPendingPlan: vi.fn(),
}));
vi.mock('./uiStore', () => ({
  useUiStore: { getState: () => ({ masterModel: { configId: 'cfg-1', modelId: 'model-1' } }) },
}));
vi.mock('./modelStore', () => ({
  useModelStore: {
    getState: () => ({
      configs: [{ id: 'cfg-1', providerId: 'openai', apiKey: 'test-key', baseURL: 'https://example.test' }],
    }),
  },
}));
vi.mock('../lib/providers', () => ({
  getProvider: () => ({ api: 'openai' }),
}));

const observation: JiziProjectObservation = {
  activeCanvasId: null,
  activeCanvas: null,
  canvases: [],
  agents: [],
  models: [],
  selectedMasterModel: null,
  tools: [],
  serviceStatus: 'running',
  searchProviderIds: [],
  enabledSkillIds: [],
};

const mockedObserve = vi.mocked(observeJiziProject);
const mockedPlan = vi.mocked(planJiziTurnWithLLM);
const mockedVerify = vi.mocked(verifyPlanStep);
const mockedRequestPending = vi.mocked(requestAutonomyPendingPlan);

describe('Jizi autonomy store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useJiziAutonomyStore.setState({ runs: {} });
    mockedObserve.mockResolvedValue(observation);
    mockedVerify.mockReturnValue({
      ok: false,
      supported: true,
      evidence: '目标尚未出现',
      retryable: true,
    });
    mockedPlan.mockResolvedValue({
      kind: 'action',
      action: { type: 'plan', steps: [{ type: 'create-canvas', name: '重试画布' }] },
      reason: '根据失败结果重新规划',
      search: { shouldSearch: false, reason: '' },
    });
  });

  it('requests a replacement plan after a retryable execution failure', async () => {
    const sessionId = 'session-failed-step';
    const steps = [{ type: 'create-canvas' as const, name: '研究画布' }];
    useJiziAutonomyStore.setState({
      runs: {
        [sessionId]: {
          task: { ...createJiziTask('创建研究画布'), status: 'executing' },
          steps,
        },
      },
    });

    await useJiziAutonomyStore.getState().finishAction(
      sessionId,
      { type: 'plan', steps },
      false,
      '创建失败',
    );

    expect(mockedObserve).toHaveBeenCalledTimes(1);
    expect(mockedPlan).toHaveBeenCalledTimes(1);
    expect(mockedRequestPending).toHaveBeenCalledTimes(1);
    expect(useJiziAutonomyStore.getState().runs[sessionId].task.status).toBe(
      'awaiting-confirmation',
    );
  });

  it('stops before replanning after two unchanged observations', async () => {
    const sessionId = 'session-stalled';
    const steps = [{ type: 'create-canvas' as const, name: '研究画布' }];
    useJiziAutonomyStore.setState({
      runs: {
        [sessionId]: {
          task: {
            ...createJiziTask('创建研究画布'),
            status: 'executing',
            lastObservationFingerprint: fingerprintJiziObservation(observation),
            unchangedObservations: 1,
          },
          steps,
        },
      },
    });

    await useJiziAutonomyStore.getState().finishAction(
      sessionId,
      { type: 'plan', steps },
      true,
    );

    expect(useJiziAutonomyStore.getState().runs[sessionId].task.status).toBe(
      'failed',
    );
    expect(mockedPlan).not.toHaveBeenCalled();
    expect(mockedRequestPending).not.toHaveBeenCalled();
  });

  it('discards a replacement plan that arrives after cancellation', async () => {
    const sessionId = 'session-cancelled-during-plan';
    const steps = [{ type: 'create-canvas' as const, name: '研究画布' }];
    let resolvePlan!: (value: Awaited<ReturnType<typeof planJiziTurnWithLLM>>) => void;
    mockedPlan.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePlan = resolve;
      }),
    );
    useJiziAutonomyStore.setState({
      runs: {
        [sessionId]: {
          task: { ...createJiziTask('创建研究画布'), status: 'executing' },
          steps,
        },
      },
    });

    const finishing = useJiziAutonomyStore.getState().finishAction(
      sessionId,
      { type: 'plan', steps },
      false,
      '创建失败',
    );
    await vi.waitFor(() => expect(mockedPlan).toHaveBeenCalledTimes(1));
    useJiziAutonomyStore.getState().cancel(sessionId);
    resolvePlan({
      kind: 'action',
      action: { type: 'plan', steps: [{ type: 'create-canvas', name: '迟到计划' }] },
      reason: '迟到的重新规划结果',
      search: { shouldSearch: false, reason: '' },
    });
    await finishing;

    expect(useJiziAutonomyStore.getState().runs[sessionId].task.status).toBe(
      'cancelled',
    );
    expect(mockedRequestPending).not.toHaveBeenCalled();
  });
});
