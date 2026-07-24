import { useEffect, useState } from 'react';
import { Input, Modal, Select } from 'antd';
import type {
  FictionCanonEntry,
  FictionCanonEntryType,
} from '../../features/fictionist/domain';
import {
  CANON_ENTRY_TYPE_OPTIONS,
} from './canonTypes';

export interface CanonEntryDraft {
  type: FictionCanonEntryType;
  name: string;
  summary: string;
  content: string;
}

interface CanonEditorProps {
  open: boolean;
  entry?: FictionCanonEntry;
  saving?: boolean;
  onCancel: () => void;
  onSave: (draft: CanonEntryDraft) => void;
}

const EMPTY_DRAFT: CanonEntryDraft = {
  type: 'character',
  name: '',
  summary: '',
  content: '',
};

export default function CanonEditor({
  open,
  entry,
  saving = false,
  onCancel,
  onSave,
}: CanonEditorProps) {
  const [draft, setDraft] = useState<CanonEntryDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(entry
      ? {
          type: entry.type,
          name: entry.name,
          summary: entry.summary,
          content: entry.content,
        }
      : EMPTY_DRAFT);
  }, [entry, open]);

  return (
    <Modal
      centered
      open={open}
      title={entry ? '编辑设定' : '新建设定'}
      okText={entry ? '保存设定' : '创建设定'}
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !draft.name.trim() }}
      onCancel={onCancel}
      onOk={() => onSave(draft)}
    >
      <div className="fictionist-canon-editor">
        <label>
          <span>设定类型</span>
          <Select<FictionCanonEntryType>
            value={draft.type}
            options={CANON_ENTRY_TYPE_OPTIONS}
            onChange={(value) => setDraft((current) => ({ ...current, type: value }))}
          />
        </label>
        <label>
          <span>名称</span>
          <Input
            autoFocus
            maxLength={80}
            value={draft.name}
            placeholder="例如：林砚、雾港或蓝墨水来信"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          <span>一句话说明</span>
          <Input
            maxLength={240}
            value={draft.summary}
            placeholder="用于在列表中快速识别这条设定"
            onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
          />
        </label>
        <label>
          <span>正式设定</span>
          <Input.TextArea
            autoSize={{ minRows: 8, maxRows: 18 }}
            value={draft.content}
            placeholder="记录外貌、背景、关系、限制或其他需要在创作中保持一致的事实。"
            onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
          />
        </label>
      </div>
    </Modal>
  );
}
