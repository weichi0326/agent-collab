import { useMemo, useRef, useState } from 'react';
import { App, Button, Dropdown, Input, Space } from 'antd';
import type { MenuProps } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  HolderOutlined,
  ImportOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { PRESET_TEMPLATES, useAgentStore } from '../../stores/agentStore';
import { useAgentEditorStore } from '../../stores/agentEditorStore';
import { useToolStore } from '../../stores/toolStore';
import { mergeToolTags } from '../../lib/toolRegistry';
import { fileToText } from '../../lib/textFile';
import { countAgentRefs } from './agentRefs';
import { exportAgentToFile, parseAgentImport } from '../../lib/agentTransfer';
import { useOnboardingStore } from '../../onboarding/onboardingStore';

export function AgentLibrary() {
  const { message, modal } = App.useApp();
  const agents = useAgentStore((s) => s.agents);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const cloneAgent = useAgentStore((s) => s.cloneAgent);
  const reorderAgent = useAgentStore((s) => s.reorderAgent);
  const openNew = useAgentEditorStore((s) => s.openNew);
  const openEdit = useAgentEditorStore((s) => s.openEdit);
  const tutorialAgentIds = useOnboardingStore((s) => s.tutorialAgentIds);

  const [query, setQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q),
    );
  }, [agents, query]);

  const menuItems: MenuProps['items'] = PRESET_TEMPLATES.map((t) => ({
    key: t.key,
    label: t.label,
  }));
  const onPickTemplate: MenuProps['onClick'] = ({ key }) => {
    const tpl = PRESET_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    const id = addAgent(tpl.draft);
    openEdit(id);
  };

  const onClone = (id: string) => {
    const newId = cloneAgent(id);
    if (newId) message.success('已克隆');
  };

  const onExport = async (id: string) => {
    const agent = useAgentStore.getState().agents.find((a) => a.id === id);
    if (!agent) return;
    const hide = message.loading('正在导出…', 0);
    try {
      const res = await exportAgentToFile(agent);
      if (res.status === 'ok') message.success('已导出');
      else if (res.status === 'error') message.error(res.message);
    } finally {
      hide();
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await fileToText(file);
      const knownTags = mergeToolTags(useToolStore.getState().customTools).map((t) => t.value);
      const { draft, droppedTags, modelHint } = parseAgentImport(text, knownTags);
      const id = addAgent(draft);
      openEdit(id);
      message.success(`已导入「${draft.name}」`);
      if (droppedTags.length > 0) {
        message.warning(`本机不存在的工具标签已跳过：${droppedTags.join('、')}`);
      }
      if (modelHint) {
        message.info(`原用模型「${modelHint}」，请在编辑器中重新选择模型`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
    }
  };

  const onDelete = (id: string, name: string) => {
    const refs = countAgentRefs(id);
    modal.confirm({
      title: `删除 Agent「${name}」`,
      content:
        refs > 0
          ? `该 Agent 被 ${refs} 个画布节点引用,删除后这些节点将显示为「已删除」。确认删除?`
          : '删除后不可恢复,确认删除?',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        removeAgent(id);
        message.success(`已删除「${name}」`);
      },
    });
  };

  return (
    <>
      <div style={{ padding: '12px 12px 0' }}>
        <Input
          size="small"
          placeholder="搜索 Agent"
          prefix={<SearchOutlined />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Space.Compact className="agent-new-btn">
            <Button type="dashed" onClick={() => openNew()}>
              <PlusOutlined /> 新建 Agent
            </Button>
            <Dropdown
              menu={{ items: menuItems, onClick: onPickTemplate }}
              trigger={['click']}
            >
              <Button type="dashed" icon={<DownOutlined />} />
            </Dropdown>
          </Space.Compact>
          <Button
            type="dashed"
            icon={<ImportOutlined />}
            title="从文件导入 Agent"
            onClick={() => fileInputRef.current?.click()}
          >
            导入
          </Button>
        </div>
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
      <div className="panel-body">
        {agents.length === 0 ? (
          <div className="panel-empty">暂无 Agent,点上方「新建 Agent」</div>
        ) : filtered.length === 0 ? (
          <div className="panel-empty">没有匹配的 Agent</div>
        ) : (
          filtered.map((a) => (
            <div
              key={a.id}
              data-agent-id={a.id}
              data-onboarding={
                a.id === tutorialAgentIds?.[0]
                  ? 'tutorial-agent-first'
                  : a.id === tutorialAgentIds?.[1]
                    ? 'tutorial-agent-second'
                    : undefined
              }
              className={`agent-card${draggingId === a.id ? ' agent-card--dragging' : ''}`}
              draggable
              onDragStart={(e) => {
                setDraggingId(a.id);
                e.dataTransfer.setData(
                  'application/agent',
                  JSON.stringify({ agentId: a.id, name: a.name }),
                );
                e.dataTransfer.setData('application/agent-sort', a.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!draggingId || draggingId === a.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                const fromId = e.dataTransfer.getData('application/agent-sort');
                if (!fromId || fromId === a.id) return;
                e.preventDefault();
                reorderAgent(fromId, a.id);
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
            >
              <RobotOutlined className="agent-card__icon" />
              <span className="agent-card__name">{a.name}</span>
              <span className="agent-card__actions">
                <EditOutlined
                  className="agent-card__act"
                  title="编辑"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(a.id);
                  }}
                />
                <CopyOutlined
                  className="agent-card__act"
                  title="克隆"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClone(a.id);
                  }}
                />
                <ExportOutlined
                  className="agent-card__act"
                  title="导出"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExport(a.id);
                  }}
                />
                <DeleteOutlined
                  className="agent-card__act agent-card__act--danger"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(a.id, a.name);
                  }}
                />
              </span>
              <HolderOutlined className="agent-card__grip" />
            </div>
          ))
        )}
      </div>
    </>
  );
}
