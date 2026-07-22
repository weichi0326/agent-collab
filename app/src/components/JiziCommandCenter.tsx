import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Modal, Tag } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  MedicineBoxOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useModelStore } from '../stores/modelStore';
import { useOrchestratorStore } from '../stores/orchestratorStore';
import { usePendingActionStore } from '../stores/pendingActionStore';
import { useUiStore } from '../stores/uiStore';
import { useCanvasStore } from '../stores/canvasStore';
import { useMasterAgentStore } from '../stores/masterAgentStore';
import { getServiceStatus, type ServiceStatus } from '../lib/pythonClient';
import { buildCanvasAdvice } from '../lib/canvasAdvisor';
import { describeMasterAction } from '../lib/masterActions';
import { requestAppView } from '../settings/appNavigation';

function serviceLabel(status: ServiceStatus | 'unknown'): string {
  if (status === 'running') return '后台正常';
  if (status === 'starting') return '后台启动中';
  if (status === 'stopped') return '后台未运行';
  return '后台未知';
}

function serviceColor(status: ServiceStatus | 'unknown'): string {
  if (status === 'running') return 'green';
  if (status === 'starting') return 'gold';
  return 'red';
}

function capsLabel(caps?: { longContext?: boolean; vision?: boolean; audio?: boolean }): string {
  if (!caps) return '能力未知';
  const parts = [caps.longContext ? '长文' : '普通文本'];
  if (caps.vision) parts.push('看图');
  if (caps.audio) parts.push('音频');
  return parts.join(' / ');
}

export default function JiziCommandCenter() {
  const { modal } = App.useApp();
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | 'unknown'>('unknown');
  const masterModel = useUiStore((s) => s.masterModel);
  const configs = useModelStore((s) => s.configs);
  const incidents = useOrchestratorStore((s) => s.incidents);
  const ignoreIncident = useOrchestratorStore((s) => s.ignoreIncident);
  const setActive = useCanvasStore((s) => s.setActive);
  const setDrawerExpanded = useUiStore((s) => s.setDrawerExpanded);
  const switchSession = useMasterAgentStore((s) => s.switchSession);
  const pendingActions = usePendingActionStore((s) => s.pendingActions);
  const canvases = useCanvasStore((s) => s.canvases);
  const activeCanvas = useCanvasStore((s) => s.canvases.find((canvas) => canvas.id === s.activeId));
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [resolvedOpen, setResolvedOpen] = useState(false);

  // 目标画布 = 运行副本 tab(runTabId)优先,无则源画布(canvasId);都不存在(被删/关闭)返回 null。
  const resolveTargetId = useCallback(
    (runTabId: string | undefined, canvasId: string): string | null => {
      if (runTabId) return canvases.some((c) => c.id === runTabId) ? runTabId : null;
      return canvases.some((c) => c.id === canvasId) ? canvasId : null;
    },
    [canvases],
  );

  const currentModel = useMemo(() => {
    if (!masterModel) return null;
    const cfg = configs.find((item) => item.id === masterModel.configId);
    const model = cfg?.models.find((item) => item.id === masterModel.modelId);
    if (!cfg || !model) return null;
    return {
      label: `${model.label || model.id}（${cfg.name || cfg.providerId}）`,
      caps: model.caps,
    };
  }, [configs, masterModel]);

  // ① 待处理:待你确认的操作(pendingActions)+ 待确认安装工具的失败(awaiting-confirm)。各带会话入口去处理。
  const pendingRows = useMemo(() => {
    const rows: { key: string; title: string; detail: string; sessionId: string }[] = [];
    for (const [slotId, item] of Object.entries(pendingActions)) {
      // 诊断类待确认(带 incidentId)已在下方 awaiting-confirm 循环单独成行,这里跳过避免重复;
      // 本循环只保留来自姬子普通操作确认的卡片。
      if (item.incidentId) continue;
      rows.push({
        key: `p_${slotId}`,
        title: describeMasterAction(item.action),
        detail: '来自姬子操作确认',
        sessionId: item.sessionId,
      });
    }
    for (const item of incidents) {
      if (item.status !== 'awaiting-confirm') continue;
      rows.push({
        key: `i_${item.id}`,
        title: `节点「${item.nodeLabel}」待确认修复`,
        detail: item.diagnosisText || item.errorDetail,
        sessionId: item.sessionId,
      });
    }
    return rows;
  }, [pendingActions, incidents]);
  const pendingCount = pendingRows.length;

  // ② 问题:失败或诊断中、未被忽略,且目标画布仍存在(避免死链跳转)。
  const problemRows = useMemo(() => {
    const rows: {
      id: string;
      nodeLabel: string;
      status: string;
      detail: string;
      targetId: string;
      canvasName: string;
    }[] = [];
    for (const item of incidents) {
      if (item.ignored) continue;
      if (item.status !== 'failed' && item.status !== 'diagnosing') continue;
      const targetId = resolveTargetId(item.runTabId, item.canvasId);
      if (!targetId) continue;
      rows.push({
        id: item.id,
        nodeLabel: item.nodeLabel,
        status: item.status,
        detail: item.diagnosisText || item.errorDetail,
        targetId,
        canvasName: canvases.find((c) => c.id === targetId)?.name ?? '未知画布',
      });
    }
    return rows;
  }, [incidents, canvases, resolveTargetId]);
  const problemCount = problemRows.length;

  // ③ 已处理:两类历史 ——
  //   confirmed = 你确认安装新工具后修好(status==='resolved',仅 onToolInstalled 这一条链路会置);
  //   ignored   = 你手动忽略。
  // 自动补已有工具(status==='repairing')属系统静默自愈,不算问题;取消不留痕,均不展示。
  // 纯只读历史,目标画布还在则可跳转。
  const resolvedRows = useMemo(() => {
    const rows: {
      id: string;
      kind: 'confirmed' | 'ignored';
      nodeLabel: string;
      detail: string;
      targetId: string | null;
      canvasName: string | null;
    }[] = [];
    for (const item of incidents) {
      const kind: 'confirmed' | 'ignored' | null = item.ignored
        ? 'ignored'
        : item.status === 'resolved'
          ? 'confirmed'
          : null;
      if (!kind) continue;
      const targetId = resolveTargetId(item.runTabId, item.canvasId);
      rows.push({
        id: item.id,
        kind,
        nodeLabel: item.nodeLabel,
        detail: item.diagnosisText || item.errorDetail,
        targetId,
        canvasName: targetId ? (canvases.find((c) => c.id === targetId)?.name ?? null) : null,
      });
    }
    return rows;
  }, [incidents, canvases, resolveTargetId]);
  const resolvedCount = resolvedRows.length;

  const closeAllModals = () => {
    setProblemsOpen(false);
    setPendingOpen(false);
    setResolvedOpen(false);
  };

  const jumpToCanvas = async (id: string) => {
    if (!(await requestAppView('workspace'))) return;
    setActive(id);
    closeAllModals();
  };

  const jumpToSession = async (sessionId: string) => {
    if (!(await requestAppView('workspace'))) return;
    setDrawerExpanded(true);
    switchSession(sessionId);
    closeAllModals();
  };

  const refreshService = useCallback(async () => {
    if (document.hidden) return;
    try {
      setServiceStatus(await getServiceStatus());
    } catch {
      setServiceStatus('unknown');
    }
  }, []);

  useEffect(() => {
    void refreshService();
    const timer = window.setInterval(() => void refreshService(), 15000);
    return () => window.clearInterval(timer);
  }, [refreshService]);

  const openCanvasAdvice = () => {
    const advice = buildCanvasAdvice(activeCanvas);
    modal.info({
      title: '画布级智能建议',
      width: 740,
      content: (
        <div className="jizi-canvas-advice">
          {advice.map((item) => (
            <div className={`jizi-canvas-advice__item jizi-canvas-advice__item--${item.level}`} key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              <span>{item.action}</span>
            </div>
          ))}
        </div>
      ),
      okText: '知道了',
    });
  };

  return (
    <div className="jizi-command-center">
      <div className="jizi-command-center__main">
        <div className="jizi-command-center__title">
          <MedicineBoxOutlined />
          姬子状态
        </div>
        <Tag color={serviceColor(serviceStatus)} variant="filled">
          {serviceLabel(serviceStatus)}
        </Tag>
        <Tag color={currentModel ? 'blue' : 'red'} variant="filled">
          {currentModel ? currentModel.label : '未选择模型'}
        </Tag>
        {currentModel && <span className="jizi-command-center__muted">{capsLabel(currentModel.caps)}</span>}
      </div>
      <div className="jizi-command-center__tasks">
        <button
          type="button"
          className="jizi-command-center__pill jizi-command-center__pill--pending"
          onClick={() => setPendingOpen(true)}
          disabled={pendingCount === 0}
          title={pendingCount > 0 ? '点击查看待处理' : undefined}
        >
          <ClockCircleOutlined /> 待处理 {pendingCount}
        </button>
        <button
          type="button"
          className="jizi-command-center__pill jizi-command-center__pill--problem"
          onClick={() => setProblemsOpen(true)}
          disabled={problemCount === 0}
          title={problemCount > 0 ? '点击查看问题列表' : undefined}
        >
          <WarningOutlined /> 问题 {problemCount}
        </button>
        <button
          type="button"
          className="jizi-command-center__pill jizi-command-center__pill--resolved"
          onClick={() => setResolvedOpen(true)}
          disabled={resolvedCount === 0}
          title={resolvedCount > 0 ? '点击查看已处理' : undefined}
        >
          <CheckCircleOutlined /> 已处理 {resolvedCount}
        </button>
      </div>
      <div className="jizi-command-center__actions">
        <Button size="small" onClick={openCanvasAdvice}>
          画布诊断
        </Button>
      </div>
      <Modal
        title="问题列表"
        open={problemsOpen}
        onCancel={() => setProblemsOpen(false)}
        footer={null}
        width={720}
        destroyOnHidden
      >
        <div className="jizi-plan-panel">
          {problemRows.length === 0 ? (
            <div className="jizi-plan-panel__empty">
              暂无未处理的问题。忽略过的问题不再提示。
            </div>
          ) : (
            problemRows.map((row) => (
              <div className="jizi-plan-panel__item" key={row.id}>
                <div>
                  <strong>
                    <Tag
                      color={row.status === 'diagnosing' ? 'gold' : 'red'}
                      variant="filled"
                    >
                      {row.status === 'diagnosing' ? '诊断中' : '失败'}
                    </Tag>
                    <span className="jizi-problem-canvas">画布：{row.canvasName}</span>
                    {row.nodeLabel}
                  </strong>
                  <span>{row.detail}</span>
                </div>
                <div className="jizi-problem-row__actions">
                  <Button size="small" onClick={() => jumpToCanvas(row.targetId)}>
                    跳转
                  </Button>
                  <Button size="small" onClick={() => ignoreIncident(row.id)}>
                    忽略
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
      <Modal
        title="待处理"
        open={pendingOpen}
        onCancel={() => setPendingOpen(false)}
        footer={null}
        width={720}
        destroyOnHidden
      >
        <div className="jizi-plan-panel">
          {pendingRows.length === 0 ? (
            <div className="jizi-plan-panel__empty">暂无待处理事项。</div>
          ) : (
            pendingRows.map((row) => (
              <div className="jizi-plan-panel__item" key={row.key}>
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.detail}</span>
                </div>
                <div className="jizi-problem-row__actions">
                  <Button size="small" type="primary" onClick={() => jumpToSession(row.sessionId)}>
                    去确认
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
      <Modal
        title="已处理"
        open={resolvedOpen}
        onCancel={() => setResolvedOpen(false)}
        footer={null}
        width={720}
        destroyOnHidden
      >
        <div className="jizi-plan-panel">
          {resolvedRows.length === 0 ? (
            <div className="jizi-plan-panel__empty">暂无已处理记录。</div>
          ) : (
            resolvedRows.map((row) => (
              <div className="jizi-plan-panel__item" key={row.id}>
                <div>
                  <strong>
                    <Tag color={row.kind === 'confirmed' ? 'green' : 'red'} variant="filled">
                      {row.kind === 'confirmed' ? '已确认' : '已忽略'}
                    </Tag>
                    {row.canvasName && (
                      <span className="jizi-problem-canvas">画布：{row.canvasName}</span>
                    )}
                    {row.nodeLabel}-运行失败
                  </strong>
                  <span>{row.detail}</span>
                </div>
                {row.targetId && (
                  <div className="jizi-problem-row__actions">
                    <Button size="small" onClick={() => jumpToCanvas(row.targetId!)}>
                      跳转
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
