import { useEffect, useRef, useState } from 'react';
import { Modal, Input, Button, App, Switch } from 'antd';
import { ClearOutlined, DeleteOutlined, DownOutlined, InboxOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { useMasterAgentStore, DEFAULT_SYSTEM_PROMPT, type MemoryKind } from '../stores/masterAgentStore';
import { useOrchestratorStore } from '../stores/orchestratorStore';
import { useUiStore } from '../stores/uiStore';
import { TEXT_EXTENSIONS, isTextFile, fileToText } from '../lib/textFile';
import { isJiziDraftDirty, type JiziDraft } from '../settings/jiziDraft';

interface Props {
  open: boolean;
  onClose: () => void;
}

export interface JiziSettingsPanelProps {
  onDirtyChange: (dirty: boolean) => void;
  onSaved?: () => void;
  onCancel?: () => void;
}

const ACCEPT = TEXT_EXTENSIONS.map((ext) => `.${ext}`).join(',');
const PROMPT_CHAR_CAP = 14000; // 提示词截断上限，避免 prompt 过长(人格块已走缓存,成本可控)

function memoryDisplayLines(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentenceParts = clean
    .split(/[。！？；;]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentenceParts.length > 1) return sentenceParts;
  return clean
    .split(/，\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// 系统提示词只能通过导入本地文本文件设置,不支持手动编辑,支持恢复默认。
export function JiziSettingsPanel({
  onDirtyChange,
  onSaved,
  onCancel,
}: JiziSettingsPanelProps) {
  const { message } = App.useApp();
  const systemPrompt = useMasterAgentStore((s) => s.systemPrompt);
  const sourceName = useMasterAgentStore((s) => s.systemPromptSourceName);
  const memory = useMasterAgentStore((s) => s.memory);
  const applySystemPrompt = useMasterAgentStore((s) => s.applySystemPrompt);
  const addMemory = useMasterAgentStore((s) => s.addMemory);
  const removeMemory = useMasterAgentStore((s) => s.removeMemory);
  const organizeMemory = useMasterAgentStore((s) => s.organizeMemory);
  const autoDiagnose = useOrchestratorStore((s) => s.enabled);
  const setAutoDiagnose = useOrchestratorStore((s) => s.setEnabled);
  const drawerFullscreen = useUiStore((s) => s.drawerFullscreen);
  const setDrawerFullscreen = useUiStore((s) => s.setDrawerFullscreen);

  const [draft, setDraft] = useState(systemPrompt);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [draftSourceName, setDraftSourceName] = useState<string | null>(sourceName);
  const [baseline, setBaseline] = useState<JiziDraft>({
    text: systemPrompt,
    sourceName,
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onDirtyChange(isJiziDraftDirty({ text: draft, sourceName: draftSourceName }, baseline));
  }, [baseline, draft, draftSourceName, onDirtyChange]);

  const onReset = () => {
    setDraft(DEFAULT_SYSTEM_PROMPT);
    setDraftSourceName(null);
  };

  const onPickFile = async (file: File) => {
    if (!isTextFile(file)) {
      message.warning('请选择纯文本格式的文件(txt/md/csv/json/log/xml/yaml/yml)');
      return;
    }
    try {
      let text = await fileToText(file);
      if (text.length > PROMPT_CHAR_CAP) {
        text = text.slice(0, PROMPT_CHAR_CAP);
        message.warning(`文件内容过长,已截断至 ${PROMPT_CHAR_CAP} 字`);
      }
      setDraft(text);
      setDraftSourceName(file.name);
    } catch {
      message.error('读取文件失败');
    }
  };

  const onSave = () => {
    const text = draft.trim();
    if (!text) {
      message.warning('提示词不能为空');
      return;
    }
    applySystemPrompt(text, draftSourceName);
    const savedDraft = { text, sourceName: draftSourceName };
    setDraft(text);
    setBaseline(savedDraft);
    onDirtyChange(false);
    message.success('已保存');
    onSaved?.();
  };

  const sourceLabel =
    draftSourceName ?? (draft === DEFAULT_SYSTEM_PROMPT ? '默认' : '早期手动编辑(无关联文件)');

  const memorySections: { kind: MemoryKind; title: string }[] = [
    { kind: 'profile', title: '用户画像' },
    { kind: 'preferences', title: '长期偏好' },
    { kind: 'resources', title: '常用资源/项目事实' },
  ];
  const memoryCount = memorySections.reduce((total, section) => total + memory[section.kind].length, 0);

  const onAddMemory = (kind: MemoryKind) => {
    if (!memoryDraft.trim()) return;
    addMemory(kind, memoryDraft);
    setMemoryDraft('');
  };

  const onOrganizeMemory = () => {
    organizeMemory();
    message.success('已整理长期记忆');
  };

  return (
    <div className="jizi-settings-panel">
      <div className="jizi-display-mode-setting">
        <div className="jizi-display-mode-setting__copy">
          <strong>显示模式</strong>
          <span>控制姬子展开后使用半屏还是覆盖工作区。</span>
        </div>
        <Switch
          checked={drawerFullscreen}
          checkedChildren="全屏"
          unCheckedChildren="半屏"
          aria-label={`姬子显示模式，当前${drawerFullscreen ? '全屏' : '半屏'}`}
          onChange={setDrawerFullscreen}
        />
      </div>
      <p style={{ color: '#86909c', marginBottom: 8 }}>
        系统提示词决定姬子的身份设定与回答风格，请选择本地文本文件导入，保存后立即对新消息生效。
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPickFile(file);
          e.target.value = '';
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Button icon={<InboxOutlined />} onClick={() => fileInputRef.current?.click()}>
          选择文件导入
        </Button>
        <span style={{ color: '#86909c' }}>当前来源：{sourceLabel}</span>
      </div>
      <div className="master-config-preview">
        <button
          type="button"
          className="master-config-preview__toggle"
          onClick={() => setPreviewOpen((v) => !v)}
        >
          {previewOpen ? <DownOutlined /> : <RightOutlined />}
          <span>{previewOpen ? '收起人格文本预览' : '展开人格文本预览'}</span>
          <em>{draft.length.toLocaleString('en-US')} 字符</em>
        </button>
        {previewOpen ? (
          <Input.TextArea value={draft} disabled autoSize={{ minRows: 6, maxRows: 14 }} />
        ) : (
          <div className="master-config-preview__summary">
            当前人格文件已导入。预览默认收起，避免占用配置窗口空间。
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid #f0f0f0',
        }}
      >
        <Switch checked={autoDiagnose} onChange={setAutoDiagnose} />
        <span>节点失败时自动诊断</span>
      </div>
      <p style={{ color: '#86909c', margin: '6px 0 0' }}>
        开启后，画布节点运行失败时姬子会自动分析原因、必要时生成候选修复工具（安装仍需你审阅代码后确认）。
      </p>
      <div className="master-memory-manager">
        <div className="master-memory-manager__head">
          <div>
            <strong>长期记忆</strong>
            <span>姬子会按语义挑选相关记忆注入回答，你也可以在这里手动修正。</span>
          </div>
          <Button
            size="small"
            icon={<ClearOutlined />}
            disabled={memoryCount === 0}
            onClick={onOrganizeMemory}
          >
            整理记忆（{memoryCount}）
          </Button>
        </div>
        <Input
          value={memoryDraft}
          placeholder="输入一条要让姬子长期记住的内容"
          onChange={(e) => setMemoryDraft(e.target.value)}
        />
        {memorySections.map((section) => (
          <div className="master-memory-section" key={section.kind}>
            <div className="master-memory-section__title">
              {section.title}
              <Button
                size="small"
                icon={<PlusOutlined />}
                disabled={!memoryDraft.trim()}
                onClick={() => onAddMemory(section.kind)}
              >
                加到这里
              </Button>
            </div>
            <div className="master-memory-tags">
              {memory[section.kind].length === 0 ? (
                <span className="master-memory-empty">暂无</span>
              ) : (
                memory[section.kind].map((item, index) => {
                  const lines = memoryDisplayLines(item);
                  return (
                    <div
                      key={`${item}-${index}`}
                      className="master-memory-card"
                    >
                      <div className="master-memory-card__content">
                        {lines.length <= 1 ? (
                          <p>{lines[0] ?? item}</p>
                        ) : (
                          <ul>
                            {lines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <button
                        type="button"
                        title="删除"
                        onClick={() => removeMemory(section.kind, index)}
                      >
                        <DeleteOutlined />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button onClick={onReset}>恢复默认</Button>
        {onCancel && <Button onClick={onCancel}>取消</Button>}
        <Button type="primary" onClick={onSave}>保存</Button>
      </div>
    </div>
  );
}

function MasterConfigModal({ open, onClose }: Props) {
  return (
    <Modal
      title="姬子配置"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      className="master-config-modal pearl-dialog"
      rootClassName="pearl-dialog-root"
      footer={null}
      width={920}
    >
      <JiziSettingsPanel
        onDirtyChange={() => undefined}
        onSaved={onClose}
        onCancel={onClose}
      />
    </Modal>
  );
}

export default MasterConfigModal;
