import { Button } from 'antd';
import {
  EditOutlined,
  ExpandOutlined,
  NodeCollapseOutlined,
  NodeExpandOutlined,
} from '@ant-design/icons';
import { Panel } from '@xyflow/react';

interface CanvasToolbarProps {
  allCollapsed: boolean;
  canCollapse: boolean;
  readOnly: boolean;
  setAllCollapsed: () => void;
  fitView: () => void;
  renameCanvas: () => void;
}

export function CanvasToolbar({
  allCollapsed,
  canCollapse,
  readOnly,
  setAllCollapsed,
  fitView,
  renameCanvas,
}: CanvasToolbarProps) {
  return (
    <Panel position="top-right">
      <div className="canvas-toolbar">
        <Button
          size="small"
          icon={allCollapsed ? <NodeExpandOutlined /> : <NodeCollapseOutlined />}
          disabled={readOnly || !canCollapse}
          onClick={setAllCollapsed}
        >
          {allCollapsed ? '展开全部' : '折叠全部'}
        </Button>
        <Button
          size="small"
          icon={<ExpandOutlined />}
          onClick={fitView}
        >
          适合屏幕
        </Button>
        <Button
          size="small"
          icon={<EditOutlined />}
          disabled={readOnly}
          onClick={renameCanvas}
        >
          重命名
        </Button>
      </div>
    </Panel>
  );
}
