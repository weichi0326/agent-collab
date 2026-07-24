import { BulbOutlined, FileTextOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Input, Tag } from 'antd';
import {
  MAX_OUTLINE_FIELD_CHARS,
  MAX_OUTLINE_DETAILS_CHARS,
  type FictionChapter,
  type FictionChapterOutline,
  type FictionProjectOutline,
  type FictionStoryOutline,
  type FictionVolume,
  type FictionVolumeOutline,
} from '../../features/fictionist/domain';

export type FictionOutlineTarget =
  | { kind: 'story' }
  | { kind: 'volume'; id: string }
  | { kind: 'chapter'; id: string };

export type StoryOutlineField = keyof FictionStoryOutline;
export type VolumeOutlineField = keyof FictionVolumeOutline;
export type ChapterOutlineField = keyof FictionChapterOutline;

interface OutlineEditorProps {
  projectTitle: string;
  target: FictionOutlineTarget;
  outline: FictionProjectOutline;
  volume?: FictionVolume;
  chapter?: FictionChapter;
  chapterNumber?: number;
  dirty: boolean;
  saving: boolean;
  onStoryChange: (field: StoryOutlineField, value: string) => void;
  onVolumeChange: (volumeId: string, field: VolumeOutlineField, value: string) => void;
  onChapterChange: (chapterId: string, field: ChapterOutlineField, value: string) => void;
  onSave: () => void;
  onImport: () => void;
  onOptimize: () => void;
  hasPendingReview?: boolean;
  onOpenPendingReview?: () => void;
}

const STORY_FIELDS: Array<{
  key: StoryOutlineField;
  label: string;
  placeholder: string;
  wide?: boolean;
  maxLength?: number;
}> = [
  { key: 'premise', label: '一句话梗概', placeholder: '用一到三句话说明主角、目标、阻力和故事结果', wide: true },
  { key: 'theme', label: '主题表达', placeholder: '这部小说最终想讨论什么' },
  { key: 'protagonistGoal', label: '主角目标', placeholder: '主角最想完成什么，以及为什么必须完成' },
  { key: 'coreConflict', label: '核心冲突', placeholder: '贯穿全书、持续升级的主要矛盾', wide: true },
  { key: 'endingDirection', label: '结局方向', placeholder: '主要人物和核心矛盾最终走向何处', wide: true },
  {
    key: 'details',
    label: '详细大纲',
    placeholder: '可直接导入本地大纲原文，也可以在这里补充完整剧情规划',
    wide: true,
    maxLength: MAX_OUTLINE_DETAILS_CHARS,
  },
];

const VOLUME_FIELDS: Array<{
  key: VolumeOutlineField;
  label: string;
  placeholder: string;
  wide?: boolean;
  maxLength?: number;
}> = [
  { key: 'summary', label: '本卷概述', placeholder: '概括本卷的主要推进和阶段结果', wide: true },
  { key: 'objective', label: '阶段目标', placeholder: '本卷需要完成的叙事目标' },
  { key: 'turningPoint', label: '关键转折', placeholder: '改变人物选择或故事方向的事件' },
  { key: 'climax', label: '高潮与收束', placeholder: '本卷高潮、阶段结局和通往下一卷的接口', wide: true },
  {
    key: 'details',
    label: '详细大纲',
    placeholder: '记录本卷完整剧情、章节分配或导入的原始卷纲',
    wide: true,
    maxLength: MAX_OUTLINE_DETAILS_CHARS,
  },
];

const CHAPTER_FIELDS: Array<{
  key: ChapterOutlineField;
  label: string;
  placeholder: string;
  wide?: boolean;
  maxLength?: number;
}> = [
  { key: 'summary', label: '本章概述', placeholder: '概括本章从开场到结尾发生的事情', wide: true },
  { key: 'objective', label: '本章目标', placeholder: '这一章必须推动什么' },
  { key: 'pointOfView', label: '视角人物', placeholder: '本章跟随谁的视角' },
  { key: 'conflict', label: '本章冲突', placeholder: '人物在本章面对的直接阻力', wide: true },
  { key: 'keyEvents', label: '关键事件', placeholder: '按发生顺序列出必须出现的场景或事件', wide: true },
  { key: 'clues', label: '线索与伏笔', placeholder: '新增、推进或回收哪些信息', wide: true },
  { key: 'hook', label: '结尾钩子', placeholder: '读者为什么会继续读下一章', wide: true },
  {
    key: 'details',
    label: '详细大纲',
    placeholder: '记录本章完整场景安排或导入的原始章节纲要',
    wide: true,
    maxLength: MAX_OUTLINE_DETAILS_CHARS,
  },
];

function filledFieldCount(values: Record<string, string>, keys: readonly string[]): number {
  return keys.filter((key) => values[key]?.trim()).length;
}

export default function OutlineEditor({
  projectTitle,
  target,
  outline,
  volume,
  chapter,
  chapterNumber,
  dirty,
  saving,
  onStoryChange,
  onVolumeChange,
  onChapterChange,
  onSave,
  onImport,
  onOptimize,
  hasPendingReview = false,
  onOpenPendingReview,
}: OutlineEditorProps) {
  const isStory = target.kind === 'story';
  const isVolume = target.kind === 'volume' && volume;
  const isChapter = target.kind === 'chapter' && chapter;
  const volumeOutline = isVolume ? outline.volumes[volume.id] : undefined;
  const chapterOutline = isChapter ? outline.chapters[chapter.id] : undefined;
  const fields = isStory ? STORY_FIELDS : isVolume ? VOLUME_FIELDS : CHAPTER_FIELDS;
  const values = isStory
    ? outline
    : isVolume
      ? volumeOutline ?? {}
      : chapterOutline ?? {};
  const title = isStory
    ? '故事总纲'
    : isVolume
      ? volume.title
      : chapter?.title ?? '章节纲要';
  const eyebrow = isStory
    ? `${projectTitle} · 作品级规划`
    : isVolume
      ? `${projectTitle} · 卷纲`
      : `${volume?.title ?? '未分卷'} · 第 ${chapterNumber ?? 0} 章`;
  const completedCount = filledFieldCount(
    values as Record<string, string>,
    fields.map((field) => field.key),
  );
  const detailsField = fields.find((field) => field.key === 'details');
  const detailsValue = isStory
    ? outline.details ?? ''
    : isVolume
      ? volumeOutline?.details ?? ''
      : chapterOutline?.details ?? '';
  const updateDetails = (value: string) => {
    if (isStory) onStoryChange('details', value);
    else if (isVolume) onVolumeChange(volume.id, 'details', value);
    else if (isChapter) onChapterChange(chapter.id, 'details', value);
  };

  return (
    <div className="fictionist-content-view fictionist-outline-editor">
      <header>
        <span>
          <small>{eyebrow}</small>
          <h1>{title}</h1>
        </span>
        <div className="fictionist-outline-actions">
          <Tag color={dirty ? 'gold' : 'green'}>{dirty ? '有未保存修改' : '已保存'}</Tag>
          {hasPendingReview ? (
            <Button icon={<FileTextOutlined />} onClick={onOpenPendingReview}>待确认结果</Button>
          ) : null}
          <Button icon={<UploadOutlined />} onClick={onImport}>导入大纲</Button>
          <Button icon={<BulbOutlined />} onClick={onOptimize}>AI 优化</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!dirty}
            onClick={onSave}
          >
            保存大纲
          </Button>
        </div>
      </header>

      <div className="fictionist-outline-progress" aria-label="大纲填写进度">
        <span><strong>{completedCount}</strong><small>已填写</small></span>
        <span><strong>{fields.length}</strong><small>当前项目</small></span>
        <span><strong>{outline.updatedAt ? '已建立' : '未建立'}</strong><small>正式大纲</small></span>
      </div>

      <div className="fictionist-outline-workspace">
        <section className="fictionist-outline-section fictionist-outline-structured">
          <div className="fictionist-outline-section-heading">
            <span>
              <strong>{isStory ? '故事核心' : isVolume ? '本卷结构' : '本章规划'}</strong>
              <small>{isStory ? '全书方向' : isVolume ? '阶段推进' : '写作执行单'}</small>
            </span>
            <Tag>{isStory ? '总纲' : isVolume ? '卷纲' : '章纲'}</Tag>
          </div>
          <div className="fictionist-outline-form">
            {isStory ? STORY_FIELDS.filter((field) => field.key !== 'details').map((field) => (
              <label className={field.wide ? 'is-wide' : ''} key={field.key}>
                <span>{field.label}</span>
                <Input.TextArea
                  aria-label={field.label}
                  autoSize={{ minRows: field.wide ? 3 : 2, maxRows: 8 }}
                  maxLength={field.maxLength ?? MAX_OUTLINE_FIELD_CHARS}
                  value={outline[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) => onStoryChange(field.key, event.target.value)}
                />
              </label>
            )) : isVolume ? VOLUME_FIELDS.filter((field) => field.key !== 'details').map((field) => (
              <label className={field.wide ? 'is-wide' : ''} key={field.key}>
                <span>{field.label}</span>
                <Input.TextArea
                  aria-label={field.label}
                  autoSize={{ minRows: field.wide ? 3 : 2, maxRows: 8 }}
                  maxLength={field.maxLength ?? MAX_OUTLINE_FIELD_CHARS}
                  value={volumeOutline?.[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) => onVolumeChange(volume.id, field.key, event.target.value)}
                />
              </label>
            )) : isChapter ? CHAPTER_FIELDS.filter((field) => field.key !== 'details').map((field) => (
              <label className={field.wide ? 'is-wide' : ''} key={field.key}>
                <span>{field.label}</span>
                <Input.TextArea
                  aria-label={field.label}
                  autoSize={{ minRows: field.wide ? 3 : 2, maxRows: 8 }}
                  maxLength={field.maxLength ?? MAX_OUTLINE_FIELD_CHARS}
                  value={chapterOutline?.[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) => onChapterChange(chapter.id, field.key, event.target.value)}
                />
              </label>
            )) : null}
          </div>
        </section>

        <section className="fictionist-outline-section fictionist-outline-details">
          <div className="fictionist-outline-section-heading">
            <span>
              <strong>详细大纲</strong>
              <small>{detailsValue.length.toLocaleString()} / {MAX_OUTLINE_DETAILS_CHARS.toLocaleString()} 字符</small>
            </span>
          </div>
          <Input.TextArea
            aria-label="详细大纲"
            maxLength={MAX_OUTLINE_DETAILS_CHARS}
            value={detailsValue}
            placeholder={detailsField?.placeholder}
            onChange={(event) => updateDetails(event.target.value)}
          />
        </section>
      </div>
    </div>
  );
}
