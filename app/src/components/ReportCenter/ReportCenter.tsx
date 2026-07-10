import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Empty, Input, Progress, Select, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { isTauri } from '@tauri-apps/api/core';
import {
  deleteOutputReport,
  listOutputReports,
  openAppOutputDir,
  openLocalPath,
  type OutputReport,
} from '../../lib/outputDirectory';
import { listToolAuditLog, type ToolAuditRecord } from '../../lib/pythonClient';
import { useCanvasStore } from '../../stores/canvasStore';
import { useOrchestratorStore } from '../../stores/orchestratorStore';
import { useTokenStatsStore } from '../../stores/tokenStatsStore';
import {
  buildCanvasMetrics,
  buildNodeMetrics,
  buildReportMetrics,
  buildTokenMetrics,
  formatDuration,
  formatTokens,
} from './metrics';

interface ReportCenterProps {
  refreshToken: number;
}

const FORMAT_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  docx: 'Word',
  xlsx: 'Excel',
  mindmap: '思维导图',
};

export default function ReportCenter({ refreshToken }: ReportCenterProps) {
  const { message, modal } = App.useApp();
  const runHistory = useCanvasStore((s) => s.runHistory);
  const markOutputItemsDeleted = useCanvasStore((s) => s.markOutputItemsDeleted);
  const autoGrantedToolCount = useOrchestratorStore((s) => s.autoGrantedToolCount);
  const installedToolCount = useOrchestratorStore((s) => s.installedToolCount);
  const [reports, setReports] = useState<OutputReport[]>([]);
  const [audit, setAudit] = useState<ToolAuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [canvasFilter, setCanvasFilter] = useState<string>();
  const [formatFilter, setFormatFilter] = useState<string>();
  const desktop = isTauri();

  const loadReports = useCallback(async () => {
    if (!desktop) {
      setReports([]);
      setAudit([]);
      return;
    }
    setLoading(true);
    try {
      const [rep, aud] = await Promise.all([listOutputReports(), listToolAuditLog()]);
      setReports(rep);
      setAudit(aud.slice().reverse()); // 审计接口按时间升序返回,倒序展示最新在前
    } catch (e) {
      console.error('[report_center.list]', e);
      message.error('读取历史产物失败');
    } finally {
      setLoading(false);
    }
  }, [desktop, message]);

  const runningRuns = useMemo(
    () => runHistory.filter((record) => record.runState?.status === 'running'),
    [runHistory],
  );
  const completedRunHistory = useMemo(
    () => runHistory.filter((record) => record.runState?.status !== 'running'),
    [runHistory],
  );
  const visibleReports = useMemo(() => {
    if (runningRuns.length === 0) return reports;
    const runningTimes = new Set(
      runningRuns.map((record) => record.runState?.startedAt).filter(Boolean),
    );
    const runningFolders = runningRuns
      .map((record) => `${record.canvasName}_${record.stamp}`)
      .filter(Boolean);
    return reports.filter(
      (report) =>
        !runningTimes.has(report.run_at) &&
        !runningFolders.some((folder) => report.folder_path.includes(folder)),
    );
  }, [reports, runningRuns]);

  useEffect(() => {
    void loadReports();
  }, [loadReports, refreshToken]);

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleReports.filter((report) => {
      if (canvasFilter && report.canvas_name !== canvasFilter) return false;
      if (formatFilter && report.output_format !== formatFilter) return false;
      if (!q) return true;
      return [
        report.artifact_name,
        report.canvas_name,
        report.node_label,
        report.summary,
        report.run_at,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(q));
    });
  }, [canvasFilter, formatFilter, query, visibleReports]);

  const canvasOptions = useMemo(
    () =>
      [...new Set(visibleReports.map((r) => r.canvas_name).filter(Boolean))]
        .sort()
        .map((value) => ({ value, label: value })),
    [visibleReports],
  );
  const formatOptions = useMemo(
    () =>
      [...new Set(visibleReports.map((r) => r.output_format).filter(Boolean))]
        .sort()
        .map((value) => ({
          value,
          label: FORMAT_LABEL[value] ?? value,
        })),
    [visibleReports],
  );

  const metrics = useMemo(
    () => buildReportMetrics(completedRunHistory, visibleReports),
    [completedRunHistory, visibleReports],
  );
  const canvasMetrics = useMemo(
    () => buildCanvasMetrics(completedRunHistory, visibleReports).slice(0, 6),
    [completedRunHistory, visibleReports],
  );
  const nodeMetrics = useMemo(
    () => buildNodeMetrics(completedRunHistory, visibleReports).slice(0, 8),
    [completedRunHistory, visibleReports],
  );

  // Token 用量统计:订阅 store 保证清零/新运行后刷新;交叉画布节点 id 判断节点是否仍存在。
  const byModel = useTokenStatsStore((s) => s.byModel);
  const byNode = useTokenStatsStore((s) => s.byNode);
  const masterTotal = useTokenStatsStore((s) => s.masterTotal);
  const grandTotal = useTokenStatsStore((s) => s.grandTotal);
  const byScene = useTokenStatsStore((s) => s.byScene);
  const canvases = useCanvasStore((s) => s.canvases);
  const savedCanvases = useCanvasStore((s) => s.savedCanvases);
  const tokenMetrics = useMemo(() => {
    const existing = new Set<string>();
    for (const c of canvases) for (const n of c.nodes) existing.add(n.id);
    for (const c of savedCanvases) for (const n of c.nodes) existing.add(n.id);
    return buildTokenMetrics({ byModel, byNode, masterTotal, grandTotal, byScene }, existing);
  }, [byModel, byNode, masterTotal, grandTotal, byScene, canvases, savedCanvases]);
  const resetTokenStats = useTokenStatsStore((s) => s.reset);

  const openPath = async (path?: string) => {
    if (!desktop || !path) {
      message.info('桌面端产出文件可打开');
      return;
    }
    try {
      await openLocalPath(path);
    } catch (e) {
      console.error('[report_center.open]', e);
      message.error('打开失败');
    }
  };

  const openOutputDir = async () => {
    try {
      await openAppOutputDir();
    } catch (e) {
      console.error('[report_center.output_dir]', e);
      message.error('打开输出目录失败');
    }
  };

  const deleteReport = (report: OutputReport) => {
    modal.confirm({
      title: '删除这条历史产物？',
      content: '会删除主产物和 data.json，删除后无法从报告中心打开。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const paths = [report.artifact_path, report.data_path].filter(Boolean);
        try {
          await deleteOutputReport(paths);
          useCanvasStore
            .getState()
            .canvases.forEach((canvas) =>
              markOutputItemsDeleted(canvas.id, paths, canvas.runId),
            );
          message.success('历史产物已删除');
          await loadReports();
        } catch (e) {
          console.error('[report_center.delete]', e);
          message.error('删除失败');
        }
      },
    });
  };

  const columns: ColumnsType<OutputReport> = [
    {
      title: '产物',
      dataIndex: 'artifact_name',
      ellipsis: true,
      render: (_, report) => (
        <div className="report-table__artifact">
          <FileTextOutlined />
          <div className="report-table__artifact-text">
            <span>{report.artifact_name || '报告产物'}</span>
            {report.summary && <small>{report.summary}</small>}
          </div>
        </div>
      ),
    },
    {
      title: '画布',
      dataIndex: 'canvas_name',
      width: 150,
      ellipsis: true,
    },
    {
      title: '节点',
      dataIndex: 'node_label',
      width: 150,
      ellipsis: true,
    },
    {
      title: '格式',
      dataIndex: 'output_format',
      width: 100,
      render: (value: string) => <Tag>{FORMAT_LABEL[value] ?? value ?? 'output'}</Tag>,
    },
    {
      title: '生成时间',
      dataIndex: 'run_at',
      width: 170,
      sorter: (a, b) => (a.run_at || '').localeCompare(b.run_at || ''),
      defaultSortOrder: 'descend',
    },
    {
      title: '操作',
      width: 210,
      render: (_, report) => (
        <div className="report-table__actions">
          <Button size="small" onClick={() => void openPath(report.artifact_path)}>
            打开
          </Button>
          <Button size="small" onClick={() => void openPath(report.data_path)}>
            JSON
          </Button>
          <Button size="small" onClick={() => void openPath(report.folder_path)}>
            定位
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => deleteReport(report)}
          />
        </div>
      ),
    },
  ];

  const auditColumns: ColumnsType<ToolAuditRecord> = [
    {
      title: '时间',
      dataIndex: 'ts',
      width: 170,
      sorter: (a, b) => a.ts - b.ts,
      defaultSortOrder: 'descend',
      render: (ts: number) => new Date(ts).toLocaleString(),
    },
    {
      title: '工具',
      dataIndex: 'name',
      width: 160,
      ellipsis: true,
    },
    {
      title: '批准人',
      dataIndex: 'approved_by',
      width: 120,
      ellipsis: true,
    },
    {
      title: '副作用',
      dataIndex: 'allow_side_effects',
      width: 110,
      render: (allow: boolean) =>
        allow ? <Tag color="red">已放行</Tag> : <Tag>默认拒绝</Tag>,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      render: (reason: string) => reason || <span style={{ color: '#999' }}>—</span>,
    },
    {
      title: '代码指纹',
      dataIndex: 'code_sha256',
      width: 150,
      render: (sha: string) => (
        <Tooltip
          title={
            <div>
              <div>sha256: {sha}</div>
            </div>
          }
        >
          <code>{sha ? sha.slice(0, 12) : '—'}</code>
        </Tooltip>
      ),
    },
  ];

  return (
    <div className="report-center">
      <div className="report-center__header">
        <div>
          <div className="report-center__title">
            <FileSearchOutlined />
            报告中心
          </div>
          <div className="report-center__subtitle">
            汇总运行表现、失败分布和历史产物，方便回看与清理。
          </div>
        </div>
      </div>

      <div className="report-stats">
        <Tooltip title="只统计已结束的画布运行；正在运行中的画布完成前不会进入报告中心。">
        <div className="report-stat">
          <span>总运行次数</span>
          <strong>{metrics.totalRuns}</strong>
        </div>
        </Tooltip>
        <Tooltip title="成功率 = 成功运行 / 已结束运行；不包含正在运行中的画布。">
        <div className="report-stat">
          <span>运行成功率</span>
          <strong>{metrics.successRate}%</strong>
        </div>
        </Tooltip>
        <Tooltip title="只统计已完成运行写出的历史产物。">
        <div className="report-stat">
          <span>历史产物</span>
          <strong>{metrics.totalReports}</strong>
        </div>
        </Tooltip>
        <Tooltip title="按已结束运行的开始/结束时间估算。">
        <div className="report-stat">
          <span>平均耗时</span>
          <strong>{formatDuration(metrics.avgRunDurationMs)}</strong>
        </div>
        </Tooltip>
        <Tooltip title="失败和手动中止的已结束运行总数。">
        <div className="report-stat">
          <span>失败 / 中止</span>
          <strong>{metrics.failedRuns + metrics.cancelledRuns}</strong>
        </div>
        </Tooltip>
        <Tooltip title="最近一个已同步到报告中心的历史产物时间。">
        <div className="report-stat">
          <span>最近产出</span>
          <strong className="report-stat__time">{metrics.latestReportAt}</strong>
        </div>
        </Tooltip>
        <Tooltip title="姬子识别节点缺少「已注册工具」时,无需确认自动补上的工具标签累计数。">
        <div className="report-stat">
          <span>姬子自动补工具</span>
          <strong>{autoGrantedToolCount}</strong>
        </div>
        </Tooltip>
        <Tooltip title="姬子诊断后经你确认安装的新工具累计数。">
        <div className="report-stat">
          <span>姬子安装工具</span>
          <strong>{installedToolCount}</strong>
        </div>
        </Tooltip>
      </div>

      <section className="report-section report-tokens">
        <div className="report-section__head">
          <span>Token 用量统计</span>
          <Tooltip title="永久累计所有运行与姬子对话消耗的 token（只统计用量，不计费）。重启不清零。">
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() =>
                modal.confirm({
                  title: '清零 Token 统计',
                  content: '将清空所有已累计的 token 用量数据，且不可恢复。确定吗？',
                  okText: '清零',
                  okButtonProps: { danger: true },
                  cancelText: '取消',
                  onOk: () => {
                    resetTokenStats();
                    message.success('已清零 Token 统计');
                  },
                })
              }
            >
              清零统计
            </Button>
          </Tooltip>
        </div>
        <div className="report-tokens__disclaimer">
          Token 为大致用量，仅供参考、不作计费依据——部分模型或中转不返回用量，失败请求与重试也可能漏记。
        </div>
        <div className="report-stats">
          <Tooltip title="所有节点 + 姬子累计消耗的 token 总和。">
            <div className="report-stat">
              <span>总计 Token</span>
              <strong>{formatTokens(tokenMetrics.grandTotal)}</strong>
            </div>
          </Tooltip>
          <Tooltip title="姬子（总控）对话/规划/诊断累计消耗的 token。">
            <div className="report-stat">
              <span>总控（姬子）</span>
              <strong>{formatTokens(tokenMetrics.masterTotal)}</strong>
            </div>
          </Tooltip>
        </div>
        {tokenMetrics.grandTotal === 0 ? (
          <Empty description="暂无 token 记录，运行画布或与姬子对话后统计" />
        ) : (
          <div className="report-token-grid">
            <div className="report-token-block">
              <div className="report-token-block__title">按模型</div>
              {tokenMetrics.byModel.map((row) => (
                <div key={row.model} className="report-token-row">
                  <span title={row.model}>{row.model}</span>
                  <strong>{formatTokens(row.total)}</strong>
                </div>
              ))}
            </div>
            <div className="report-token-block">
              <div className="report-token-block__title">按节点</div>
              {tokenMetrics.activeNodes.map((row, i) => (
                <div key={`${row.label}-${i}`} className="report-token-row">
                  <span title={row.label}>{row.label}</span>
                  <strong>{formatTokens(row.total)}</strong>
                </div>
              ))}
              {tokenMetrics.deletedTotal > 0 && (
                <div className="report-token-row report-token-row--muted">
                  <span>已删除节点</span>
                  <strong>{formatTokens(tokenMetrics.deletedTotal)}</strong>
                </div>
              )}
            </div>
            {tokenMetrics.byScene.length > 0 && (
              <div className="report-token-block">
                <div className="report-token-block__title">姬子按场景</div>
                {tokenMetrics.byScene.map((row) => (
                  <div key={row.scene} className="report-token-row">
                    <span title={row.label}>{row.label}</span>
                    <strong>{formatTokens(row.total)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="report-grid">
        <section className="report-section">
          <div className="report-section__head">
            <span>画布表现</span>
          </div>
          {canvasMetrics.length > 0 ? (
            <div className="report-rank">
              {canvasMetrics.map((item) => (
                <div key={item.name} className="report-rank__item">
                  <div className="report-rank__main">
                    <span>{item.name}</span>
                    <small>
                      {item.runs} 次运行 · {item.reports} 个产物
                    </small>
                  </div>
                  <Progress
                    percent={item.successRate}
                    size="small"
                    status={item.failed > 0 ? 'exception' : 'success'}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无画布统计" />
          )}
        </section>

        <section className="report-section">
          <div className="report-section__head">
            <span>节点表现</span>
          </div>
          {nodeMetrics.length > 0 ? (
            <div className="report-rank">
              {nodeMetrics.map((item) => (
                <div key={item.name} className="report-rank__item">
                  <div className="report-rank__main">
                    <span>{item.name}</span>
                    <small>
                      {item.runs} 次执行 · {item.reports} 个产物
                    </small>
                  </div>
                  <Progress
                    percent={item.successRate}
                    size="small"
                    status={item.failed > 0 ? 'exception' : 'success'}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点统计" />
          )}
        </section>
      </div>

      <section className="report-section report-section--table">
        <div className="report-section__head">
          <span>历史产物</span>
          <div className="report-filters">
            <Button
              icon={<FolderOpenOutlined />}
              onClick={() => void openOutputDir()}
            >
              打开输出目录
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void loadReports()}
            >
              刷新
            </Button>
            <Input.Search
              allowClear
              placeholder="搜索产物、画布、节点、摘要"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 260 }}
            />
            <Select
              allowClear
              placeholder="画布"
              value={canvasFilter}
              options={canvasOptions}
              onChange={setCanvasFilter}
              style={{ width: 180 }}
            />
            <Select
              allowClear
              placeholder="格式"
              value={formatFilter}
              options={formatOptions}
              onChange={setFormatFilter}
              style={{ width: 130 }}
            />
          </div>
        </div>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={filteredReports}
          locale={{
            emptyText: desktop ? '暂无历史产物' : '桌面端可查看历史产物',
          }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </section>

      <section className="report-section report-section--table">
        <div className="report-section__head">
          <span>工具安装审计</span>
          <Tooltip title="记录每次自定义工具安装:谁、何时、批准了哪段代码,以及是否放行顶层副作用。放行副作用属高风险操作,必须留痕。">
            <small className="report-audit__hint">谁、何时、批准了哪段代码</small>
          </Tooltip>
        </div>
        <Table
          rowKey={(r) => `${r.ts}-${r.name}-${r.code_sha256}`}
          size="small"
          loading={loading}
          columns={auditColumns}
          dataSource={audit}
          locale={{
            emptyText: desktop ? '暂无工具安装记录' : '桌面端可查看安装审计',
          }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </section>
    </div>
  );
}
