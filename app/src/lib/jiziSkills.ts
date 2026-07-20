import { isTauri, invoke } from '@tauri-apps/api/core';
import { chat, type LLMConfig } from './llmClient';
import { asObject } from './jsonGuards';
import { enabledJiziSkillIds } from '../stores/jiziSkillStore';
import { useJiziSkillUsageStore } from '../stores/jiziSkillUsageStore';
import { cleanJsonFence } from './masterPlanner';
import workflowPlannerContent from '../../../jizi-agent-architecture/skills/workflow-planner/SKILL.md?raw';
import agentConfigWriterContent from '../../../jizi-agent-architecture/skills/agent-config-writer/SKILL.md?raw';
import failureDiagnosisContent from '../../../jizi-agent-architecture/skills/failure-diagnosis/SKILL.md?raw';
import toolGenerationReviewContent from '../../../jizi-agent-architecture/skills/tool-generation-review/SKILL.md?raw';
import modelRoutingAdvisorContent from '../../../jizi-agent-architecture/skills/model-routing-advisor/SKILL.md?raw';
import skillCreatorContent from '../../../jizi-agent-architecture/skills/skill-creator/SKILL.md?raw';
import {
  assertSkillTextLimits,
  type JiziSkillCategory,
  parseSkillDocument,
  sliceUnicode,
  skillFrontmatterList,
  skillFrontmatterValue,
  unicodeLength,
} from './jiziSkillFormat';

const SKILL_CONTEXT_CHAR_LIMIT = 18_000;

export interface JiziSkillFile {
  id: string;
  path: string;
  content: string;
}

export interface JiziSkill {
  id: string;
  title: string;
  description: string;
  category: JiziSkillCategory;
  capabilities: string[];
  instructions: string;
  path?: string;
  legacyFormat?: boolean;
  rawContent?: string;
}

export interface SelectedJiziSkill {
  skill: JiziSkill;
  reason: string;
}

export interface JiziSkillContext {
  block: string;
  selected: SelectedJiziSkill[];
  selectionWarning?: string;
}

export function fitJiziSkillContext(
  selected: SelectedJiziSkill[],
  limit = SKILL_CONTEXT_CHAR_LIMIT,
): Pick<JiziSkillContext, 'block' | 'selected'> {
  const header = [
    '【姬子本轮自动选用的 skill】',
    '下面是本轮任务需要参考的做事方法。只在相关时使用，不要向用户生硬复述 skill 名称。',
  ];
  const blocks: string[] = [];
  const included: SelectedJiziSkill[] = [];
  let total = unicodeLength(header.join('\n\n'));

  for (const item of selected) {
    const { skill, reason } = item;
    const block = [
      `## ${skill.title} (${skill.id})`,
      reason ? `选择原因：${reason}` : '',
      skill.capabilities.length > 0
        ? `具体能力：\n${skill.capabilities.map((capability) => `- ${capability}`).join('\n')}`
        : '',
      skill.instructions,
    ]
      .filter(Boolean)
      .join('\n');
    const remaining = limit - total;
    if (remaining <= 0) break;
    const fittedBlock = unicodeLength(block) > remaining
      ? `${sliceUnicode(block, Math.max(0, remaining - 12))}\n...(已截断)`
      : block;
    if (!fittedBlock.trim()) break;
    blocks.push(fittedBlock);
    included.push(item);
    total += unicodeLength(fittedBlock);
  }
  return { block: [...header, ...blocks].join('\n\n'), selected: included };
}

interface SkillSelectionResult {
  selected: SelectedJiziSkill[];
  warning?: string;
}

const selectionCache = new Map<string, { expiresAt: number; selectedIds: string[] }>();
const SKILL_SELECTION_CACHE_MS = 30_000;

const BUILTIN_SKILL_FILES: JiziSkillFile[] = [
  {
    id: 'workflow-planner',
    path: '',
    content: workflowPlannerContent,
  },
  {
    id: 'agent-config-writer',
    path: '',
    content: agentConfigWriterContent,
  },
  {
    id: 'failure-diagnosis',
    path: '',
    content: failureDiagnosisContent,
  },
  {
    id: 'tool-generation-review',
    path: '',
    content: toolGenerationReviewContent,
  },
  {
    id: 'model-routing-advisor',
    path: '',
    content: modelRoutingAdvisorContent,
  },
  {
    id: 'skill-creator',
    path: '',
    content: skillCreatorContent,
  },
];

export const BUILTIN_JIZI_SKILL_IDS = BUILTIN_SKILL_FILES.map((file) => file.id);
const BUILTIN_JIZI_SKILL_ID_SET = new Set(BUILTIN_JIZI_SKILL_IDS);

function titleFromName(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

export function parseJiziSkillFile(file: JiziSkillFile): JiziSkill | null {
  const parsed = parseSkillDocument(file.content);
  if (!parsed) return null;

  const { frontmatter, body } = parsed;
  const index =
    skillFrontmatterValue(frontmatter, 'index') ||
    skillFrontmatterValue(frontmatter, 'name') ||
    file.id;
  const newTitle = skillFrontmatterValue(frontmatter, 'title');
  const newDescription = skillFrontmatterValue(frontmatter, 'description');
  const displayTitle = skillFrontmatterValue(frontmatter, 'display_title');
  const displayDescription = skillFrontmatterValue(frontmatter, 'display_description');
  const legacyFormat =
    !!skillFrontmatterValue(frontmatter, 'name') ||
    !!displayTitle ||
    !!displayDescription ||
    !skillFrontmatterValue(frontmatter, 'index') ||
    !newTitle;
  const title = newTitle || displayTitle || titleFromName(index);
  const description = displayDescription || newDescription;
  const categoryValue = skillFrontmatterValue(frontmatter, 'category');
  const category: JiziSkillCategory =
    categoryValue === 'tool' ||
    categoryValue === 'diagnosis' ||
    categoryValue === 'model' ||
    categoryValue === 'skill'
      ? categoryValue
      : 'workflow';
  const capabilities = skillFrontmatterList(frontmatter, 'capabilities');
  if (!index || !title || !description || !body) return null;

  return {
    id: file.id || index,
    title,
    description,
    category,
    capabilities,
    instructions: body,
    path: file.path || undefined,
    legacyFormat,
    rawContent: file.content,
  };
}

async function readSkillFiles(): Promise<JiziSkillFile[]> {
  if (!isTauri()) return [];
  return invoke<JiziSkillFile[]>('list_jizi_skill_files');
}

export function mergeJiziSkillFiles(files: JiziSkillFile[]): JiziSkill[] {
  const merged = new Map<string, JiziSkill>();
  for (const file of BUILTIN_SKILL_FILES) {
    const skill = parseJiziSkillFile(file);
    if (skill) merged.set(skill.id, skill);
  }
  for (const file of files) {
    const skill = parseJiziSkillFile(file);
    if (skill) merged.set(skill.id, skill);
  }
  return [...merged.values()];
}

export async function loadJiziSkills(): Promise<JiziSkill[]> {
  try {
    return mergeJiziSkillFiles(await readSkillFiles());
  } catch (err) {
    console.warn('[jiziSkills] failed to load skill files, using built-ins', err);
    return mergeJiziSkillFiles([]);
  }
}

export async function loadJiziSkillById(id: string): Promise<JiziSkill | undefined> {
  const skills = await loadJiziSkills();
  return skills.find((skill) => skill.id === id);
}

export async function saveJiziSkill(input: {
  id: string;
  title: string;
  description: string;
  category: JiziSkillCategory;
  capabilities: string[];
  instructions: string;
}): Promise<void> {
  assertSkillTextLimits(input);
  if (!isTauri()) {
    throw new Error('创建 skill 需要在桌面应用中使用');
  }
  await invoke('save_jizi_skill_file', input);
}

// 覆盖已有 skill:同名直接写入,替换旧内容。用于导入时用户选择"覆盖"。
export async function overwriteJiziSkill(input: {
  id: string;
  title: string;
  description: string;
  category: JiziSkillCategory;
  capabilities: string[];
  instructions: string;
}): Promise<void> {
  assertSkillTextLimits(input);
  if (!isTauri()) {
    throw new Error('覆盖 skill 需要在桌面应用中使用');
  }
  await invoke('overwrite_jizi_skill_file', input);
}

export interface JiziSkillWriteInput {
  id: string;
  title: string;
  description: string;
  category: JiziSkillCategory;
  capabilities: string[];
  instructions: string;
  overwrite: boolean;
}

export async function writeJiziSkills(items: JiziSkillWriteInput[]): Promise<void> {
  for (const item of items) assertSkillTextLimits(item);
  if (!isTauri()) throw new Error('写入 skill 需要在桌面应用中使用');
  await invoke('write_jizi_skill_files', { items });
}

export async function deleteJiziSkill(id: string): Promise<void> {
  if (!isTauri()) throw new Error('删除 skill 需要在桌面应用中使用');
  await invoke('delete_jizi_skill_file', { id });
}

export function hasSkillOverride(skill: JiziSkill): boolean {
  return !!skill.path;
}

// 内置身份由稳定 ID 决定；同 ID 的磁盘文件只是覆盖内容，不会改变其内置身份。
export function isBuiltinSkill(
  skill: Pick<JiziSkill, 'id'> | string | undefined,
): boolean {
  const id = typeof skill === 'string' ? skill : skill?.id;
  return !!id && BUILTIN_JIZI_SKILL_ID_SET.has(id);
}

function buildSelectionPrompt(userText: string, skills: JiziSkill[]): string {
  const catalog = skills
    .map(
      (skill) =>
        [
          `- id: ${skill.id}`,
          `  名称: ${skill.title}`,
          `  描述: ${skill.description}`,
          skill.capabilities.length > 0
            ? `  capabilities: ${skill.capabilities.join(' | ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
    )
    .join('\n');
  return [
    '你在为“姬子”选择本轮回答需要加载的 skill。',
    '请根据用户真实意图和 skill 描述判断，不要做关键词机械匹配。',
    '请选择所有真正相关的 skill；如果普通回答不需要专门技能，可以选择 0 个。不要为了凑数选择无关 skill。',
    '只返回 JSON，不要 Markdown，不要解释。',
    '返回格式：{"selected":[{"id":"skill-id","reason":"一句很短的选择原因"}]}',
    '',
    '【可用 skill】',
    catalog || '(无)',
    '',
    '【用户请求】',
    userText,
  ].join('\n');
}

export function parseSkillSelectionReply(
  reply: string,
  skills: JiziSkill[],
  limit?: number,
): SelectedJiziSkill[] {
  const root = asObject(JSON.parse(cleanJsonFence(reply)));
  const rawSelected = Array.isArray(root?.selected) ? root.selected : [];
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const seen = new Set<string>();
  const selected: SelectedJiziSkill[] = [];

  for (const item of rawSelected) {
    const obj = asObject(item);
    const id = String(obj?.id ?? '').trim();
    const skill = byId.get(id);
    if (!skill || seen.has(id)) continue;
    seen.add(id);
    selected.push({
      skill,
      reason: String(obj?.reason ?? '').trim(),
    });
    if (typeof limit === 'number' && selected.length >= limit) break;
  }

  return selected;
}

export async function selectJiziSkills(
  text: string,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
  limit?: number,
): Promise<SelectedJiziSkill[]> {
  return (await selectJiziSkillsDetailed(text, cfg, model, signal, limit)).selected;
}

async function selectJiziSkillsDetailed(
  text: string,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
  limit?: number,
): Promise<SkillSelectionResult> {
  const normalized = text.trim();
  if (!normalized) return { selected: [] };

  const skills = await loadJiziSkills();
  const enabledIds = new Set(enabledJiziSkillIds(skills.map((skill) => skill.id)));
  const enabledSkills = skills.filter((skill) => enabledIds.has(skill.id));
  if (enabledSkills.length === 0) return { selected: [] };

  const cacheKey = `${model}\n${enabledSkills.map((skill) => skill.id).join(',')}\n${normalized}`;
  const cached = selectionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const byId = new Map(enabledSkills.map((skill) => [skill.id, skill]));
    return {
      selected: cached.selectedIds
        .map((id) => byId.get(id))
        .filter((skill): skill is JiziSkill => !!skill)
        .map((skill) => ({ skill, reason: '复用近期相同请求的选择结果' })),
    };
  }

  try {
    const reply = await chat({
      cfg,
      model,
      system: '你只负责选择 skill，只输出 JSON。',
      text: buildSelectionPrompt(normalized, enabledSkills),
      signal,
      scene: 'skill-select',
    });
    const selected = parseSkillSelectionReply(reply, enabledSkills, limit);
    selectionCache.set(cacheKey, {
      expiresAt: Date.now() + SKILL_SELECTION_CACHE_MS,
      selectedIds: selected.map((item) => item.skill.id),
    });
    return { selected };
  } catch (err) {
    const warning = err instanceof Error ? err.message : '未知错误';
    console.warn('[jiziSkills] skill selection failed', err);
    return { selected: [], warning: `Skill 选择失败：${warning}` };
  }
}

export async function buildJiziSkillContext(
  text: string,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
  options?: { requiredIds?: string[]; autoSelect?: boolean },
): Promise<JiziSkillContext> {
  const skills = await loadJiziSkills();
  const enabledIds = new Set(enabledJiziSkillIds(skills.map((skill) => skill.id)));
  const required = (options?.requiredIds ?? [])
    .map((id) => skills.find((skill) => skill.id === id))
    .filter((skill): skill is JiziSkill => !!skill && enabledIds.has(skill.id))
    .map((skill) => ({ skill, reason: '当前功能固定需要' }));
  const selection = options?.autoSelect === false
    ? { selected: [] as SelectedJiziSkill[] }
    : await selectJiziSkillsDetailed(text, cfg, model, signal);
  const automatic = selection.selected;
  const selected = [...required, ...automatic].filter(
    (item, index, items) => items.findIndex((other) => other.skill.id === item.skill.id) === index,
  );
  if (selected.length === 0) {
    return { block: '', selected: [], selectionWarning: selection.warning };
  }

  const fitted = fitJiziSkillContext(selected);
  for (const item of fitted.selected) {
    useJiziSkillUsageStore.getState().record(item.skill.id, item.reason);
  }
  return { ...fitted, selectionWarning: selection.warning };
}

export async function buildJiziSkillSystemBlock(
  text: string,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
  options?: { requiredIds?: string[]; autoSelect?: boolean },
): Promise<string> {
  return (await buildJiziSkillContext(text, cfg, model, signal, options)).block;
}
