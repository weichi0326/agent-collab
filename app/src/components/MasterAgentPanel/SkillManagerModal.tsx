import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Empty, Input, Modal, Segmented, Select, Switch, Tag, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, ImportOutlined, PlusOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import type { LLMConfig } from '../../lib/llmClient';
import { getProvider } from '../../lib/providers';
import {
  isBuiltinSkill,
  hasSkillOverride,
  deleteJiziSkill,
  loadJiziSkills,
  overwriteJiziSkill,
  saveJiziSkill,
  type JiziSkill,
} from '../../lib/jiziSkills';
import { rewriteExistingSkill } from '../../lib/jiziSkillImport';
import { useModelStore } from '../../stores/modelStore';
import { useUiStore } from '../../stores/uiStore';
import { useJiziSkillSettingsStore } from '../../stores/jiziSkillStore';
import { useJiziSkillUsageStore } from '../../stores/jiziSkillUsageStore';
import { ImportSkillModal } from './ImportSkillModal';
import {
  generatedSkillId,
  normalizeSkillId,
  SKILL_DESCRIPTION_CHAR_LIMIT,
  SKILL_INSTRUCTION_CHAR_LIMIT,
  SKILL_TITLE_CHAR_LIMIT,
  type JiziSkillCategory,
  sliceUnicode,
} from '../../lib/jiziSkillFormat';

interface SkillManagerModalProps {
  open: boolean;
  onClose: () => void;
}

const EMPTY_DRAFT = {
  id: '',
  title: '',
  description: '',
  category: 'workflow' as JiziSkillCategory,
  capabilitiesText: '',
  instructions: '',
};

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '工作流', value: 'workflow' },
  { label: '工具', value: 'tool' },
  { label: '诊断', value: 'diagnosis' },
  { label: '模型', value: 'model' },
  { label: 'Skill 编写', value: 'skill' },
];

const CATEGORY_LABEL: Record<string, string> = {
  workflow: '工作流',
  tool: '工具',
  diagnosis: '诊断',
  model: '模型',
  skill: 'Skill 编写',
};

function skillCapabilities(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function skillCategory(skill: JiziSkill): string {
  return skill.category;
}

export function SkillManagerModal({ open, onClose }: SkillManagerModalProps) {
  const { message, modal } = App.useApp();
  const masterModel = useUiStore((s) => s.masterModel);
  const configs = useModelStore((s) => s.configs);
  const [skills, setSkills] = useState<JiziSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rewritingLegacy, setRewritingLegacy] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const disabledSkillIds = useJiziSkillSettingsStore((s) => s.disabledSkillIds);
  const setSkillEnabled = useJiziSkillSettingsStore((s) => s.setSkillEnabled);
  const usage = useJiziSkillUsageStore((s) => s.usage);
  const removeUsage = useJiziSkillUsageStore((s) => s.remove);
  const disabled = new Set(disabledSkillIds);
  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const matchesQuery =
        !q ||
        skill.id.toLowerCase().includes(q) ||
        skill.title.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.capabilities.some((item) => item.toLowerCase().includes(q));
      const matchesCategory = category === 'all' || skillCategory(skill) === category;
      return matchesQuery && matchesCategory;
    });
  }, [category, query, skills]);
  const legacySkills = useMemo(
    () => skills.filter((skill) => skill.legacyFormat && !isBuiltinSkill(skill)),
    [skills],
  );
  const activeSkill = visibleSkills.find((skill) => skill.id === activeId) ?? visibleSkills[0];

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
    return {
      cfg: {
        api: preset?.api ?? 'openai',
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
      },
      modelId: masterModel.modelId,
    };
  }, [configs, masterModel, message]);

  const refreshSkills = async () => {
    setLoading(true);
    try {
      const next = await loadJiziSkills();
      setSkills(next);
      setActiveId((current) => current && next.some((skill) => skill.id === current) ? current : next[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void loadJiziSkills()
      .then((items) => {
        if (alive) {
          setSkills(items);
          setActiveId((current) => current && items.some((skill) => skill.id === current) ? current : items[0]?.id ?? null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const onSaveDraft = async () => {
    const payload = {
      id: normalizeSkillId(draft.id) || generatedSkillId(`${draft.title}|${draft.description}`),
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      capabilities: skillCapabilities(draft.capabilitiesText),
      instructions: draft.instructions.trim(),
    };
    if (
      !payload.id ||
      !payload.title ||
      !payload.description ||
      payload.capabilities.length === 0 ||
      !payload.instructions
    ) {
      message.warning('请把名称、描述、具体能力和做事方法都补全');
      return;
    }

    setCreating(true);
    try {
      if (editingId) {
        await overwriteJiziSkill({ ...payload, id: editingId });
        message.success('Skill 已更新');
      } else {
        await saveJiziSkill(payload);
        message.success('Skill 已创建');
      }
      setCreateOpen(false);
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
      await refreshSkills();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建 skill 失败');
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setCreateOpen(true);
  };

  const openEdit = (skill: JiziSkill) => {
    setEditingId(skill.id);
    setDraft({
      id: skill.id,
      title: skill.title,
      description: skill.description,
      category: skill.category,
      capabilitiesText: skill.capabilities.join('\n'),
      instructions: skill.instructions,
    });
    setCreateOpen(true);
  };

  const removeOrRestore = (skill: JiziSkill) => {
    const builtin = isBuiltinSkill(skill);
    const restore = builtin && hasSkillOverride(skill);
    modal.confirm({
      title: restore ? '恢复内置 Skill' : '删除 Skill',
      content: restore
        ? `将删除「${skill.title}」的用户覆盖版本，并恢复应用内置内容。`
        : `确定永久删除「${skill.title}」吗？`,
      okText: restore ? '恢复内置版本' : '删除',
      okType: restore ? 'primary' : 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteJiziSkill(skill.id);
        setSkillEnabled(skill.id, true);
        if (!restore) removeUsage(skill.id);
        message.success(restore ? '已恢复内置版本' : 'Skill 已删除');
        await refreshSkills();
      },
    });
  };

  const onRewriteLegacy = async () => {
    if (legacySkills.length === 0) {
      message.info('没有需要复写的旧格式 Skill');
      return;
    }
    const llm = resolveLlmCfg();
    if (!llm) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: '复写旧格式 Skill',
        content: `将用当前模型把 ${legacySkills.length} 个旧格式 Skill 整理成新的中文格式，并覆盖原文件。旧的 name/display_title/display_description 字段会被移除。`,
        okText: '开始复写',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;

    setRewritingLegacy(true);
    let success = 0;
    let failed = 0;
    try {
      for (const skill of legacySkills) {
        try {
          const rewritten = await rewriteExistingSkill({
            skill,
            cfg: llm.cfg,
            model: llm.modelId,
          });
          await overwriteJiziSkill({
            id: skill.id,
            title: rewritten.displayTitle,
            description: rewritten.displayDescription,
            category: rewritten.category,
            capabilities: rewritten.capabilities,
            instructions: rewritten.instructions,
          });
          success += 1;
        } catch (err) {
          failed += 1;
          message.error(
            `复写「${skill.title}」失败: ${err instanceof Error ? err.message : '未知错误'}`,
          );
        }
      }
      if (success > 0) {
        message.success(`已复写 ${success} 个旧格式 Skill${failed > 0 ? `，${failed} 个失败` : ''}`);
        await refreshSkills();
      }
      if (success === 0 && failed > 0) {
        message.error('旧格式 Skill 复写失败，请检查模型配置后重试');
      }
    } finally {
      setRewritingLegacy(false);
    }
  };

  return (
    <>
      <Modal
        title="姬子 Skill 管理"
        open={open && !importOpen}
        onCancel={onClose}
        footer={null}
        width={900}
        className="jizi-skill-manager-modal"
        destroyOnHidden
      >
      <div className="jizi-skill-modal__toolbar">
        <div className="jizi-skill-modal__hint">
          {skills.length - disabledSkillIds.filter((id) => skills.some((skill) => skill.id === id)).length} 个启用 / {skills.length} 个总计
        </div>
        <div className="jizi-skill-modal__actions">
          <Tooltip
            title={
              legacySkills.length > 0
                ? `发现 ${legacySkills.length} 个旧格式 Skill，可复写为新的中文格式`
                : '没有需要复写的旧格式 Skill'
            }
          >
            <Button
              icon={<SyncOutlined />}
              loading={rewritingLegacy}
              disabled={legacySkills.length === 0 || rewritingLegacy}
              onClick={onRewriteLegacy}
            >
              复写旧 Skill
            </Button>
          </Tooltip>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
            导入 skill
          </Button>
          <Button icon={<PlusOutlined />} onClick={openCreate}>
            新建 skill
          </Button>
        </div>
      </div>
      <div className="jizi-skill-store-tools">
        <Input.Search
          allowClear
          placeholder="搜索 Skill 名称、说明或能力"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Segmented
          size="small"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(value) => setCategory(String(value))}
        />
      </div>
      {skills.length === 0 && !loading ? (
        <Empty description="没有读取到 skill" />
      ) : (
        <div className="jizi-skill-library">
          <div className="jizi-skill-list">
          {visibleSkills.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的 Skill" />
          ) : visibleSkills.map((skill) => {
            const enabled = !disabled.has(skill.id);
            return (
              <div
                className={`jizi-skill-item ${activeSkill?.id === skill.id ? 'jizi-skill-item--active' : ''}`}
                key={skill.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveId(skill.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveId(skill.id);
                  }
                }}
              >
                <div className="jizi-skill-item__head">
                  <div className="jizi-skill-item__main">
                    <div className="jizi-skill-item__title">
                      {skill.title}
                      <Tag color={enabled ? 'blue' : 'default'} variant="filled">
                        {enabled ? '已启用' : '已停用'}
                      </Tag>
                      <Tag variant="filled">{CATEGORY_LABEL[skillCategory(skill)]}</Tag>
                      {skill.legacyFormat && <Tag color="orange">旧格式</Tag>}
                    </div>
                    <div className="jizi-skill-item__desc">
                      {skill.description}
                    </div>
                    {skill.capabilities.length > 0 && (
                      <div className="jizi-skill-item__caps">
                        {skill.capabilities.map((capability) => (
                          <span key={capability}>{capability}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Switch
                    checked={enabled}
                    onClick={(_checked, event) => event.stopPropagation()}
                    onChange={(checked) => setSkillEnabled(skill.id, checked)}
                  />
                </div>
              </div>
            );
          })}
          </div>
          <section className="jizi-skill-detail">
            {activeSkill ? (
              <>
                <div className="jizi-skill-detail__head">
                  <div>
                    <h3>{activeSkill.title}</h3>
                    <span>{activeSkill.id}</span>
                  </div>
                  <div className="jizi-skill-detail__actions">
                    <Tooltip title="编辑 Skill">
                      <Button icon={<EditOutlined />} onClick={() => openEdit(activeSkill)} />
                    </Tooltip>
                    {(!isBuiltinSkill(activeSkill) || hasSkillOverride(activeSkill)) && (
                      <Tooltip title={isBuiltinSkill(activeSkill) ? '恢复内置版本' : '删除 Skill'}>
                        <Button
                          danger={!isBuiltinSkill(activeSkill)}
                          icon={isBuiltinSkill(activeSkill) ? <ReloadOutlined /> : <DeleteOutlined />}
                          onClick={() => removeOrRestore(activeSkill)}
                        />
                      </Tooltip>
                    )}
                  </div>
                </div>
                <div className="jizi-skill-detail__meta">
                  <Tag>{CATEGORY_LABEL[activeSkill.category]}</Tag>
                  <Tag>{isBuiltinSkill(activeSkill) ? '内置' : '用户创建'}</Tag>
                  {hasSkillOverride(activeSkill) && <Tag color="orange">用户覆盖</Tag>}
                </div>
                <div className="jizi-skill-detail__usage">
                  <span>调用 {usage[activeSkill.id]?.count ?? 0} 次</span>
                  <span>
                    最近调用：{usage[activeSkill.id]?.lastUsedAt
                      ? new Date(usage[activeSkill.id]!.lastUsedAt).toLocaleString('zh-CN')
                      : '暂无'}
                  </span>
                  {usage[activeSkill.id]?.lastReason && (
                    <span>最近原因：{usage[activeSkill.id]!.lastReason}</span>
                  )}
                </div>
                <p className="jizi-skill-detail__description">{activeSkill.description}</p>
                <div className="jizi-skill-detail__section">
                  <h4>具体能力</h4>
                  <ul>{activeSkill.capabilities.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className="jizi-skill-detail__section">
                  <h4>做事方法</h4>
                  <pre>{activeSkill.instructions}</pre>
                </div>
                {activeSkill.path && <div className="jizi-skill-item__path">{activeSkill.path}</div>}
              </>
            ) : <Empty description="选择一个 Skill 查看详情" />}
          </section>
        </div>
      )}
      <Modal
        title={editingId ? '编辑 Skill' : '新建 Skill'}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onSaveDraft}
        confirmLoading={creating}
        okText={editingId ? '保存' : '创建'}
        cancelText="取消"
        width={760}
        destroyOnHidden
      >
        <div className="jizi-skill-create">
          <div className="jizi-skill-create__section">
            <div className="jizi-skill-create__section-title">Skill 信息</div>
            <label>
              名称
              <Input
                value={draft.title}
                maxLength={SKILL_TITLE_CHAR_LIMIT}
                showCount
                placeholder="例如：接口测试助手"
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    title: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              分类
              <Select
                value={draft.category}
                options={CATEGORY_OPTIONS.filter((item) => item.value !== 'all')}
                onChange={(value) => setDraft((current) => ({ ...current, category: value as JiziSkillCategory }))}
              />
            </label>
            <label>
              描述
              <Input.TextArea
                value={draft.description}
                placeholder="用一句话告诉用户这个 skill 能帮什么忙"
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={SKILL_DESCRIPTION_CHAR_LIMIT}
                showCount
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    description: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              索引
              <Input
                value={draft.id}
                disabled={!!editingId}
                placeholder="可留空自动生成，例如 jz-a1b2c3d4"
                onChange={(e) =>
                  setDraft((current) => ({ ...current, id: e.target.value }))
                }
                onBlur={(e) =>
                  setDraft((current) => ({
                    ...current,
                    id:
                      normalizeSkillId(e.target.value) ||
                      generatedSkillId(`${current.title}|${current.description}`),
                  }))
                }
              />
            </label>
          </div>

          <div className="jizi-skill-create__section">
            <div className="jizi-skill-create__section-title">真正会注入给姬子的做法</div>
            <label>
              具体能力
              <Input.TextArea
                value={draft.capabilitiesText}
                placeholder={'一行一个能力，例如：\n设计接口测试步骤\n判断是否需要 requests / httpx\n解释状态码和返回体'}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    capabilitiesText: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              做事方法、边界和输出要求
              <Input.TextArea
                value={draft.instructions}
                placeholder="写清楚这个 skill 被启用后，姬子应该怎么做、不能怎么做、结果应该怎么给用户。"
                autoSize={{ minRows: 6, maxRows: 12 }}
                maxLength={SKILL_INSTRUCTION_CHAR_LIMIT}
                showCount
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    instructions: sliceUnicode(
                      e.target.value,
                      SKILL_INSTRUCTION_CHAR_LIMIT,
                    ),
                  }))
                }
              />
            </label>
          </div>
        </div>
      </Modal>
      </Modal>
      <ImportSkillModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        skills={skills}
        onImported={refreshSkills}
      />
    </>
  );
}
