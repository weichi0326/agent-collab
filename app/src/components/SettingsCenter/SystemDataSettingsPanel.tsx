import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Divider,
  Flex,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  formatDirectoryUsage,
  getSystemSnapshot,
  isDesktopSystemInfoAvailable,
  openSystemDirectory,
  readableSystemError,
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

export default function SystemDataSettingsPanel() {
  const { message } = App.useApp();
  const desktopAvailable = isDesktopSystemInfoAvailable();
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | 'unknown'>('unknown');
  const [serviceVersion, setServiceVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(desktopAvailable);
  const [restarting, setRestarting] = useState(false);
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
