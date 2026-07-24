import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Input,
  Select,
  Radio,
  Button,
  App,
  Segmented,
  InputNumber,
  Switch,
  Collapse,
} from 'antd';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  FileTextOutlined,
  CloseOutlined,
  DownOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  RightOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useUiStore } from '../stores/uiStore';
import {
  useCanvasStore,
  upstreamNames,
  type AgentNodeData,
  type AgentNodeCapabilities,
  type AgentOutputFormat,
} from '../stores/canvasStore';
import { useAgentStore } from '../stores/agentStore';
import { findProfessionalAgent } from '../features/professionalPackages/agentRegistry';
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
import {
  NODE_PROMPT_CHAR_CAP,
  nodePromptSourceLabel,
  normalizeNodePromptText,
} from './PropertiesPanel/nodePromptImport';
import { TEXT_EXTENSIONS, fileToText, isTextFile } from '../lib/textFile';
import {
  INPUT_CHAR_LIMIT_MAX,
  INPUT_CHAR_LIMIT_MIN,
  NODE_MAX_TOKENS_MAX,
  NODE_MAX_TOKENS_MIN,
  NODE_TIMEOUT_SECONDS_MAX,
  NODE_TIMEOUT_SECONDS_MIN,
  executionCapability,
  generationCapability,
  inputCapability,
  mergeNodeCapability,
  validationCapability,
} from '../lib/agentNodeCapabilities';
import { rerunCanvasNode } from '../lib/agentRunner';

// 桌面端(Tauri)走系统原生选择器/打开;纯浏览器回落 <input type=file> 与提示。
const inTauri = isTauri();
const NODE_PROMPT_ACCEPT = TEXT_EXTENSIONS.map((ext) => `.${ext}`).join(',');

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

function CapabilityHeader({
  title,
  enabled,
  summary,
}: {
  title: string;
  enabled: boolean;
  summary: string;
}) {
  return (
    <div className="node-capability__header">
      <span>{title}</span>
      <em className={enabled ? 'is-enabled' : ''}>{summary}</em>
    </div>
  );
}

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
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [outputRulePreviewOpen, setOutputRulePreviewOpen] = useState(false);
  const [rerunLoading, setRerunLoading] = useState(false);

  const agentId =
    typeof node?.data?.agentId === 'string' ? node.data.agentId : undefined;
  const def = useAgentStore((s) =>
    agentId ? s.agents.find((a) => a.id === agentId) : undefined,
  );
  const professionalAgentId = typeof node?.data?.professionalAgentId === 'string'
    ? node.data.professionalAgentId
    : undefined;
  const professionalDef = professionalAgentId
    ? findProfessionalAgent(professionalAgentId)
    : undefined;

  const modelOptions = useModelOptions();
  const toolTags = useToolTags();

  // 前序节点名(有则手动来源被覆盖为只读)
  const ups = useMemo(
    () => (node && canvas ? upstreamNames(canvas.nodes, canvas.edges, node.id) : []),
    [node, canvas],
  );
  const hasUpstream = ups.length > 0;
  const upstreamOptions = useMemo(() => {
    if (!node || !canvas) return [];
    return canvas.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => {
        const source = canvas.nodes.find((item) => item.id === edge.source);
        const data = source?.data as AgentNodeData | undefined;
        return {
          value: edge.source,
          label: typeof data?.label === 'string' && data.label.trim()
            ? data.label
            : edge.source,
        };
      });
  }, [canvas, node]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptFileInputRef = useRef<HTMLInputElement>(null);
  const outputRuleFileInputRef = useRef<HTMLInputElement>(null);

  const d = (node?.data ?? {}) as AgentNodeData;
  const promptText = typeof d.systemPrompt === 'string' ? d.systemPrompt : '';
  const promptSourceName =
    typeof d.systemPromptSourceName === 'string'
      ? d.systemPromptSourceName
      : undefined;
  const promptSourceLabel = nodePromptSourceLabel(
    promptText,
    promptSourceName,
  );
  const outputRuleEnabled = d.outputRuleEnabled === true;
  const outputRuleText =
    typeof d.outputRuleText === 'string' ? d.outputRuleText : '';
  const outputRuleSourceName =
    typeof d.outputRuleSourceName === 'string'
      ? d.outputRuleSourceName
      : undefined;
  const outputRuleSourceLabel =
    outputRuleSourceName ?? (outputRuleText ? '已导入规则' : '未导入');
  const modelValue = packModelRef(d.modelRef ?? null);
  const modelValid = isValidModelRef(modelValue, modelOptions);
  const inputConfig = inputCapability(d.capabilities?.input);
  const generationConfig = generationCapability(d.capabilities?.generation);
  const executionConfig = executionCapability(d.capabilities?.execution);
  const validationConfig = validationCapability(d.capabilities?.validation);
  const runRecord = canvas?.runId
    ? useCanvasStore.getState().runHistory.find((record) => record.id === canvas.runId)
    : undefined;

  const sourceMode: 'file' | 'history' | 'inline' =
    d.dataSourceMode === 'history'
      || d.dataSourceMode === 'inline'
      ? d.dataSourceMode
      : 'file';
  const outputFormat: AgentOutputFormat =
    d.outputFormat === 'txt' ||
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

  useEffect(() => {
    setPromptPreviewOpen(false);
    setOutputRulePreviewOpen(false);
  }, [node?.id]);

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

  const patchCapability = <K extends keyof AgentNodeCapabilities,>(
    key: K,
    capabilityPatch: Partial<NonNullable<AgentNodeCapabilities[K]>>,
  ) => {
    patch({
      capabilities: mergeNodeCapability(d.capabilities, key, capabilityPatch),
    });
  };

  const rerunFailedNode = async () => {
    if (!canvas || !node || !runRecord) return;
    setRerunLoading(true);
    try {
      await rerunCanvasNode(canvas.id, node.id, runRecord.canvasId);
      message.success('已重跑该节点及其下游');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重跑失败');
    } finally {
      setRerunLoading(false);
    }
  };

  const moveSelectedUpstream = (id: string, offset: -1 | 1) => {
    const index = orderedSelectedIds.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= orderedSelectedIds.length) return;
    const next = [...orderedSelectedIds];
    [next[index], next[target]] = [next[target], next[index]];
    patchCapability('input', { upstreamOrder: next });
  };

  const onPickPromptFile = async (file: File) => {
    if (!isTextFile(file)) {
      message.warning('请选择纯文本格式的文件(txt/md/csv/json/log/xml/yaml/yml)');
      return;
    }
    try {
      const normalized = normalizeNodePromptText(await fileToText(file));
      patch({
        systemPrompt: normalized.text,
        systemPromptSourceName: file.name,
      });
      if (normalized.truncated) {
        message.warning(`文件内容过长,已截断至 ${NODE_PROMPT_CHAR_CAP} 字`);
      }
    } catch {
      message.error('读取文件失败');
    }
  };

  const onPickOutputRuleFile = async (file: File) => {
    if (!isTextFile(file)) {
      message.warning('请选择纯文本格式的文件(txt/md/csv/json/log/xml/yaml/yml)');
      return;
    }
    try {
      const normalized = normalizeNodePromptText(await fileToText(file));
      patch({
        outputRuleText: normalized.text,
        outputRuleSourceName: file.name,
      });
      if (normalized.truncated) {
        message.warning(`文件内容过长,已截断至 ${NODE_PROMPT_CHAR_CAP} 字`);
      }
    } catch {
      message.error('读取文件失败');
    }
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

  const renderManualSourceControls = () => (
    <div className="node-source">
      <Radio.Group
        size="small"
        value={sourceMode}
        disabled={readOnly}
        onChange={(e) => patch({ dataSourceMode: e.target.value })}
        options={[
          { label: '文件', value: 'file' },
          { label: '历史产物', value: 'history' },
          ...(sourceMode === 'inline'
            ? [{ label: '任务快照', value: 'inline' }]
            : []),
        ]}
        optionType="button"
      />
      {sourceMode === 'inline' ? (
        <div className="node-source__inline">
          <strong>{d.inlineDataSource?.name || '任务上下文快照'}</strong>
          <pre>{d.inlineDataSource?.content || '快照内容为空'}</pre>
          <div className="node-hint">这是创建专业任务时固定的上下文；可切换到其他来源，但不能直接改写快照。</div>
        </div>
      ) : sourceMode === 'file' ? (
        <div className="node-source__files">
          {!inTauri && (
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={readOnly}
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
              {files.map((file) => (
                <span key={file} className="node-source__file-chip">
                  <FileTextOutlined />
                  <span className="node-source__file-name">{file}</span>
                  {!readOnly && (
                    <CloseOutlined
                      className="node-source__file-x"
                      onClick={() => removeFile(file)}
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
              : '未选择任何文件'}
          </div>
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
              {historyPaths.map((path) => (
                <span key={path} className="node-source__file-chip">
                  <FileTextOutlined />
                  <span className="node-source__file-name">{path}</span>
                  {!readOnly && (
                    <CloseOutlined
                      className="node-source__file-x"
                      onClick={() => removeHistoryPath(path)}
                    />
                  )}
                </span>
              ))}
            </div>
          )}
          {historyReports.length > 0 && (
            <div className="node-source__filelist">
              {historyReports.map((report) => (
                <label
                  key={report.data_path}
                  className="node-source__history-item"
                  title={report.summary}
                >
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={historyPaths.includes(report.data_path)}
                    onChange={() => toggleHistoryPath(report.data_path)}
                  />
                  <span className="node-source__file-name">
                    {report.canvas_name} · {report.node_label} · {report.run_at}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="node-hint">
            {inTauri
              ? '从既有输出选取之前的结构化产物（data.json）作为本节点输入'
              : '仅桌面端可选历史产物'}
          </div>
        </div>
      )}
    </div>
  );

  const validationRuleCount = [
    validationConfig.minChars,
    validationConfig.maxChars,
    ...validationConfig.requiredTerms,
    ...validationConfig.forbiddenTerms,
  ].filter((value) => value !== null).length;
  const selectedOrderOptions = upstreamOptions.filter((option) =>
    inputConfig.selectedUpstreamIds.includes(option.value),
  );
  const orderedSelectedIds = [
    ...inputConfig.upstreamOrder.filter((id) =>
      inputConfig.selectedUpstreamIds.includes(id),
    ),
    ...inputConfig.selectedUpstreamIds.filter(
      (id) => !inputConfig.upstreamOrder.includes(id),
    ),
  ];

  // 门控节点(OR/AND/NOR):只渲染 label/description/gateType,跳过 LLM/工具/数据源/输出格式/Schema。
  if (node && d.gateType) {
    const gateType: 'or' | 'and' | 'nor' =
      d.gateType === 'and' || d.gateType === 'nor' ? d.gateType : 'or';
    return (
      <div
        className="right-panel"
        data-onboarding="properties-panel"
        style={{ width: rightWidth }}
      >
        <ResizeHandle side="right" />
        <div className="workspace-panel-header">
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
      <div
        className="right-panel"
        data-onboarding="properties-panel"
        style={{ width: rightWidth }}
      >
        <ResizeHandle side="right" />
        <div className="workspace-panel-header">
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
    <div
      className="right-panel"
      data-onboarding="properties-panel"
      style={{ width: rightWidth }}
    >
      <ResizeHandle side="right" />
      <div className="workspace-panel-header">
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
            {professionalAgentId && (
              <div className="agent-form__origin">
                {professionalDef
                  ? `源自${professionalDef.packageName}专业包：${professionalDef.name}`
                  : '来源专业包当前未安装；节点保留安装时的配置快照'}
              </div>
            )}
            <NodeRunStatus
              runState={d.runState}
              onRerun={
                readOnly &&
                d.runState?.status === 'failed' &&
                executionConfig.allowManualRerun &&
                runRecord
                  ? rerunFailedNode
                  : undefined
              }
              rerunLoading={rerunLoading}
            />

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
              <input
                ref={promptFileInputRef}
                type="file"
                accept={NODE_PROMPT_ACCEPT}
                style={{ display: 'none' }}
                disabled={readOnly}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onPickPromptFile(file);
                  event.target.value = '';
                }}
              />
              <div className="node-prompt-import__controls">
                <Button
                  size="small"
                  icon={<InboxOutlined />}
                  disabled={readOnly}
                  onClick={() => promptFileInputRef.current?.click()}
                >
                  选择文件导入
                </Button>
                <span title={promptSourceLabel}>
                  {promptText ? `已导入 · ${promptSourceLabel}` : '未导入'}
                </span>
              </div>
              <div className="master-config-preview node-prompt-import__preview">
                <button
                  type="button"
                  className="master-config-preview__toggle"
                  aria-expanded={promptPreviewOpen}
                  aria-label={
                    promptPreviewOpen
                      ? '收起系统提示词预览'
                      : '展开系统提示词预览'
                  }
                  onClick={() => setPromptPreviewOpen((open) => !open)}
                >
                  {promptPreviewOpen ? <DownOutlined /> : <RightOutlined />}
                  <span>系统提示词预览</span>
                  <em>{promptText.length.toLocaleString('en-US')} 字符</em>
                </button>
                {promptPreviewOpen && (
                  <Input.TextArea
                    value={promptText}
                    disabled
                    autoSize={{ minRows: 6, maxRows: 14 }}
                  />
                )}
              </div>
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

            {/* 数据来源：基础信息常显；高级选择与补充来源在输入处理能力中配置 */}
            <div className="agent-form__field">
              <div className="agent-form__label">数据来源</div>
              {hasUpstream ? (
                <div className="node-source node-source--upstream">
                  <div className="node-source__hint">来自前序节点：</div>
                  <div className="node-source__ups">
                    {ups.map((n, i) => (
                      <span key={i} className="node-source__up-chip">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                renderManualSourceControls()
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
               <div className="node-output-rule__switch-row">
                 <span>自定义输出规则</span>
                 <Switch
                   size="small"
                   checked={outputRuleEnabled}
                   disabled={readOnly}
                   onChange={(checked) => {
                     patch({ outputRuleEnabled: checked });
                     if (!checked) setOutputRulePreviewOpen(false);
                   }}
                 />
               </div>
               {outputRuleEnabled && (
                 <div className="node-output-rule">
                   <input
                     ref={outputRuleFileInputRef}
                     type="file"
                     accept={NODE_PROMPT_ACCEPT}
                     style={{ display: 'none' }}
                     disabled={readOnly}
                     onChange={(event) => {
                       const file = event.target.files?.[0];
                       if (file) void onPickOutputRuleFile(file);
                       event.target.value = '';
                     }}
                   />
                   <div className="node-prompt-import__controls node-output-rule__controls">
                     <Button
                       size="small"
                       icon={<InboxOutlined />}
                       disabled={readOnly}
                       onClick={() => outputRuleFileInputRef.current?.click()}
                     >
                       选择文件导入
                     </Button>
                     <span title={outputRuleSourceLabel}>
                       {outputRuleText
                         ? `已导入 · ${outputRuleSourceLabel}`
                         : '未导入'}
                     </span>
                   </div>
                   <div className="master-config-preview node-prompt-import__preview node-output-rule__preview">
                     <button
                       type="button"
                       className="master-config-preview__toggle"
                       aria-expanded={outputRulePreviewOpen}
                       aria-label={
                         outputRulePreviewOpen
                           ? '收起输出规则预览'
                           : '展开输出规则预览'
                       }
                       onClick={() =>
                         setOutputRulePreviewOpen((open) => !open)
                       }
                     >
                       {outputRulePreviewOpen ? (
                         <DownOutlined />
                       ) : (
                         <RightOutlined />
                       )}
                       <span>输出规则预览</span>
                       <em>
                         {outputRuleText.length.toLocaleString('en-US')} 字符
                       </em>
                     </button>
                     {outputRulePreviewOpen && (
                       <Input.TextArea
                         value={outputRuleText}
                         disabled
                         autoSize={{ minRows: 6, maxRows: 14 }}
                       />
                     )}
                   </div>
                 </div>
               )}
             </div>

            <div className="node-capabilities">
              <Collapse
                size="small"
                items={[{
                  key: 'input',
                  label: (
                    <CapabilityHeader
                      title="输入处理"
                      enabled={inputConfig.enabled}
                      summary={inputConfig.enabled
                        ? `${inputConfig.selectionMode === 'all' ? '全部上游' : '指定上游'} · ${{
                            structured: '结构化内容',
                            summary: '摘要',
                            full: '完整正文',
                          }[inputConfig.contentMode]}`
                        : '默认行为'}
                    />
                  ),
                  children: (
                    <div className="node-capability__body">
                      <div className="node-capability__switch-row">
                        <span>启用输入处理</span>
                        <Switch
                          size="small"
                          checked={inputConfig.enabled}
                          disabled={readOnly}
                          onChange={(enabled) => patchCapability('input', { enabled })}
                        />
                      </div>
                      {inputConfig.enabled && (
                        <>
                          {hasUpstream && (
                            <>
                              <div className="agent-form__field">
                                <div className="agent-form__label">上游范围</div>
                                <Segmented
                                  block
                                  size="small"
                                  disabled={readOnly}
                                  value={inputConfig.selectionMode}
                                  options={[
                                    { label: '全部上游', value: 'all' },
                                    { label: '指定上游', value: 'selected' },
                                  ]}
                                  onChange={(selectionMode) => patchCapability('input', {
                                    selectionMode: selectionMode as 'all' | 'selected',
                                  })}
                                />
                              </div>
                              {inputConfig.selectionMode === 'selected' && (
                                <>
                                  <div className="agent-form__field">
                                    <div className="agent-form__label">选择上游节点</div>
                                    <Select
                                      mode="multiple"
                                      allowClear
                                      disabled={readOnly}
                                      value={inputConfig.selectedUpstreamIds}
                                      options={upstreamOptions}
                                      placeholder="选择参与输入的上游节点"
                                      onChange={(selectedUpstreamIds) => patchCapability('input', {
                                        selectedUpstreamIds,
                                        upstreamOrder: [
                                          ...orderedSelectedIds.filter((id) => selectedUpstreamIds.includes(id)),
                                          ...selectedUpstreamIds.filter((id) => !orderedSelectedIds.includes(id)),
                                        ],
                                      })}
                                    />
                                  </div>
                                  {orderedSelectedIds.length > 1 && (
                                    <div className="agent-form__field">
                                      <div className="agent-form__label">处理顺序</div>
                                      <div className="node-capability__order-list">
                                        {orderedSelectedIds.map((id, index) => (
                                          <div key={id} className="node-capability__order-item">
                                            <span>{selectedOrderOptions.find((option) => option.value === id)?.label ?? id}</span>
                                            <div>
                                              <Button
                                                type="text"
                                                size="small"
                                                icon={<UpOutlined />}
                                                title="上移"
                                                disabled={readOnly || index === 0}
                                                onClick={() => moveSelectedUpstream(id, -1)}
                                              />
                                              <Button
                                                type="text"
                                                size="small"
                                                icon={<DownOutlined />}
                                                title="下移"
                                                disabled={readOnly || index === orderedSelectedIds.length - 1}
                                                onClick={() => moveSelectedUpstream(id, 1)}
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </>
                          )}
                          <div className="agent-form__field">
                            <div className="agent-form__label">内容模式</div>
                            <Select
                              disabled={readOnly}
                              value={inputConfig.contentMode}
                              options={[
                                { label: '完整正文', value: 'full' },
                                { label: '摘要', value: 'summary' },
                                { label: '结构化内容', value: 'structured' },
                              ]}
                              onChange={(contentMode) => patchCapability('input', { contentMode })}
                            />
                          </div>
                          {hasUpstream && (
                            <>
                              <div className="node-capability__switch-row">
                                <span>补充文件或历史产物</span>
                                <Switch
                                  size="small"
                                  checked={inputConfig.includeSupplementalSources}
                                  disabled={readOnly}
                                  onChange={(includeSupplementalSources) =>
                                    patchCapability('input', { includeSupplementalSources })}
                                />
                              </div>
                              {inputConfig.includeSupplementalSources && renderManualSourceControls()}
                            </>
                          )}
                          <div className="node-capability__grid">
                            <div className="agent-form__field">
                              <div className="agent-form__label">输入字符上限</div>
                              <InputNumber
                                min={INPUT_CHAR_LIMIT_MIN}
                                max={INPUT_CHAR_LIMIT_MAX}
                                step={1000}
                                disabled={readOnly}
                                value={inputConfig.maxInputChars}
                                onChange={(maxInputChars) => patchCapability('input', {
                                  maxInputChars: Number(maxInputChars ?? 120000),
                                })}
                              />
                            </div>
                            <div className="agent-form__field">
                              <div className="agent-form__label">超长处理</div>
                              <Select
                                disabled={readOnly}
                                value={inputConfig.oversizeStrategy}
                                options={[
                                  { label: '报错停止', value: 'error' },
                                  { label: '截断', value: 'truncate' },
                                  { label: '模型压缩', value: 'summarize' },
                                ]}
                                onChange={(oversizeStrategy) => patchCapability('input', { oversizeStrategy })}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ),
                }]}
              />

              <Collapse
                size="small"
                items={[{
                  key: 'generation',
                  label: (
                    <CapabilityHeader
                      title="模型生成"
                      enabled={generationConfig.enabled}
                      summary={generationConfig.enabled
                        ? `${generationConfig.maxTokens} tokens · ${generationConfig.temperature === null ? '继承温度' : `T ${generationConfig.temperature}`}`
                        : '继承默认参数'}
                    />
                  ),
                  children: (
                    <div className="node-capability__body">
                      <div className="node-capability__switch-row">
                        <span>启用生成参数覆盖</span>
                        <Switch
                          size="small"
                          checked={generationConfig.enabled}
                          disabled={readOnly}
                          onChange={(enabled) => patchCapability('generation', { enabled })}
                        />
                      </div>
                      {generationConfig.enabled && (
                        <>
                          <div className="agent-form__field">
                            <div className="agent-form__label">最大输出 Tokens</div>
                            <InputNumber
                              min={NODE_MAX_TOKENS_MIN}
                              max={NODE_MAX_TOKENS_MAX}
                              step={512}
                              disabled={readOnly}
                              value={generationConfig.maxTokens}
                              onChange={(maxTokens) => patchCapability('generation', {
                                maxTokens: Number(maxTokens ?? NODE_MAX_TOKENS_MAX),
                              })}
                            />
                          </div>
                          <div className="node-capability__switch-row">
                            <span>自定义温度</span>
                            <Switch
                              size="small"
                              checked={generationConfig.temperature !== null}
                              disabled={readOnly}
                              onChange={(checked) => patchCapability('generation', {
                                temperature: checked ? 0.7 : null,
                              })}
                            />
                          </div>
                          {generationConfig.temperature !== null && (
                            <InputNumber
                              min={0}
                              max={2}
                              step={0.1}
                              precision={2}
                              disabled={readOnly}
                              value={generationConfig.temperature}
                              onChange={(temperature) => patchCapability('generation', {
                                temperature: Number(temperature ?? 0.7),
                              })}
                            />
                          )}
                          <div className="agent-form__field">
                            <div className="agent-form__label">回退模型</div>
                            <Select
                              allowClear
                              disabled={readOnly || modelOptions.length === 0}
                              placeholder="主模型重试耗尽后使用（可选）"
                              value={packModelRef(generationConfig.fallbackModelRef)}
                              options={modelOptions.filter((option) => option.value !== modelValue)}
                              onChange={(value) => patchCapability('generation', {
                                fallbackModelRef: unpackModelRef(value),
                              })}
                            />
                          </div>
                          <div className="node-capability__switch-row">
                            <span>空输出自动重试</span>
                            <Switch
                              size="small"
                              checked={generationConfig.retryOnEmpty}
                              disabled={readOnly}
                              onChange={(retryOnEmpty) => patchCapability('generation', { retryOnEmpty })}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ),
                }]}
              />

              <Collapse
                size="small"
                items={[{
                  key: 'execution',
                  label: (
                    <CapabilityHeader
                      title="执行策略"
                      enabled={executionConfig.enabled}
                      summary={executionConfig.enabled
                        ? `重试 ${executionConfig.retryCount} 次 · ${executionConfig.timeoutSeconds} 秒`
                        : '默认 · 重试 2 次'}
                    />
                  ),
                  children: (
                    <div className="node-capability__body">
                      <div className="node-capability__switch-row">
                        <span>启用执行策略</span>
                        <Switch
                          size="small"
                          checked={executionConfig.enabled}
                          disabled={readOnly}
                          onChange={(enabled) => patchCapability('execution', { enabled })}
                        />
                      </div>
                      {executionConfig.enabled && (
                        <>
                          <div className="node-capability__grid">
                            <div className="agent-form__field">
                              <div className="agent-form__label">节点重试次数</div>
                              <InputNumber
                                min={0}
                                max={2}
                                disabled={readOnly}
                                value={executionConfig.retryCount}
                                onChange={(retryCount) => patchCapability('execution', {
                                  retryCount: Number(retryCount ?? 0),
                                })}
                              />
                            </div>
                            <div className="agent-form__field">
                              <div className="agent-form__label">单次超时（秒）</div>
                              <InputNumber
                                min={NODE_TIMEOUT_SECONDS_MIN}
                                max={NODE_TIMEOUT_SECONDS_MAX}
                                step={15}
                                disabled={readOnly}
                                value={executionConfig.timeoutSeconds}
                                onChange={(timeoutSeconds) => patchCapability('execution', {
                                  timeoutSeconds: Number(timeoutSeconds ?? 300),
                                })}
                              />
                            </div>
                          </div>
                          <div className="node-capability__switch-row">
                            <span>允许失败后手动重跑</span>
                            <Switch
                              size="small"
                              checked={executionConfig.allowManualRerun}
                              disabled={readOnly}
                              onChange={(allowManualRerun) =>
                                patchCapability('execution', { allowManualRerun })}
                            />
                          </div>
                          <div className="node-hint">
                            运行快照中可重跑失败节点及其下游，已成功上游不会重复执行。
                          </div>
                        </>
                      )}
                    </div>
                  ),
                }]}
              />

              <Collapse
                size="small"
                items={[{
                  key: 'validation',
                  label: (
                    <CapabilityHeader
                      title="质量校验"
                      enabled={validationConfig.enabled}
                      summary={validationConfig.enabled
                        ? `${validationRuleCount} 项规则 · ${validationConfig.onFailure === 'retry' ? '失败重试' : '失败停止'}`
                        : '未启用'}
                    />
                  ),
                  children: (
                    <div className="node-capability__body">
                      <div className="node-capability__switch-row">
                        <span>启用确定性校验</span>
                        <Switch
                          size="small"
                          checked={validationConfig.enabled}
                          disabled={readOnly}
                          onChange={(enabled) => patchCapability('validation', { enabled })}
                        />
                      </div>
                      {validationConfig.enabled && (
                        <>
                          <div className="node-capability__grid">
                            <div className="agent-form__field">
                              <div className="agent-form__label">最少字符</div>
                              <InputNumber
                                min={0}
                                disabled={readOnly}
                                value={validationConfig.minChars}
                                placeholder="不限"
                                onChange={(minChars) => patchCapability('validation', {
                                  minChars: minChars === null ? null : Number(minChars),
                                })}
                              />
                            </div>
                            <div className="agent-form__field">
                              <div className="agent-form__label">最多字符</div>
                              <InputNumber
                                min={0}
                                disabled={readOnly}
                                value={validationConfig.maxChars}
                                placeholder="不限"
                                onChange={(maxChars) => patchCapability('validation', {
                                  maxChars: maxChars === null ? null : Number(maxChars),
                                })}
                              />
                            </div>
                          </div>
                          <div className="agent-form__field">
                            <div className="agent-form__label">必含词</div>
                            <Select
                              mode="tags"
                              allowClear
                              disabled={readOnly}
                              tokenSeparators={[',', '，']}
                              value={validationConfig.requiredTerms}
                              placeholder="输入后回车，可添加多个"
                              onChange={(requiredTerms) => patchCapability('validation', { requiredTerms })}
                            />
                          </div>
                          <div className="agent-form__field">
                            <div className="agent-form__label">禁用词</div>
                            <Select
                              mode="tags"
                              allowClear
                              disabled={readOnly}
                              tokenSeparators={[',', '，']}
                              value={validationConfig.forbiddenTerms}
                              placeholder="输入后回车，可添加多个"
                              onChange={(forbiddenTerms) => patchCapability('validation', { forbiddenTerms })}
                            />
                          </div>
                          <div className="agent-form__field">
                            <div className="agent-form__label">校验失败后</div>
                            <Segmented
                              block
                              size="small"
                              disabled={readOnly}
                              value={validationConfig.onFailure}
                              options={[
                                { label: '标记失败', value: 'fail' },
                                { label: '按策略重试', value: 'retry' },
                              ]}
                              onChange={(onFailure) => patchCapability('validation', {
                                onFailure: onFailure as 'fail' | 'retry',
                              })}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ),
                }]}
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
