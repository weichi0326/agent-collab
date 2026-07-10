import { isTauri, invoke } from '@tauri-apps/api/core';
import { chat, type LLMConfig } from './llmClient';
import { enabledJiziSkillIds } from '../stores/jiziSkillStore';
import { cleanJsonFence } from './masterPlanner';

const SKILL_CONTEXT_CHAR_LIMIT = 18_000;

export interface JiziSkillFile {
  id: string;
  path: string;
  content: string;
}

export interface JiziSkill {
  id: string;
  name: string;
  title: string;
  description: string;
  displayTitle?: string;
  displayDescription?: string;
  capabilities: string[];
  instructions: string;
  path?: string;
}

export interface SelectedJiziSkill {
  skill: JiziSkill;
  reason: string;
}

export interface JiziSkillContext {
  block: string;
  selected: SelectedJiziSkill[];
}

const BUILTIN_SKILL_FILES: JiziSkillFile[] = [
  {
    id: 'workflow-planner',
    path: '',
    content: `---
name: workflow-planner
description: Plan canvas workflows for the multi-agent desktop app. Use when the user wants to design, explain, or improve a canvas made of Agent nodes, tool nodes, gate nodes, and data flow connections.
display_title: 工作流规划
display_description: 帮你把目标拆成画布流程，规划 Agent 节点、工具节点、门控节点和数据流。
capabilities: 拆解目标 | 规划画布节点 | 说明数据流
---

# Workflow Planner

Help users turn a goal into a small runnable canvas workflow. Restate the goal, identify inputs, propose Agent nodes, explain data flow, and call out manual configuration needs.`,
  },
  {
    id: 'agent-config-writer',
    path: '',
    content: `---
name: agent-config-writer
description: Write practical Agent configurations for the multi-agent app. Use when the user asks for Agent names, descriptions, system prompts, tool tags, output formats, or model choices.
display_title: Agent 配置编写
display_description: 帮你编写 Agent 名称、职责说明、系统提示词、工具标签、输出格式和模型建议。
capabilities: 编写 Agent 提示词 | 建议工具标签 | 设计输出格式
---

# Agent Config Writer

Create clear Agent names, descriptions, prompts, tool tags, output formats, and model capability notes that can be pasted into the app.`,
  },
  {
    id: 'failure-diagnosis',
    path: '',
    content: `---
name: failure-diagnosis
description: Diagnose failed canvas nodes in the multi-agent app. Use when a node, tool call, model call, file read/write, Python service, or workflow run fails and the user wants a practical explanation and next step.
display_title: 失败诊断
display_description: 当节点、工具、模型、文件或 Python 服务出错时，帮你判断原因、影响和最省事的修法。
capabilities: 判断失败原因 | 说明实际影响 | 给出低成本修复步骤
---

# Failure Diagnosis

Classify the likely cause, explain the consequence in plain language, give the cheapest check first, and separate user-fixable steps from developer fixes.`,
  },
  {
    id: 'tool-generation-review',
    path: '',
    content: `---
name: tool-generation-review
description: Generate and review custom Python tools for the multi-agent app. Use when built-in tools do not cover a task and the user wants a new tool, or when failure diagnosis suggests a missing tool/library.
display_title: 工具生成审阅
display_description: 当现有工具不够用时，帮你整理工具需求、依赖和安全边界，生成候选工具前先把关。
capabilities: 整理工具需求 | 检查依赖与安全边界 | 审阅候选工具
---

# Tool Generation Review

Define tool contract, dependencies, code safety boundaries, and review steps. Never install unreviewed generated code.`,
  },
  {
    id: 'model-routing-advisor',
    path: '',
    content: `---
name: model-routing-advisor
description: Advise model/provider choices for the multi-agent app. Use when the user asks which LLM to use for long documents, images, reasoning, low cost, speed, or fallback routing.
display_title: 模型选择建议
display_description: 根据长文本、图片、推理、速度、成本等需求，帮你判断该选哪类模型。
capabilities: 匹配任务和模型能力 | 判断成本速度取舍 | 设计备用模型路线
---

# Model Routing Advisor

Match tasks to capabilities such as long context, vision, reasoning, speed, and cost. Do not invent configured models or pricing.`,
  },
];

function titleFromName(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function frontmatterValue(frontmatter: string, key: string): string {
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(pattern);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
}

function frontmatterList(frontmatter: string, key: string): string[] {
  const raw = frontmatterValue(frontmatter, key);
  if (!raw) return [];
  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseJiziSkillFile(file: JiziSkillFile): JiziSkill | null {
  const text = file.content.trim();
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  const name = frontmatterValue(frontmatter, 'name') || file.id;
  const description = frontmatterValue(frontmatter, 'description');
  const displayTitle = frontmatterValue(frontmatter, 'display_title');
  const displayDescription = frontmatterValue(frontmatter, 'display_description');
  const capabilities = frontmatterList(frontmatter, 'capabilities');
  if (!name || !description || !body) return null;

  return {
    id: file.id || name,
    name,
    title: displayTitle || titleFromName(name),
    description,
    displayTitle: displayTitle || undefined,
    displayDescription: displayDescription || undefined,
    capabilities,
    instructions: body,
    path: file.path || undefined,
  };
}

async function readSkillFiles(): Promise<JiziSkillFile[]> {
  if (!isTauri()) return BUILTIN_SKILL_FILES;
  const files = await invoke<JiziSkillFile[]>('list_jizi_skill_files');
  return files.length > 0 ? files : BUILTIN_SKILL_FILES;
}

export async function loadJiziSkills(): Promise<JiziSkill[]> {
  try {
    return (await readSkillFiles())
      .map(parseJiziSkillFile)
      .filter((skill): skill is JiziSkill => !!skill);
  } catch (err) {
    console.warn('[jiziSkills] failed to load skill files, using built-ins', err);
    return BUILTIN_SKILL_FILES.map(parseJiziSkillFile).filter(
      (skill): skill is JiziSkill => !!skill,
    );
  }
}

export async function saveJiziSkill(input: {
  id: string;
  displayTitle: string;
  displayDescription: string;
  modelName: string;
  modelDescription: string;
  capabilities: string[];
  instructions: string;
}): Promise<void> {
  if (!isTauri()) {
    throw new Error('创建 skill 需要在桌面应用中使用');
  }
  await invoke('save_jizi_skill_file', input);
}

// 覆盖已有 skill:同名直接写入,替换旧内容。用于导入时用户选择"覆盖"。
export async function overwriteJiziSkill(input: {
  id: string;
  displayTitle: string;
  displayDescription: string;
  modelName: string;
  modelDescription: string;
  capabilities: string[];
  instructions: string;
}): Promise<void> {
  if (!isTauri()) {
    throw new Error('覆盖 skill 需要在桌面应用中使用');
  }
  await invoke('overwrite_jizi_skill_file', input);
}

// 判断是否为内置 skill(5 个):内置 skill 的 path 为空字符串。
export function isBuiltinSkill(skill: Pick<JiziSkill, 'path'> | undefined): boolean {
  return !skill?.path;
}

function buildSelectionPrompt(userText: string, skills: JiziSkill[]): string {
  const catalog = skills
    .map(
      (skill) =>
        [
          `- id: ${skill.id}`,
          `  name: ${skill.name}`,
          `  description: ${skill.description}`,
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
  const normalized = text.trim();
  if (!normalized) return [];

  const skills = await loadJiziSkills();
  const enabledIds = new Set(enabledJiziSkillIds(skills.map((skill) => skill.id)));
  const enabledSkills = skills.filter((skill) => enabledIds.has(skill.id));
  if (enabledSkills.length === 0) return [];

  const reply = await chat({
    cfg,
    model,
    system: '你只负责选择 skill，只输出 JSON。',
    text: buildSelectionPrompt(normalized, enabledSkills),
    signal,
    scene: 'skill-select',
  });

  try {
    return parseSkillSelectionReply(reply, enabledSkills, limit);
  } catch (err) {
    console.warn('[jiziSkills] failed to parse skill selection', err);
    return [];
  }
}

export async function buildJiziSkillContext(
  text: string,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
): Promise<JiziSkillContext> {
  const selected = await selectJiziSkills(text, cfg, model, signal);
  if (selected.length === 0) return { block: '', selected: [] };

  const header = [
    '【姬子本轮自动选用的 skill】',
    '下面是本轮任务需要参考的做事方法。只在相关时使用，不要向用户生硬复述 skill 名称。',
  ];
  const blocks: string[] = [];
  const included: SelectedJiziSkill[] = [];
  let total = header.join('\n\n').length;

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
    if (blocks.length > 0 && total + block.length > SKILL_CONTEXT_CHAR_LIMIT) break;
    blocks.push(block);
    included.push(item);
    total += block.length;
  }

  const block = [...header, ...blocks].join('\n\n');
  return { block, selected: included };
}

export async function buildJiziSkillSystemBlock(
  text: string,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  return (await buildJiziSkillContext(text, cfg, model, signal)).block;
}
