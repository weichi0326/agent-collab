import { useState, useEffect } from 'react';
import { Modal, Tag, Button, Empty, Input, Popconfirm, App, Spin } from 'antd';
import {
  CheckCircleFilled,
  LoadingOutlined,
  CloseCircleFilled,
  DeleteOutlined,
} from '@ant-design/icons';
import { TOOL_REGISTRY, type ToolDef } from '../lib/toolRegistry';
import {
  getServiceStatus,
  executeTool,
  type ServiceStatus,
  type ToolMeta,
  type ToolMetaCapability,
  type ToolMetaImplementation,
} from '../lib/pythonClient';
import { useToolStore } from '../stores/toolStore';
import { startToolStatusPolling } from '../settings/toolPolling';

const CAP_FOLD_THRESHOLD = 5;
const STATUS_POLL_MS = 3000; // 轮询间隔

interface Props {
  open: boolean;
  onClose: () => void;
}

export const TOOL_CONFIG_MODAL_CLASS_NAME = 'tool-config-modal pearl-dialog';

export interface ToolSettingsPanelProps {
  active: boolean;
}

function inferCustomImplementation(meta: ToolMeta): ToolMetaImplementation {
  if (meta.implementation) return meta.implementation;
  return {
    language: 'Python 3.10+',
    libraries: meta.dependencies.length > 0 ? meta.dependencies : ['标准库'],
    note:
      meta.source === 'generated'
        ? '由姬子生成并经安装器注册；通过统一 execute(params) 入口接收 JSON 参数，执行后返回可序列化结果。'
        : '通过工具安装器注册；运行时由 Python 服务动态加载模块并调用 execute(params)。',
  };
}

function inferCustomCapabilities(meta: ToolMeta): ToolMetaCapability[] {
  if (meta.capabilities && meta.capabilities.length > 0) return meta.capabilities;

  const tags = new Set(meta.tags.map((tag) => tag.toLowerCase()));
  if (tags.has('api') || tags.has('http') || tags.has('test')) {
    return [
      { label: '发送 HTTP 请求', description: '支持按 params 指定 method、url、headers、params、json/body 和 timeout' },
      { label: '读取响应信息', description: '返回状态码、响应头、响应体/JSON 和请求耗时，便于 Agent 判断接口表现' },
      { label: '状态码断言', description: '可用 expected_status 判断接口是否符合预期，适合接口冒烟测试' },
      { label: '通用接口测试', description: '没有固定接口地址，运行时由 Agent 或用户传入目标 URL 与请求参数' },
    ];
  }

  return [
    { label: '执行自定义逻辑', description: meta.description || '按工具代码中的 execute(params) 执行任务' },
    { label: 'JSON 参数输入', description: '通过 params 对象接收参数，适合 Agent 节点自动传参或手动试运行' },
    { label: '结构化结果输出', description: '返回 JSON 可序列化结果，方便下游 Agent 继续读取和处理' },
  ];
}

// 服务状态横幅（弹窗顶部）
function ServiceBanner({ status }: { status: ServiceStatus | 'checking' }) {
  const config: Record<
    ServiceStatus | 'checking',
    { icon: React.ReactNode; text: string; cls: string }
  > = {
    checking: {
      icon: <LoadingOutlined />,
      text: '正在检测 Python 服务…',
      cls: 'tc-banner tc-banner--checking',
    },
    starting: {
      icon: <LoadingOutlined />,
      text: 'Python 服务启动中，工具即将就绪…',
      cls: 'tc-banner tc-banner--starting',
    },
    running: {
      icon: <CheckCircleFilled />,
      text: 'Python 服务运行中，所有工具可用',
      cls: 'tc-banner tc-banner--running',
    },
    stopped: {
      icon: <CloseCircleFilled />,
      text: 'Python 服务暂不可用；应用会自动拉起，若持续失败请运行环境配置器后重启',
      cls: 'tc-banner tc-banner--stopped',
    },
  };
  const { icon, text, cls } = config[status];
  return (
    <div className={cls}>
      {icon}
      <span>{text}</span>
    </div>
  );
}

// 试运行区：手填 params JSON → 调 execute → 展示结果 / 错误。内置与自定义工具一致可试。
// 注意：试运行直接调真实 execute，会真实读写文件 / 联网，等同用户主动操作。
function TestRunSection({ toolName }: { toolName: string }) {
  const [paramsText, setParamsText] = useState('{}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 切换工具时重置，避免残留上一个工具的结果。
  useEffect(() => {
    setParamsText('{}');
    setResult(null);
    setError(null);
  }, [toolName]);

  const run = async () => {
    let params: Record<string, unknown>;
    try {
      const parsed = JSON.parse(paramsText || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError('params 必须是 JSON 对象，例如 {"path":"..."}');
        setResult(null);
        return;
      }
      params = parsed as Record<string, unknown>;
    } catch {
      setError('params 不是合法 JSON，请检查格式');
      setResult(null);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await executeTool(toolName, params);
      if (res.ok) {
        setResult(JSON.stringify(res.result ?? null, null, 2));
      } else {
        setError(res.error || '执行失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '执行失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="tc-section tc-testrun">
      <div className="tc-section__title">试运行</div>
      <p className="tc-testrun__hint">
        手动填入 params(JSON)验证工具。会真实执行(读写文件 / 联网),请谨慎填参。
      </p>
      <Input.TextArea
        value={paramsText}
        onChange={(e) => setParamsText(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 8 }}
        spellCheck={false}
        placeholder='{"path": "C:/Users/.../a.txt", "mode": "meta"}'
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
      <Button
        type="primary"
        size="small"
        loading={running}
        onClick={run}
        style={{ marginTop: 8 }}
      >
        运行
      </Button>
      {error && <pre className="tc-testrun__error">{error}</pre>}
      {result !== null && <pre className="tc-testrun__result">{result}</pre>}
    </div>
  );
}

// 右栏：内置工具详情
function ToolDetail({ tool }: { tool: ToolDef }) {
  const [expanded, setExpanded] = useState(false);
  const caps = tool.capabilities;
  const needFold = caps.length > CAP_FOLD_THRESHOLD;
  const visible = needFold && !expanded ? caps.slice(0, CAP_FOLD_THRESHOLD) : caps;

  const isReady = tool.status === 'ready';
  const statusColor = isReady ? 'success' : 'default';
  const statusText = isReady ? '已落地' : '计划中';

  return (
    <div className="tc-detail">
      {/* 头部 */}
      <div className="tc-detail__header">
        <span className="tc-detail__icon">{tool.icon}</span>
        <div className="tc-detail__title-row">
          <span className="tc-detail__name">{tool.label}</span>
          <Tag color={statusColor} className="tc-detail__status">
            {statusText}
          </Tag>
        </div>
        <p className="tc-detail__summary">{tool.summary}</p>
      </div>

      {/* 实现原理 */}
      <div className="tc-section">
        <div className="tc-section__title">实现原理</div>
        <div className="tc-impl">
          <div className="tc-impl__row">
            <span className="tc-impl__key">语言</span>
            <span className="tc-impl__val">{tool.implementation.language}</span>
          </div>
          <div className="tc-impl__row">
            <span className="tc-impl__key">依赖库</span>
            <span className="tc-impl__val tc-impl__libs">
              {tool.implementation.libraries.map((lib) => (
                <Tag key={lib} className="tc-lib-tag">{lib}</Tag>
              ))}
            </span>
          </div>
          {tool.implementation.note && (
            <div className="tc-impl__note">{tool.implementation.note}</div>
          )}
        </div>
      </div>

      {/* 工具能力 */}
      <div className="tc-section">
        <div className="tc-section__title">
          工具能力
          <span className="tc-section__count">{caps.length} 项</span>
        </div>
        <div className="tc-caps">
          {visible.map((cap, i) => (
            <div key={i} className="tc-cap-item">
              <span className="tc-cap-item__dot" />
              <div className="tc-cap-item__body">
                <span className="tc-cap-item__label">{cap.label}</span>
                <span className="tc-cap-item__desc">{cap.description}</span>
              </div>
            </div>
          ))}
        </div>
        {needFold && (
          <Button
            type="text"
            size="small"
            className="tc-fold-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : `展开全部（${caps.length} 项）`}
          </Button>
        )}
      </div>

      <TestRunSection toolName={tool.value} />
    </div>
  );
}

// 右栏：自定义 / 生成工具详情
function CustomToolDetail({
  meta,
  onRemove,
  removing,
}: {
  meta: ToolMeta;
  onRemove: () => void;
  removing: boolean;
}) {
  const sourceText = meta.source === 'generated' ? '姬子生成' : '手动添加';
  const implementation = inferCustomImplementation(meta);
  const capabilities = inferCustomCapabilities(meta);
  return (
    <div className="tc-detail">
      <div className="tc-detail__header">
        <span className="tc-detail__icon">🧩</span>
        <div className="tc-detail__title-row">
          <span className="tc-detail__name">{meta.name}</span>
          <Tag color={meta.loadError ? 'error' : 'success'} className="tc-detail__status">
            {meta.loadError ? '未加载' : '已注册'}
          </Tag>
          <Tag className="tc-detail__status">{sourceText}</Tag>
        </div>
        <p className="tc-detail__summary">{meta.description || '（无描述）'}</p>
      </div>

      {meta.loadError && (
        <div className="tc-section">
          <div className="tc-section__title">加载状态</div>
          <pre className="tc-testrun__error">{meta.loadError}</pre>
        </div>
      )}

      <div className="tc-section">
        <div className="tc-section__title">实现原理</div>
        <div className="tc-impl">
          <div className="tc-impl__row">
            <span className="tc-impl__key">语言</span>
            <span className="tc-impl__val">{implementation.language}</span>
          </div>
          <div className="tc-impl__row">
            <span className="tc-impl__key">依赖库</span>
            <span className="tc-impl__val tc-impl__libs">
              {implementation.libraries.map((lib) => (
                <Tag key={lib} className="tc-lib-tag">{lib}</Tag>
              ))}
            </span>
          </div>
          {implementation.note && (
            <div className="tc-impl__note">{implementation.note}</div>
          )}
        </div>
      </div>

      <div className="tc-section">
        <div className="tc-section__title">
          工具能力
          <span className="tc-section__count">{capabilities.length} 项</span>
        </div>
        <div className="tc-caps">
          {capabilities.map((cap, i) => (
            <div key={`${cap.label}-${i}`} className="tc-cap-item">
              <span className="tc-cap-item__dot" />
              <div className="tc-cap-item__body">
                <span className="tc-cap-item__label">{cap.label}</span>
                <span className="tc-cap-item__desc">{cap.description}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <TestRunSection toolName={meta.name} />

      <div className="tc-section">
        <Popconfirm
          title="删除该自定义工具？"
          description="将删除模块文件并从注册表移除，不可撤销。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={onRemove}
        >
          <Button danger size="small" icon={<DeleteOutlined />} loading={removing}>
            删除工具
          </Button>
        </Popconfirm>
      </div>
    </div>
  );
}

// 右栏：空状态
function EmptyDetail() {
  return (
    <div className="tc-empty">
      <Empty
        description="在左侧选择一个工具查看详情"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    </div>
  );
}

export function ToolSettingsPanel({ active }: ToolSettingsPanelProps) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | 'checking'>('checking');
  const [removing, setRemoving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const customTools = useToolStore((s) => s.customTools);
  const syncFromService = useToolStore((s) => s.syncFromService);
  const removeTool = useToolStore((s) => s.removeTool);

  const selectedBuiltin = TOOL_REGISTRY.find((t) => t.value === selected) ?? null;
  const selectedCustom = customTools.find((t) => t.name === selected) ?? null;

  // 仅活动工具页轮询状态并同步元数据；离开页面后忽略尚未完成的请求。
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const disposePolling = startToolStatusPolling(async () => {
      const nextStatus = await getServiceStatus();
      if (!cancelled) setServiceStatus(nextStatus);
    }, STATUS_POLL_MS);

    setSyncing(true);
    void syncFromService().finally(() => {
      if (!cancelled) setSyncing(false);
    });

    return () => {
      cancelled = true;
      disposePolling();
    };
  }, [active, syncFromService]);

  const handleRemove = async () => {
    if (!selectedCustom) return;
    setRemoving(true);
    const res = await removeTool(selectedCustom.name);
    setRemoving(false);
    if (res.ok) {
      message.success(`已删除工具「${selectedCustom.name}」`);
      setSelected(null);
    } else {
      message.error(res.error || '删除失败');
    }
  };

  return (
    <div className="tool-settings-panel">
      {/* 服务状态横幅 */}
      <ServiceBanner status={serviceStatus} />

      <div className="tc">
        {/* 左栏：工具列表 */}
        <div className="tc__left">
          <div className="tc__left-header">内置工具</div>
          <div className="tc-tool-list">
            {TOOL_REGISTRY.map((tool) => {
              const isReady = tool.status === 'ready';
              return (
                <button
                  type="button"
                  key={tool.value}
                  className={`tc-tool-item${selected === tool.value ? ' tc-tool-item--active' : ''}`}
                  onClick={() => setSelected(tool.value)}
                >
                  <span className="tc-tool-item__icon">{tool.icon}</span>
                  <span className="tc-tool-item__name">{tool.label}</span>
                  <Tag
                    color={isReady ? 'success' : 'default'}
                    className="tc-tool-item__badge"
                  >
                    {isReady ? '已落地' : '计划中'}
                  </Tag>
                </button>
              );
            })}
          </div>

          <div className="tc__left-header">
            自定义工具
            {syncing && <LoadingOutlined style={{ marginLeft: 6 }} />}
          </div>
          <div className="tc-tool-list">
            {customTools.length === 0 ? (
              <div className="tc-tool-empty">
                暂无自定义工具。可让姬子「写个 XX 工具」生成。
              </div>
            ) : (
              customTools.map((tool) => (
                <button
                  type="button"
                  key={tool.name}
                  className={`tc-tool-item${selected === tool.name ? ' tc-tool-item--active' : ''}`}
                  onClick={() => setSelected(tool.name)}
                >
                  <span className="tc-tool-item__icon">🧩</span>
                  <span className="tc-tool-item__name">{tool.name}</span>
                  <Tag
                    color={tool.loadError ? 'error' : 'success'}
                    className="tc-tool-item__badge"
                  >
                    {tool.loadError ? '未加载' : '已注册'}
                  </Tag>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 右栏：详情或空态 */}
        <div className="tc__right">
          {selectedBuiltin ? (
            <ToolDetail key={selected} tool={selectedBuiltin} />
          ) : selectedCustom ? (
            <CustomToolDetail
              key={selected}
              meta={selectedCustom}
              onRemove={handleRemove}
              removing={removing}
            />
          ) : syncing ? (
            <div className="tc-empty">
              <Spin />
            </div>
          ) : (
            <EmptyDetail />
          )}
        </div>
      </div>
    </div>
  );
}

function ToolConfigModal({ open, onClose }: Props) {
  return (
    <Modal
      className={TOOL_CONFIG_MODAL_CLASS_NAME}
      rootClassName="pearl-dialog-root"
      title="工具库"
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <ToolSettingsPanel active={open} />
    </Modal>
  );
}

export default ToolConfigModal;
