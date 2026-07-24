import { Input, Modal, Select } from 'antd';
import { useEffect, useState } from 'react';
import type {
  FictionChapter,
  FictionTimelineEvent,
  FictionTimelineEventKind,
} from '../../features/fictionist/domain';

export interface TimelineEventDraft {
  timeLabel: string;
  title: string;
  description: string;
  kind: FictionTimelineEventKind;
  sourceChapterId?: string;
  order?: number;
}

interface TimelineEditorProps {
  open: boolean;
  event?: FictionTimelineEvent;
  chapters: FictionChapter[];
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: TimelineEventDraft) => void;
}

const KIND_OPTIONS: Array<{ value: FictionTimelineEventKind; label: string }> = [
  { value: 'background', label: '背景事件' },
  { value: 'confirmed', label: '已确认' },
  { value: 'chapter', label: '章节事件' },
];

function initialDraft(event?: FictionTimelineEvent): TimelineEventDraft {
  return {
    timeLabel: event?.timeLabel ?? '',
    title: event?.title ?? '',
    description: event?.description ?? '',
    kind: event?.kind ?? 'chapter',
    sourceChapterId: event?.sourceChapterId,
    order: event?.order,
  };
}

export default function TimelineEditor({
  open,
  event,
  chapters,
  saving,
  onCancel,
  onSave,
}: TimelineEditorProps) {
  const [draft, setDraft] = useState<TimelineEventDraft>(() => initialDraft(event));

  useEffect(() => {
    if (open) setDraft(initialDraft(event));
  }, [event, open]);

  const update = <K extends keyof TimelineEventDraft>(key: K, value: TimelineEventDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const canSave = Boolean(draft.timeLabel.trim() && draft.title.trim());

  return (
    <Modal
      centered
      title={event ? '编辑时间线事件' : '新增时间线事件'}
      open={open}
      width={640}
      onCancel={onCancel}
      onOk={() => onSave(draft)}
      okText="保存事件"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !canSave }}
    >
      <div className="fictionist-create-form fictionist-timeline-form">
        <label>
          <span>时间标记</span>
          <Input
            autoFocus
            maxLength={60}
            placeholder="例如：今晚 · 03:10"
            value={draft.timeLabel}
            onChange={(event) => update('timeLabel', event.target.value)}
          />
        </label>
        <label>
          <span>事件名称</span>
          <Input
            maxLength={80}
            placeholder="例如：林砚发现铜钟仍在走"
            value={draft.title}
            onChange={(event) => update('title', event.target.value)}
          />
        </label>
        <label>
          <span>事件类型</span>
          <Select
            value={draft.kind}
            options={KIND_OPTIONS}
            onChange={(value: FictionTimelineEventKind) => update('kind', value)}
          />
        </label>
        <label>
          <span>关联章节</span>
          <Select
            allowClear
            value={draft.sourceChapterId}
            placeholder="可选，关联正文依据"
            options={chapters.map((chapter, index) => ({
              value: chapter.id,
              label: `${String(index + 1).padStart(2, '0')} ${chapter.title}`,
            }))}
            onChange={(value?: string) => update('sourceChapterId', value || undefined)}
          />
        </label>
        <label className="fictionist-timeline-form__wide">
          <span>事件说明</span>
          <Input.TextArea
            rows={4}
            maxLength={2000}
            showCount
            placeholder="记录事件事实、因果关系或需要保持一致的时间信息"
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
