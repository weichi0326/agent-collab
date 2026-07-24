import { useRef } from 'react';
import {
  BulbOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Button, Input, Modal, Segmented, Select, Tag } from 'antd';
import type {
  FictionOutlineImportStrategy,
  FictionOutlineOptimizationIntensity,
  FictionOutlineTaskOperation,
  FictionOutlineWorkflowResult,
} from '../../features/fictionist/outlineWorkflows';

export interface OutlineTargetOption {
  label: string;
  value: string;
}

interface OutlineImportModalProps {
  open: boolean;
  sourceName?: string;
  sourcePreview: string;
  sourceChars: number;
  accept: string;
  method: 'direct' | 'analyze';
  strategy: FictionOutlineImportStrategy;
  targetValue: string;
  targetOptions: OutlineTargetOption[];
  selectedModel?: string;
  modelOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  onCancel: () => void;
  onFile: (file: File) => void;
  onMethodChange: (value: 'direct' | 'analyze') => void;
  onStrategyChange: (value: FictionOutlineImportStrategy) => void;
  onTargetChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: () => void;
}

export function OutlineImportModal({
  open,
  sourceName,
  sourcePreview,
  sourceChars,
  accept,
  method,
  strategy,
  targetValue,
  targetOptions,
  selectedModel,
  modelOptions,
  loading,
  onCancel,
  onFile,
  onMethodChange,
  onStrategyChange,
  onTargetChange,
  onModelChange,
  onSubmit,
}: OutlineImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Modal
      centered
      title="导入本地大纲"
      open={open}
      width={760}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="submit"
          type="primary"
          icon={method === 'direct' ? <UploadOutlined /> : <FileSearchOutlined />}
          loading={loading}
          disabled={!sourceName || !sourceChars || (method === 'analyze' && !selectedModel)}
          onClick={onSubmit}
        >
          {method === 'direct' ? '直接导入' : '创建整理任务'}
        </Button>,
      ]}
    >
      <div className="fictionist-outline-dialog-form">
        <label>
          <span>导入目标</span>
          <Select value={targetValue} options={targetOptions} onChange={onTargetChange} />
        </label>
        <label>
          <span>导入方式</span>
          <Segmented
            block
            value={method}
            options={[
              { label: '直接导入', value: 'direct' },
              { label: 'AI 整理后导入', value: 'analyze' },
            ]}
            onChange={(value) => onMethodChange(value as 'direct' | 'analyze')}
          />
        </label>
        {method === 'direct' ? (
          <label>
            <span>写入方式</span>
            <Segmented
              block
              value={strategy}
              options={[
                { label: '替换详细大纲', value: 'replace' },
                { label: '追加到详细大纲', value: 'append' },
              ]}
              onChange={(value) => onStrategyChange(value as FictionOutlineImportStrategy)}
            />
          </label>
        ) : (
          <label>
            <span>使用模型</span>
            <Select
              value={selectedModel}
              options={modelOptions}
              placeholder={modelOptions.length > 0 ? '选择运行模型' : '请先在设置中启用模型'}
              onChange={onModelChange}
            />
          </label>
        )}
        <div className="fictionist-outline-file-picker">
          <input
            ref={inputRef}
            hidden
            type="file"
            accept={accept}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onFile(file);
            }}
          />
          <Button icon={<FolderOpenOutlined />} onClick={() => inputRef.current?.click()}>
            选择本地文本
          </Button>
          {sourceName ? (
            <span><strong>{sourceName}</strong><small>{sourceChars.toLocaleString()} 字符</small></span>
          ) : <span><strong>尚未选择文件</strong><small>支持纯文本类文件</small></span>}
        </div>
        {sourcePreview ? (
          <pre className="fictionist-outline-source-preview">{sourcePreview}</pre>
        ) : null}
        <p className="fictionist-modal-note">
          {method === 'direct'
            ? '直接导入不会猜测卷章结构，只写入所选层级的“详细大纲”。'
            : 'AI 只生成待确认结果；返回小说家并确认后才会写入正式大纲。'}
        </p>
      </div>
    </Modal>
  );
}

interface OutlineOptimizeModalProps {
  open: boolean;
  targetValue: string;
  targetOptions: OutlineTargetOption[];
  goals: string[];
  intensity: FictionOutlineOptimizationIntensity;
  requirements: string;
  selectedModel?: string;
  modelOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  onCancel: () => void;
  onTargetChange: (value: string) => void;
  onGoalsChange: (value: string[]) => void;
  onIntensityChange: (value: FictionOutlineOptimizationIntensity) => void;
  onRequirementsChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: () => void;
}

export function OutlineOptimizeModal({
  open,
  targetValue,
  targetOptions,
  goals,
  intensity,
  requirements,
  selectedModel,
  modelOptions,
  loading,
  onCancel,
  onTargetChange,
  onGoalsChange,
  onIntensityChange,
  onRequirementsChange,
  onModelChange,
  onSubmit,
}: OutlineOptimizeModalProps) {
  return (
    <Modal
      centered
      title="AI 优化大纲"
      open={open}
      width={760}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="submit"
          type="primary"
          icon={<BulbOutlined />}
          loading={loading}
          disabled={!selectedModel || goals.length === 0}
          onClick={onSubmit}
        >
          创建优化任务
        </Button>,
      ]}
    >
      <div className="fictionist-outline-dialog-form">
        <label>
          <span>优化范围</span>
          <Select value={targetValue} options={targetOptions} onChange={onTargetChange} />
        </label>
        <label>
          <span>优化方向</span>
          <Select
            mode="multiple"
            value={goals}
            options={[
              { label: '主线结构', value: '主线结构' },
              { label: '节奏推进', value: '节奏推进' },
              { label: '冲突升级', value: '冲突升级' },
              { label: '人物弧光', value: '人物弧光' },
              { label: '伏笔回收', value: '伏笔回收' },
              { label: '结尾收束', value: '结尾收束' },
            ]}
            onChange={onGoalsChange}
          />
        </label>
        <label>
          <span>修改强度</span>
          <Segmented
            block
            value={intensity}
            options={[
              { label: '保守调整', value: 'conservative' },
              { label: '适度优化', value: 'balanced' },
              { label: '大幅重构', value: 'rewrite' },
            ]}
            onChange={(value) => onIntensityChange(value as FictionOutlineOptimizationIntensity)}
          />
        </label>
        <label>
          <span>补充要求</span>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={1000}
            value={requirements}
            placeholder="例如：保留现有结局，加强第二卷的主角主动性"
            onChange={(event) => onRequirementsChange(event.target.value)}
          />
        </label>
        <label>
          <span>使用模型</span>
          <Select
            value={selectedModel}
            options={modelOptions}
            placeholder={modelOptions.length > 0 ? '选择运行模型' : '请先在设置中启用模型'}
            onChange={onModelChange}
          />
        </label>
        <p className="fictionist-modal-note">工作流只优化所选范围，结果确认前不会覆盖正式大纲。</p>
      </div>
    </Modal>
  );
}

interface OutlineReviewModalProps {
  open: boolean;
  operation: FictionOutlineTaskOperation;
  targetLabel: string;
  result?: FictionOutlineWorkflowResult;
  volumeLabels?: Readonly<Record<string, string>>;
  chapterLabels?: Readonly<Record<string, string>>;
  loading: boolean;
  onClose: () => void;
  onReopenCanvas: () => void;
  onDiscard: () => void;
  onApply: () => void;
}

interface OutlineReviewContentProps {
  targetLabel: string;
  result: FictionOutlineWorkflowResult;
  volumeLabels?: Readonly<Record<string, string>>;
  chapterLabels?: Readonly<Record<string, string>>;
}

interface OutlineReviewField {
  label: string;
  value?: string;
  details?: boolean;
}

function OutlineReviewEntry({
  level,
  title,
  fields,
}: {
  level: '全书' | '卷纲' | '章纲';
  title: string;
  fields: OutlineReviewField[];
}) {
  return (
    <article className="fictionist-outline-review-entry">
      <header>
        <span><small>{level}</small><strong>{title}</strong></span>
        <Tag>{level}</Tag>
      </header>
      <dl>
        {fields.map((field) => (
          <div className={field.details ? 'is-details' : ''} key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value?.trim() || '未填写'}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function OutlineReviewContent({
  targetLabel,
  result,
  volumeLabels = {},
  chapterLabels = {},
}: OutlineReviewContentProps) {
  const affected = [
    result.story ? '全书大纲' : '',
    result.volumes.length ? `${result.volumes.length} 个卷纲` : '',
    result.chapters.length ? `${result.chapters.length} 个章节纲要` : '',
  ].filter(Boolean).join('、');
  return (
    <div className="fictionist-outline-review">
      <div className="fictionist-outline-review-summary">
        <span><small>目标范围</small><strong>{targetLabel}</strong></span>
        <span><small>将更新</small><strong>{affected}</strong></span>
        <Tag color="green">待确认</Tag>
      </div>
      <section>
        <strong>本次调整</strong>
        {result.changeSummary.length > 0 ? (
          <ul>{result.changeSummary.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        ) : <p>工作流没有附加修改说明。</p>}
      </section>
      <div className="fictionist-outline-review-results">
        {result.story ? (
          <OutlineReviewEntry
            level="全书"
            title="故事总纲"
            fields={[
              { label: '一句话梗概', value: result.story.premise },
              { label: '主题表达', value: result.story.theme },
              { label: '主角目标', value: result.story.protagonistGoal },
              { label: '核心冲突', value: result.story.coreConflict },
              { label: '结局方向', value: result.story.endingDirection },
              { label: '详细大纲', value: result.story.details, details: true },
            ]}
          />
        ) : null}
        {result.volumes.map((volume, index) => (
          <OutlineReviewEntry
            key={volume.id}
            level="卷纲"
            title={volumeLabels[volume.id] ?? `第 ${index + 1} 个卷纲`}
            fields={[
              { label: '本卷概述', value: volume.summary },
              { label: '阶段目标', value: volume.objective },
              { label: '关键转折', value: volume.turningPoint },
              { label: '高潮与收束', value: volume.climax },
              { label: '详细大纲', value: volume.details, details: true },
            ]}
          />
        ))}
        {result.chapters.map((chapter, index) => (
          <OutlineReviewEntry
            key={chapter.id}
            level="章纲"
            title={chapterLabels[chapter.id] ?? `第 ${index + 1} 个章节纲要`}
            fields={[
              { label: '本章概述', value: chapter.summary },
              { label: '本章目标', value: chapter.objective },
              { label: '视角人物', value: chapter.pointOfView },
              { label: '本章冲突', value: chapter.conflict },
              { label: '关键事件', value: chapter.keyEvents },
              { label: '线索与伏笔', value: chapter.clues },
              { label: '结尾钩子', value: chapter.hook },
              { label: '详细大纲', value: chapter.details, details: true },
            ]}
          />
        ))}
      </div>
    </div>
  );
}

export function OutlineReviewModal({
  open,
  operation,
  targetLabel,
  result,
  volumeLabels,
  chapterLabels,
  loading,
  onClose,
  onReopenCanvas,
  onDiscard,
  onApply,
}: OutlineReviewModalProps) {
  return (
    <Modal
      centered
      title={operation === 'import' ? '确认整理后的大纲' : '确认优化后的大纲'}
      open={open}
      width={1100}
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
      onCancel={onClose}
      footer={[
        <Button key="canvas" onClick={onReopenCanvas}>重新打开画布</Button>,
        <Button key="discard" danger onClick={onDiscard}>放弃结果</Button>,
        <Button key="apply" type="primary" loading={loading} onClick={onApply}>
          写入正式大纲
        </Button>,
      ]}
    >
      {result ? (
        <>
          <OutlineReviewContent
            targetLabel={targetLabel}
            result={result}
            volumeLabels={volumeLabels}
            chapterLabels={chapterLabels}
          />
          <p className="fictionist-modal-note">点击“写入正式大纲”后才会保存；如果原大纲已被修改，系统会阻止覆盖。</p>
        </>
      ) : null}
    </Modal>
  );
}
