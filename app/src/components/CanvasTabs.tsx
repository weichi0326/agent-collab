import { useState } from 'react';
import { Tabs, Input, App, Modal, Button } from 'antd';
import {
  BookOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DownOutlined,
  EyeOutlined,
  LockOutlined,
  LoadingOutlined,
  PauseCircleFilled,
  RightOutlined,
} from '@ant-design/icons';
import {
  FICTIONIST_TABS_DEFAULT_EXPANDED,
  fictionistCanvasDisplayName,
  partitionCanvasTabs,
} from './canvasTabGroups';
import {
  useCanvasStore,
  canvasLimitMessage,
  isCanvasDirty,
  validateCanvasName,
  type Canvas,
  type CanvasRunStatus,
} from '../stores/canvasStore';

function RunTabIcon({ status }: { status?: CanvasRunStatus }) {
  if (status === 'running') return <LoadingOutlined />;
  if (status === 'success') return <CheckCircleFilled />;
  if (status === 'failed') return <CloseCircleFilled />;
  if (status === 'cancelled') return <PauseCircleFilled />;
  return <EyeOutlined />;
}

function canvasTabItem(canvas: Canvas) {
  const displayName = fictionistCanvasDisplayName(canvas);
  return {
    key: canvas.id,
    // 运行中的画布隐藏关闭按钮，避免误关正在执行的任务。
    closable: !(canvas.lockClose || canvas.runState?.status === 'running'),
    label: canvas.readOnly && canvas.workflowRef?.systemWorkflow ? (
      <span
        className="canvas-tab-label canvas-tab--readonly"
        title="系统备用画布，只能查看，任务失败时由小说家自动引用"
      >
        <LockOutlined />
        <span className="canvas-tab-label__text">{displayName}</span>
      </span>
    ) : canvas.readOnly ? (
      <span
        className={`canvas-tab-label canvas-tab--readonly canvas-tab--${canvas.runState?.status ?? 'idle'}`}
        title="只读运行快照，不会影响原画布"
      >
        <RunTabIcon status={canvas.runState?.status} />
        <span className="canvas-tab-label__text">{displayName}</span>
      </span>
    ) : (
      <span className="canvas-tab-label">
        <span className="canvas-tab-label__text">{displayName}</span>
      </span>
    ),
  };
}

function CanvasTabs() {
  const { message } = App.useApp();
  const canvases = useCanvasStore((s) => s.canvases);
  const activeId = useCanvasStore((s) => s.activeId);
  const maxCanvases = useCanvasStore((s) => s.maxCanvases);
  const savedCanvases = useCanvasStore((s) => s.savedCanvases);
  const setActive = useCanvasStore((s) => s.setActive);
  const addCanvas = useCanvasStore((s) => s.addCanvas);
  const removeCanvas = useCanvasStore((s) => s.removeCanvas);
  const saveAndClose = useCanvasStore((s) => s.saveAndClose);

  const [closeNamingId, setCloseNamingId] = useState<string | null>(null);
  const [closeNameValue, setCloseNameValue] = useState('');
  const [fictionistExpanded, setFictionistExpanded] = useState(
    FICTIONIST_TABS_DEFAULT_EXPANDED,
  );

  const onEdit = (
    targetKey: React.MouseEvent | React.KeyboardEvent | string,
    action: 'add' | 'remove',
  ) => {
    if (action === 'add') {
      if (!addCanvas()) message.warning(canvasLimitMessage(maxCanvases));
      return;
    }
    const id = targetKey as string;
    const canvas = canvases.find((c) => c.id === id);
    if (canvas?.lockClose || canvas?.runState?.status === 'running') {
      message.warning('任务运行中，暂不能关闭该运行画布');
      return;
    }
    // 有未保存改动 -> 二次确认;空白/已保存画布直接关
    if (canvas && isCanvasDirty(canvas, savedCanvases)) {
      Modal.confirm({
        title: '关闭画布',
        content: `「${canvas.name}」有未保存的改动。`,
        // 按钮顺序:取消(左) / 不保存关闭(中,danger 弱化——会丢改动) / 保存并关闭(右,绿色实心——推荐的正向操作)
        footer: () => (
          <>
            <Button onClick={() => Modal.destroyAll()}>取消</Button>
            <Button
              danger
              onClick={() => {
                Modal.destroyAll();
                removeCanvas(id);
              }}
            >
              不保存关闭
            </Button>
            <Button
              color="green"
              variant="solid"
              onClick={() => {
                Modal.destroyAll();
                if (canvas.savedId) {
                  saveAndClose(id);
                  message.success('已保存并关闭画布');
                } else {
                  setCloseNamingId(id);
                  setCloseNameValue('');
                }
              }}
            >
              保存并关闭
            </Button>
          </>
        ),
      });
    } else {
      removeCanvas(id);
    }
  };

  const { ordinary, fictionist: fictionistCanvases } = partitionCanvasTabs(canvases);
  const ordinaryItems = ordinary.map(canvasTabItem);
  const fictionistItems = fictionistCanvases.map(canvasTabItem);
  const activeFictionistCanvas = fictionistCanvases.find((canvas) => canvas.id === activeId);

  const commitCloseNaming = () => {
    const id = closeNamingId;
    const name = closeNameValue.trim();
    if (!id) return;
    const check = validateCanvasName(name, savedCanvases);
    if (!check.ok) {
      message.warning(check.error);
      return;
    }
    saveAndClose(id, name);
    setCloseNamingId(null);
    setCloseNameValue('');
    message.success('已保存并关闭画布');
  };

  return (
    <div className="canvas-tabs">
      <Tabs
        className="canvas-tabs__ordinary"
        type="editable-card"
        size="small"
        animated={false}
        activeKey={activeId}
        onChange={setActive}
        onEdit={onEdit}
        items={ordinaryItems}
      />
      {fictionistItems.length > 0 ? (
        <section className={`canvas-package-tabs${activeFictionistCanvas ? ' is-active' : ''}`}>
          <button
            type="button"
            className="canvas-package-tabs__toggle"
            aria-expanded={fictionistExpanded}
            aria-controls="fictionist-canvas-tabs"
            aria-label={`${fictionistExpanded ? '收起' : '展开'}小说家画布（${fictionistItems.length}）`}
            onClick={() => setFictionistExpanded((expanded) => !expanded)}
          >
            <span className="canvas-package-tabs__heading">
              {fictionistExpanded ? <DownOutlined /> : <RightOutlined />}
              <BookOutlined />
              <strong>小说家画布</strong>
              <em>{fictionistItems.length}</em>
            </span>
            {activeFictionistCanvas ? (
              <span className="canvas-package-tabs__current">
                当前：{fictionistCanvasDisplayName(activeFictionistCanvas)}
              </span>
            ) : null}
          </button>
          {fictionistExpanded ? (
            <div className="canvas-package-tabs__content" id="fictionist-canvas-tabs">
              <Tabs
                type="editable-card"
                size="small"
                animated={false}
                hideAdd
                activeKey={activeId}
                onChange={setActive}
                onEdit={onEdit}
                items={fictionistItems}
              />
            </div>
          ) : null}
        </section>
      ) : null}
      <Modal
        title="保存并关闭画布"
        open={!!closeNamingId}
        onOk={commitCloseNaming}
        onCancel={() => setCloseNamingId(null)}
        okText="保存并关闭"
        cancelText="取消"
        destroyOnHidden
      >
        <p className="pearl-modal-copy pearl-modal-copy--compact">
          该画布尚未保存,请先命名(不能直接使用默认名)。
        </p>
        <Input
          autoFocus
          value={closeNameValue}
          onChange={(e) => setCloseNameValue(e.target.value)}
          onPressEnter={commitCloseNaming}
          placeholder="请输入画布名称"
          maxLength={40}
        />
      </Modal>
    </div>
  );
}

export default CanvasTabs;
