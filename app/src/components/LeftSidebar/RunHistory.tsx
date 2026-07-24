import { App } from 'antd';
import {
  ClockCircleOutlined,
  DeleteOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { canvasLimitMessage, useCanvasStore } from '../../stores/canvasStore';
import { RUN_HISTORY_STATUS } from './constants';
import { runHistoryDisplayName } from './runHistoryDisplay';

export function RunHistory() {
  const { message } = App.useApp();
  const runHistory = useCanvasStore((s) => s.runHistory);
  const deleteRun = useCanvasStore((s) => s.deleteRun);
  const openRun = useCanvasStore((s) => s.openRun);

  const onOpen = (runId: string) => {
    const s = useCanvasStore.getState();
    const already = s.canvases.some((c) => c.runId === runId);
    if (!already) {
      const record = s.runHistory.find((r) => r.id === runId);
      // 较早的运行记录已瘦身为仅元数据(无图快照),无法回看。
      if (record && record.nodes.length === 0) {
        message.info('该运行记录较早,仅保留摘要信息,不可回看快照');
        return;
      }
    }
    const result = openRun(runId);
    if (result === 'limit') message.warning(canvasLimitMessage(s.maxCanvases));
    else if (result === 'not-found') message.warning('该运行记录不存在或无法回看');
  };

  const onDelete = (runId: string) => {
    const record = useCanvasStore
      .getState()
      .runHistory.find((r) => r.id === runId);
    if (record?.runState?.status === 'running') {
      message.warning('任务运行中，暂不能删除该运行记录');
      return;
    }
    deleteRun(runId);
  };

  return (
    <div className="panel-body">
      {runHistory.length === 0 ? (
        <div className="panel-empty">暂无运行记录</div>
      ) : (
        runHistory.map((r) => {
          const status =
            RUN_HISTORY_STATUS[r.runState?.status ?? 'idle'] ??
            RUN_HISTORY_STATUS.idle;
          const isRunning = r.runState?.status === 'running';
          const iconCls = `history-item__icon history-item__icon--${status.tone}`;
          return (
            <div
              key={r.id}
              className="history-item"
              title={`状态：${status.text}`}
              onClick={() => onOpen(r.id)}
            >
              <span className={`history-item__rail history-item__rail--${status.tone}`} />
              {/* 运行中→转圈,完成/其它→时钟;图标随状态上色,与左侧竖条同色系 */}
              {isRunning ? (
                <LoadingOutlined spin className={iconCls} />
              ) : (
                <ClockCircleOutlined className={iconCls} />
              )}
              <div className="history-item__text">
                <div className="history-item__canvas">
                  {runHistoryDisplayName(r)}
                </div>
                <div className="history-item__time">{r.time}</div>
              </div>
              <DeleteOutlined
                className="history-item__del"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(r.id);
                }}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
