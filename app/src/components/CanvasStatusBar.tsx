import { useMemo } from 'react';
import { Progress } from 'antd';
import { useCanvasStore, isCanvasDirty } from '../stores/canvasStore';

const RUN_TEXT = {
  idle: '未运行',
  running: '运行中',
  success: '运行完成',
  failed: '运行失败',
  cancelled: '已停止',
} as const;

function CanvasStatusBar() {
  const canvas = useCanvasStore((s) =>
    s.canvases.find((c) => c.id === s.activeId),
  );
  const savedCanvases = useCanvasStore((s) => s.savedCanvases);

  const dirty = useMemo(
    () => (canvas ? isCanvasDirty(canvas, savedCanvases) : false),
    [canvas, savedCanvases],
  );
  const sc = useMemo(
    () =>
      canvas?.savedId
        ? savedCanvases.find((x) => x.id === canvas.savedId)
        : undefined,
    [canvas?.savedId, savedCanvases],
  );

  if (!canvas) return <div className="canvas-statusbar" />;

  const nodeCount = canvas.nodes.length;
  const edgeCount = canvas.edges.length;
  const runState = canvas.runState;

  let saveText: string;
  if (sc && !dirty) {
    saveText = `已保存 · ${sc.savedAt.slice(11)}`;
  } else {
    saveText = sc ? '未保存 *' : '未保存';
  }

  return (
    <div className="canvas-statusbar">
      <span className="canvas-statusbar__item">
        节点 {nodeCount} · 连线 {edgeCount}
      </span>
      {runState && runState.status !== 'idle' && (
        <span
          className={`canvas-statusbar__run canvas-statusbar__run--${runState.status}`}
          title={runState.message}
        >
          {RUN_TEXT[runState.status]}
          {typeof runState.total === 'number' && runState.total > 0
            ? ` · ${runState.completed ?? 0}/${runState.total}`
            : ''}
          {/* 4.8：运行中提示该画布 tab 已锁定关闭 */}
          {runState.status === 'running' ? ' · 运行中不可关闭' : ''}
        </span>
      )}
      {runState &&
        runState.status === 'running' &&
        typeof runState.total === 'number' &&
        runState.total > 0 && (
          <Progress
            className="canvas-statusbar__progress"
            percent={Math.round(
              (((runState.completed ?? 0) +
                (runState.failed ?? 0) +
                (runState.skipped ?? 0)) /
                runState.total) *
                100,
            )}
            size="small"
            showInfo={false}
            style={{ width: 80 }}
          />
        )}
      <span
        className={`canvas-statusbar__save${
          dirty ? ' canvas-statusbar__save--dirty' : ''
        }`}
      >
        {saveText}
      </span>
    </div>
  );
}

export default CanvasStatusBar;
