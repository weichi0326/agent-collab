import type { RefObject } from 'react';
import { Input, Select, Tooltip, type SelectProps } from 'antd';
import {
  CloseCircleFilled,
  ClusterOutlined,
  GlobalOutlined,
  MedicineBoxOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { ACCEPT } from './constants';
import { fileIcon } from './fileHelpers';
import type { Attachment } from './types';

interface ComposerProps {
  draft: string;
  setDraft: (value: string) => void;
  attachments: Attachment[];
  removeAttachment: (id: string) => void;
  addFiles: (files: FileList | File[]) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  searchReady: boolean;
  webSearchOn: boolean;
  setWebSearchOn: (updater: (value: boolean) => boolean) => void;
  modelsLength: number;
  valueValid: boolean;
  currentValue: string | undefined;
  onChangeModel: (value: string | undefined) => void;
  options: SelectProps['options'];
  activeSending: boolean;
  onOpenSkillManager: () => void;
  onRunHealthCheck: () => void;
  healthChecking: boolean;
  onStop: () => void;
  onSend: () => void;
  // 诊断固定会话:只读,姬子自动写入,不允许用户手动发消息(确认卡仍在消息区可点)。
  readOnly?: boolean;
}

export function Composer({
  draft,
  setDraft,
  attachments,
  removeAttachment,
  addFiles,
  fileInputRef,
  searchReady,
  webSearchOn,
  setWebSearchOn,
  modelsLength,
  valueValid,
  currentValue,
  onChangeModel,
  options,
  activeSending,
  onOpenSkillManager,
  onRunHealthCheck,
  healthChecking,
  onStop,
  onSend,
  readOnly,
}: ComposerProps) {
  if (readOnly) {
    return (
      <div className="master-composer master-composer--readonly">
        <MedicineBoxOutlined />
        <span>诊断信息为姬子自动写入的只读会话，无法手动发送消息。</span>
      </div>
    );
  }
  return (
    <div className="master-composer">
      {attachments.length > 0 && (
        <div className="master-composer__attachments">
          {attachments.map((a) => (
            <div className="master-attachment-chip" key={a.id}>
              {a.isImage ? (
                <img src={a.previewUrl} alt={a.file.name} />
              ) : (
                <>
                  <span className="master-attachment-chip__icon">
                    {fileIcon(a.file.name)}
                  </span>
                  <span className="master-attachment-chip__name">
                    {a.file.name}
                  </span>
                </>
              )}
              <CloseCircleFilled
                className="master-attachment-chip__remove"
                onClick={() => removeAttachment(a.id)}
              />
            </div>
          ))}
        </div>
      )}

      <Input.TextArea
        className="master-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => {
          const imageFiles = Array.from(e.clipboardData.items)
            .filter(
              (item) =>
                item.kind === 'file' && item.type.startsWith('image/'),
            )
            .map((item) => item.getAsFile())
            .filter((f): f is File => f !== null);
          if (imageFiles.length > 0) {
            e.preventDefault();
            addFiles(imageFiles);
          }
        }}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            void onSend();
          }
        }}
        placeholder="向姬子提问，Enter 发送 / Shift+Enter 换行"
        autoSize={{ minRows: 1, maxRows: 4 }}
        variant="borderless"
        style={{ resize: 'none' }}
      />

      <div className="master-composer__actions">
        <div className="master-composer__actions-left">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="master-attach-btn"
            title="上传文件"
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusOutlined />
            附件
          </button>
          <button
            type="button"
            className="master-attach-btn"
            title="技能管理"
            onClick={onOpenSkillManager}
          >
            <ClusterOutlined />
            Skill
          </button>
          <button
            type="button"
            className="master-attach-btn"
            title="姬子一键体检"
            disabled={healthChecking}
            onClick={onRunHealthCheck}
          >
            <MedicineBoxOutlined />
            体检
          </button>
          <Tooltip
            title={
              searchReady ? '' : '请先在标题栏「搜索配置」中启用并填写密钥'
            }
          >
            <button
              type="button"
              className={`master-websearch${
                webSearchOn ? ' master-websearch--on' : ''
              }${searchReady ? '' : ' master-websearch--disabled'}`}
              disabled={!searchReady}
              onClick={() => setWebSearchOn((v) => !v)}
            >
              <GlobalOutlined />
              联网搜索
            </button>
          </Tooltip>
        </div>
        <div className="master-composer__actions-right">
          <Select
            size="small"
            variant="borderless"
            popupMatchSelectWidth={false}
            className="master-model-select"
            placeholder={modelsLength === 0 ? '未配置模型' : '选择模型'}
            value={valueValid ? currentValue : undefined}
            onChange={onChangeModel}
            options={options}
            disabled={modelsLength === 0}
            allowClear
          />
          {activeSending ? (
            <button
              type="button"
              className="master-send master-send--stop"
              title="停止"
              onClick={onStop}
            >
              <StopOutlined />
            </button>
          ) : (
            <button
              type="button"
              className="master-send"
              title="发送"
              disabled={activeSending || (!draft.trim() && attachments.length === 0)}
              onClick={() => void onSend()}
            >
              <SendOutlined />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
