import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Result, Spin } from 'antd';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import TitleBar from './components/TitleBar';
import LeftSidebar from './components/LeftSidebar';
import CanvasTabs from './components/CanvasTabs';
import CanvasArea from './components/CanvasArea';
import CanvasStatusBar from './components/CanvasStatusBar';
import PropertiesPanel from './components/PropertiesPanel';
import MasterAgentDrawer from './components/MasterAgentDrawer';
import AgentConfigModal from './components/AgentConfigModal';
import CommandPalette from './components/CommandPalette';
import ReportCenter from './components/ReportCenter/ReportCenter';
import JiziCommandCenter from './components/JiziCommandCenter';
import { useCanvasStore } from './stores/canvasStore';
import { useAgentStore } from './stores/agentStore';
import { useModelStore } from './stores/modelStore';
import { useSearchStore } from './stores/searchStore';
import { useMasterAgentStore } from './stores/masterAgentStore';
import { useUiStore } from './stores/uiStore';
import { useToolStore } from './stores/toolStore';
import { useTokenStatsStore } from './stores/tokenStatsStore';
import { useOrchestratorStore } from './stores/orchestratorStore';
import { useJiziSkillSettingsStore } from './stores/jiziSkillStore';
import './App.css';

// 桌面端 persist 从项目内 JSON 异步读盘,首帧数据为空。等所有 store 完成 hydration
// 再渲染主体,避免空态闪烁与 ensureCanvas 竞态(浏览器 localStorage 兜底为同步,几乎瞬时就绪)。
const PERSISTED = [
  useCanvasStore,
  useAgentStore,
  useModelStore,
  useSearchStore,
  useMasterAgentStore,
  useUiStore,
  useToolStore,
  useTokenStatsStore,
  useOrchestratorStore,
  useJiziSkillSettingsStore,
];

const HYDRATION_TIMEOUT_MS = 8000;

function useAllHydrated(): {
  hydrated: boolean;
  timedOut: boolean;
  forceReady: () => void;
} {
  const [hydrated, setHydrated] = useState(() =>
    PERSISTED.every((s) => s.persist.hasHydrated()),
  );
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    const check = () => {
      if (PERSISTED.every((s) => s.persist.hasHydrated())) {
        setTimedOut(false);
        setHydrated(true);
      }
    };
    const unsubs = PERSISTED.map((s) => s.persist.onFinishHydration(check));
    const timer = window.setTimeout(() => {
      if (!PERSISTED.every((s) => s.persist.hasHydrated())) {
        setTimedOut(true);
      }
    }, HYDRATION_TIMEOUT_MS);
    check();
    return () => {
      window.clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  }, [hydrated]);

  return {
    hydrated,
    timedOut,
    forceReady: () => {
      setTimedOut(false);
      setHydrated(true);
    },
  };
}

function App() {
  const { message } = AntdApp.useApp();
  const { hydrated, timedOut, forceReady } = useAllHydrated();
  const [startupReady, setStartupReady] = useState(false);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const [reportRefreshToken, setReportRefreshToken] = useState(0);
  const ensureCanvas = useCanvasStore((s) => s.ensureCanvas);
  const recoverInterruptedRuns = useCanvasStore((s) => s.recoverInterruptedRuns);
  useEffect(() => {
    if (!hydrated) return;
    const count = recoverInterruptedRuns();
    ensureCanvas();
    setStartupReady(true);
    if (count > 0) {
      message.warning(`已恢复 ${count} 个异常中断的运行任务`);
    }
  }, [hydrated, ensureCanvas, message, recoverInterruptedRuns]);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<string>('app-close-blocked', (event) => {
      message.warning(event.payload || '任务运行中，请先中止任务或等待运行完成。');
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [message]);
  useEffect(() => {
    if (!isTauri()) return;
    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const preventDevToolsKeys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const devtoolsShortcut =
        event.key === 'F12' ||
        (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key));
      if (devtoolsShortcut) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('contextmenu', preventContextMenu);
    window.addEventListener('keydown', preventDevToolsKeys, true);
    return () => {
      window.removeEventListener('contextmenu', preventContextMenu);
      window.removeEventListener('keydown', preventDevToolsKeys, true);
    };
  }, []);

  if (!hydrated || !startupReady) {
    if (!hydrated && timedOut) {
      return (
        <div className="app-loading">
          <Result
            status="warning"
            title="数据恢复耗时较久"
            subTitle="可以重载再试；若选择继续进入，部分数据可能尚未加载完成，界面可能显示不全，甚至在保存时覆盖未加载的内容。"
            extra={[
              <Button type="primary" key="reload" onClick={() => window.location.reload()}>
                重载
              </Button>,
              <Button key="continue" onClick={forceReady}>
                继续进入
              </Button>,
            ]}
          />
        </div>
      );
    }

    return (
      <div className="app-loading">
        <Spin description="加载数据中…" size="large">
          <div style={{ width: 120, height: 60 }} />
        </Spin>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar
        view={view}
        setView={setView}
        onRefreshReports={() => setReportRefreshToken((v) => v + 1)}
      />
      {view === 'workspace' && <MasterAgentDrawer />}
      {view === 'reports' ? (
        <div className="app-body app-body--reports anim-fade-up">
          <ReportCenter refreshToken={reportRefreshToken} />
        </div>
      ) : (
        <>
          <JiziCommandCenter />
          <div className="app-body anim-fade">
            <LeftSidebar />
            <div className="canvas-column">
            <CanvasTabs />
            <CanvasArea />
            <CanvasStatusBar />
          </div>
            <PropertiesPanel />
          </div>
        </>
      )}
      <AgentConfigModal />
      {view === 'workspace' && <CommandPalette />}
    </div>
  );
}

export default App;

