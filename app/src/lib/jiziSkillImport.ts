import { chat, type LLMConfig } from './llmClient';
import { cleanJsonFence } from './masterPlanner';

// 导入分析阶段限长:对齐 Rust save_jizi_skill_file 的 24000 字符上限,超长截断后再喂姬子。
const MAX_IMPORT_CHARS = 24_000;

export interface SkillCandidate {
  sourceFile: string;
  displayTitle: string;
  displayDescription: string;
  modelName: string;
  modelDescription: string;
  capabilities: string[];
  instructions: string;
  possibleDuplicateOf?: string; // 阶段1 填:疑似重复的已有 skill id
  recommendation?: 'keep_new' | 'keep_old' | 'keep_both'; // 阶段2 填
  duplicateReason?: string;
  preserveRaw?: boolean; // 原文照存模式:instructions/capabilities/modelName/modelDescription 锁定只读
}

// 阶段1:分析导入文件,产出候选(含拆分) + 粗筛重复标记。
// existingSkills 只含 id/displayDescription/capabilities,不含 instructions 全文(省 token)。
export async function analyzeImportedSkill(params: {
  fileContent: string;
  fileName: string;
  existingSkills: { id: string; displayDescription?: string; capabilities: string[] }[];
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
}): Promise<{ candidates: SkillCandidate[] }> {
  const { fileContent, fileName, existingSkills, cfg, model, signal } = params;
  const truncated =
    fileContent.length > MAX_IMPORT_CHARS
      ? fileContent.slice(0, MAX_IMPORT_CHARS) + '\n...(内容过长已截断)'
      : fileContent;

  const catalog = existingSkills
    .map(
      (s) =>
        `- id:${s.id}${s.displayDescription ? `  说明:${s.displayDescription}` : ''}${s.capabilities.length ? `  能力:${s.capabilities.join(' / ')}` : ''}`,
    )
    .join('\n');

  const system =
    '你只负责分析用户提供的 SKILL 文本并输出一个 JSON 对象,不输出任何自然语言解释,不使用 Markdown 代码块。';
  const text = `用户提供了一份 SKILL 文本(可能来自 .md 文件,可能带 YAML frontmatter,也可能纯正文)。你的任务:

1. 阅读全文,判断该文本承载的是一个还是多个独立职责的 skill。如果一个文件里写了多个职责(例如多个 ## 章节各自是独立能力),按职责拆成多个候选;单一职责就输出一个候选。
2. 为每个候选生成:英文 modelName(小写字母+数字+连字符,2-64 字符,用于模型识别)、英文 modelDescription(触发条件描述,告诉模型何时启用此 skill)、中文 displayTitle(简洁展示名)、中文 displayDescription(一句话简介,≤1000 字符)、capabilities(中文能力列表,每条简短)、instructions(实际注入姬子的做事方法,保留原文里的关键指令,≤24000 字符)。
3. 对每个候选,在已有 skill 清单里粗筛是否疑似功能重复(只基于 displayDescription 和 capabilities 层面判断)。疑似重复就填 possibleDuplicateOf 为对应已有 skill 的 id;不疑似就不填。不要在这一步给"谁更好"的判断,下一阶段会单独做。

已有 skill 清单:
${catalog || '(无)'}

请输出如下 JSON 结构(不要任何额外说明):
{
  "candidates": [
    {
      "displayTitle": "中文展示名",
      "displayDescription": "中文一句话简介",
      "modelName": "english-id",
      "modelDescription": "English trigger description",
      "capabilities": ["能力1", "能力2"],
      "instructions": "完整指令正文",
      "possibleDuplicateOf": "已有skill的id或省略"
    }
  ]
}

SKILL 文本(来源文件:${fileName}):
${truncated}`;

  const reply = await chat({ cfg, model, system, text, signal, scene: 'import-skill' });
  const root = JSON.parse(cleanJsonFence(reply)) as { candidates?: unknown };
  const arr = Array.isArray(root.candidates) ? root.candidates : [];
  const candidates: SkillCandidate[] = [];
  for (const item of arr) {
    const obj = item as Record<string, unknown>;
    const candidate = coerceCandidate(obj, fileName);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) {
    throw new Error('姬子未从文本中解析出可用的 skill 候选,请检查文件内容或重试。');
  }
  return { candidates };
}

// 阶段2:对疑似重复的候选,读对应已有 skill 的全文 instructions 做深度比对。
export async function deepCompareSkill(params: {
  candidate: SkillCandidate;
  existing: { id: string; instructions: string };
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
}): Promise<{ recommendation: 'keep_new' | 'keep_old' | 'keep_both'; reason: string }> {
  const { candidate, existing, cfg, model, signal } = params;
  const system =
    '你只负责比对两份 SKILL 文本并输出一个 JSON 对象,不输出任何自然语言解释,不使用 Markdown 代码块。';
  const text = `请对比以下两份 skill,判断应保留哪一个(或两者都保留):
- keep_new:新版更好,建议用新版覆盖旧版
- keep_old:旧版更好,建议保留旧版、放弃新版
- keep_both:两者各有价值,建议都保留(此时新版应改名为不同 id)

【旧 skill】 id:${existing.id}
${existing.instructions.slice(0, MAX_IMPORT_CHARS)}

【新 skill 候选】
指令:
${candidate.instructions.slice(0, MAX_IMPORT_CHARS)}

输出 JSON:
{
  "recommendation": "keep_new" | "keep_old" | "keep_both",
  "reason": "一句话中文说明为何这样建议"
}`;

  const reply = await chat({ cfg, model, system, text, signal, scene: 'import-skill' });
  const root = JSON.parse(cleanJsonFence(reply)) as { recommendation?: string; reason?: string };
  const rec = root.recommendation;
  const recommendation =
    rec === 'keep_new' || rec === 'keep_old' || rec === 'keep_both'
      ? rec
      : 'keep_both';
  const reason = typeof root.reason === 'string' && root.reason.trim()
    ? root.reason.trim()
    : '未给出理由';
  return { recommendation, reason };
}

function coerceCandidate(
  obj: Record<string, unknown>,
  sourceFile: string,
): SkillCandidate | null {
  const displayTitle = strField(obj, 'displayTitle');
  const displayDescription = strField(obj, 'displayDescription');
  const modelName = strField(obj, 'modelName');
  const modelDescription = strField(obj, 'modelDescription');
  const instructions = strField(obj, 'instructions');
  const capabilities = Array.isArray(obj.capabilities)
    ? (obj.capabilities as unknown[])
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
    : [];
  const possibleDuplicateOf = strField(obj, 'possibleDuplicateOf') || undefined;
  if (
    !displayTitle ||
    !displayDescription ||
    !modelName ||
    !modelDescription ||
    !instructions ||
    capabilities.length === 0
  ) {
    return null;
  }
  return {
    sourceFile,
    displayTitle,
    displayDescription,
    modelName,
    modelDescription,
    capabilities,
    instructions,
    possibleDuplicateOf,
  };
}

function strField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v.trim() : '';
}

// ── 原文照存模式 ──────────────────────────────────────────────
// 适用于已带规范 frontmatter 的高质量 skill 文本。姬子不转写,只生成中文展示名/描述,
// 其余字段(modelName/modelDescription/capabilities/instructions)从原文 frontmatter+body 原样提取。

interface ParsedFrontmatter {
  name: string;
  description: string;
  displayTitle?: string;
  displayDescription?: string;
  capabilities: string[];
  instructions: string;
}

function parseFrontmatter(text: string): ParsedFrontmatter | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  const name = fmValue(frontmatter, 'name');
  const description = fmValue(frontmatter, 'description');
  const displayTitle = fmValue(frontmatter, 'display_title') || undefined;
  const displayDescription = fmValue(frontmatter, 'display_description') || undefined;
  const capabilities = fmList(frontmatter, 'capabilities');
  if (!name || !description || !body) return null;
  return { name, description, displayTitle, displayDescription, capabilities, instructions: body };
}

function fmValue(frontmatter: string, key: string): string {
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(pattern);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
}

function fmList(frontmatter: string, key: string): string[] {
  const raw = fmValue(frontmatter, key);
  if (!raw) return [];
  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

// 原文照存阶段1:解析 frontmatter → 原样提取字段 → 姬子只生成中文名/描述(若无) + 粗筛重复。
// 只喂姬子 frontmatter 的 name/description/capabilities,不喂 instructions 全文,省 token。
export async function analyzeImportedSkillPreserve(params: {
  fileContent: string;
  fileName: string;
  existingSkills: { id: string; displayDescription?: string; capabilities: string[] }[];
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
}): Promise<{ candidates: SkillCandidate[] }> {
  const { fileContent, fileName, existingSkills, cfg, model, signal } = params;
  const parsed = parseFrontmatter(fileContent);
  if (!parsed) {
    throw new Error('该文件没有规范的 frontmatter(--- name/description/capabilities ---),无法原文照存。请改用智能转写模式。');
  }

  // 已有 displayTitle/displayDescription 就直接用,不再调姬子(最省)。
  if (parsed.displayTitle && parsed.displayDescription) {
    return {
      candidates: [
        {
          sourceFile: fileName,
          displayTitle: parsed.displayTitle,
          displayDescription: parsed.displayDescription,
          modelName: parsed.name,
          modelDescription: parsed.description,
          capabilities: parsed.capabilities.length > 0 ? parsed.capabilities : ['默认能力'],
          instructions: parsed.instructions,
          preserveRaw: true,
          possibleDuplicateOf: findPossibleDuplicate(parsed.description, parsed.capabilities, existingSkills),
        },
      ],
    };
  }

  // 缺中文名/描述,调姬子补(只喂 frontmatter 的英文 name/description/capabilities,不喂 instructions)。
  const catalog = existingSkills
    .map(
      (s) =>
        `- id:${s.id}${s.displayDescription ? `  说明:${s.displayDescription}` : ''}${s.capabilities.length ? `  能力:${s.capabilities.join(' / ')}` : ''}`,
    )
    .join('\n');

  const system =
    '你只负责为已有 skill 生成中文展示名和中文简介,只输出一个 JSON 对象,不输出自然语言解释,不使用 Markdown 代码块。';
  const text = `这是一个已有 skill(英文 name/description/capabilities),请生成对应的中文展示名和一句话中文简介。

skill 英文名: ${parsed.name}
skill 英文描述: ${parsed.description}
能力列表: ${parsed.capabilities.join(' / ') || '(无)'}

已有 skill 清单(用于粗筛是否疑似重复):
${catalog || '(无)'}

输出 JSON:
{
  "displayTitle": "简洁中文展示名",
  "displayDescription": "一句话中文简介,≤1000字符",
  "possibleDuplicateOf": "疑似重复的已有 skill id,没有则省略该字段"
}`;

  const reply = await chat({ cfg, model, system, text, signal, scene: 'import-skill' });
  const root = JSON.parse(cleanJsonFence(reply)) as {
    displayTitle?: string;
    displayDescription?: string;
    possibleDuplicateOf?: string;
  };
  const displayTitle = (root.displayTitle ?? '').trim();
  const displayDescription = (root.displayDescription ?? '').trim();
  if (!displayTitle || !displayDescription) {
    throw new Error('姬子未能生成中文展示名或描述,请重试。');
  }
  return {
    candidates: [
      {
        sourceFile: fileName,
        displayTitle,
        displayDescription,
        modelName: parsed.name,
        modelDescription: parsed.description,
        capabilities: parsed.capabilities.length > 0 ? parsed.capabilities : ['默认能力'],
        instructions: parsed.instructions,
        preserveRaw: true,
        possibleDuplicateOf: root.possibleDuplicateOf?.trim() || undefined,
      },
    ],
  };
}

// 纯前端粗筛:已有 displayTitle/displayDescription 时不再调姬子,用简单文本匹配兜底。
function findPossibleDuplicate(
  description: string,
  capabilities: string[],
  existing: { id: string; displayDescription?: string; capabilities: string[] }[],
): string | undefined {
  const desc = description.toLowerCase();
  const caps = capabilities.map((c) => c.toLowerCase());
  for (const s of existing) {
    const sDesc = (s.displayDescription ?? '').toLowerCase();
    if (!sDesc) continue;
    // 描述有显著词重叠就算疑似
    const overlap = wordOverlap(desc, sDesc);
    if (overlap >= 0.4) return s.id;
    // 能力列表有交集
    const sCaps = s.capabilities.map((c) => c.toLowerCase());
    if (caps.some((c) => sCaps.some((sc) => sc.includes(c) || c.includes(sc)))) return s.id;
  }
  return undefined;
}

function wordOverlap(a: string, b: string): number {
  const wordsA = a.split(/\s+/).filter((w) => w.length > 2);
  const wordsB = b.split(/\s+/).filter((w) => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const setB = new Set(wordsB);
  const common = wordsA.filter((w) => setB.has(w)).length;
  return common / Math.min(wordsA.length, wordsB.length);
}
