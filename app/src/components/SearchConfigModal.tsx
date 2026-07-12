import { useState, useRef, useEffect } from 'react';
import { Modal, Input, Switch, Button, Typography, Tooltip } from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  LinkOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from '@ant-design/icons';
import { useSearchStore, orderedIds } from '../stores/searchStore';
import { getSearchProvider } from '../lib/searchProviders';
import { testSearchKey } from '../lib/searchClient';

type TestState =
  | { status: 'testing' }
  | { status: 'ok'; count?: number }
  | { status: 'fail'; error: string };

const { Link, Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SearchSettingsPanel() {
  const configs = useSearchStore((s) => s.configs);
  const order = useSearchStore((s) => s.order);
  const setKey = useSearchStore((s) => s.setKey);
  const setEnabled = useSearchStore((s) => s.setEnabled);
  const move = useSearchStore((s) => s.move);

  const [tests, setTests] = useState<Record<string, TestState>>({});
  // M2 修复：mounted ref 防止弹窗关闭后 setState 写入已卸载组件
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const ids = orderedIds(order);

  const runTest = async (id: string) => {
    const preset = getSearchProvider(id);
    const cfg = configs[id];
    if (!preset || !cfg?.apiKey.trim()) return;
    setTests((t) => ({ ...t, [id]: { status: 'testing' } }));
    const res = await testSearchKey(preset.api, cfg.apiKey);
    if (!mountedRef.current) return; // 弹窗已关闭，放弃更新
    setTests((t) => ({
      ...t,
      [id]: res.ok
        ? { status: 'ok', count: res.count }
        : { status: 'fail', error: res.error ?? '测试失败' },
    }));
  };

  return (
    <>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        可配置多家搜索厂商并排优先级：发送时从最上面一家开始用，某家失败或额度用尽会自动切换到下一家。
        开启输入框的「联网搜索」开关后，发送前会先检索资料，再连同参考来源交给模型作答。
      </Paragraph>

      <div className="search-cfg-list">
        {ids.map((id, index) => {
          const preset = getSearchProvider(id);
          if (!preset) return null;
          const cfg = configs[id] ?? { apiKey: '', enabled: false };
          return (
            <div className="search-cfg-row" key={id}>
              <div className="search-cfg-row__order">
                <span className="search-cfg-row__rank">{index + 1}</span>
                <Tooltip title="上移(更优先)">
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  />
                </Tooltip>
                <Tooltip title="下移">
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={index === ids.length - 1}
                    onClick={() => move(id, 1)}
                  />
                </Tooltip>
              </div>

              <div className="search-cfg-row__main">
                <div className="search-cfg-row__head">
                  <Text strong>{preset.name}</Text>
                  <Link href={preset.signup} target="_blank" rel="noreferrer">
                    <LinkOutlined /> 获取 Key
                  </Link>
                  <Switch
                    size="small"
                    checked={cfg.enabled}
                    onChange={(v) => setEnabled(id, v)}
                  />
                </div>
                <div className="search-cfg-row__note">{preset.freeNote}</div>
                <div className="search-cfg-row__key">
                  <Input.Password
                    size="small"
                    placeholder={`粘贴 ${preset.name} API Key`}
                    value={cfg.apiKey}
                    onChange={(e) => setKey(id, e.target.value)}
                  />
                  <Button
                    size="small"
                    loading={tests[id]?.status === 'testing'}
                    disabled={!cfg.apiKey.trim()}
                    onClick={() => runTest(id)}
                  >
                    测试
                  </Button>
                </div>
                {tests[id] && tests[id].status !== 'testing' && (
                  <div className="search-cfg-row__result">
                    {tests[id].status === 'ok' ? (
                      <Text type="success">
                        <CheckCircleFilled /> Key 有效
                        {typeof (tests[id] as { count?: number }).count ===
                        'number'
                          ? `(返回 ${(tests[id] as { count?: number }).count} 条)`
                          : ''}
                      </Text>
                    ) : (
                      <Text type="danger">
                        <CloseCircleFilled />{' '}
                        {(tests[id] as { error: string }).error}
                      </Text>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function SearchConfigModal({ open, onClose }: Props) {
  return (
    <Modal
      className="search-config-modal pearl-dialog"
      rootClassName="pearl-dialog-root"
      title="联网搜索配置"
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="done" type="primary" onClick={onClose}>
          完成
        </Button>,
      ]}
      destroyOnHidden
    >
      <SearchSettingsPanel />
    </Modal>
  );
}

export default SearchConfigModal;
