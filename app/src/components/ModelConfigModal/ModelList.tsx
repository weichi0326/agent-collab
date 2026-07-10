import { Button, Empty, Input, Switch, Tooltip } from 'antd';
import {
  AudioOutlined,
  CheckOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  SyncOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ModelCaps, ProviderConfig } from '../../stores/modelStore';
import SignalIcon from '../SignalIcon';

const CAP_META: { key: keyof ModelCaps; label: string; node: React.ReactNode }[] = [
  { key: 'longContext', label: '长上下文 (1M)', node: <span className="cap-pill__1m">1M</span> },
  { key: 'vision', label: '视觉 / 图像', node: <EyeOutlined /> },
  { key: 'audio', label: '语音 / 音频', node: <AudioOutlined /> },
];

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

interface ModelListProps {
  selectedConfig: ProviderConfig | undefined;
  fetchingId: string | null;
  newModel: string;
  setNewModel: (value: string) => void;
  editingModelId: string | null;
  editingLabel: string;
  setEditingLabel: (value: string) => void;
  onTest: (config: ProviderConfig) => void;
  onFetch: (config: ProviderConfig) => void;
  onAddModel: () => void;
  startRename: (modelId: string, current: string) => void;
  commitRename: (modelId: string) => void;
  removeModel: (configId: string, modelId: string) => void;
  toggleModel: (configId: string, modelId: string, enabled: boolean) => void;
  toggleCap: (configId: string, modelId: string, cap: keyof ModelCaps) => void;
  inferCaps: (configId: string, modelId: string) => void;
}

export function ModelList({
  selectedConfig,
  fetchingId,
  newModel,
  setNewModel,
  editingModelId,
  editingLabel,
  setEditingLabel,
  onTest,
  onFetch,
  onAddModel,
  startRename,
  commitRename,
  removeModel,
  toggleModel,
  toggleCap,
  inferCaps,
}: ModelListProps) {
  return (
    <div className="mc__right">
      <div className="mc__section-title">已添加的模型名称</div>
      <div className="mc__models-note">
        姬子会根据模型名称先自动识别长上下文、看图、音频能力；识别不准时可以手动点亮或关闭。
      </div>

      {!selectedConfig ? (
        <Empty
          description="保存或选中一个配置后,在此管理模型"
          style={{ padding: '48px 0' }}
        />
      ) : (
        <>
          <div className="mc__provider-bar">
            <span className="mc__provider-name">{selectedConfig.name}</span>
            <SignalIcon test={selectedConfig.test} />
            <div style={{ flex: 1 }} />
          </div>
          <div className="mc__meta">
            {selectedConfig.baseURL} · 密钥 {maskKey(selectedConfig.apiKey)}
          </div>

          <div className="mc__actions">
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={selectedConfig.test.status === 'testing'}
              onClick={() => onTest(selectedConfig)}
            >
              通信测试
            </Button>
            <Button
              size="small"
              icon={<CloudDownloadOutlined />}
              loading={fetchingId === selectedConfig.id}
              onClick={() => onFetch(selectedConfig)}
            >
              获取模型列表
            </Button>
          </div>
          <div className="mc__add-model">
            <Input
              size="small"
              placeholder="手动添加模型名称"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onPressEnter={onAddModel}
            />
            <Button size="small" icon={<PlusOutlined />} onClick={onAddModel} />
          </div>

          <div className="mc__models">
            {selectedConfig.models.length === 0 ? (
              <span className="mc__models-hint">
                点「获取模型列表」或手动添加模型
              </span>
            ) : (
              selectedConfig.models.map((m) => (
                <div key={m.id} className="model-row">
                  <div className="model-row__main">
                    {editingModelId === m.id ? (
                      <Input
                        size="small"
                        autoFocus
                        value={editingLabel}
                        placeholder={m.id}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        onPressEnter={() => commitRename(m.id)}
                        onBlur={() => commitRename(m.id)}
                        suffix={
                          <CheckOutlined
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => commitRename(m.id)}
                          />
                        }
                      />
                    ) : (
                      <>
                        <span className="model-row__name" title={m.id}>
                          {m.label || m.id}
                        </span>
                        {m.label && (
                          <span className="model-row__id">{m.id}</span>
                        )}
                        <EditOutlined
                          className="model-row__edit"
                          onClick={() => startRename(m.id, m.label ?? '')}
                        />
                      </>
                    )}
                  </div>

                  <div className="model-row__caps">
                    {CAP_META.map((cap) => (
                      <Tooltip key={cap.key} title={cap.label}>
                        <button
                          type="button"
                          className={`cap-pill${
                            m.caps[cap.key] ? ' cap-pill--on' : ''
                          }`}
                          onClick={() =>
                            toggleCap(selectedConfig.id, m.id, cap.key)
                          }
                        >
                          {cap.node}
                        </button>
                      </Tooltip>
                    ))}
                  </div>

                  <div className="model-row__ops">
                    <Tooltip title="按模型名称重新识别能力">
                      <button
                        type="button"
                        className="model-row__infer"
                        onClick={() => inferCaps(selectedConfig.id, m.id)}
                      >
                        <SyncOutlined />
                      </button>
                    </Tooltip>
                    <Switch
                      className="model-switch"
                      checked={m.enabled}
                      checkedChildren="On"
                      unCheckedChildren="Off"
                      onChange={(v) => toggleModel(selectedConfig.id, m.id, v)}
                    />
                    <DeleteOutlined
                      className="model-row__del"
                      onClick={() => removeModel(selectedConfig.id, m.id)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
