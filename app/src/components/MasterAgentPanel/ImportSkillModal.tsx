import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, Modal, Segmented, Select, Tag, Tooltip } from 'antd';
import {
  CloudUploadOutlined,
  FileMarkdownOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { LLMConfig } from '../../lib/llmClient';
import { getProvider } from '../../lib/providers';
import { useModelStore } from '../../stores/modelStore';
import { useUiStore } from '../../stores/uiStore';
import {
  isBuiltinSkill,
  writeJiziSkills,
  type JiziSkill,
} from '../../lib/jiziSkills';
import {
  analyzeImportedSkill,
  analyzeImportedSkillPreserve,
  deepCompareSkill,
  type SkillCandidate,
} from '../../lib/jiziSkillImport';
import {
  assertSkillTextLimits,
  generatedSkillId,
  normalizeSkillId,
  SKILL_DESCRIPTION_CHAR_LIMIT,
  SKILL_INSTRUCTION_CHAR_LIMIT,
  SKILL_TITLE_CHAR_LIMIT,
  sliceUnicode,
} from '../../lib/jiziSkillFormat';

type ImportMode = 'rewrite' | 'preserve';

interface ImportSkillModalProps {
  open: boolean;
  onClose: () => void;
  skills: JiziSkill[];
  onImported: () => void | Promise<void>;
}

type ConflictResolution = 'skip' | 'overwrite' | 'rename';

interface CandidateRow extends SkillCandidate {
  id: string; // 用户可编辑的索引
  selected: boolean;
  conflict: ConflictResolution;
  preserveRaw: boolean;
}

export function ImportSkillModal({
  open,
  onClose,
  skills,
  onImported,
}: ImportSkillModalProps) {
  const { message, modal } = App.useApp();
  const masterModel = useUiStore((s) => s.masterModel);
  const configs = useModelStore((s) => s.configs);

  const [analyzing, setAnalyzing] = useState(false);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [stage, setStage] = useState<'idle' | 'confirm'>('idle');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ImportMode>('rewrite');
  const [activeIndex, setActiveIndex] = useState(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const analysisController = useRef<AbortController | null>(null);

  const resolveLlmCfg = useCallback((): {
    cfg: LLMConfig;
    modelId: string;
  } | null => {
    if (!masterModel) {
      setAnalysisError('尚未选择姬子对话模型，请先在右下角选择模型后重试。');
      return null;
    }
    const cfg = configs.find((c) => c.id === masterModel.configId);
    if (!cfg) {
      setAnalysisError('当前选择的模型配置已经失效，请重新选择模型。');
      return null;
    }
    if (!cfg.apiKey) {
      setAnalysisError('当前模型没有配置密钥，请先到「模型配置」补全。');
      return null;
    }
    const preset = getProvider(cfg.providerId);
    const llmCfg: LLMConfig = {
      api: preset?.api ?? 'openai',
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
    };
    return { cfg: llmCfg, modelId: masterModel.modelId };
  }, [masterModel, configs]);

  const reset = () => {
    setRows([]);
    setStage('idle');
    setAnalyzing(false);
    setSaving(false);
    setActiveIndex(0);
    setAnalysisError(null);
    setAnalysisProgress('');
  };

  const handleSelectFiles = async () => {
    setAnalysisError(null);
    const llm = resolveLlmCfg();
    if (!llm) return;
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!selected || selected.length === 0) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length > 5) {
      message.warning('一次最多导入 5 个文件');
      return;
    }

    setAnalyzing(true);
    setStage('idle');
    setRows([]);
    setAnalysisProgress('正在读取文件...');
    const controller = new AbortController();
    analysisController.current = controller;
    try {
      const fileContents = await Promise.all(
        paths.map((p) => invoke<string>('read_text_file', { path: p })),
      );
      const existingSkills = skills.map((s) => ({
        id: s.id,
        displayDescription: s.description,
        capabilities: s.capabilities,
      }));

      const allCandidates: SkillCandidate[] = [];
      for (let i = 0; i < fileContents.length; i += 1) {
        if (mode === 'preserve') {
          const { candidates } = await analyzeImportedSkillPreserve({
            fileContent: fileContents[i],
            fileName: paths[i],
            existingSkills,
            cfg: llm.cfg,
            model: llm.modelId,
            signal: controller.signal,
            onProgress: setAnalysisProgress,
          });
          allCandidates.push(...candidates);
        } else {
          const { candidates } = await analyzeImportedSkill({
            fileContent: fileContents[i],
            fileName: paths[i],
            existingSkills,
            cfg: llm.cfg,
            model: llm.modelId,
            signal: controller.signal,
            onProgress: setAnalysisProgress,
          });
          allCandidates.push(...candidates);
        }
      }

      const existingIds = new Set(skills.map((s) => s.id));
      const byId = new Map<string, JiziSkill>();
      skills.forEach((s) => byId.set(s.id, s));

      const candidateRows: CandidateRow[] = allCandidates.map((c, index) => {
        const conflictId = c.possibleDuplicateOf;
        const duplicateSkill = conflictId ? byId.get(conflictId) : undefined;
        const shouldRewriteLegacy =
          !!duplicateSkill?.legacyFormat && !isBuiltinSkill(duplicateSkill);
        const initialId =
          shouldRewriteLegacy
            ? normalizeSkillId(conflictId ?? '')
            : normalizeSkillId(c.index ?? '') ||
              generatedSkillId(`${c.sourceFile}|${index}|${c.displayTitle}|${c.displayDescription}`);
        const hasIdClash = existingIds.has(initialId);
        return {
          ...c,
          id: initialId,
          selected: true,
          conflict: shouldRewriteLegacy ? 'overwrite' : hasIdClash ? 'rename' : 'skip',
          preserveRaw: c.preserveRaw ?? false,
        };
      });

      setRows(candidateRows);
      setAnalysisProgress('正在检查重复 Skill...');
      setActiveIndex(0);
      setStage('confirm');

      await Promise.all(candidateRows.map(async (row, i) => {
        if (!row.possibleDuplicateOf) return;
        const existing = byId.get(row.possibleDuplicateOf);
        if (!existing) return;
        try {
          const result = await deepCompareSkill({
            candidate: row,
            existing: { id: existing.id, instructions: existing.instructions },
            cfg: llm.cfg,
            model: llm.modelId,
            signal: controller.signal,
          });
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    recommendation: result.recommendation,
                    duplicateReason: result.reason,
                  }
                : r,
            ),
          );
        } catch {
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    duplicateReason: '深度比对失败，建议自行判断',
                  }
                : r,
            ),
          );
        }
      }));
    } catch (err) {
      if (controller.signal.aborted) {
        setAnalysisError(null);
        message.info('已停止 Skill 分析');
        return;
      }
      const detail = err instanceof Error ? err.message : '姬子分析失败，请重试';
      setAnalysisError(detail);
    } finally {
      if (analysisController.current === controller) analysisController.current = null;
      setAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  const updateRow = (index: number, patch: Partial<CandidateRow>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const handleConfirmImport = async () => {
    const existingIds = new Set(skills.map((s) => s.id));
    const usedIds = new Set<string>();
    const toSave: {
      row: CandidateRow;
      rowIndex: number;
      id: string;
      overwrite: boolean;
    }[] = [];
    for (const [rowIndex, row] of rows.entries()) {
      if (!row.selected) continue;
      const rawId = normalizeSkillId(row.id) || generatedSkillId(`${row.sourceFile}|${row.displayTitle}`);
      if (!rawId) {
        message.warning(`存在索引为空的候选，请补全`);
        return;
      }
      let finalId = rawId;
      let overwrite = false;

      if (existingIds.has(rawId)) {
        if (row.conflict === 'overwrite') {
          finalId = rawId;
          overwrite = true;
        } else if (row.conflict === 'rename') {
          let suffix = 2;
          finalId = `${rawId}-${suffix}`;
          while ((existingIds.has(finalId) || usedIds.has(finalId)) && suffix < 100) {
            suffix += 1;
            finalId = `${rawId}-${suffix}`;
          }
          if (suffix >= 100) {
            message.warning(`「${row.displayTitle}」改名尝试 100 次仍冲突，请手动修改索引`);
            return;
          }
        } else {
          message.warning(
            `「${row.displayTitle}」的索引 ${rawId} 与已有 skill 冲突，请选择覆盖或自动改名`,
          );
          return;
        }
      } else if (usedIds.has(rawId)) {
        let suffix = 2;
        finalId = `${rawId}-${suffix}`;
        while ((existingIds.has(finalId) || usedIds.has(finalId)) && suffix < 100) {
          suffix += 1;
          finalId = `${rawId}-${suffix}`;
        }
        if (suffix >= 100) {
          message.warning(`「${row.displayTitle}」改名尝试 100 次仍冲突，请手动修改索引`);
          return;
        }
      } else {
        finalId = rawId;
      }
      usedIds.add(finalId);
      const payload = {
        description: row.displayDescription.trim(),
        instructions: row.instructions.trim(),
      };
      if (
        !row.displayTitle.trim() ||
        !payload.description ||
        row.capabilities.length === 0 ||
        !payload.instructions
      ) {
        message.warning(`请补全「${row.displayTitle || finalId}」的名称、描述、能力和正文`);
        return;
      }
      try {
        assertSkillTextLimits(payload);
      } catch (err) {
        message.warning(err instanceof Error ? err.message : 'Skill 内容超过长度上限');
        return;
      }
      toSave.push({ row, rowIndex, id: finalId, overwrite });
    }

    if (toSave.length === 0) {
      message.info('没有要导入的 skill');
      return;
    }

    const builtinOverwrite = toSave.find(
      (item) => item.overwrite && isBuiltinSkill(skills.find((s) => s.id === item.id)),
    );
    if (builtinOverwrite) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: '确认覆盖内置 skill',
          content: `「${builtinOverwrite.id}」是内置 skill，覆盖后原始内容将被替换，确定继续？`,
          okText: '确认覆盖',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) {
        message.info('已取消导入');
        return;
      }
    }

    setSaving(true);
    try {
      await writeJiziSkills(
        toSave.map((item) => ({
          id: item.id,
          title: item.row.displayTitle.trim(),
          description: item.row.displayDescription.trim(),
          category: item.row.category,
          capabilities: item.row.capabilities,
          instructions: item.row.instructions.trim(),
          overwrite: item.overwrite,
        })),
      );
      message.success(`成功导入 ${toSave.length} 个 skill`);
      await onImported();
      reset();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Skill 导入失败，未写入任何内容');
    } finally {
      setSaving(false);
    }
  };

  const existingIds = useMemo(() => new Set(skills.map((s) => s.id)), [skills]);
  const selectedCount = rows.filter((r) => r.selected).length;
  const conflictCount = rows.filter((r) =>
    existingIds.has(normalizeSkillId(r.id)),
  ).length;
  const activeRow = rows[activeIndex] ?? rows[0];
  const activeHasIdClash = activeRow
    ? existingIds.has(normalizeSkillId(activeRow.id))
    : false;
  const activeIsDuplicate = !!activeRow?.possibleDuplicateOf;

  return (
    <Modal
      title={null}
      open={open}
      onCancel={() => {
        if (saving) return;
        if (analyzing) {
          analysisController.current?.abort();
          return;
        }
        reset();
        onClose();
      }}
      footer={
        stage === 'confirm' ? (
          <>
            <Button onClick={() => { reset(); onClose(); }} disabled={saving}>
              取消
            </Button>
            <Button
              type="primary"
              onClick={handleConfirmImport}
              loading={saving}
              disabled={selectedCount === 0}
            >
              导入 {selectedCount} 个
            </Button>
          </>
        ) : analyzing ? (
          <Button danger onClick={() => analysisController.current?.abort()}>
            停止分析
          </Button>
        ) : null
      }
      width="min(1120px, calc(100vw - 64px))"
      className="jizi-skill-import-modal"
      destroyOnHidden
      mask={{ closable: !analyzing && !saving }}
    >
      {analysisError && (
        <div className="jizi-skill-import__error">
          <Alert
            type="error"
            showIcon
            title="Skill 分析失败"
            description={analysisError}
            action={(
              <Button size="small" danger onClick={handleSelectFiles}>
                重新选择并分析
              </Button>
            )}
          />
        </div>
      )}
      {stage === 'idle' && !analyzing && (
        <div className="jizi-skill-import__intro">
          <div className="jizi-skill-import__hero">
            <div>
              <div className="jizi-skill-import__eyebrow">Skill 导入</div>
              <h2>导入 Skill</h2>
              <p>
                选择 Markdown 文件后，姬子会读取内容、按专业 Skill 规范整理、识别重复项，并在写入前交给你确认。
              </p>
            </div>
            <div className="jizi-skill-import__summary">
              <span>支持 .md</span>
              <strong>最多 5 个文件</strong>
            </div>
          </div>

          <div className="jizi-skill-import__workspace">
            <section className="jizi-skill-import__upload-panel">
              <div className="jizi-skill-import__upload-icon">
                <CloudUploadOutlined />
              </div>
              <div>
                <h3>选择文件并开始分析</h3>
                <p>
                  建议导入包含职责、能力边界、操作步骤的 Skill 文档。分析完成后可以修改名称、描述、能力和冲突策略。
                </p>
              </div>
              <Button
                type="primary"
                size="large"
                icon={<FileMarkdownOutlined />}
                loading={analyzing}
                onClick={handleSelectFiles}
              >
                选择 .md 文件
              </Button>
            </section>

            <aside className="jizi-skill-import__side">
              <div className="jizi-skill-import__mode-card">
                <div className="jizi-skill-import__mode-head">
                  <ThunderboltOutlined />
                  <span>导入模式</span>
                </div>
                <Segmented
                  block
                  value={mode}
                  onChange={(v) => { setMode(v as ImportMode); reset(); }}
                  options={[
                    { label: '智能整理', value: 'rewrite' },
                    { label: '原文照存', value: 'preserve' },
                  ]}
                />
                <p className="jizi-skill-import__hint">
                  {mode === 'rewrite'
                    ? '适合普通 Skill 文档：自动拆分，并整理为专业的中文名称、描述、能力和正文。'
                    : '适合规范 Skill：保留原始正文和能力，仅读取中文名称、描述和索引。'}
                </p>
              </div>
              <div className="jizi-skill-import__checks">
                <div><SafetyCertificateOutlined /> 检查重复 Skill</div>
                <div><SafetyCertificateOutlined /> 旧格式 Skill 默认复写</div>
                <div><SafetyCertificateOutlined /> 保留写入前确认</div>
                <div><SafetyCertificateOutlined /> 内置 Skill 覆盖需二次确认</div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {(analyzing || stage === 'confirm') && (
        <div className="jizi-skill-import__confirm">
          <div className="jizi-skill-import__confirm-head">
            <div>
              <div className="jizi-skill-import__eyebrow">导入确认</div>
              <h3>确认导入内容</h3>
              <p>检查解析出的 Skill 候选，勾选后写入本地库。</p>
            </div>
            <div className="jizi-skill-import__confirm-stats">
              <span>已解析 <strong>{rows.length}</strong></span>
              <span>将导入 <strong>{selectedCount}</strong></span>
              <span>冲突 <strong>{conflictCount}</strong></span>
            </div>
          </div>

          {rows.length === 0 && analyzing ? (
            <p className="jizi-skill-import__loading">
              {analysisProgress || '姬子正在阅读并分析文件，请稍候...'}
            </p>
          ) : (
            <div className="jizi-skill-import__review">
              <aside className="jizi-skill-import__nav" aria-label="待导入 Skill">
                {rows.map((row, i) => {
                  const hasIdClash = existingIds.has(
                    normalizeSkillId(row.id),
                  );
                  const isDuplicate = !!row.possibleDuplicateOf;
                  return (
                    <div
                      key={i}
                      className={`jizi-skill-import__nav-item ${i === activeIndex ? 'jizi-skill-import__nav-item--active' : ''} ${!row.selected ? 'jizi-skill-import__nav-item--off' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveIndex(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActiveIndex(i);
                        }
                      }}
                    >
                      <Checkbox
                        checked={row.selected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          updateRow(i, {
                            selected: checked,
                            conflict:
                              checked && hasIdClash && row.conflict === 'skip'
                                ? 'rename'
                                : row.conflict,
                          });
                        }}
                      />
                      <div className="jizi-skill-import__nav-main">
                        <span>{row.displayTitle}</span>
                        <small>{row.sourceFile.split(/[\\/]/).pop() ?? row.sourceFile}</small>
                        <div className="jizi-skill-import__nav-tags">
                          {row.preserveRaw && <Tag color="purple">原文</Tag>}
                          {isDuplicate && <Tag color="orange">重复</Tag>}
                          {hasIdClash && <Tag color="red">冲突</Tag>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </aside>

              <section className="jizi-skill-import__detail">
                {activeRow && (
                  <>
                    <div className="jizi-skill-import__detail-head">
                      <div>
                        <h4>{activeRow.displayTitle}</h4>
                        <span>
                          来源: {activeRow.sourceFile.split(/[\\/]/).pop() ?? activeRow.sourceFile}
                        </span>
                      </div>
                      <Checkbox
                        checked={activeRow.selected}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          updateRow(activeIndex, {
                            selected: checked,
                            conflict:
                              checked && activeHasIdClash && activeRow.conflict === 'skip'
                                ? 'rename'
                                : activeRow.conflict,
                          });
                        }}
                      >
                        导入
                      </Checkbox>
                    </div>

                    <div className="jizi-skill-import__fields">
                      <label>
                        Skill 名称
                        <Input
                          value={activeRow.displayTitle}
                          maxLength={SKILL_TITLE_CHAR_LIMIT}
                          showCount
                          onChange={(e) =>
                            updateRow(activeIndex, { displayTitle: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Skill 描述
                        <Input.TextArea
                          value={activeRow.displayDescription}
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          maxLength={SKILL_DESCRIPTION_CHAR_LIMIT}
                          showCount
                          onChange={(e) =>
                            updateRow(activeIndex, {
                              displayDescription: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        分类
                        <Select
                          value={activeRow.category}
                          options={[
                            { value: 'workflow', label: '工作流' },
                            { value: 'tool', label: '工具' },
                            { value: 'diagnosis', label: '诊断' },
                            { value: 'model', label: '模型' },
                            { value: 'skill', label: 'Skill 编写' },
                          ]}
                          onChange={(category) => updateRow(activeIndex, { category })}
                        />
                      </label>
                      <label>
                        索引
                        <Input
                          value={activeRow.id}
                          onChange={(e) =>
                            updateRow(activeIndex, { id: e.target.value })
                          }
                          onBlur={(e) => {
                            const id =
                              normalizeSkillId(e.target.value) ||
                              generatedSkillId(
                                `${activeRow.sourceFile}|${activeRow.displayTitle}`,
                              );
                            updateRow(activeIndex, {
                              id,
                              conflict:
                                existingIds.has(id) && activeRow.conflict === 'skip'
                                  ? 'rename'
                                  : activeRow.conflict,
                            });
                          }}
                        />
                      </label>
                      <label>
                        具体能力
                        <Input.TextArea
                          value={activeRow.capabilities.join('\n')}
                          autoSize={{ minRows: 3, maxRows: 6 }}
                          readOnly={activeRow.preserveRaw}
                          onChange={(e) =>
                            updateRow(activeIndex, {
                              capabilities: e.target.value
                                .split(/\r?\n/)
                                .map((l) => l.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                      <label>
                        做事方法
                        <Input.TextArea
                          value={activeRow.instructions}
                          autoSize={{ minRows: 9, maxRows: 16 }}
                          maxLength={SKILL_INSTRUCTION_CHAR_LIMIT}
                          showCount
                          readOnly={activeRow.preserveRaw}
                          onChange={(e) =>
                            updateRow(activeIndex, {
                              instructions: sliceUnicode(
                                e.target.value,
                                SKILL_INSTRUCTION_CHAR_LIMIT,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>

                    {activeIsDuplicate && (
                      <div className="jizi-skill-import__dup">
                        <Tag color="orange">疑似与「{activeRow.possibleDuplicateOf}」重复</Tag>
                        {activeRow.recommendation && (
                          <Tag color={activeRow.recommendation === 'keep_old' ? 'red' : 'blue'}>
                            建议: {activeRow.recommendation === 'keep_new'
                              ? '用新版覆盖'
                              : activeRow.recommendation === 'keep_old'
                                ? '保留旧版'
                                : '两者都保留'}
                          </Tag>
                        )}
                        {activeRow.duplicateReason && (
                          <span className="jizi-skill-import__dup-reason">
                            {activeRow.duplicateReason}
                          </span>
                        )}
                      </div>
                    )}

                    {activeHasIdClash && (
                      <div className="jizi-skill-import__conflict">
                        <span>与本地已有 Skill 冲突:</span>
                        {(['skip', 'overwrite', 'rename'] as ConflictResolution[]).map((opt) => (
                          <Tooltip
                            key={opt}
                            title={
                              opt === 'overwrite'
                                ? isBuiltinSkill(
                                    skills.find(
                                      (s) =>
                                        s.id ===
                                        normalizeSkillId(activeRow.id),
                                    ),
                                  )
                                    ? '覆盖内置 skill，需二次确认'
                                    : '用新内容替换旧 skill 文件'
                                    : undefined
                            }
                          >
                            <Button
                              size="small"
                              type={
                                (opt === 'skip'
                                  ? !activeRow.selected
                                  : activeRow.selected && activeRow.conflict === opt)
                                  ? 'primary'
                                  : 'default'
                              }
                              onClick={() =>
                                updateRow(activeIndex, {
                                  conflict: opt,
                                  selected: opt !== 'skip',
                                })
                              }
                            >
                              {opt === 'skip'
                                ? '不导入'
                                : opt === 'overwrite'
                                  ? '覆盖'
                                  : '自动改名'}
                            </Button>
                          </Tooltip>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
