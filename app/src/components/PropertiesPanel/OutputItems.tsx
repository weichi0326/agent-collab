import { FileTextOutlined } from '@ant-design/icons';
import type { AgentNodeData } from '../../stores/canvasStore';

interface OutputItemsProps {
  lastOutput: AgentNodeData['lastOutput'];
  openOutputItem: (path?: string, deleted?: boolean) => void;
  // 运行时检测到磁盘上已不存在的产物路径(仅 UI 提示,不写入 store)
  missingPaths?: Set<string>;
}

export function OutputItems({
  lastOutput,
  openOutputItem,
  missingPaths,
}: OutputItemsProps) {
  if (!lastOutput || lastOutput.items.length === 0) {
    return (
      <div className="node-output-empty">
        运行后在此显示输出,双击打开(待执行引擎/桌面端接入)
      </div>
    );
  }

  return (
    <div className="node-output-list">
      {lastOutput.items.map((it) => {
        const missing = !!it.path && !!missingPaths?.has(it.path);
        const unavailable = it.deleted || missing;
        return (
          <div
            key={it.name}
            className={`node-output-item${
              unavailable ? ' node-output-item--deleted' : ''
            }`}
            title={
              it.deleted ? '产物已移除' : missing ? '该文件已不在磁盘' : '双击打开'
            }
            onDoubleClick={
              unavailable
                ? undefined
                : () => openOutputItem(it.path, it.deleted)
            }
          >
            <FileTextOutlined />
            <div className="node-output-item__body">
              <span>{it.name}</span>
              {missing && !it.deleted && (
                <div className="node-output-item__summary">该文件已不在磁盘</div>
              )}
              {it.summary && (
                <div className="node-output-item__summary">
                  摘要：{it.summary}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
