import { useMemo, useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, App, Popconfirm } from 'antd';
import {
  SearchOutlined,
  StarFilled,
  StarOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { PROVIDERS, getProvider, CUSTOM_ID } from '../lib/providers';
import { listModels, testConnection, type LLMConfig } from '../lib/llmClient';
import {
  useModelStore,
  type ProviderConfig,
} from '../stores/modelStore';
import { ModelList } from './ModelConfigModal/ModelList';

function toLLMConfig(config: ProviderConfig): LLMConfig {
  const preset = getProvider(config.providerId);
  return {
    api: preset?.api ?? 'openai',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  };
}

function ModelConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const configs = useModelStore((s) => s.configs);
  const addProvider = useModelStore((s) => s.addProvider);
  const updateProvider = useModelStore((s) => s.updateProvider);
  const removeProvider = useModelStore((s) => s.removeProvider);
  const toggleStar = useModelStore((s) => s.toggleStar);
  const setModels = useModelStore((s) => s.setModels);
  const addModel = useModelStore((s) => s.addModel);
  const removeModel = useModelStore((s) => s.removeModel);
  const toggleModel = useModelStore((s) => s.toggleModel);
  const renameModel = useModelStore((s) => s.renameModel);
  const toggleCap = useModelStore((s) => s.toggleCap);
  const inferCaps = useModelStore((s) => s.inferCaps);
  const setTest = useModelStore((s) => s.setTest);

  const [search, setSearch] = useState('');
  const [draftProviderId, setDraftProviderId] = useState<string | undefined>();
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [newModel, setNewModel] = useState('');
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  // M2 修复：mounted ref 防止弹窗关闭后 setTest/setFetchingId 写入已卸载组件
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const kw = search.trim().toLowerCase();

  const officialChips = useMemo(
    () =>
      PROVIDERS.filter((p) => p.group === 'official').filter(
        (p) => !kw || p.name.toLowerCase().includes(kw),
      ),
    [kw],
  );
  const relayChips = useMemo(
    () =>
      PROVIDERS.filter((p) => p.group === 'relay').filter(
        (p) => !kw || p.name.toLowerCase().includes(kw),
      ),
    [kw],
  );

  // 已配置数量(用于 chip 上的计数徽标)
  const countByProvider = useMemo(() => {
    const m = new Map<string, number>();
    configs.forEach((c) => m.set(c.providerId, (m.get(c.providerId) ?? 0) + 1));
    return m;
  }, [configs]);

  // 已配置实例:精选置顶(按标星时间),其余保持添加顺序;按搜索词过滤
  const visibleConfigs = useMemo(() => {
    const arr = [...configs].sort((a, b) => {
      if (a.starred && b.starred) return (a.starredAt ?? 0) - (b.starredAt ?? 0);
      if (a.starred) return -1;
      if (b.starred) return 1;
      return 0;
    });
    if (!kw) return arr;
    return arr.filter(
      (c) =>
        c.name.toLowerCase().includes(kw) ||
        c.models.some((m) => (m.label || m.id).toLowerCase().includes(kw)),
    );
  }, [configs, kw]);

  const selectedConfig = configs.find((c) => c.id === selectedConfigId);
  const formActive = !!draftProviderId || !!selectedConfigId;
  const adding = !!draftProviderId && !selectedConfigId;
  const customMode =
    draftProviderId === CUSTOM_ID ||
    (!!selectedConfig && selectedConfig.providerId === CUSTOM_ID);

  const startAdd = (providerId: string) => {
    setDraftProviderId(providerId);
    setSelectedConfigId(undefined);
    setNewModel('');
    if (providerId === CUSTOM_ID) {
      setName('');
      setBaseURL('');
    } else {
      const p = getProvider(providerId);
      setName(p?.name ?? '');
      setBaseURL(p?.baseURL ?? '');
    }
    setApiKey('');
  };

  const selectConfig = (cfg: ProviderConfig) => {
    setSelectedConfigId(cfg.id);
    setDraftProviderId(undefined);
    setName(cfg.name);
    setBaseURL(cfg.baseURL);
    setApiKey(cfg.apiKey);
    setNewModel('');
  };

  const onSave = () => {
    if (!formActive) {
      message.warning('请先在左侧选择厂商');
      return;
    }
    if (!name.trim()) {
      message.warning('请填写名称 / 备注');
      return;
    }
    if (!baseURL.trim()) {
      message.warning('请填写请求接口 url (baseURL)');
      return;
    }
    if (!apiKey.trim()) {
      message.warning('请填写密钥');
      return;
    }
    if (selectedConfigId) {
      updateProvider(selectedConfigId, {
        name: name.trim(),
        baseURL: baseURL.trim(),
        apiKey: apiKey.trim(),
      });
      message.success('配置已更新');
    } else {
      const id = addProvider(
        draftProviderId!,
        name.trim(),
        apiKey.trim(),
        baseURL.trim(),
      );
      setSelectedConfigId(id);
      setDraftProviderId(undefined);
      message.success(`已保存「${name.trim()}」配置`);
    }
  };

  const onTest = async (config: ProviderConfig) => {
    setTest(config.id, { status: 'testing' });
    const testModel =
      config.models.find((m) => m.enabled)?.id ?? config.models[0]?.id;
    const result = await testConnection(toLLMConfig(config), testModel);
    // 4.9：测试结果始终写入 store 持久化,即便弹窗已关闭,重新打开仍可见
    setTest(config.id, { status: result.status, latencyMs: result.latencyMs });
    if (result.status === 'fail') {
      message.error(
        testModel
          ? '真实对话测试失败，请检查模型是否可用于 chat/completions'
          : '通信测试失败(未添加模型时仅测试模型列表接口)',
      );
    } else if (testModel) {
      message.success(`真实对话测试通过：${testModel}`);
    }
  };

  const onFetch = async (config: ProviderConfig) => {
    setFetchingId(config.id);
    try {
      const ids = await listModels(toLLMConfig(config));
      if (!mountedRef.current) return; // M2：弹窗已关闭，放弃更新
      setModels(config.id, ids);
      message.success(`获取到 ${ids.length} 个模型`);
    } catch {
      if (!mountedRef.current) return;
      const preset = getProvider(config.providerId);
      if (preset?.defaultModels?.length) {
        setModels(config.id, preset.defaultModels);
        message.warning('在线获取失败,已载入内置默认模型(接入 Tauri 后可在线获取)');
      } else {
        message.error('获取模型列表失败(浏览器预览受 CORS 限制,可手动添加模型)');
      }
    } finally {
      if (mountedRef.current) setFetchingId(null);
    }
  };

  const onAddModel = () => {
    if (!selectedConfig) return;
    const id = newModel.trim();
    if (!id) return;
    addModel(selectedConfig.id, id);
    setNewModel('');
  };

  const startRename = (modelId: string, current: string) => {
    setEditingModelId(modelId);
    setEditingLabel(current);
  };
  const commitRename = (modelId: string) => {
    if (!selectedConfig) return;
    renameModel(selectedConfig.id, modelId, editingLabel);
    setEditingModelId(null);
  };

  const renderChip = (
    id: string,
    label: string,
    opts?: { custom?: boolean },
  ) => {
    const count = countByProvider.get(id) ?? 0;
    const active =
      draftProviderId === id ||
      (!!selectedConfig && selectedConfig.providerId === id && !draftProviderId);
    return (
      <button
        key={id}
        type="button"
        className={`mc-chip${active ? ' mc-chip--active' : ''}${
          opts?.custom ? ' mc-chip--custom' : ''
        }`}
        onClick={() => startAdd(id)}
      >
        {opts?.custom && <PlusOutlined />}
        <span className="mc-chip__name">{label}</span>
        {count > 0 && <span className="mc-chip__count">{count}</span>}
      </button>
    );
  };

  return (
    <Modal
      title="模型配置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1040}
      styles={{ body: { padding: 0 } }}
    >
      <div className="mc">
        {/* 左栏:厂商选择 + 表单 + 已配置实例 */}
        <div className="mc__left">
          <Input
            allowClear
            placeholder="搜索厂商或模型"
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 12 }}
          />

          {configs.length > 0 && (
            <>
              <div className="mc__section-title">已配置</div>
              <div className="mc__instances">
                {visibleConfigs.map((c) => (
                  <div
                    key={c.id}
                    className={`mc-inst${
                      c.id === selectedConfigId ? ' mc-inst--active' : ''
                    }`}
                    onClick={() => selectConfig(c)}
                  >
                    <span
                      className="mc-inst__star"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStar(c.id);
                      }}
                    >
                      {c.starred ? (
                        <StarFilled style={{ color: '#ffb400' }} />
                      ) : (
                        <StarOutlined />
                      )}
                    </span>
                    <span className="mc-inst__name">{c.name}</span>
                    <span className="mc-inst__badge">
                      {getProvider(c.providerId)?.name ?? '自定义'}
                    </span>
                    <Popconfirm
                      title="删除此配置?"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => {
                        removeProvider(c.id);
                        if (c.id === selectedConfigId) {
                          setSelectedConfigId(undefined);
                        }
                      }}
                    >
                      <DeleteOutlined
                        className="mc-inst__del"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mc__section-title">官方 API</div>
          <div className="mc__chips">
            {officialChips.map((p) => renderChip(p.id, p.name))}
          </div>

          <div className="mc__section-title">三方中转</div>
          <div className="mc__chips">
            {relayChips.map((p) => renderChip(p.id, p.name))}
            {renderChip(CUSTOM_ID, '自定义配置', { custom: true })}
          </div>

          {formActive && (
            <div className="mc__form">
              <div className="mc__form-title">
                {adding ? '新增配置' : '编辑配置'}
              </div>
              <div className="mc__field">
                <label>名称 / 备注</label>
                <Input
                  placeholder="例如:公司免费模型"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="mc__field">
                <label>请求接口 url (baseURL)</label>
                <Input
                  placeholder="https://.../v1"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                />
              </div>
              <div className="mc__field">
                <label>密钥</label>
                <Input.Password
                  placeholder="填入 API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              {customMode && (
                <div className="mc__hint">
                  自定义 / 中转商需手动填写 url 与密钥(OpenAI 兼容协议)
                </div>
              )}
              <Button type="primary" block onClick={onSave}>
                {selectedConfigId ? '更新配置' : '保存配置'}
              </Button>
            </div>
          )}
        </div>

        <ModelList
          selectedConfig={selectedConfig}
          fetchingId={fetchingId}
          newModel={newModel}
          setNewModel={setNewModel}
          editingModelId={editingModelId}
          editingLabel={editingLabel}
          setEditingLabel={setEditingLabel}
          onTest={onTest}
          onFetch={onFetch}
          onAddModel={onAddModel}
          startRename={startRename}
          commitRename={commitRename}
          removeModel={removeModel}
          toggleModel={toggleModel}
          toggleCap={toggleCap}
          inferCaps={inferCaps}
        />
      </div>
    </Modal>
  );
}

export default ModelConfigModal;
