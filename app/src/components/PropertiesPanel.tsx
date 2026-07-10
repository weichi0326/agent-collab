import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Select, Radio, Button, App, Segmented, InputNumber } from 'antd';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  FileTextOutlined,
  CloseOutlined,
  FolderOpenOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { useUiStore } from '../stores/uiStore';
import {
  outputFolderName,
  useCanvasStore,
  upstreamNames,
  type AgentNodeData,
  type AgentOutputFormat,
} from '../stores/canvasStore';
import { useAgentStore } from '../stores/agentStore';
import { useToolTags } from '../stores/toolStore';
import { useModelOptions } from '../stores/modelStore';
import { packModelRef, unpackModelRef, isValidModelRef } from '../lib/modelRef';
import {
  listOutputReports,
  localPathExists,
  openAppOutputDir,
  openLocalPath,
  type OutputReport,
} from '../lib/outputDirectory';
import ResizeHandle from './ResizeHandle';
import { OUTPUT_FORMAT_OPTIONS } from './PropertiesPanel/constants';
import { formatTimerLabel } from '../lib/timerLabel';
import { NodeRunStatus } from './PropertiesPanel/NodeRunStatus';
import { OutputItems } from './PropertiesPanel/OutputItems';
import { useSelectedNodeContext } from './PropertiesPanel/useSelectedNodeContext';

// 桌面端(Tauri)走系统原生选择器/打开;纯浏览器回落 <input type=file> 与提示。
const inTauri = isTauri();

// 属性编辑的撤销合并:同一节点同一字段在 EDIT_COALESCE_MS 内的连续输入合并为一次快照,
// 避免逐字符入 history 导致撤销要按无数次;切换字段/节点或超时则开启新会话。
const EDIT_COALESCE_MS = 800;
let lastEditNodeId = '';
let lastEditField = '';
let lastEditAt = 0;

// 门控节点的名称与描述由系统按类型写死,不允许用户编辑;切换类型时同步更新。
const GATE_LABEL: Record<'or' | 'and' | 'nor', string> = {
  or: '或门',
  and: '与门',
  nor: '非门',
};
const GATE_DESC: Record<'or' | 'and' | 'nor', string> = {
  or: '任一上游通过，本节点即通过',
  and: '全部上游通过，本节点才通过',
  nor: '全部上游都不通过，本节点才通过',
};

function PropertiesPanel() {
  const { message } = App.useApp();
  const rightWidth = useUiStore((s) => s.rightWidth);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const pushHistory = useCanvasStore((s) => s.pushHistory);
  const { activeId, canvas, node } = useSelectedNodeContext();
  // 磁盘上已缺失的产物路径:仅本地 UI 提示,不回写 store(2.7)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(
    () => new Set(),
  );

  const agentId =
    typeof node?.data?.agentId === 'string' ? node.data.agentId : undefined;
  const def = useAgentStore((s) =>
    agentId ? s.agents.find((a) => a.id === agentId) : undefined,
  );

  const modelOptions = useModelOptions();
  const toolTags = useToolTags();

  // 前序节点名(有则手动来源被覆盖为只读)
  const ups = useMemo(
    () => (node && canvas ? upstreamNames(canvas.nodes, canvas.edges, node.id) : []),
    [node, canvas],
  );
  const hasUpstream = ups.length > 0;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const d = (node?.data ?? {}) as AgentNodeData;
  const modelValue = packModelRef(d.modelRef ?? null);
  const modelValid = isValidModelRef(modelValue, modelOptions);

  const sourceMode: 'file' | 'url' | 'history' =
    d.dataSourceMode === 'url' || d.dataSourceMode === 'history'
      ? d.dataSourceMode
      : 'file';
  const outputFormat: AgentOutputFormat =
    d.outputFormat === 'docx' ||
    d.outputFormat === 'xlsx' ||
    d.outputFormat === 'mindmap' ||
    d.outputFormat === 'markdown'
      ? d.outputFormat
      : 'markdown';
  const files = Array.isArray(d.dataSourceFiles) ? d.dataSourceFiles : [];
  const historyPaths = Array.isArray(d.dataSourceHistoryPaths)
    ? d.dataSourceHistoryPaths
    : [];
  const canvasName = canvas?.name ?? '画布';
  const nodeName = typeof d.label === 'string' && d.label ? d.label : 'Agent';
  const outputFolderPreview = outputFolderName(canvasName, nodeName).replace(
    /_\d{14}\//,
    '_运行时间/',
  );
  const outputFolderPath = d.lastOutput?.items.find((item) => item.path)?.path
    ?.replace(/[\\/][^\\/]+$/, '');
  // 只读快照 tab:仅可查看节点配置,所有编辑控件禁用
  const readOnly = !!canvas?.readOnly;
  const outputCheckKey = useMemo(
    () =>
      (d.lastOutput?.items ?? [])
        .filter((item) => item.path && !item.deleted)
        .map((item) => item.path)
        .join('|'),
    [d.lastOutput],
  );

  useEffect(() => {
    if (!inTauri || !canvas?.readOnly || !node || !outputCheckKey) return;
    const paths = outputCheckKey.split('|').filter(Boolean);
    let cancelled = false;

    Promise.all(
      paths.map(async (path) => ({
        path,
        exists: await localPathExists(path),
      })),
    )
      .then((results) => {
        if (cancelled) return;
        const missing = results.filter((r) => !r.exists).map((r) => r.path);
        setMissingPaths(new Set(missing));
      })
      .catch((e) => {
        console.error('[path_exists]', e);
      });

    return () => {
      cancelled = true;
    };
  }, [canvas?.id, canvas?.readOnly, canvas?.runId, node, outputCheckKey]);

  const patch = (p: Partial<AgentNodeData>) => {
    if (!node) return;
    const field = Object.keys(p).sort().join(',');
    const now = Date.now();
    const sameSession =
      lastEditNodeId === node.id &&
      lastEditField === field &&
      now - lastEditAt < EDIT_COALESCE_MS;
    if (!sameSession) pushHistory(activeId);
    lastEditNodeId = node.id;
    lastEditField = field;
    lastEditAt = now;
    updateNodeData(activeId, node.id, p);
  };

  const onChangeModel = (val: string | undefined) => {
    patch({ modelRef: unpackModelRef(val) });
  };

  // 合并去重写入(桌面端存真实绝对路径,浏览器存文件名)
  const mergeFiles = (picked: string[]) => {
    if (picked.length === 0) return;
    patch({ dataSourceFiles: Array.from(new Set([...files, ...picked])) });
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    mergeFiles(Array.from(list).map((f) => f.name));
  };

  // 桌面端:系统文件框多选,拿到真实绝对路径
  const pickFilesTauri = async () => {
    try {
      const sel = await open({ multiple: true });
      if (!sel) return;
      mergeFiles(Array.isArray(sel) ? sel : [sel]);
    } catch (e) {
      console.error('[dialog.open files]', e);
      message.error('打开文件选择器失败');
    }
  };

  const openOutputDir = async () => {
    try {
      if (outputFolderPath) {
        await openLocalPath(outputFolderPath);
        return;
      }
      await openAppOutputDir();
    } catch (e) {
      console.error('[open_output_dir]', e);
      message.error('打开输出目录失败');
    }
  };

  // 双击产出项:桌面端有真实路径则用系统默认程序打开
  const openOutputItem = async (path?: string, deleted?: boolean) => {
    if (deleted) {
      message.info('该产物已被移除');
      return;
    }
    if (inTauri && path) {
      try {
        await openLocalPath(path);
      } catch (e) {
        console.error('[open_path]', e);
        message.error('打开文件失败');
      }
      return;
    }
    message.info('待执行引擎产出文件后可打开');
  };

  const removeFile = (name: string) => {
    patch({ dataSourceFiles: files.filter((f) => f !== name) });
  };

  const [historyReports, setHistoryReports] = useState<OutputReport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistoryReports = async () => {
    setHistoryLoading(true);
    try {
      setHistoryReports(await listOutputReports());
    } catch (e) {
      console.error('[list_output_reports]', e);
      message.error('加载历史产物失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistoryPath = (path: string) => {
    patch({
      dataSourceHistoryPaths: historyPaths.includes(path)
        ? historyPaths.filter((p) => p !== path)
        : [...historyPaths, path],
    });
  };

  const removeHistoryPath = (path: string) => {
    patch({ dataSourceHistoryPaths: historyPaths.filter((p) => p !== path) });
  };

  // 门控节点(OR/AND/NOR):只渲染 label/description/gateType,跳过 LLM/工具/数据源/输出格式/Schema。
  if (node && d.gateType) {
    const gateType: 'or' | 'and' | 'nor' =
      d.gateType === 'and' || d.gateType === 'nor' ? d.gateType : 'or';
    return (
      <div className="right-panel" style={{ width: rightWidth }}>
        <ResizeHandle side="right" />
        <div style={{ padding: 12, borderBottom: '1px solid #f0f1f3' }}>
          <Segmented
            block
            className="single-seg"
            value="properties"
            options={[{ label: '属性', value: 'properties' }]}
          />
        </div>
        <div key={node.id} className="panel-body anim-fade">
          <div className="agent-form">
            {readOnly && (
              <div className="agent-form__readonly">只读快照,仅供查看</div>
            )}
            <NodeRunStatus runState={d.runState} />
            <div className="agent-form__field">
              <div className="agent-form__label">名称</div>
              <Input value={GATE_LABEL[gateType]} disabled readOnly />
            </div>
            <div className="agent-form__field">
              <div className="agent-form__label">描述</div>
              <Input.TextArea
                value={GATE_DESC[gateType]}
                autoSize={{ minRows: 2, maxRows: 3 }}
                disabled
                readOnly
              />
            </div>
            <div className="agent-form__field">
              <div className="agent-form__label">门控类型</div>
              <Segmented
                block
                disabled={readOnly}
                value={gateType}
                onChange={(v) => {
                  const t = v as 'or' | 'and' | 'nor';
                  patch({ gateType: t, label: GATE_LABEL[t], description: GATE_DESC[t] });
                }}
                options={[
                  { label: '或门', value: 'or' },
                  { label: '与门', value: 'and' },
                  { label: '非门', value: 'nor' },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 定时节点(type='timer'):只渲染 label/描述/时长(时/分/秒),名称随时长写死,不调 LLM/工具。
  if (node && typeof d.timerSeconds === 'number') {
    const totalSec = Math.min(86400, Math.max(1, Math.floor(d.timerSeconds)));
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    const applyDuration = (h: number, m: number, s: number) => {
      const next = Math.min(86400, Math.max(1, h * 3600 + m * 60 + s));
      patch({ timerSeconds: next, label: `定时 ${formatTimerLabel(next)}` });
    };
    return (
      <div className="right-panel" style={{ width: rightWidth }}>
        <ResizeHandle side="right" />
        <div style={{ padding: 12, borderBottom: '1px solid #f0f1f3' }}>
          <Segmented
            block
            className="single-seg"
            value="properties"
            options={[{ label: '属性', value: 'properties' }]}
          />
        </div>
        <div key={node.id} className="panel-body anim-fade">
          <div className="agent-form">
            {readOnly && (
              <div className="agent-form__readonly">只读快照,仅供查看</div>
            )}
            <NodeRunStatus runState={d.runState} />
            <div className="agent-form__field">
              <div className="agent-form__label">名称</div>
              <Input value={`定时 ${formatTimerLabel(totalSec)}`} disabled readOnly />
            </div>
            <div className="agent-form__field">
              <div className="agent-form__label">描述</div>
              <Input.TextArea
                value={'上游全部通过后开始倒计时，计时完毕放行下游；无上游时运行开始即倒计时。'}
                autoSize={{ minRows: 2, maxRows: 3 }}
                disabled
                readOnly
              />
            </div>
            <div className="agent-form__field">
              <div className="agent-form__label">倒计时时长（≤ 24 小时）</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <InputNumber
                    min={0}
                    max={23}
                    value={hh}
                    disabled={readOnly}
                    onChange={(v) => applyDuration(Number(v ?? 0), mm, ss)}
                    style={{ width: '100%' }}
                  />
                  <div className="timer-unit-label">时</div>
                </div>
                <div style={{ flex: 1 }}>
                  <InputNumber
                    min={0}
                    max={59}
                    value={mm}
                    disabled={readOnly}
                    onChange={(v) => applyDuration(hh, Number(v ?? 0), ss)}
                    style={{ width: '100%' }}
                  />
                  <div className="timer-unit-label">分</div>
                </div>
                <div style={{ flex: 1 }}>
                  <InputNumber
                    min={0}
                    max={59}
                    value={ss}
                    disabled={readOnly}
                    onChange={(v) => applyDuration(hh, mm, Number(v ?? 0))}
                    style={{ width: '100%' }}
                  />
                  <div className="timer-unit-label">秒</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="right-panel" style={{ width: rightWidth }}>
      <ResizeHandle side="right" />
      <div style={{ padding: 12, borderBottom: '1px solid #f0f1f3' }}>
        <Segmented
          block
          className="single-seg"
          value="properties"
          options={[{ label: '属性', value: 'properties' }]}
        />
      </div>
      {!node ? (
        <div key="empty" className="panel-body anim-fade">
          <div className="panel-empty">未选中节点</div>
        </div>
      ) : (
        <div key={node.id} className="panel-body anim-fade">
          <div className="agent-form">
            {readOnly && (
              <div className="agent-form__readonly">只读快照,仅供查看</div>
            )}
            {def && (
              <div className="agent-form__origin">源自 Agent 库：{def.name}</div>
            )}
            <NodeRunStatus runState={d.runState} />

            <div className="agent-form__field">
              <div className="agent-form__label">名称</div>
              <Input
                value={typeof d.label === 'string' ? d.label : ''}
                maxLength={40}
                placeholder="节点名称"
                disabled={readOnly}
                onChange={(e) => patch({ label: e.target.value })}
              />
            </div>

            <div className="agent-form__field">
              <div className="agent-form__label">描述</div>
              <Input.TextArea
                value={typeof d.description === 'string' ? d.description : ''}
                autoSize={{ minRows: 2, maxRows: 3 }}
                placeholder="一句话说明这个节点的职责(可选)"
                disabled={readOnly}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>

            <div className="agent-form__field">
              <div className="agent-form__label">系统提示词</div>
              <Input.TextArea
                value={typeof d.systemPrompt === 'string' ? d.systemPrompt : ''}
                autoSize={{ minRows: 5, maxRows: 10 }}
                placeholder="定义该节点的角色、任务与输出要求"
                disabled={readOnly}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
              />
            </div>

            <div className="agent-form__field">
              <div className="agent-form__label">工具标签</div>
              <Select
                mode="multiple"
                allowClear
                style={{ width: '100%' }}
                placeholder="选择该节点可用的工具(可多选)"
                value={Array.isArray(d.toolTags) ? d.toolTags : []}
                disabled={readOnly}
                onChange={(vals) => patch({ toolTags: vals })}
                options={toolTags}
              />
            </div>

            <div className="agent-form__field">
              <div className="agent-form__label">选用 LLM</div>
              <Select
                allowClear
                style={{ width: '100%' }}
                placeholder={
                  modelOptions.length === 0
                    ? '尚未配置模型,请到「模型配置」添加'
                    : '选择该节点使用的模型'
                }
                disabled={readOnly || modelOptions.length === 0}
                value={modelValid ? modelValue : undefined}
                onChange={onChangeModel}
                options={modelOptions}
              />
            </div>

            {/* 数据来源:有前序节点则只读展示前序;否则手动选文件/URL */}
            <div className="agent-form__field">
              <div className="agent-form__label">数据来源</div>
              {hasUpstream ? (
                <div className="node-source node-source--upstream">
                  <div className="node-source__hint">来自前序节点(不可修改)：</div>
                  <div className="node-source__ups">
                    {ups.map((n, i) => (
                      <span key={i} className="node-source__up-chip">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="node-source">
                  <Radio.Group
                    size="small"
                    value={sourceMode}
                    disabled={readOnly}
                    onChange={(e) => patch({ dataSourceMode: e.target.value })}
                    options={[
                      { label: '文件', value: 'file' },
                      { label: '网页 URL', value: 'url' },
                      { label: '历史产物', value: 'history' },
                    ]}
                    optionType="button"
                  />
                  {sourceMode === 'file' ? (
                    <div className="node-source__files">
                      {!inTauri && (
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            onPickFiles(e.target.files);
                            e.target.value = '';
                          }}
                        />
                      )}
                      <Button
                        size="small"
                        icon={<InboxOutlined />}
                        disabled={readOnly}
                        onClick={() =>
                          inTauri ? pickFilesTauri() : fileInputRef.current?.click()
                        }
                      >
                        选择文件
                      </Button>
                      {files.length > 0 && (
                        <div className="node-source__filelist">
                          {files.map((f) => (
                            <span key={f} className="node-source__file-chip">
                              <FileTextOutlined />
                              <span className="node-source__file-name">{f}</span>
                              {!readOnly && (
                                <CloseOutlined
                                  className="node-source__file-x"
                                  onClick={() => removeFile(f)}
                                />
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="node-hint">
                        {files.length > 0
                          ? inTauri
                            ? `已选 ${files.length} 个文件，运行时按文件路径读取内容`
                            : `已选 ${files.length} 个文件，文件内容读取待桌面端接入`
                          : '未选择任何文件，该节点缺少数据来源，无法运行'}
                      </div>
                    </div>
                  ) : sourceMode === 'url' ? (
                    <div className="node-source__url">
                      <Input
                        placeholder="https://example.com/doc"
                        value={
                          typeof d.dataSourceUrl === 'string'
                            ? d.dataSourceUrl
                            : ''
                        }
                        onChange={(e) =>
                          patch({ dataSourceUrl: e.target.value })
                        }
                      />
                      <div className="node-hint">网页抓取待桌面端接入</div>
                    </div>
                  ) : (
                    <div className="node-source__files">
                      <Button
                        size="small"
                        icon={<InboxOutlined />}
                        loading={historyLoading}
                        disabled={readOnly}
                        onClick={loadHistoryReports}
                      >
                        加载历史产物
                      </Button>
                      {historyPaths.length > 0 && (
                        <div className="node-source__filelist">
                          {historyPaths.map((p) => (
                            <span key={p} className="node-source__file-chip">
                              <FileTextOutlined />
                              <span className="node-source__file-name">{p}</span>
                              {!readOnly && (
                                <CloseOutlined
                                  className="node-source__file-x"
                                  onClick={() => removeHistoryPath(p)}
                                />
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      {historyReports.length > 0 && (
                        <div className="node-source__filelist">
                          {historyReports.map((r) => (
                            <label
                              key={r.data_path}
                              className="node-source__history-item"
                              title={r.summary}
                            >
                              <input
                                type="checkbox"
                                disabled={readOnly}
                                checked={historyPaths.includes(r.data_path)}
                                onChange={() => toggleHistoryPath(r.data_path)}
                              />
                              <span className="node-source__file-name">
                                {r.canvas_name} · {r.node_label} · {r.run_at}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      <div className="node-hint">
                        {inTauri
                          ? '从既有输出选取之前的结构化产物(data.json)作为本节点输入'
                          : '仅桌面端可选历史产物'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 输出目录 */}
            <div className="agent-form__field">
              <div className="agent-form__label">输出格式</div>
              <Select
                style={{ width: '100%' }}
                value={outputFormat}
                disabled={readOnly}
                options={OUTPUT_FORMAT_OPTIONS}
                onChange={(value) => patch({ outputFormat: value })}
              />
            </div>

            <div className="agent-form__field">
              <div className="agent-form__label">输出目录</div>
              <div className="node-output-path">
                <Button
                  icon={<FolderOpenOutlined />}
                  disabled={!inTauri}
                  title={
                    inTauri
                      ? outputFolderPath
                        ? '打开该节点产物目录'
                        : '打开总输出目录'
                      : '待桌面端接入'
                  }
                  onClick={openOutputDir}
                >
                  {outputFolderPath ? '打开节点产物目录' : '打开总输出目录'}
                </Button>
              </div>
              <div className="node-hint">产物保存到项目 outputs 目录，按 月份 / 日期 / 画布运行 / 节点产物 分级</div>
              <div className="node-folder-preview">
                {outputFolderPath ?? outputFolderPreview}
              </div>
            </div>

            {/* 本次输出内容 */}
            <div className="agent-form__field">
              <div className="agent-form__label">本次输出内容</div>
              <OutputItems
                lastOutput={d.lastOutput}
                openOutputItem={openOutputItem}
                missingPaths={missingPaths}
              />
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default PropertiesPanel;
