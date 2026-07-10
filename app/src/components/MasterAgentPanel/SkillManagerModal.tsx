import { useEffect, useMemo, useState } from 'react';
import { App, Button, Empty, Input, Modal, Segmented, Switch, Tag } from 'antd';
import { loadJiziSkills, saveJiziSkill, type JiziSkill } from '../../lib/jiziSkills';
import { useJiziSkillSettingsStore } from '../../stores/jiziSkillStore';
import { ImportSkillModal } from './ImportSkillModal';

interface SkillManagerModalProps {
  open: boolean;
  onClose: () => void;
}

const SKILL_DISPLAY: Record<string, { title: string; description: string }> = {
  'workflow-planner': {
    title: '工作流规划',
    description: '帮你把目标拆成画布流程，规划 Agent 节点、工具节点、门控节点和数据流。',
  },
  'agent-config-writer': {
    title: 'Agent 配置编写',
    description: '帮你编写 Agent 名称、职责说明、系统提示词、工具标签、输出格式和模型建议。',
  },
  'failure-diagnosis': {
    title: '失败诊断',
    description: '当节点、工具、模型、文件或 Python 服务出错时，帮你判断原因、影响和最省事的修法。',
  },
  'tool-generation-review': {
    title: '工具生成审阅',
    description: '当现有工具不够用时，帮你整理工具需求、依赖和安全边界，生成候选工具前先把关。',
  },
  'model-routing-advisor': {
    title: '模型选择建议',
    description: '根据长文本、图片、推理、速度、成本等需求，帮你判断该选哪类模型。',
  },
};

function displaySkill(skill: JiziSkill): { title: string; description: string } {
  return (
    skill.displayTitle && skill.displayDescription
      ? {
          title: skill.displayTitle,
          description: skill.displayDescription,
        }
      : SKILL_DISPLAY[skill.id] ?? {
          title: skill.title,
          description: skill.description,
        }
  );
}

const EMPTY_DRAFT = {
  id: '',
  displayTitle: '',
  displayDescription: '',
  modelName: '',
  modelDescription: '',
  capabilitiesText: '',
  instructions: '',
};

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '工作流', value: 'workflow' },
  { label: '工具', value: 'tool' },
  { label: '诊断', value: 'diagnosis' },
  { label: '模型', value: 'model' },
];

const CATEGORY_LABEL: Record<string, string> = {
  workflow: '工作流',
  tool: '工具',
  diagnosis: '诊断',
  model: '模型',
};

function normalizeSkillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function skillCapabilities(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function skillCategory(skill: JiziSkill): string {
  const display = displaySkill(skill);
  const text = [
    skill.id,
    skill.name,
    skill.title,
    skill.description,
    display.title,
    display.description,
    skill.capabilities.join(' '),
    skill.instructions.slice(0, 1000),
  ]
    .join(' ')
    .toLowerCase();
  if (/失败|错误|诊断|修复|报错|failure|diagnos|error|repair|fix/.test(text)) return 'diagnosis';
  if (/工具|安装|依赖|python|函数|代码|tool|install|dependency|library|package/.test(text)) return 'tool';
  if (/模型|视觉|图片|长上下文|音频|成本|速度|model|provider|vision|context|audio|cost/.test(text)) return 'model';
  return 'workflow';
}

export function SkillManagerModal({ open, onClose }: SkillManagerModalProps) {
  const { message } = App.useApp();
  const [skills, setSkills] = useState<JiziSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const disabledSkillIds = useJiziSkillSettingsStore((s) => s.disabledSkillIds);
  const setSkillEnabled = useJiziSkillSettingsStore((s) => s.setSkillEnabled);
  const disabled = new Set(disabledSkillIds);
  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const display = displaySkill(skill);
      const matchesQuery =
        !q ||
        skill.id.toLowerCase().includes(q) ||
        display.title.toLowerCase().includes(q) ||
        display.description.toLowerCase().includes(q) ||
        skill.capabilities.some((item) => item.toLowerCase().includes(q));
      const matchesCategory = category === 'all' || skillCategory(skill) === category;
      return matchesQuery && matchesCategory;
    });
  }, [category, query, skills]);

  const refreshSkills = async () => {
    setLoading(true);
    try {
      setSkills(await loadJiziSkills());
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
        if (alive) setSkills(items);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const onCreate = async () => {
    const payload = {
      id: normalizeSkillId(draft.id || draft.modelName),
      displayTitle: draft.displayTitle.trim(),
      displayDescription: draft.displayDescription.trim(),
      modelName: normalizeSkillId(draft.modelName || draft.id),
      modelDescription: draft.modelDescription.trim(),
      capabilities: skillCapabilities(draft.capabilitiesText),
      instructions: draft.instructions.trim(),
    };
    if (
      !payload.id ||
      !payload.displayTitle ||
      !payload.displayDescription ||
      !payload.modelName ||
      !payload.modelDescription ||
      payload.capabilities.length === 0 ||
      !payload.instructions
    ) {
      message.warning('请把中文展示、模型识别、具体能力和做事方法都补全');
      return;
    }

    setCreating(true);
    try {
      await saveJiziSkill(payload);
      message.success('skill 已创建');
      setCreateOpen(false);
      setDraft(EMPTY_DRAFT);
      await refreshSkills();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建 skill 失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title="姬子 Skill 能力商店"
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnHidden
    >
      <div className="jizi-skill-modal__toolbar">
        <div className="jizi-skill-modal__hint">
          这里控制姬子可以调用哪些 Skill。开启后，姬子会让模型自己判断何时需要它；关闭后，本轮自动选择会跳过它。
        </div>
        <div className="jizi-skill-modal__actions">
          <Button size="small" onClick={() => setImportOpen(true)}>
            导入 skill
          </Button>
          <Button size="small" type="primary" onClick={() => setCreateOpen(true)}>
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
        <div className="jizi-skill-list">
          {visibleSkills.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的 Skill" />
          ) : visibleSkills.map((skill) => {
            const enabled = !disabled.has(skill.id);
            const display = displaySkill(skill);
            return (
              <div className="jizi-skill-item" key={skill.id}>
                <div className="jizi-skill-item__head">
                  <div className="jizi-skill-item__main">
                    <div className="jizi-skill-item__title">
                      {display.title}
                      <Tag color={enabled ? 'blue' : 'default'} variant="filled">
                        {enabled ? '已启用' : '已停用'}
                      </Tag>
                      <Tag variant="filled">{CATEGORY_LABEL[skillCategory(skill)]}</Tag>
                    </div>
                    <div className="jizi-skill-item__desc">
                      {display.description}
                    </div>
                    {skill.capabilities.length > 0 && (
                      <div className="jizi-skill-item__caps">
                        {skill.capabilities.map((capability) => (
                          <span key={capability}>{capability}</span>
                        ))}
                      </div>
                    )}
                    {skill.path && (
                      <div className="jizi-skill-item__path">{skill.path}</div>
                    )}
                  </div>
                  <Switch
                    checked={enabled}
                    onChange={(checked) => setSkillEnabled(skill.id, checked)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Modal
        title="新建 skill"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreate}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        width={760}
        destroyOnHidden
      >
        <div className="jizi-skill-create">
          <div className="jizi-skill-create__section">
            <div className="jizi-skill-create__section-title">用户看到的内容</div>
            <label>
              中文名称
              <Input
                value={draft.displayTitle}
                placeholder="例如：接口测试助手"
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    displayTitle: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              中文简介
              <Input.TextArea
                value={draft.displayDescription}
                placeholder="用一句话告诉用户这个 skill 能帮什么忙"
                autoSize={{ minRows: 2, maxRows: 4 }}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    displayDescription: e.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="jizi-skill-create__section">
            <div className="jizi-skill-create__section-title">模型用来判断是否启用</div>
            <label>
              skill 标识
              <Input
                value={draft.id}
                placeholder="例如 api-test-helper"
                onChange={(e) =>
                  setDraft((current) => ({ ...current, id: e.target.value }))
                }
                onBlur={(e) =>
                  setDraft((current) => ({
                    ...current,
                    id: normalizeSkillId(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              英文识别名
              <Input
                value={draft.modelName}
                placeholder="例如 api-test-helper"
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    modelName: e.target.value,
                  }))
                }
                onBlur={(e) =>
                  setDraft((current) => ({
                    ...current,
                    modelName: normalizeSkillId(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              英文触发描述
              <Input.TextArea
                value={draft.modelDescription}
                placeholder="Use when the user needs to design, run, or debug API tests..."
                autoSize={{ minRows: 3, maxRows: 6 }}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    modelDescription: e.target.value,
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
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    instructions: e.target.value,
                  }))
                }
              />
            </label>
          </div>
        </div>
      </Modal>
      <ImportSkillModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        skills={skills}
        onImported={refreshSkills}
      />
    </Modal>
  );
}
