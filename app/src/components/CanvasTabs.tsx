import { useState } from 'react';
import { Tabs, Input, App, Modal, Button } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  EyeOutlined,
  LoadingOutlined,
  PauseCircleFilled,
} from '@ant-design/icons';
import {
  useCanvasStore,
  canvasLimitMessage,
  isCanvasDirty,
  validateCanvasName,
  type CanvasRunStatus,
} from '../stores/canvasStore';

function RunTabIcon({ status }: { status?: CanvasRunStatus }) {
  if (status === 'running') return <LoadingOutlined />;
  if (status === 'success') return <CheckCircleFilled />;
  if (status === 'failed') return <CloseCircleFilled />;
  if (status === 'cancelled') return <PauseCircleFilled />;
  return <EyeOutlined />;
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

  const items = canvases.map((c) => ({
    key: c.id,
    // 4.8：运行中的画布隐藏关闭按钮(closable:false),避免误关正在跑的任务;结束后恢复可关闭
    closable: !(c.lockClose || c.runState?.status === 'running'),
    label: c.readOnly ? (
      // 只读快照 tab:眼睛图标标识,不可重命名
      <span
        className={`canvas-tab-label canvas-tab--readonly canvas-tab--${c.runState?.status ?? 'idle'}`}
        title="只读运行快照，不会影响原画布"
      >
        <RunTabIcon status={c.runState?.status} />
        <span className="canvas-tab-label__text">{c.name}</span>
      </span>
    ) : (
      <span className="canvas-tab-label">
        <span className="canvas-tab-label__text">{c.name}</span>
      </span>
    ),
  }));

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
        type="editable-card"
        size="small"
        animated={false}
        activeKey={activeId}
        onChange={setActive}
        onEdit={onEdit}
        items={items}
      />
      <Modal
        title="保存并关闭画布"
        open={!!closeNamingId}
        onOk={commitCloseNaming}
        onCancel={() => setCloseNamingId(null)}
        okText="保存并关闭"
        cancelText="取消"
        destroyOnHidden
      >
        <p style={{ color: '#86909c', marginBottom: 8 }}>
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
