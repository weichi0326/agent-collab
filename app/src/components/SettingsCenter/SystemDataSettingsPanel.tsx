import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { openLocalPath } from '../../lib/outputDirectory';
import { cleanupLocationOptions } from './cleanupLocation';
import { reconcileClearedAppData } from './systemDataCleanup';
import {
  EXPECTED_PYTHON_SERVICE_VERSION,
  getHealth,
  getServiceStatus,
  restartPythonService,
  type ServiceStatus,
} from '../../lib/pythonClient';
import {
  FRONTEND_VERSION,
  TAURI_VERSION,
  clearSelectedAppData,
  formatDirectoryUsage,
  getSystemSnapshot,
  isDesktopSystemInfoAvailable,
  openSystemDirectory,
  readableSystemError,
  scanCleanableAppData,
  type CleanableItem,
  type CleanableItemId,
  type CleanableScan,
  type DirectoryUsage,
  type SystemDirectoryKind,
  type SystemSnapshot,
} from '../../lib/systemInfo';

const SERVICE_LABEL: Record<ServiceStatus | 'unknown', string> = {
  unknown: '检测中',
  starting: '启动中',
  running: '运行中',
  stopped: '已停止',
};

const SERVICE_COLOR: Record<ServiceStatus | 'unknown', string> = {
  unknown: 'default',
  starting: 'processing',
  running: 'success',
  stopped: 'error',
};

interface DirectoryRow {
  key: SystemDirectoryKind;
  label: string;
  path: string;
  usage: DirectoryUsage;
}

const EMPTY_CLEANUP_ITEMS: CleanableItem[] = [];

function cleanupPathParts(path: string): string[] {
  return path.split(/[,;；]\s*/u).filter(Boolean);
}

function cleanupScopeSummary(item: CleanableItem): string {
  const count = cleanupPathParts(item.path).length;
  if (count <= 0) return '清理范围：未提供位置';
  return `清理范围：${count} 个文件或目录位置`;
}

function cleanupUsageWarning(item: CleanableItem): string | null {
  if (!item.exists || item.usage.complete) return null;
  return item.usage.detail ? `${item.usage.detail}，大小可能不完整` : '部分内容无法统计，大小可能不完整';
}

export default function SystemDataSettingsPanel() {
  const { message } = App.useApp();
  const desktopAvailable = isDesktopSystemInfoAvailable();
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | 'unknown'>('unknown');
  const [serviceVersion, setServiceVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(desktopAvailable);
  const [restarting, setRestarting] = useState(false);
  const [cleanupPanelOpen, setCleanupPanelOpen] = useState(false);
  const [cleanupScanning, setCleanupScanning] = useState(false);
  const [cleanupScan, setCleanupScan] = useState<CleanableScan | null>(null);
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<CleanableItemId[]>([]);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!desktopAvailable) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const [snapshotResult, statusResult, healthResult] = await Promise.allSettled([
      getSystemSnapshot(),
      getServiceStatus(),
      getHealth(),
    ]);

    if (snapshotResult.status === 'fulfilled') {
      setSnapshot(snapshotResult.value);
    } else {
      setError(readableSystemError(snapshotResult.reason, '无法读取系统快照'));
    }
    setServiceStatus(statusResult.status === 'fulfilled' ? statusResult.value : 'unknown');
    setServiceVersion(
      healthResult.status === 'fulfilled'
        ? healthResult.value?.serviceVersion ?? null
        : null,
    );
    setLoading(false);
  }, [desktopAvailable]);

  useEffect(() => {
    if (desktopAvailable) void refresh();
  }, [desktopAvailable, refresh]);

  const directories = useMemo<DirectoryRow[]>(() => {
    if (!snapshot) return [];
    return [
      {
        key: 'data',
        label: '项目数据',
        path: snapshot.data_dir,
        usage: snapshot.data_usage,
      },
      {
        key: 'app_data',
        label: '用户扩展数据',
        path: snapshot.app_data_dir,
        usage: snapshot.app_data_usage,
      },
      {
        key: 'output',
        label: '任务输出',
        path: snapshot.output_dir,
        usage: snapshot.output_usage,
      },
      {
        key: 'log',
        label: '运行日志',
        path: snapshot.log_dir,
        usage: snapshot.log_usage,
      },
    ];
  }, [snapshot]);

  const failedChecks = snapshot?.checks.filter((check) => !check.ok) ?? [];
  const checks = snapshot?.checks ?? [];
  const cleanupItems = cleanupScan?.items ?? EMPTY_CLEANUP_ITEMS;

  const normalCleanupItems = useMemo(
    () => cleanupItems.filter((item) => !item.important),
    [cleanupItems],
  );

  const importantCleanupItems = useMemo(
    () => cleanupItems.filter((item) => item.important),
    [cleanupItems],
  );

  const selectedCleanupItems = useMemo(
    () => cleanupItems.filter((item) => selectedCleanupIds.includes(item.id)),
    [cleanupItems, selectedCleanupIds],
  );

  const selectedImportantCleanupItems = useMemo(
    () => selectedCleanupItems.filter((item) => item.important),
    [selectedCleanupItems],
  );

  const selectedCleanupUsage = useMemo<DirectoryUsage>(
    () => selectedCleanupItems.reduce<DirectoryUsage>((total, item) => ({
      bytes: total.bytes + item.usage.bytes,
      complete: total.complete && item.usage.complete,
      detail: total.detail ?? item.usage.detail,
    }), { bytes: 0, complete: true, detail: null }),
    [selectedCleanupItems],
  );

  const protectedImportantCount = useMemo(
    () => importantCleanupItems.filter((item) => !selectedCleanupIds.includes(item.id)).length,
    [importantCleanupItems, selectedCleanupIds],
  );

  const handleRestart = async () => {
    if (!desktopAvailable) return;
    setRestarting(true);
    try {
      const status = await restartPythonService();
      await refresh();
      if (status === 'running') {
        message.success('Python 后台已重启');
      } else {
        message.error('Python 后台未能启动，请按环境检查提示修复');
      }
    } catch (reason) {
      message.error(readableSystemError(reason, '重启 Python 后台失败'));
    } finally {
      setRestarting(false);
    }
  };

  const handleOpenDirectory = async (kind: SystemDirectoryKind) => {
    try {
      await openSystemDirectory(kind);
    } catch (reason) {
      message.error(readableSystemError(reason, '打开目录失败'));
    }
  };

  const handleOpenCleanupLocation = async (item: CleanableItem) => {
    const locations = cleanupLocationOptions(item.label, item.path);
    if (locations.length === 0) {
      message.warning('没有可打开的数据位置');
      return;
    }
    if (locations.length === 1) {
      try {
        await openLocalPath(locations[0].path);
      } catch (reason) {
        message.error(readableSystemError(reason, '打开数据位置失败'));
      }
      return;
    }

    Modal.confirm({
      centered: true,
      title: '选择数据位置',
      icon: null,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {locations.map((location) => (
            <Button
              block
              className="system-settings-cleanup-location-option"
              key={location.path}
              onClick={() => {
                void openLocalPath(location.path).catch((reason: unknown) => {
                  message.error(readableSystemError(reason, '打开数据位置失败'));
                });
              }}
            >
              <span className="system-settings-cleanup-location-option__main">
                <strong>{location.label}</strong>
                <Typography.Text type="secondary">{location.description}</Typography.Text>
                <Typography.Text type="secondary" ellipsis={{ tooltip: location.path }}>
                  {location.path}
                </Typography.Text>
              </span>
            </Button>
          ))}
        </Space>
      ),
      okButtonProps: { style: { display: 'none' } },
      cancelText: '关闭',
    });
  };

  const handleScanCleanup = async () => {
    if (!desktopAvailable) return;
    setCleanupPanelOpen(true);
    setCleanupScanning(true);
    try {
      const scan = await scanCleanableAppData();
      setCleanupScan(scan);
      setSelectedCleanupIds(
        scan.items
          .filter((item) => item.defaultSelected && item.exists && item.usage.bytes > 0)
          .map((item) => item.id),
      );
    } catch (reason) {
      message.error(readableSystemError(reason, '扫描可清理内容失败'));
    } finally {
      setCleanupScanning(false);
    }
  };

  const toggleCleanupItem = (id: CleanableItemId, checked: boolean) => {
    setSelectedCleanupIds((current) => (
      checked ? [...current, id] : current.filter((item) => item !== id)
    ));
  };

  const runSelectedCleanup = async () => {
    if (!desktopAvailable || !cleanupScan) return;
    if (selectedCleanupIds.length === 0) {
      message.warning('请先选择要清理的内容');
      return;
    }
    const importantItems = selectedImportantCleanupItems;
    const execute = async () => {
      setClearing(true);
      try {
        const result = await clearSelectedAppData(selectedCleanupIds);
        reconcileClearedAppData(result.cleared);
        message.success(`已清理 ${result.cleared.length} 类内容`);
        await handleScanCleanup();
        await refresh();
      } catch (reason) {
        message.error(readableSystemError(reason, '清理选中内容失败'));
      } finally {
        setClearing(false);
      }
    };

    if (importantItems.length === 0) {
      await execute();
      return;
    }

    Modal.confirm({
      centered: true,
      title: '确认清理重要数据？',
      content: (
        <Flex vertical gap={8}>
          <Typography.Text>以下重要数据清理后无法撤销：</Typography.Text>
          {importantItems.map((item) => (
            <Typography.Text key={item.id}>
              <strong>{item.label}：</strong>{item.impact}
            </Typography.Text>
          ))}
        </Flex>
      ),
      okText: '确认清理',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: execute,
    });
  };

  const renderCleanupCard = (item: CleanableItem) => {
    const disabled = !item.exists || item.usage.bytes <= 0 || clearing;
    const checked = selectedCleanupIds.includes(item.id);
    const usageWarning = cleanupUsageWarning(item);
    const cardClassName = [
      'system-settings-cleanup-card',
      item.important ? 'system-settings-cleanup-card--important' : 'system-settings-cleanup-card--normal',
      checked ? 'system-settings-cleanup-card--selected' : '',
      disabled ? 'system-settings-cleanup-card--disabled' : '',
    ].filter(Boolean).join(' ');

    return (
      <div className={cardClassName} key={item.id}>
        <Checkbox
          checked={checked}
          disabled={disabled}
          onChange={(event) => toggleCleanupItem(item.id, event.target.checked)}
        />
        <div className="system-settings-cleanup-card__main">
          <Space wrap size={8}>
            <strong>{item.label}</strong>
            <Tag className={item.important ? 'system-settings-cleanup-important-tag' : undefined} color={item.important ? undefined : 'success'}>
              {item.important ? '重要数据' : '普通数据'}
            </Tag>
            {item.defaultSelected && <Tag color="success">默认清理</Tag>}
          </Space>
          <Typography.Text type="secondary">{item.description}</Typography.Text>
          <Typography.Text type={item.important ? 'danger' : 'secondary'}>
            清理后会失去：{item.impact}
          </Typography.Text>
          <div className="system-settings-cleanup-scope">
            <span>{cleanupScopeSummary(item)}</span>
            <Button
              className="system-settings-cleanup-detail-button"
              type="link"
              size="small"
              onClick={() => void handleOpenCleanupLocation(item)}
            >
              查看数据位置
            </Button>
          </div>
          {usageWarning && (
            <Typography.Text type="warning">
              {usageWarning}
            </Typography.Text>
          )}
        </div>
        <div className="system-settings-cleanup-card__meta">
          <Tag color={item.exists ? (item.usage.complete ? undefined : 'warning') : 'default'}>
            {item.exists ? formatDirectoryUsage(item.usage) : '暂无内容'}
          </Tag>
          {item.important && <span className="system-settings-cleanup-card__protect">默认保护</span>}
        </div>
      </div>
    );
  };

  const renderCleanupGroup = (
    title: string,
    description: string,
    items: CleanableItem[],
    important = false,
  ) => (
    <section className={`system-settings-cleanup-group ${important ? 'system-settings-cleanup-group--important' : 'system-settings-cleanup-group--normal'}`}>
      <div className="system-settings-cleanup-group__header">
        <div>
          <Typography.Title level={5}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
        {important && <Tag color="warning">默认保护</Tag>}
      </div>
      <div className="system-settings-cleanup-group__cards">
        {items.map(renderCleanupCard)}
      </div>
    </section>
  );

  return (
    <Spin spinning={desktopAvailable && loading && !snapshot}>
      <Flex vertical gap={24}>
        {!desktopAvailable && (
          <Alert
            type="info"
            showIcon
            title="桌面状态仅在桌面应用中可用"
            description="浏览器预览可以检查布局；版本、目录、环境状态和后台重启需要在 Tauri 桌面应用中查看。"
          />
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            title="无法读取系统快照"
            description={error}
            action={(
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>
                重试
              </Button>
            )}
          />
        )}

        <section aria-labelledby="python-service-heading">
          <Flex justify="space-between" align="center" gap={16} wrap>
            <div>
              <Typography.Title id="python-service-heading" level={4}>
                Python 后台
              </Typography.Title>
              <Typography.Text type="secondary">
                本地工具与模型调用服务
              </Typography.Text>
            </div>
            <Space>
              <Tooltip title="刷新系统状态">
                <Button
                  aria-label="刷新系统状态"
                  icon={<ReloadOutlined />}
                  loading={desktopAvailable && loading}
                  disabled={!desktopAvailable}
                  onClick={() => void refresh()}
                />
              </Tooltip>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={restarting}
                disabled={!desktopAvailable}
                onClick={() => void handleRestart()}
              >
                重启后台
              </Button>
            </Space>
          </Flex>
          <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
            <Descriptions.Item label="服务状态">
              <Tag color={desktopAvailable ? SERVICE_COLOR[serviceStatus] : 'default'}>
                {desktopAvailable ? SERVICE_LABEL[serviceStatus] : '仅桌面可用'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="版本匹配">
              <Tag
                color={
                  !desktopAvailable
                    ? 'default'
                    : serviceVersion === EXPECTED_PYTHON_SERVICE_VERSION
                      ? 'success'
                      : 'warning'
                }
              >
                {!desktopAvailable
                  ? '仅桌面可用'
                  : serviceVersion === EXPECTED_PYTHON_SERVICE_VERSION
                    ? '正常'
                    : '需要重启或修复'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="当前服务版本">
              <Typography.Text code>{serviceVersion ?? '未检测到'}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="期望服务版本">
              <Typography.Text code>{EXPECTED_PYTHON_SERVICE_VERSION}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        </section>

        <Divider style={{ margin: 0 }} />

        <section aria-labelledby="application-details-heading">
          <Typography.Title id="application-details-heading" level={4}>
            应用信息
          </Typography.Title>
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="应用版本">
              {snapshot?.app_version ?? '未读取'}
            </Descriptions.Item>
            <Descriptions.Item label="前端版本">
              {FRONTEND_VERSION}
            </Descriptions.Item>
            <Descriptions.Item label="Rust 后台版本">
              {snapshot?.backend_version ?? '未读取'}
            </Descriptions.Item>
            <Descriptions.Item label="Tauri 版本">
              {TAURI_VERSION}
            </Descriptions.Item>
            <Descriptions.Item label="操作系统">
              {snapshot?.os ?? '未读取'}
            </Descriptions.Item>
            <Descriptions.Item label="处理器架构">
              {snapshot?.arch ?? '未读取'}
            </Descriptions.Item>
          </Descriptions>
        </section>

        <Divider style={{ margin: 0 }} />

        <section aria-labelledby="local-data-heading">
          <Typography.Title id="local-data-heading" level={4}>
            本地数据
          </Typography.Title>
          <div className="system-settings-list">
            {directories.length === 0 ? (
              <div className="system-settings-list__empty">目录信息尚未读取</div>
            ) : directories.map((item) => (
              <div className="system-settings-row" key={item.key}>
                <div className="system-settings-row__content">
                  <Space>
                    <strong>{item.label}</strong>
                    <Tag color={item.usage.complete ? undefined : 'warning'}>
                      {formatDirectoryUsage(item.usage)}
                    </Tag>
                  </Space>
                  <Typography.Text copyable ellipsis={{ tooltip: item.path }}>
                    {item.path}
                  </Typography.Text>
                  {item.usage.detail && (
                    <Typography.Text type={item.usage.complete ? 'secondary' : 'warning'}>
                      {item.usage.detail}
                    </Typography.Text>
                  )}
                </div>
                <Tooltip title={`打开${item.label}目录`}>
                  <Button
                    aria-label={`打开${item.label}目录`}
                    icon={<FolderOpenOutlined />}
                    disabled={!desktopAvailable}
                    onClick={() => void handleOpenDirectory(item.key)}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        </section>

        <Divider style={{ margin: 0 }} />

        <section aria-labelledby="danger-zone-heading">
          <Typography.Title id="danger-zone-heading" level={4} type="danger">
            危险操作
          </Typography.Title>
          <Alert
            type="warning"
            showIcon
            title="分类清理软件数据"
            description="先扫描可清理内容，再选择要删除的分类；重要数据会在执行前二次确认。"
            action={(
              <Button
                danger
                type="primary"
                icon={<DeleteOutlined />}
                loading={cleanupScanning}
                disabled={!desktopAvailable}
                onClick={() => void handleScanCleanup()}
              >
                扫描可清理内容
              </Button>
            )}
          />
        </section>

        <Modal
          centered
          className="system-settings-cleanup-modal"
          title="选择要清理的内容"
          open={cleanupPanelOpen}
          width={1280}
          onCancel={() => setCleanupPanelOpen(false)}
          footer={(
            <div className="system-settings-cleanup-footer">
              <Button
                icon={<ReloadOutlined />}
                loading={cleanupScanning}
                disabled={!desktopAvailable || clearing}
                onClick={() => void handleScanCleanup()}
              >
                重新扫描
              </Button>
              <Space>
                <Button onClick={() => setCleanupPanelOpen(false)}>
                  取消
                </Button>
                <Button
                  className="system-settings-cleanup-danger-button"
                  danger
                  type="primary"
                  icon={<DeleteOutlined />}
                  loading={clearing}
                  disabled={!desktopAvailable || cleanupScanning || !cleanupScan}
                  onClick={() => void runSelectedCleanup()}
                >
                  清理选中内容
                </Button>
              </Space>
            </div>
          )}
        >
          <div className="system-settings-cleanup-body">
            <div className="system-settings-cleanup-intro">
              <Typography.Text type="secondary">
                普通缓存默认选中，画布、姬子、工具和 Key 等重要数据默认保护。
              </Typography.Text>
              <div className="system-settings-cleanup-summary">
                <div className="system-settings-cleanup-summary-card">
                  <span>默认清理</span>
                  <strong>{selectedCleanupItems.filter((item) => !item.important).length}</strong>
                </div>
                <div className="system-settings-cleanup-summary-card">
                  <span>重要保护</span>
                  <strong>{protectedImportantCount}</strong>
                </div>
                <div className="system-settings-cleanup-summary-card">
                  <span>预计释放</span>
                  <strong>{formatDirectoryUsage(selectedCleanupUsage)}</strong>
                </div>
              </div>
            </div>
            <Spin spinning={cleanupScanning}>
              {!cleanupScan || cleanupItems.length === 0 ? (
                <Empty description="尚未扫描到可清理内容" />
              ) : (
                <div className="system-settings-cleanup-list">
                  {renderCleanupGroup(
                    '普通缓存',
                    '默认选中，可安全清理任务产物、日志、运行历史和界面状态。',
                    normalCleanupItems,
                  )}
                  {renderCleanupGroup(
                    '重要数据',
                    '默认保护，包含画布、姬子、工具和 Key 等会影响继续使用的数据。',
                    importantCleanupItems,
                    true,
                  )}
                  {selectedImportantCleanupItems.length > 0 && (
                    <div className="system-settings-cleanup-warning">
                      已选择重要数据，清理前会再次确认。
                    </div>
                  )}
                </div>
              )}
            </Spin>
          </div>
        </Modal>


        <Divider style={{ margin: 0 }} />

        <section aria-labelledby="environment-checks-heading">
          <Typography.Title id="environment-checks-heading" level={4}>
            环境检查
          </Typography.Title>
          <div className="system-settings-list">
            {checks.length === 0 ? (
              <div className="system-settings-list__empty">环境信息尚未读取</div>
            ) : checks.map((check) => (
              <div className="system-settings-row" key={check.id}>
                <span
                  className={`system-settings-row__status system-settings-row__status--${
                    check.ok ? 'ok' : 'error'
                  }`}
                  aria-hidden="true"
                >
                  {check.ok
                    ? <CheckCircleOutlined />
                    : <CloseCircleOutlined />}
                </span>
                <div className="system-settings-row__content">
                  <Space>
                    <strong>{check.label}</strong>
                    <Tag color={check.ok ? 'success' : 'error'}>
                      {check.ok ? '正常' : '需要处理'}
                    </Tag>
                  </Space>
                  <Typography.Text type="secondary">{check.detail}</Typography.Text>
                </div>
              </div>
            ))}
          </div>
          {failedChecks.length > 0 && (
            <Alert
              style={{ marginTop: 16 }}
              type="warning"
              showIcon
              title="修复指引"
              description={(
                <Flex vertical gap={8}>
                  {failedChecks.map((check) => (
                    <Typography.Text key={check.id}>
                      <strong>{check.label}：</strong>{check.repair}
                    </Typography.Text>
                  ))}
                </Flex>
              )}
            />
          )}
        </section>
      </Flex>
    </Spin>
  );
}
