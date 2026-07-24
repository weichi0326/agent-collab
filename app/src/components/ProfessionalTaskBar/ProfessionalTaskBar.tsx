import { useState } from 'react';
import { Button, Modal, Tag } from 'antd';
import { ArrowLeftOutlined, FileSearchOutlined } from '@ant-design/icons';
import { useProfessionalTaskStore } from '../../features/professionalTasks/professionalTaskStore';
import { taskMatchesOrigin } from '../../features/professionalTasks/domain';
import { requestAppView } from '../../settings/appNavigation';
import { useCanvasStore } from '../../stores/canvasStore';
import './ProfessionalTaskBar.css';

const STATUS_LABELS = {
  preparing: '准备中',
  ready: '待运行',
  running: '运行中',
  review_required: '草稿待确认',
  accepted: '已保存为章节',
  failed: '需要处理',
  discarded: '已放弃',
  interrupted: '已中止',
} as const;

export default function ProfessionalTaskBar() {
  const [contextOpen, setContextOpen] = useState(false);
  const activeCanvas = useCanvasStore((state) =>
    state.canvases.find((canvas) => canvas.id === state.activeId),
  );
  const task = useProfessionalTaskStore((state) => {
    const taskId = activeCanvas?.origin?.taskId;
    return taskId ? state.tasks[taskId] : undefined;
  });
  const focusTask = useProfessionalTaskStore((state) => state.focusTask);

  if (!activeCanvas?.origin || !task || !taskMatchesOrigin(task, activeCanvas.origin)) return null;

  const returnToPackage = async () => {
    focusTask(task.id);
    if (task.packageId === 'fictionist') await requestAppView('fictionist');
  };

  return (
    <>
      <div className="professional-task-bar" role="status">
        <div className="professional-task-bar__source">
          <span>来自 {task.sourceLabel}</span>
          <strong>{task.taskLabel}</strong>
          <Tag color={task.status === 'review_required' ? 'green' : undefined}>
            {STATUS_LABELS[task.status]}
          </Tag>
          {task.fallbackAttempt ? (
            <Tag color={task.fallbackAttempt.status === 'succeeded' ? 'orange' : 'red'}>
              {task.fallbackAttempt.status === 'running'
                ? '正在切换备用流程'
                : task.fallbackAttempt.status === 'succeeded'
                  ? '备用流程已接管'
                  : task.fallbackAttempt.status === 'cancelled'
                    ? '备用流程已中止'
                    : '备用流程也失败'}
            </Tag>
          ) : null}
          {task.errorMessage ? <small title={task.errorMessage}>{task.errorMessage}</small> : null}
          {task.fallbackAttempt?.status === 'succeeded' ? (
            <small title={task.fallbackAttempt.primaryError}>
              主流程失败：{task.fallbackAttempt.primaryError}
            </small>
          ) : null}
        </div>
        <div className="professional-task-bar__actions">
          <Button
            size="small"
            icon={<FileSearchOutlined />}
            onClick={() => setContextOpen(true)}
          >
            查看任务上下文
          </Button>
          {task.packageId === 'fictionist' ? (
            <Button
              size="small"
              type={task.status === 'review_required' ? 'primary' : 'default'}
              icon={<ArrowLeftOutlined />}
              onClick={() => void returnToPackage()}
            >
              返回小说家
            </Button>
          ) : null}
        </div>
      </div>
      <Modal
        title={task.contextSnapshot.title}
        open={contextOpen}
        footer={null}
        width={760}
        onCancel={() => setContextOpen(false)}
      >
        <pre className="professional-task-context">{task.contextSnapshot.content}</pre>
      </Modal>
    </>
  );
}
