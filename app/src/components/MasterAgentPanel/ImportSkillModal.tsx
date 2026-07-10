import { useCallback, useMemo, useState } from 'react';
import { App, Button, Input, Modal, Segmented, Tag, Tooltip } from 'antd';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { LLMConfig } from '../../lib/llmClient';
import { getProvider } from '../../lib/providers';
import { useModelStore } from '../../stores/modelStore';
import { useUiStore } from '../../stores/uiStore';
import {
  isBuiltinSkill,
  overwriteJiziSkill,
  saveJiziSkill,
  type JiziSkill,
} from '../../lib/jiziSkills';
import {
  analyzeImportedSkill,
  analyzeImportedSkillPreserve,
  deepCompareSkill,
  type SkillCandidate,
} from '../../lib/jiziSkillImport';

type ImportMode = 'rewrite' | 'preserve';

interface ImportSkillModalProps {
  open: boolean;
  onClose: () => void;
  skills: JiziSkill[];
  onImported: () => void;
}

type ConflictResolution = 'skip' | 'overwrite' | 'rename';

interface CandidateRow extends SkillCandidate {
  id: string; // 用户可编辑的 skill id(初始 = modelName)
  conflict: ConflictResolution;
  isBuiltinConflict: boolean;
  preserveRaw: boolean;
}

function normalizeSkillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
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

  const resolveLlmCfg = useCallback((): {
    cfg: LLMConfig;
    modelId: string;
  } | null => {
    if (!masterModel) {
      message.warning('请先在右下角选择对话模型');
      return null;
    }
    const cfg = configs.find((c) => c.id === masterModel.configId);
    if (!cfg) {
      message.warning('所选模型已失效，请重新选择');
      return null;
    }
    if (!cfg.apiKey) {
      message.warning('所选模型未配置密钥，请到「模型配置」补全');
      return null;
    }
    const preset = getProvider(cfg.providerId);
    const llmCfg: LLMConfig = {
      api: preset?.api ?? 'openai',
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
    };
    return { cfg: llmCfg, modelId: masterModel.modelId };
  }, [masterModel, configs, message]);

  const reset = () => {
    setRows([]);
    setStage('idle');
    setAnalyzing(false);
  };

  const handleSelectFiles = async () => {
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
    try {
      const fileContents = await Promise.all(
        paths.map((p) => invoke<string>('read_text_file', { path: p })),
      );
      const existingSkills = skills.map((s) => ({
        id: s.id,
        displayDescription: s.displayDescription,
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
          });
          allCandidates.push(...candidates);
        } else {
          const { candidates } = await analyzeImportedSkill({
            fileContent: fileContents[i],
            fileName: paths[i],
            existingSkills,
            cfg: llm.cfg,
            model: llm.modelId,
          });
          allCandidates.push(...candidates);
        }
      }

      const existingIds = new Set(skills.map((s) => s.id));
      const byId = new Map<string, JiziSkill>();
      skills.forEach((s) => byId.set(s.id, s));

      const candidateRows: CandidateRow[] = allCandidates.map((c) => {
        const initialId = normalizeSkillId(c.modelName);
        const conflictId = c.possibleDuplicateOf;
        const isBuiltinConflict = conflictId
          ? isBuiltinSkill(byId.get(conflictId))
          : false;
        const hasIdClash = existingIds.has(initialId);
        let conflict: ConflictResolution = 'skip';
        if (hasIdClash) {
          conflict = 'skip';
        }
        return {
          ...c,
          id: initialId,
          conflict,
          isBuiltinConflict,
          preserveRaw: c.preserveRaw ?? false,
        };
      });

      setRows(candidateRows);
      setStage('confirm');

      for (let i = 0; i < candidateRows.length; i += 1) {
        const row = candidateRows[i];
        if (!row.possibleDuplicateOf) continue;
        const existing = byId.get(row.possibleDuplicateOf);
        if (!existing) continue;
        try {
          const result = await deepCompareSkill({
            candidate: row,
            existing: { id: existing.id, instructions: existing.instructions },
            cfg: llm.cfg,
            model: llm.modelId,
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
      }
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : '姬子分析失败，请重试',
      );
    } finally {
      setAnalyzing(false);
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
    const toSave: { row: CandidateRow; id: string; overwrite: boolean }[] = [];
    for (const row of rows) {
      const rawId = normalizeSkillId(row.id || row.modelName);
      if (!rawId) {
        message.warning(`存在英文名为空的候选，请补全`);
        return;
      }
      if (row.conflict === 'skip') continue;
      let finalId = rawId;
      let overwrite = false;
      if (row.conflict === 'overwrite') {
        if (!existingIds.has(rawId)) {
          message.warning(`「${row.displayTitle}」选了覆盖但原 skill 不存在，请改回跳过或改名`);
          return;
        }
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
          message.warning(`「${row.displayTitle}」改名尝试 100 次仍冲突，请手动改英文名`);
          return;
        }
      } else if (existingIds.has(rawId) || usedIds.has(rawId)) {
        message.warning(
          `「${row.displayTitle}」的英文名 ${rawId} 与已有 skill 冲突，请选择跳过/覆盖/改名`,
        );
        return;
      }
      usedIds.add(finalId);
      toSave.push({ row, id: finalId, overwrite });
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
    let success = 0;
    let failed = 0;
    for (const item of toSave) {
      const payload = {
        id: item.id,
        displayTitle: item.row.displayTitle.trim(),
        displayDescription: item.row.displayDescription.trim(),
        modelName: normalizeSkillId(item.row.modelName),
        modelDescription: item.row.modelDescription.trim(),
        capabilities: item.row.capabilities,
        instructions: item.row.instructions.trim(),
      };
      try {
        if (item.overwrite) {
          await overwriteJiziSkill(payload);
        } else {
          await saveJiziSkill(payload);
        }
        success += 1;
      } catch (err) {
        failed += 1;
        message.error(
          `导入「${item.row.displayTitle}」失败: ${err instanceof Error ? err.message : '未知错误'}`,
        );
      }
    }
    if (success > 0) {
      message.success(`成功导入 ${success} 个 skill${failed > 0 ? `，${failed} 个失败` : ''}`);
    }
    if (failed === 0) {
      reset();
      onImported();
    } else {
      setStage('confirm');
    }
  };

  const existingIds = useMemo(() => new Set(skills.map((s) => s.id)), [skills]);

  return (
    <Modal
      title="导入 Skill"
      open={open}
      onCancel={() => {
        if (saving || analyzing) return;
        reset();
        onClose();
      }}
      footer={
        stage === 'confirm' ? (
          <>
            <Button onClick={() => { reset(); onClose(); }} disabled={saving}>
              取消
            </Button>
            <Button type="primary" onClick={handleConfirmImport} loading={saving}>
              导入 {rows.filter((r) => r.conflict !== 'skip').length} 个
            </Button>
          </>
        ) : null
      }
      width={820}
      destroyOnHidden
      maskClosable={!analyzing && !saving}
    >
      {stage === 'idle' && (
        <div className="jizi-skill-import__intro">
          <div className="jizi-skill-import__mode">
            <span className="jizi-skill-import__mode-label">导入模式:</span>
            <Segmented
              size="small"
              value={mode}
              onChange={(v) => { setMode(v as ImportMode); reset(); }}
              options={[
                { label: '智能转写', value: 'rewrite' },
                { label: '原文照存', value: 'preserve' },
              ]}
            />
          </div>
          <p className="jizi-skill-import__hint">
            {mode === 'rewrite'
              ? '姬子会阅读全文、自动拆分多功能文件、检测与已有 skill 的重复，并生成中文展示名和描述供你确认。'
              : '需文件带规范 frontmatter(--- name/description/capabilities ---)。姬子只生成中文名和描述，其余字段原样保留，不支持拆分。'}
          </p>
          <Button type="primary" loading={analyzing} onClick={handleSelectFiles}>
            选择 .md 文件并分析
          </Button>
        </div>
      )}

      {(analyzing || stage === 'confirm') && (
        <div className="jizi-skill-import__list">
          {rows.length === 0 && analyzing && (
            <p>姬子正在阅读并分析文件，请稍候...</p>
          )}
          {rows.map((row, i) => {
            const hasIdClash = existingIds.has(normalizeSkillId(row.id || row.modelName));
            const isDuplicate = !!row.possibleDuplicateOf;
            return (
              <div
                key={i}
                className={`jizi-skill-import__row ${isDuplicate ? 'jizi-skill-import__row--duplicate' : ''}`}
              >
                <div className="jizi-skill-import__row-head">
                  <span className="jizi-skill-import__row-title">
                    {row.displayTitle}
                  </span>
                  {row.preserveRaw && <Tag color="purple">原文照存</Tag>}
                  <span className="jizi-skill-import__row-source">
                    来源: {row.sourceFile.split(/[\\/]/).pop() ?? row.sourceFile}
                  </span>
                </div>
                <div className="jizi-skill-import__fields">
                  <label>
                    中文展示名
                    <Input
                      value={row.displayTitle}
                      onChange={(e) => updateRow(i, { displayTitle: e.target.value })}
                    />
                  </label>
                  <label>
                    中文简介
                    <Input.TextArea
                      value={row.displayDescription}
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      onChange={(e) =>
                        updateRow(i, { displayDescription: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    英文标识 (id)
                    <Input
                      value={row.id}
                      onChange={(e) => updateRow(i, { id: e.target.value })}
                      onBlur={(e) =>
                        updateRow(i, { id: normalizeSkillId(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    英文触发描述
                    <Input.TextArea
                      value={row.modelDescription}
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      readOnly={row.preserveRaw}
                      onChange={(e) =>
                        updateRow(i, { modelDescription: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    具体能力 (一行一个)
                    <Input.TextArea
                      value={row.capabilities.join('\n')}
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      readOnly={row.preserveRaw}
                      onChange={(e) =>
                        updateRow(i, {
                          capabilities: e.target.value
                            .split(/\r?\n/)
                            .map((l) => l.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label>
                    做事方法 (instructions)
                    <Input.TextArea
                      value={row.instructions}
                      autoSize={{ minRows: 4, maxRows: 10 }}
                      readOnly={row.preserveRaw}
                      onChange={(e) => updateRow(i, { instructions: e.target.value })}
                    />
                  </label>
                </div>
                {isDuplicate && (
                  <div className="jizi-skill-import__dup">
                    <Tag color="orange">疑似与「{row.possibleDuplicateOf}」重复</Tag>
                    {row.recommendation && (
                      <Tag color={row.recommendation === 'keep_old' ? 'red' : 'blue'}>
                        建议: {row.recommendation === 'keep_new'
                          ? '用新版覆盖'
                          : row.recommendation === 'keep_old'
                            ? '保留旧版'
                            : '两者都保留'}
                      </Tag>
                    )}
                    {row.duplicateReason && (
                      <span className="jizi-skill-import__dup-reason">
                        {row.duplicateReason}
                      </span>
                    )}
                  </div>
                )}
                {hasIdClash && (
                  <div className="jizi-skill-import__conflict">
                    <span>英文名与已有 skill 冲突:</span>
                    {(['skip', 'overwrite', 'rename'] as ConflictResolution[]).map((opt) => (
                      <Tooltip
                        key={opt}
                        title={
                          opt === 'overwrite'
                            ? isBuiltinSkill(
                                skills.find((s) => s.id === normalizeSkillId(row.id)),
                              )
                                ? '覆盖内置 skill，需二次确认'
                                : '用新内容替换旧 skill 文件'
                                : undefined
                        }
                      >
                        <Button
                          size="small"
                          type={row.conflict === opt ? 'primary' : 'default'}
                          onClick={() => updateRow(i, { conflict: opt })}
                        >
                          {opt === 'skip'
                            ? '跳过'
                            : opt === 'overwrite'
                              ? '覆盖'
                              : '改名(-2)'}
                        </Button>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
