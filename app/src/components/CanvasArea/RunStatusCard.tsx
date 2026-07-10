import { useEffect, useMemo } from 'react';
import { Button } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { Panel } from '@xyflow/react';
import { useOrchestratorStore } from '../../stores/orchestratorStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { useUiStore } from '../../stores/uiStore';
import { useMasterAgentStore } from '../../stores/masterAgentStore';
import type { Canvas, AgentNodeData } from '../../stores/canvas/types';
import type { Incident } from '../../lib/orchestrator/diagnosis';

interface Props {
  canvas: Canvas;
}

// 右上角统一运行状态卡:覆盖运行全生命周期的 7 种状态,由 canvas.runState + 节点 runState +
// 匹配的姬子 incident 派生而来(不落盘格式化文案)。终态(完成/无法修复)可收起为小色标胶囊。
interface CardView {
  variant: string; // CSS 类后缀 → .canvas-run-card--{variant}
  title: string;
  lines: string[];
  spinner: boolean;
  collapsible: boolean;
  confirm?: Incident; // 状态⑦:附「去确认」按钮
}

function nodeLabel(data: unknown): string {
  const label = (data as AgentNodeData | undefined)?.label;
  return typeof label === 'string' && label.trim() ? label.trim() : '未命名节点';
}

function runningNodeLabel(canvas: Canvas): string | null {
  const n = canvas.nodes.find(
    (x) => (x.data as AgentNodeData)?.runState?.status === 'running',
  );
  return n ? nodeLabel(n.data) : null;
}

function failedNodeLabel(canvas: Canvas): string | null {
  const n = canvas.nodes.find(
    (x) => (x.data as AgentNodeData)?.runState?.status === 'failed',
  );
  return n ? nodeLabel(n.data) : null;
}

function elapsedSeconds(startedAt?: string, finishedAt?: string): string {
  if (!startedAt || !finishedAt) return '';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  return `${(ms / 1000).toFixed(1)}s`;
}

function deriveView(canvas: Canvas, incident: Incident | undefined): CardView | null {
  const status = canvas.runState?.status;
  if (!status || status === 'idle') return null;

  if (status === 'running') {
    const node = runningNodeLabel(canvas);
    // 命中「已判定可自动修复」的重跑窗口 → 状态⑤(修复·重新运行)。
    if (incident?.status === 'repairing') {
      return {
        variant: 'rerun',
        title: '修复成功，画布正在重新运行',
        lines: [node ? `当前节点：${node}` : '正在准备下一节点…'],
        spinner: true,
        collapsible: false,
      };
    }
    return {
      variant: 'running',
      title: '画布运行中',
      lines: [node ? `当前运行节点：${node}` : '正在准备节点…'],
      spinner: true,
      collapsible: false,
    };
  }

  if (status === 'success') {
    const cost = elapsedSeconds(canvas.runState?.startedAt, canvas.runState?.finishedAt);
    return {
      variant: 'success',
      title: '画布运行完成',
      lines: cost ? [`总耗时：${cost}`] : [],
      spinner: false,
      collapsible: true,
    };
  }

  if (status === 'cancelled') {
    return {
      variant: 'cancelled',
      title: '画布运行已取消',
      lines: [],
      spinner: false,
      collapsible: true,
    };
  }

  // status === 'failed'
  const failed = incident?.nodeLabel || failedNodeLabel(canvas) || '未知节点';
  const diag = incident?.diagnosisText;

  if (incident?.status === 'diagnosing') {
    return {
      variant: 'diagnosing',
      title: '画布运行失败',
      lines: [`失败节点：${failed}`, '姬子正在思考失败原因…'],
      spinner: true,
      collapsible: false,
    };
  }

  if (incident?.status === 'repairing') {
    return {
      variant: 'repairing',
      title: '画布运行失败',
      lines: [
        `失败节点：${failed}`,
        '已定位，可自动修复，正在修复中…',
        diag ? `诊断信息：${diag}` : '',
      ].filter(Boolean),
      spinner: true,
      collapsible: false,
    };
  }

  if (incident?.status === 'awaiting-confirm') {
    return {
      variant: 'awaiting',
      title: '画布运行失败',
      lines: [
        `失败节点：${failed}`,
        '可修复，但需你确认安装候选工具',
        diag ? `诊断信息：${diag}` : '',
      ].filter(Boolean),
      spinner: false,
      collapsible: false,
      confirm: incident,
    };
  }

  // incident.status === 'failed'(无法自动修复)或无 incident 兜底
  return {
    variant: 'failed',
    title: '画布运行失败',
    lines: [
      `失败节点：${failed}`,
      '已定位，当前无法自动修复，请查看报错',
      diag ? `诊断信息：${diag}` : '',
    ].filter(Boolean),
    spinner: false,
    collapsible: true,
  };
}

export function RunStatusCard({ canvas }: Props) {
  const incidents = useOrchestratorStore((s) => s.incidents);
  const setRunCardCollapsed = useCanvasStore((s) => s.setRunCardCollapsed);

  const incident = useMemo(() => {
    const matches = incidents.filter((i) =>
      canvas.runId
        ? i.runTabId === canvas.id && i.runId === canvas.runId
        : i.canvasId === canvas.id,
    );
    if (matches.length === 0) return undefined;
    return matches.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
  }, [incidents, canvas.id, canvas.runId]);

  const view = useMemo(() => deriveView(canvas, incident), [canvas, incident]);

  // 运行开始时清掉上一轮遗留的收起标记,保证运行中卡片总是完整展示。
  const running = canvas.runState?.status === 'running';
  useEffect(() => {
    if (running && canvas.runCardCollapsed) {
      setRunCardCollapsed(canvas.id, false);
    }
  }, [running, canvas.runCardCollapsed, canvas.id, setRunCardCollapsed]);

  if (!view) return null;

  const collapsed = !!canvas.runCardCollapsed && view.collapsible;

  const goToConfirm = () => {
    if (!view.confirm) return;
    useUiStore.getState().setView('workspace');
    useUiStore.getState().setDrawerExpanded(true);
    useMasterAgentStore.getState().switchSession(view.confirm.sessionId);
  };

  if (collapsed) {
    return (
      <Panel position="top-right" style={{ marginTop: 52 }}>
        <button
          type="button"
          className={`canvas-run-pill canvas-run-card--${view.variant}`}
          title={view.title}
          onClick={() => setRunCardCollapsed(canvas.id, false)}
        >
          <span className="canvas-run-pill__dot" />
          {view.title}
        </button>
      </Panel>
    );
  }

  return (
    <Panel position="top-right" style={{ marginTop: 52 }}>
      <div className={`canvas-run-card canvas-run-card--${view.variant}`}>
        <div className="canvas-run-card__head">
          {view.spinner && <LoadingOutlined spin className="canvas-run-card__spin" />}
          <span className="canvas-run-card__title">{view.title}</span>
        </div>
        {view.lines.length > 0 && (
          <div className="canvas-run-card__lines">
            {view.lines.map((line, i) => (
              <div className="canvas-run-card__line" key={i}>
                {line}
              </div>
            ))}
          </div>
        )}
        {(view.collapsible || view.confirm) && (
          <div className="canvas-run-card__actions">
            {view.confirm && (
              <Button type="primary" size="small" onClick={goToConfirm}>
                去确认
              </Button>
            )}
            {view.collapsible && (
              <Button size="small" onClick={() => setRunCardCollapsed(canvas.id, true)}>
                收起
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
