import { useState } from 'react';
import { Segmented } from 'antd';
import { useUiStore } from '../stores/uiStore';
import ResizeHandle from './ResizeHandle';
import { AgentLibrary } from './LeftSidebar/AgentLibrary';
import { SpecialPalette } from './LeftSidebar/SpecialPalette';
import { SavedCanvases } from './LeftSidebar/SavedCanvases';
import { RunHistory } from './LeftSidebar/RunHistory';
import type { Tab } from './LeftSidebar/types';

function LeftSidebar() {
  const [tab, setTab] = useState<Tab>('agents');
  const leftWidth = useUiStore((s) => s.leftWidth);

  return (
    <div className="agent-sidebar" style={{ width: leftWidth }}>
      <ResizeHandle side="left" />
      <div className="workspace-panel-header">
        <Segmented
          block
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { label: 'Agent 库', value: 'agents' },
            { label: '画布', value: 'canvases' },
            { label: '运行历史', value: 'history' },
          ]}
        />
      </div>
      <div key={tab} className="sidebar-tabpane anim-fade-up">
        {tab === 'agents' && (
          <>
            <SpecialPalette />
            <AgentLibrary />
          </>
        )}
        {tab === 'canvases' && <SavedCanvases />}
        {tab === 'history' && <RunHistory />}
      </div>
    </div>
  );
}

export default LeftSidebar;
