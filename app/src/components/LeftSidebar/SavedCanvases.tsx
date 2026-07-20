import { useRef, useState } from 'react';
import { App, Modal, Input, Button } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  ImportOutlined,
  PartitionOutlined,
} from '@ant-design/icons';
import {
  canvasLimitMessage,
  useCanvasStore,
  validateCanvasName,
} from '../../stores/canvasStore';
import { useToolStore } from '../../stores/toolStore';
import { mergeToolTags } from '../../lib/toolRegistry';
import { fileToText } from '../../lib/textFile';
import { exportCanvasToFile, parseCanvasImport } from '../../lib/canvasTransfer';

export function SavedCanvases() {
  const { message } = App.useApp();
  const savedCanvases = useCanvasStore((s) => s.savedCanvases);
  const openSaved = useCanvasStore((s) => s.openSaved);
  const deleteSaved = useCanvasStore((s) => s.deleteSaved);
  const renameSaved = useCanvasStore((s) => s.renameSaved);
  const importCanvas = useCanvasStore((s) => s.importCanvas);
  const canvases = useCanvasStore((s) => s.canvases);
  const maxCanvases = useCanvasStore((s) => s.maxCanvases);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    const check = validateCanvasName(name, savedCanvases, {
      excludeSavedId: renamingId,
    });
    if (!check.ok) {
      message.warning(check.error);
      return;
    }
    renameSaved(renamingId, name);
    setRenamingId(null);
    setRenameValue('');
    message.success('已重命名');
  };

  const onOpen = (id: string) => {
    const result = openSaved(id);
    if (result === 'limit') message.warning(canvasLimitMessage(maxCanvases));
    else if (result === 'not-found') message.warning('该已保存画布不存在或已被删除');
  };

  const onDelete = (id: string, name: string) => {
    const wasOpen = canvases.some((c) => c.savedId === id);
    deleteSaved(id);
    if (wasOpen) {
      message.warning(`画布「${name}」已删除，运行中的标签会保留为未保存画布`);
    } else {
      message.success(`画布「${name}」已删除`);
    }
  };

  const onExport = async (id: string) => {
    const sc = savedCanvases.find((x) => x.id === id);
    if (!sc) return;
    const hide = message.loading('导出中…', 0);
    try {
      const res = await exportCanvasToFile({
        name: sc.name,
        nodes: sc.nodes,
        edges: sc.edges,
      });
      if (res.status === 'ok') message.success('已导出');
      else if (res.status === 'error') message.error(res.message);
    } finally {
      hide();
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await fileToText(file);
      const knownTags = mergeToolTags(useToolStore.getState().customTools).map(
        (t) => t.value,
      );
      const { name, nodes, edges, droppedTags, clearedModelCount } =
        parseCanvasImport(text, knownTags);
      const ok = importCanvas(name, nodes, edges);
      if (!ok) {
        message.warning(canvasLimitMessage(maxCanvases));
        return;
      }
      message.success(`已导入画布「${name}」(${nodes.length} 个节点)`);
      if (droppedTags.length > 0) {
        message.warning(`本机不存在的工具标签已跳过：${droppedTags.join('、')}`);
      }
      if (clearedModelCount > 0) {
        message.info(`${clearedModelCount} 个节点需在属性面板重新选择模型后才能运行`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
    }
  };

  return (
    <div className="panel-body">
      <div style={{ marginBottom: 8 }}>
        <Button
          type="dashed"
          block
          icon={<ImportOutlined />}
          title="从文件导入画布"
          onClick={() => fileInputRef.current?.click()}
        >
          导入画布
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {savedCanvases.length === 0 ? (
        <div className="panel-empty">暂无已保存画布,点标题栏「保存」</div>
      ) : (
        savedCanvases.map((sc) => (
          <div
            key={sc.id}
            className="history-item"
            onClick={() => onOpen(sc.id)}
          >
            <PartitionOutlined className="history-item__icon" />
            <div className="history-item__text">
              <div className="history-item__canvas">{sc.name}</div>
              <div className="history-item__time">保存于 {sc.savedAt}</div>
            </div>
            <ExportOutlined
              className="history-item__del"
              title="导出画布"
              onClick={(e) => {
                e.stopPropagation();
                void onExport(sc.id);
              }}
            />
            <EditOutlined
              className="history-item__del"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation();
                openRename(sc.id, sc.name);
              }}
            />
            <DeleteOutlined
              className="history-item__del"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(sc.id, sc.name);
              }}
            />
          </div>
        ))
      )}
      <Modal
        title="重命名画布"
        open={!!renamingId}
        onOk={commitRename}
        onCancel={() => setRenamingId(null)}
        okText="重命名"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={commitRename}
          placeholder="请输入画布名称"
          maxLength={40}
        />
      </Modal>
    </div>
  );
}
