import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Modal, Input, type InputRef } from 'antd';
import {
  ApartmentOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  FileAddOutlined,
  SwapOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { Node } from '@xyflow/react';
import { useCanvasStore } from '../stores/canvasStore';
import { useAgentStore } from '../stores/agentStore';
import { uid } from '../lib/id';
import { normalizeToolTags } from '../lib/toolTagMigration';

interface Command {
  key: string;
  group: string;
  label: string;
  keywords: string;
  icon: React.ReactNode;
  run: () => void;
}

// 全局命令面板(Ctrl/Cmd+K):聚合「添加 Agent 节点 / 画布切换与保存运行 / 打开运行记录」。
// 运行与保存复用标题栏逻辑,通过 window 事件转发,避免重复实现运行/命名流程。
function dispatchTitleBarCommand(type: 'run' | 'save'): void {
  window.dispatchEvent(new CustomEvent('agent-titlebar-command', { detail: type }));
}

function CommandPalette() {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<InputRef>(null);

  const agents = useAgentStore((s) => s.agents);
  const canvases = useCanvasStore((s) => s.canvases);
  const activeId = useCanvasStore((s) => s.activeId);
  const runHistory = useCanvasStore((s) => s.runHistory);
  const maxCanvases = useCanvasStore((s) => s.maxCanvases);
  const addNode = useCanvasStore((s) => s.addNode);
  const addCanvas = useCanvasStore((s) => s.addCanvas);
  const setActive = useCanvasStore((s) => s.setActive);
  const openRun = useCanvasStore((s) => s.openRun);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuery('');
        setActiveIdx(0);
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const activeCanvas = canvases.find((c) => c.id === activeId);
  const canEditActive = !!activeCanvas && !activeCanvas.readOnly;

  const close = () => setOpen(false);

  const addAgentNode = (agentId: string) => {
    if (!activeCanvas) {
      message.warning('当前没有打开的画布');
      return;
    }
    if (!canEditActive) {
      message.warning('只读快照不可添加节点');
      return;
    }
    const def = agents.find((a) => a.id === agentId);
    if (!def) return;
    const count = activeCanvas.nodes.length;
    const node: Node = {
      id: uid('node'),
      type: 'agent',
      position: { x: 160 + (count % 5) * 48, y: 120 + (count % 5) * 48 },
      data: {
        agentId: def.id,
        label: def.name,
        description: def.description ?? '',
        systemPrompt: def.systemPrompt ?? '',
        toolTags: normalizeToolTags(def.toolTags),
        modelRef: def.modelRef ?? null,
        inputSchemaText: def.inputSchemaText ?? '',
        outputSchemaText: def.outputSchemaText ?? '',
      },
    };
    addNode(activeId, node);
    message.success(`已添加节点：${def.name}`);
  };

  const openHistoryRun = (runId: string) => {
    const already = canvases.some((c) => c.runId === runId);
    if (!already) {
      const record = runHistory.find((r) => r.id === runId);
      if (record && record.nodes.length === 0) {
        message.info('该运行记录较早,仅保留摘要信息,不可回看快照');
        return;
      }
      if (canvases.length >= maxCanvases) {
        message.warning(`最多只能同时打开 ${maxCanvases} 个画布,请先关闭一个`);
        return;
      }
    }
    openRun(runId);
  };

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    list.push({
      key: 'canvas-new',
      group: '画布',
      label: '新建画布',
      keywords: '新建画布 new canvas',
      icon: <FileAddOutlined />,
      run: () => {
        if (canvases.length >= maxCanvases) {
          message.warning(`最多只能同时打开 ${maxCanvases} 个画布`);
          return;
        }
        addCanvas();
      },
    });
    list.push({
      key: 'canvas-save',
      group: '画布',
      label: '保存当前画布',
      keywords: '保存 save',
      icon: <SaveOutlined />,
      run: () => dispatchTitleBarCommand('save'),
    });
    list.push({
      key: 'canvas-run',
      group: '运行',
      label: '运行当前画布',
      keywords: '运行 run 执行',
      icon: <PlayCircleOutlined />,
      run: () => dispatchTitleBarCommand('run'),
    });
    canvases
      .filter((c) => c.id !== activeId)
      .forEach((c) => {
        list.push({
          key: `switch-${c.id}`,
          group: '画布',
          label: `切换到：${c.name}`,
          keywords: `切换 switch ${c.name}`,
          icon: <SwapOutlined />,
          run: () => setActive(c.id),
        });
      });
    agents.forEach((a) => {
      list.push({
        key: `agent-${a.id}`,
        group: '添加 Agent 节点',
        label: a.name,
        keywords: `${a.name} ${a.description ?? ''}`,
        icon: <ApartmentOutlined />,
        run: () => addAgentNode(a.id),
      });
    });
    runHistory.slice(0, 20).forEach((r) => {
      list.push({
        key: `run-${r.id}`,
        group: '运行记录',
        label: `${r.canvasName}_${r.stamp}`,
        keywords: `${r.canvasName} ${r.stamp} ${r.time}`,
        icon: <ClockCircleOutlined />,
        run: () => openHistoryRun(r.id),
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, canvases, activeId, runHistory, maxCanvases]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const exec = (cmd?: Command) => {
    if (!cmd) return;
    close();
    cmd.run();
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      exec(filtered[activeIdx]);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      closable={false}
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
      afterOpenChange={(o) => o && inputRef.current?.focus()}
    >
      <div className="command-palette">
        <Input
          ref={inputRef}
          size="large"
          variant="borderless"
          placeholder="输入以搜索命令、Agent、画布或运行记录…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <div className="command-palette__list">
          {filtered.length === 0 ? (
            <div className="command-palette__empty">无匹配命令</div>
          ) : (
            filtered.map((c, i) => (
              <div
                key={c.key}
                className={`command-palette__item${
                  i === activeIdx ? ' command-palette__item--active' : ''
                }`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => exec(c)}
              >
                <span className="command-palette__icon">{c.icon}</span>
                <span className="command-palette__label">{c.label}</span>
                <span className="command-palette__group">{c.group}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export default CommandPalette;
