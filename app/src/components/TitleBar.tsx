import { useEffect, useRef, useState } from 'react';
import { Space, Button, App, Modal, Input, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  BarChartOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SaveOutlined,
  ApiOutlined,
  GlobalOutlined,
  ToolOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  ArrowLeftOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  useCanvasStore,
  validateCanvasName,
  isCanvasDirty,
} from '../stores/canvasStore';
import ModelConfigModal from './ModelConfigModal';
import SearchConfigModal from './SearchConfigModal';
import ToolConfigModal from './ToolConfigModal';
import ServiceStatusDot from './ServiceStatusDot';
import {
  removeRunArtifacts,
  runCanvas,
  RunAbortedError,
} from '../lib/agentRunner';
import { listTools, restartPythonService } from '../lib/pythonClient';
import { openAppOutputDir } from '../lib/outputDirectory';
import {
  registerRunController,
  unregisterRunController,
} from '../lib/runControllers';
import { useAbortedRunStore } from '../stores/abortedRunStore';

interface TitleBarProps {
  view: 'workspace' | 'reports';
  setView: (view: 'workspace' | 'reports') => void;
  onRefreshReports: () => void;
}

function TitleBar({ view, setView, onRefreshReports }: TitleBarProps) {
  const { message } = App.useApp();
  const activeId = useCanvasStore((s) => s.activeId);
  const activeCanvas = useCanvasStore((s) =>
    s.canvases.find((c) => c.id === s.activeId),
  );
  const savedCanvases = useCanvasStore((s) => s.savedCanvases);
  const saveActive = useCanvasStore((s) => s.saveActive);
  const saveActiveAsNew = useCanvasStore((s) => s.saveActiveAsNew);

  const [naming, setNaming] = useState(false);
  const [nameValue, setNameValue] = useState('');
  // 命名框来源:'first' 首次保存(saveActive) / 'saveAs' 另存为新名(saveActiveAsNew)
  const [namingMode, setNamingMode] = useState<'first' | 'saveAs'>('first');
  // 命名/覆盖保存完成后是否紧接着运行(运行前置保存流程)
  const [pendingRun, setPendingRun] = useState(false);
  // 已保存但有改动时,运行前弹「另存为新名 / 覆盖保存」选择框
  const [dirtyRunOpen, setDirtyRunOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [restartingBackend, setRestartingBackend] = useState(false);
  // 中止残留产物清理走共享 store:整图运行与姬子子图重跑中止都汇入同一「任务已中止」Modal。
  const abortedRun = useAbortedRunStore((s) => s.abortedRun);
  const setAbortedRun = useAbortedRunStore((s) => s.setAbortedRun);
  const clearAbortedRun = useAbortedRunStore((s) => s.clearAbortedRun);
  const [removingArtifacts, setRemovingArtifacts] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const readOnly = !!activeCanvas?.readOnly;
  const onRestartBackend = async () => {
    // 运行中时按钮已 disabled,这里无需再拦截(2.8)
    setRestartingBackend(true);
    try {
      const status = await restartPythonService();
      if (status !== 'running') {
        message.warning('后台服务未启动，请先运行环境配置器');
        return;
      }
      const tools = await listTools();
      message.success(
        tools.length > 0
          ? `后台已重启，已加载 ${tools.length} 个工具`
          : '后台已重启，但暂未读取到工具列表',
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : '未知错误';
      message.error(`重启后台失败：${detail}`);
    } finally {
      setRestartingBackend(false);
    }
  };

  const onOpenOutputDir = async () => {
    try {
      await openAppOutputDir();
    } catch (e) {
      console.error('[open_output_dir]', e);
      message.error('打开输出目录失败');
    }
  };

  const doRun = async () => {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    // 按源画布 id 登记本次运行的中止控制器,供编排层「忽略失败」时停止画布(item 2)。
    const runCanvasId = activeId;
    registerRunController(runCanvasId, controller);
    setRunning(true);
    try {
      const result = await runCanvas(activeId, controller.signal);
      message.success(
        `运行完成：${result.nodeCount} 个节点，写出 ${result.writtenCount} 个文件`,
      );
    } catch (err) {
      if (err instanceof RunAbortedError) {
        if (err.artifacts.length > 0) {
          setAbortedRun({
            canvasId: err.canvasId ?? activeId,
            artifacts: err.artifacts,
            runId: err.runId,
          });
        } else {
          message.info('任务已中止');
        }
        return;
      }
      const detail = err instanceof Error ? err.message : '未知错误';
      message.error(`运行失败：${detail}`);
    } finally {
      unregisterRunController(runCanvasId, controller);
      abortRef.current = null;
      setRunning(false);
    }
  };

  const onAbortRun = () => {
    abortRef.current?.abort();
    message.info('正在中止任务...');
  };

  const onSave = () => {
    if (!activeCanvas) {
      message.warning('当前没有打开的画布');
      return;
    }
    // 已保存过 -> 直接覆盖更新
    if (activeCanvas.savedId) {
      saveActive();
      message.success('画布已更新');
      return;
    }
    // 首次保存 -> 弹命名框(不预填,默认名仅作占位提示)
    setNameValue('');
    setNamingMode('first');
    setPendingRun(false);
    setNaming(true);
  };

  // 另存为:无论是否已保存,都新建一条命名的 SavedCanvas
  const onSaveAs = () => {
    if (!activeCanvas) {
      message.warning('当前没有打开的画布');
      return;
    }
    setNameValue('');
    setNamingMode('saveAs');
    setPendingRun(false);
    setNaming(true);
  };

  const confirmName = () => {
    const name = nameValue.trim();
    const check = validateCanvasName(name, savedCanvases);
    if (!check.ok) {
      message.warning(check.error);
      return;
    }
    if (namingMode === 'saveAs') saveActiveAsNew(name);
    else saveActive(name);
    setNaming(false);
    message.success('画布已保存');
    if (pendingRun) {
      setPendingRun(false);
      void doRun();
    }
  };

  const cancelNaming = () => {
    setNaming(false);
    setPendingRun(false);
  };

  // 运行前置保存流程:空画布提示;未保存强制命名;已保存有改动询问另存/覆盖;干净直接运行
  const onRun = () => {
    if (running) {
      onAbortRun();
      return;
    }
    if (!activeCanvas) {
      message.warning('当前没有打开的画布');
      return;
    }
    const hasContent =
      activeCanvas.nodes.length > 0 || activeCanvas.edges.length > 0;
    if (!hasContent) {
      message.warning('画布为空,请先添加节点后再运行');
      return;
    }
    if (!activeCanvas.savedId) {
      setNameValue('');
      setNamingMode('first');
      setPendingRun(true);
      setNaming(true);
      return;
    }
    if (isCanvasDirty(activeCanvas, savedCanvases)) {
      setDirtyRunOpen(true);
      return;
    }
    void doRun();
  };

  // 已保存但有改动:覆盖保存后运行
  const onDirtyOverwrite = () => {
    setDirtyRunOpen(false);
    saveActive();
    message.success('画布已更新');
    void doRun();
  };

  // 已保存但有改动:另存为新名(走命名框,完成后运行)
  const onDirtySaveAs = () => {
    setDirtyRunOpen(false);
    setNameValue('');
    setNamingMode('saveAs');
    setPendingRun(true);
    setNaming(true);
  };

  const keepArtifacts = () => {
    clearAbortedRun();
    message.success('已保留本次产物');
  };

  const removeArtifacts = async () => {
    if (!abortedRun) return;
    setRemovingArtifacts(true);
    try {
      const count = await removeRunArtifacts(
        abortedRun.canvasId,
        abortedRun.artifacts,
        abortedRun.runId,
      );
      clearAbortedRun();
      message.success(`已移除 ${count} 个产物文件`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : '未知错误';
      message.error(`移除产物失败：${detail}`);
    } finally {
      setRemovingArtifacts(false);
    }
  };

  // 命令面板(Ctrl+K)通过 window 事件转发运行/保存,复用此处的完整流程。
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  useEffect(() => {
    const handler = (e: Event) => {
      const type = (e as CustomEvent).detail;
      if (type === 'run') onRunRef.current();
      else if (type === 'save') onSaveRef.current();
    };
    window.addEventListener('agent-titlebar-command', handler);
    return () => window.removeEventListener('agent-titlebar-command', handler);
  }, []);

  const settingsItems: MenuProps['items'] = [
    { key: 'model', icon: <ApiOutlined />, label: '模型配置' },
    { key: 'search', icon: <GlobalOutlined />, label: '搜索配置' },
    { key: 'tool', icon: <ToolOutlined />, label: '工具库' },
  ];

  const onSettingsClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'model') setModelOpen(true);
    else if (key === 'search') setSearchOpen(true);
    else if (key === 'tool') setToolOpen(true);
  };

  return (
    <div className="title-bar">
      <div className="title-bar__logo">AI</div>
      <span className="title-bar__name">多 Agent 协同工具</span>
      <span className={`title-bar__mode title-bar__mode--${view}`}>
        {view === 'reports' ? '报告中心' : '工作台'}
      </span>
      <div className="title-bar__spacer" />
      {view === 'reports' ? (
        <Space>
          <Button
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => setView('workspace')}
          >
            返回工作台
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={onRefreshReports}
          >
            刷新
          </Button>
          <Button
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => void onOpenOutputDir()}
          >
            打开输出目录
          </Button>
        </Space>
      ) : (
      <Space>
        <Button
          size="small"
          icon={<BarChartOutlined />}
          onClick={() => setView('reports')}
        >
          报告中心
        </Button>
        <Dropdown
          menu={{ items: settingsItems, onClick: onSettingsClick }}
          trigger={['click']}
        >
          <Button size="small" icon={<SettingOutlined />}>
            设置
          </Button>
        </Dropdown>
        <Button
          className="title-bar__restart-backend"
          size="small"
          loading={restartingBackend}
          disabled={running}
          onClick={onRestartBackend}
        >
          <span className="title-bar__restart-backend-label">
            <span>重启后台</span>
            <ServiceStatusDot className="service-dot--in-button" />
          </span>
        </Button>
        <Button
          size="small"
          icon={<SaveOutlined />}
          disabled={readOnly || running}
          title={readOnly ? '只读快照不可保存' : undefined}
          onClick={onSave}
        >
          保存
        </Button>
        <Button
          size="small"
          disabled={readOnly || running}
          title={readOnly ? '只读快照不可另存' : '另存为一个新画布'}
          onClick={onSaveAs}
        >
          另存为
        </Button>
        <Button
          size="small"
          type="primary"
          danger={running}
          icon={running ? <StopOutlined /> : <PlayCircleOutlined />}
          disabled={readOnly && !running}
          title={readOnly ? '只读快照不可运行' : undefined}
          onClick={onRun}
        >
          {running ? '中止任务' : '运行'}
        </Button>
      </Space>
      )}

      <Modal
        title={namingMode === 'saveAs' ? '另存为新画布' : '保存画布'}
        open={naming}
        onOk={confirmName}
        onCancel={cancelNaming}
        okText={pendingRun ? '保存并运行' : '保存'}
        cancelText="取消"
        destroyOnHidden
      >
        <p style={{ color: '#86909c', marginBottom: 8 }}>
          {namingMode === 'saveAs'
            ? '为新画布命名(不能直接使用默认名)'
            : '首次保存需要为画布命名(不能直接使用默认名)'}
        </p>
        <Input
          autoFocus
          placeholder={
            activeCanvas ? `请输入画布名称(如:${activeCanvas.name})` : '请输入画布名称'
          }
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onPressEnter={confirmName}
        />
      </Modal>

      <Modal
        title="运行前保存"
        open={dirtyRunOpen}
        onCancel={() => setDirtyRunOpen(false)}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setDirtyRunOpen(false)}>
            取消
          </Button>,
          <Button key="saveAs" onClick={onDirtySaveAs}>
            另存为新名
          </Button>,
          <Button key="overwrite" type="primary" onClick={onDirtyOverwrite}>
            覆盖保存
          </Button>,
        ]}
      >
        <p style={{ color: '#86909c' }}>
          当前画布有未保存的改动,运行前需先保存。你可以覆盖保存到原画布,或另存为一个新画布。
        </p>
      </Modal>

      <Modal
        title="任务已中止"
        open={!!abortedRun}
        onCancel={keepArtifacts}
        destroyOnHidden
        footer={[
          <Button
            key="keep"
            disabled={removingArtifacts}
            onClick={keepArtifacts}
          >
            保留产物
          </Button>,
          <Button
            key="remove"
            danger
            type="primary"
            loading={removingArtifacts}
            onClick={removeArtifacts}
          >
            移除产物
          </Button>,
        ]}
      >
        <p style={{ color: '#4e5969', marginBottom: 8 }}>
          本次任务已中止，但已经生成了 {abortedRun?.artifacts.length ?? 0}{' '}
          个产物文件。请选择是否保留这些文件。
        </p>
        <p style={{ color: '#86909c', marginBottom: 0 }}>
          选择移除后，会删除已知产物文件，并尝试清理空的产物文件夹。
        </p>
      </Modal>

      <ModelConfigModal open={modelOpen} onClose={() => setModelOpen(false)} />
      <SearchConfigModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ToolConfigModal open={toolOpen} onClose={() => setToolOpen(false)} />
    </div>
  );
}

export default TitleBar;
