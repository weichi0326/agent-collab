import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal, Tour, type TourStepProps } from 'antd';
import { useModelStore } from '../../stores/modelStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { useUiStore } from '../../stores/uiStore';
import {
  canAdvanceModelSetupStep,
  tutorialMilestones,
  type OnboardingStage,
  type OnboardingStatus,
} from '../../onboarding/onboardingState';
import { useOnboardingStore } from '../../onboarding/onboardingStore';
import { requestAppView } from '../../settings/appNavigation';
import {
  CAPABILITY_STEPS,
  interactionTargets,
  MODEL_STEPS,
  TUTORIAL_STEPS,
  type GuidedStep,
} from '../../onboarding/onboardingSteps';
import {
  ensureTutorialResources,
  removeTutorialResources,
  type TutorialResources,
} from '../../onboarding/onboardingTutorial';
import WelcomeCarousel from './WelcomeCarousel';
import './Onboarding.css';

function targetElement(name: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[data-onboarding="${name}"]`);
}

function OnboardingInteractionMask({
  targetNames,
}: {
  targetNames: readonly string[];
}) {
  if (typeof document === 'undefined') return null;
  const padding = 7;
  const rects = targetNames.flatMap((name) => {
    const target = targetElement(name);
    if (!target) return [];
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    return [
      {
        name,
        x: Math.max(0, rect.left - padding),
        y: Math.max(0, rect.top - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      },
    ];
  });
  if (rects.length === 0) return null;

  return createPortal(
    <svg
      className="onboarding-interaction-mask"
      aria-hidden="true"
      width="100%"
      height="100%"
    >
      <defs>
        <mask id="onboarding-interaction-mask-cutout">
          <rect width="100%" height="100%" fill="white" />
          {rects.map((rect) => (
            <rect
              key={rect.name}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx="8"
              fill="black"
            />
          ))}
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        className="onboarding-interaction-mask__shade"
        mask="url(#onboarding-interaction-mask-cutout)"
      />
      {rects.map((rect) => (
        <rect
          key={rect.name}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx="8"
          className="onboarding-interaction-mask__outline"
        />
      ))}
    </svg>,
    document.body,
  );
}

// oxlint-disable-next-line react/only-export-components
export function onboardingSurface(
  status: OnboardingStatus,
  stage: OnboardingStage,
): 'hidden' | 'welcome' | 'tour' | 'finish' {
  if (status === 'completed' || status === 'skipped') return 'hidden';
  if (stage === 'welcome') return 'welcome';
  if (stage === 'finish') return 'finish';
  return 'tour';
}

// oxlint-disable-next-line react/only-export-components
export function canAdvanceTutorialStep(
  tutorialStep: number,
  drawerExpanded: boolean,
): boolean {
  if (tutorialStep === 3 || tutorialStep === 5) return true;
  if (tutorialStep === 6) return drawerExpanded;
  return false;
}

export default function OnboardingController() {
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [domRevision, setDomRevision] = useState(0);
  const status = useOnboardingStore((state) => state.status);
  const stage = useOnboardingStore((state) => state.stage);
  const welcomePage = useOnboardingStore((state) => state.welcomePage);
  const modelStep = useOnboardingStore((state) => state.modelStep);
  const capabilityStep = useOnboardingStore((state) => state.capabilityStep);
  const tutorialStep = useOnboardingStore((state) => state.tutorialStep);
  const tutorialCanvasId = useOnboardingStore((state) => state.tutorialCanvasId);
  const tutorialAgentIds = useOnboardingStore((state) => state.tutorialAgentIds);
  const configs = useModelStore((state) => state.configs);
  const canvases = useCanvasStore((state) => state.canvases);
  const setSection = useUiStore((state) => state.setSettingsSection);
  const drawerExpanded = useUiStore((state) => state.drawerExpanded);

  const resources = useMemo<TutorialResources | null>(
    () =>
      tutorialCanvasId && tutorialAgentIds
        ? { canvasId: tutorialCanvasId, agentIds: tutorialAgentIds }
        : null,
    [tutorialAgentIds, tutorialCanvasId],
  );
  const tutorialCanvas = canvases.find((canvas) => canvas.id === tutorialCanvasId);
  const milestones = tutorialAgentIds
    ? tutorialMilestones(tutorialCanvas, tutorialAgentIds)
    : null;
  const surface = onboardingSurface(status, stage);

  let current: GuidedStep | undefined;
  let currentIndex = 0;
  let total = 0;
  if (stage === 'models') {
    current = MODEL_STEPS[modelStep];
    currentIndex = modelStep;
    total = MODEL_STEPS.length;
  } else if (stage === 'capabilities') {
    current = CAPABILITY_STEPS[capabilityStep];
    currentIndex = capabilityStep;
    total = CAPABILITY_STEPS.length;
  } else if (stage === 'tutorial') {
    current = TUTORIAL_STEPS[tutorialStep];
    currentIndex = tutorialStep;
    total = TUTORIAL_STEPS.length;
  }

  void domRevision;
  const credentialsTarget = targetElement('model-credentials');
  const modelListTarget = targetElement('model-list');
  const modelCanAdvance = canAdvanceModelSetupStep(modelStep, configs, {
    credentialsVisible: !!credentialsTarget,
    credentialsConfigId:
      credentialsTarget?.dataset.onboardingConfigId ?? null,
    modelListConfigId: modelListTarget?.dataset.onboardingConfigId ?? null,
  });
  const currentTarget = current ? targetElement(current.target) : null;
  const allowedTargetNames = current ? interactionTargets(current) : [];
  const allowedTargetKey = allowedTargetNames.join('|');
  const tourOpen =
    !!currentTarget && surface === 'tour' && !skipConfirmOpen;

  useEffect(() => {
    if (status !== 'active') return;
    let cancelled = false;
    const navigate = async () => {
      if (stage === 'models') {
        if (!(await requestAppView('settings')) || cancelled) return;
        setSection('models');
      } else if (stage === 'capabilities') {
        if (!(await requestAppView('settings')) || cancelled) return;
        setSection(CAPABILITY_STEPS[capabilityStep]?.section ?? 'search');
      } else if (stage === 'tutorial') {
        if (!(await requestAppView('workspace')) || cancelled) return;
        const ensured = ensureTutorialResources(resources);
        if (ensured && !resources) {
          useOnboardingStore
            .getState()
            .setTutorialResources(ensured.canvasId, ensured.agentIds);
        }
      }
    };
    void navigate();
    return () => {
      cancelled = true;
    };
  }, [capabilityStep, resources, setSection, stage, status]);

  useEffect(() => {
    if (status !== 'active' || stage !== 'tutorial' || !milestones) return;
    if (tutorialStep === 0 && milestones.firstPlaced) {
      useOnboardingStore.getState().setTutorialStep(1);
    } else if (tutorialStep === 1 && milestones.secondPlaced) {
      useOnboardingStore.getState().setTutorialStep(2);
    } else if (tutorialStep === 2 && milestones.connected) {
      useOnboardingStore.getState().setTutorialStep(3);
    } else if (tutorialStep === 4 && milestones.saved) {
      useOnboardingStore.getState().setTutorialStep(5);
    } else if (tutorialStep === 5 && milestones.runSucceeded) {
      useOnboardingStore.getState().setTutorialStep(6);
    }
  }, [milestones, stage, status, tutorialStep]);

  useEffect(() => {
    if (surface !== 'tour' || typeof MutationObserver === 'undefined') return;
    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setDomRevision((revision) => revision + 1);
      });
    };
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-onboarding-config-id'],
    });
    document.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      window.cancelAnimationFrame(frame);
    };
  }, [surface]);

  useEffect(() => {
    if (
      status !== 'active' ||
      stage !== 'models' ||
      modelStep <= 1 ||
      !targetElement('model-provider-list')
    ) {
      return;
    }
    const credentials = targetElement('model-credentials');
    const modelList = targetElement('model-list');
    const lostCurrentSelection =
      (modelStep === 2 && !credentials) ||
      (modelStep >= 3 && !modelList?.dataset.onboardingConfigId);
    if (lostCurrentSelection) {
      useOnboardingStore.getState().setModelStep(1);
    }
  }, [domRevision, modelStep, stage, status]);

  useEffect(() => {
    if (!tourOpen || !allowedTargetKey) return;
    const allowedNames = allowedTargetKey.split('|');
    const guard = (event: Event) => {
      const element = event.target;
      if (!(element instanceof Element)) return;
      if (
        element.closest(
          '.onboarding-tour, .ant-modal-root, .ant-select-dropdown, .ant-dropdown, .ant-popover',
        )
      ) {
        return;
      }
      const allowed = allowedNames.some((name) =>
        targetElement(name)?.contains(element),
      );
      if (allowed) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const guardedEvents: Array<keyof DocumentEventMap> = [
      'pointerdown',
      'mousedown',
      'dblclick',
      'contextmenu',
      'touchstart',
      'wheel',
      'keydown',
    ];
    document.addEventListener('click', guard, true);
    guardedEvents.forEach((eventName) =>
      document.addEventListener(eventName, guard, {
        capture: true,
        passive: false,
      }),
    );
    return () => {
      document.removeEventListener('click', guard, true);
      guardedEvents.forEach((eventName) =>
        document.removeEventListener(eventName, guard, true),
      );
    };
  }, [allowedTargetKey, tourOpen]);

  if (surface === 'hidden') return null;

  const beginTutorial = () => {
    const ensured = ensureTutorialResources(resources);
    if (!ensured) return;
    useOnboardingStore
      .getState()
      .setTutorialResources(ensured.canvasId, ensured.agentIds);
    useOnboardingStore.getState().setStage('tutorial');
  };

  const next = () => {
    if (stage === 'models') {
      if (!modelCanAdvance) return;
      if (modelStep < MODEL_STEPS.length - 1) {
        useOnboardingStore.getState().setModelStep(modelStep + 1);
      } else {
        useOnboardingStore.getState().setStage('capabilities');
        useOnboardingStore.getState().setCapabilityStep(0);
      }
      return;
    }
    if (stage === 'capabilities') {
      if (capabilityStep < CAPABILITY_STEPS.length - 1) {
        useOnboardingStore.getState().setCapabilityStep(capabilityStep + 1);
      } else {
        beginTutorial();
      }
      return;
    }
    if (stage === 'tutorial') {
      if (tutorialStep === 3) {
        useOnboardingStore.getState().setTutorialStep(4);
      } else if (tutorialStep === 5) {
        useOnboardingStore.getState().setTutorialStep(6);
      } else if (tutorialStep === 6) {
        useOnboardingStore.getState().setStage('finish');
      }
    }
  };

  const previous = () => {
    if (stage === 'models' && modelStep > 0) {
      useOnboardingStore.getState().setModelStep(modelStep - 1);
    } else if (stage === 'capabilities' && capabilityStep > 0) {
      useOnboardingStore.getState().setCapabilityStep(capabilityStep - 1);
    } else if (stage === 'tutorial' && tutorialStep > 0) {
      useOnboardingStore.getState().setTutorialStep(tutorialStep - 1);
    }
  };

  const tutorialCanAdvance = canAdvanceTutorialStep(
    tutorialStep,
    drawerExpanded,
  );
  const waitingForAction = stage === 'tutorial' && !tutorialCanAdvance;
  const canAdvance =
    !!currentTarget &&
    (stage === 'models' ? modelCanAdvance : !waitingForAction);
  const tourSteps: TourStepProps[] = current
    ? [
        {
          title: current.title,
          description: current.description,
          target: currentTarget,
          placement: 'right',
        },
      ]
    : [];

  const finishResources = (keep: boolean) => {
    if (!keep && resources) removeTutorialResources(resources);
    useOnboardingStore.getState().complete();
  };

  const confirmSkip = () => {
    if (resources) removeTutorialResources(resources);
    useOnboardingStore.getState().skip();
    setSkipConfirmOpen(false);
  };

  return (
    <>
      <Modal
        className="onboarding-welcome-modal"
        rootClassName="onboarding-welcome-root"
        open={surface === 'welcome'}
        centered
        width={960}
        footer={null}
        closable={false}
        mask={{ closable: false }}
      >
        <WelcomeCarousel
          page={welcomePage}
          onPrevious={() =>
            useOnboardingStore.setState({ welcomePage: Math.max(0, welcomePage - 1) })
          }
          onNext={() => useOnboardingStore.getState().nextWelcome()}
        />
      </Modal>

      <Tour
        className="onboarding-tour"
        open={tourOpen}
        current={0}
        steps={tourSteps}
        mask={false}
        onClose={() => setSkipConfirmOpen(true)}
        indicatorsRender={() => `${currentIndex + 1} / ${total}`}
        actionsRender={() => (
          <div className="onboarding-tour__actions">
            <Button size="small" disabled={currentIndex === 0} onClick={previous}>
              上一步
            </Button>
            <Button size="small" type="text" onClick={() => setSkipConfirmOpen(true)}>
              跳过引导
            </Button>
            <Button size="small" type="primary" disabled={!canAdvance} onClick={next}>
              {waitingForAction ? '等待完成' : stage === 'tutorial' && tutorialStep === 6 ? '完成' : '下一步'}
            </Button>
          </div>
        )}
      />

      {tourOpen && (
        <OnboardingInteractionMask targetNames={allowedTargetNames} />
      )}

      <Modal
        title="退出新手引导？"
        open={skipConfirmOpen}
        onCancel={() => setSkipConfirmOpen(false)}
        onOk={confirmSkip}
        okText="退出引导"
        cancelText="继续引导"
      >
        已完成的模型和功能配置会保留；临时示例画布与教程 Agent 会被清理。
      </Modal>

      <Modal
        title="你已完成首次工作流"
        open={surface === 'finish'}
        closable={false}
        mask={{ closable: false }}
        footer={[
          <Button key="delete" onClick={() => finishResources(false)}>
            删除示例
          </Button>,
          <Button key="keep" type="primary" onClick={() => finishResources(true)}>
            保留示例
          </Button>,
        ]}
      >
        你已经完成模型配置、节点拖放、连线与保存，了解了按需运行工作流，并打开姬子协作面板。可以保留这份画布继续修改，也可以删除全部教程数据。
      </Modal>
    </>
  );
}
