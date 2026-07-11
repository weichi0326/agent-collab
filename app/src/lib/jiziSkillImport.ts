import { chat, type LLMConfig } from './llmClient';
import { cleanJsonFence } from './masterPlanner';
import { loadJiziSkillById } from './jiziSkills';
import {
  type JiziSkillCategory,
  parseSkillDocument,
  SKILL_INSTRUCTION_CHAR_LIMIT,
  skillFrontmatterList,
  skillFrontmatterValue,
  sliceUnicode,
  unicodeLength,
} from './jiziSkillFormat';

// 分析输入可以大于单个 skill 的保存上限,否则长文档后半段会直接丢失。
const MAX_ANALYZE_CHARS = 80_000;
const LONG_DOCUMENT_CHUNK_CHARS = 7_000;

function analysisExcerpt(value: string, markTruncation = true): string {
  if (unicodeLength(value) <= MAX_ANALYZE_CHARS) return value;
  const excerpt = sliceUnicode(value, MAX_ANALYZE_CHARS);
  return markTruncation ? `${excerpt}\n...(内容过长已截断)` : excerpt;
}

const FALLBACK_SKILL_CREATOR_GUIDELINES = `按专业 Skill 写作规范整理:
- 名称简短、具体、可识别，不使用泛泛的“助手/专家”堆砌。
- 描述说明何时启用这个 Skill，聚焦触发场景和任务价值，不写营销话术。
- 能力列表保留 3-8 条可执行能力，每条短而明确。
- 正文只保留模型真正需要的流程、决策规则、边界条件、校验要求和输出要求。
- 删除寒暄、安装说明、更新日志、过长背景、重复解释和对模型已显而易见的常识。
- 必要示例可以保留，但必须短小，且服务于容易出错的判断。
- 使用中文书写；不要生成英文 name、英文 description、display_title 或 display_description。
- instructions 只输出做事方法正文，不要包含 YAML frontmatter，不要重复输出一级标题。`;

async function loadSkillCreatorGuidelines(): Promise<string> {
  try {
    const skill = await loadJiziSkillById('skill-creator');
    if (skill?.instructions.trim()) {
      return [
        `名称：${skill.title}`,
        `触发说明：${skill.description}`,
        skill.capabilities.length > 0
          ? `能力：${skill.capabilities.join(' | ')}`
          : '',
        '正文：',
        skill.instructions.trim(),
      ]
        .filter(Boolean)
        .join('\n');
    }
  } catch (err) {
    console.warn('[jiziSkillImport] failed to load skill-creator, using fallback', err);
  }
  return FALLBACK_SKILL_CREATOR_GUIDELINES;
}

export interface SkillCandidate {
  sourceFile: string;
  index?: string;
  displayTitle: string;
  displayDescription: string;
  category: JiziSkillCategory;
  capabilities: string[];
  instructions: string;
  possibleDuplicateOf?: string; // 阶段1 填:疑似重复的已有 skill id
  recommendation?: 'keep_new' | 'keep_old' | 'keep_both'; // 阶段2 填
  duplicateReason?: string;
  preserveRaw?: boolean; // 原文照存模式:instructions/capabilities 锁定只读
}

interface AnalyzeImportedSkillParams {
  fileContent: string;
  fileName: string;
  existingSkills: { id: string; displayDescription?: string; capabilities: string[] }[];
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export function splitSkillAnalysisDocument(
  content: string,
  maxChars = LONG_DOCUMENT_CHUNK_CHARS,
): string[] {
  if (unicodeLength(content) <= maxChars) return [content];
  const lines = content.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^##\s+/.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current.join('\n').trim());

  const chunks: string[] = [];
  let chunk = '';
  const pushChunk = () => {
    if (chunk.trim()) chunks.push(chunk.trim());
    chunk = '';
  };
  for (const section of sections.filter(Boolean)) {
    if (unicodeLength(section) > maxChars) {
      pushChunk();
      let remaining = section;
      while (remaining) {
        chunks.push(sliceUnicode(remaining, maxChars).trim());
        remaining = Array.from(remaining).slice(maxChars).join('');
      }
      continue;
    }
    const combined = chunk ? `${chunk}\n\n${section}` : section;
    if (chunk && unicodeLength(combined) > maxChars) pushChunk();
    chunk = chunk ? `${chunk}\n\n${section}` : section;
  }
  pushChunk();
  return chunks.filter(Boolean);
}

function normalizeCapabilities(values: string[]): string[] {
  const normalized = values.map((item) => item.trim()).filter(Boolean).slice(0, 8);
  for (const fallback of ['执行核心任务', '检查边界条件', '校验输出结果']) {
    if (normalized.length >= 3) break;
    if (!normalized.includes(fallback)) normalized.push(fallback);
  }
  return normalized;
}

// 阶段1:分析导入文件,产出候选(含拆分) + 粗筛重复标记。
// existingSkills 只含 id/displayDescription/capabilities,不含 instructions 全文(省 token)。
export async function analyzeImportedSkill(
  params: AnalyzeImportedSkillParams,
): Promise<{ candidates: SkillCandidate[] }> {
  return analyzeImportedSkillInternal(params, true);
}

async function analyzeImportedSkillInternal(
  params: AnalyzeImportedSkillParams,
  allowChunking: boolean,
): Promise<{ candidates: SkillCandidate[] }> {
  const { fileContent, fileName, existingSkills, cfg, model, signal } = params;
  if (allowChunking) {
    const chunks = splitSkillAnalysisDocument(fileContent);
    if (chunks.length > 1) {
      const combined: SkillCandidate[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        if (signal?.aborted) throw new DOMException('已停止分析', 'AbortError');
        params.onProgress?.(`正在分析第 ${index + 1}/${chunks.length} 部分...`);
        try {
          const result = await analyzeImportedSkillInternal(
            {
              ...params,
              fileContent: chunks[index]!,
              fileName: `${fileName}（第 ${index + 1} 部分）`,
            },
            false,
          );
          combined.push(
            ...result.candidates.map((candidate) => ({ ...candidate, sourceFile: fileName })),
          );
        } catch (err) {
          const detail = err instanceof Error ? err.message : '未知错误';
          throw new Error(`文档第 ${index + 1}/${chunks.length} 部分分析失败：${detail}`);
        }
      }
      const seen = new Set<string>();
      const candidates = combined.filter((candidate) => {
        const key = `${candidate.displayTitle}\n${candidate.displayDescription}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (candidates.length === 0) {
        throw new Error('分批分析完成，但没有生成可用的 Skill 候选');
      }
      return { candidates };
    }
  }
  const truncated = analysisExcerpt(fileContent);
  const skillCreatorGuidelines = await loadSkillCreatorGuidelines();

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
   - 对长文档、多章节规范、QA/测试/流程治理类文档,不要因为都属于同一领域就合并成一个。只要章节可独立触发、独立维护、独立组合,就拆成多个候选。
   - 如果文档超过 8000 字或包含 5 个以上二级标题,优先拆成 3-8 个候选,除非所有章节必须每次作为一个整体同时执行。
   - QA/测试规范常见可拆方向:信息收集与追问、核心用例编写原则、配置一致性验证、输出结构/格式控制、对象类型检查、场景挖掘清单、完成后自检/决策表。
2. 为每个候选生成:displayTitle(中文名称)、displayDescription(中文描述,≤1000 字符)、category(workflow/tool/diagnosis/model/skill 之一)、capabilities(中文能力列表,3-8 条)、instructions(实际注入姬子的中文做事方法,保留原文里的关键指令,≤20000 字符)。不要翻译成英文,不要生成英文名称或英文触发描述。
3. 复写时必须调用并遵循以下 skill-creator。它是 Skill 写作质量的规范来源；结合原文完成任务，不要在输出中复述这段规范：
${skillCreatorGuidelines}
4. 对每个候选,在已有 skill 清单里粗筛是否疑似功能重复(只基于 displayDescription 和 capabilities 层面判断)。疑似重复就填 possibleDuplicateOf 为对应已有 skill 的 id;不疑似就不填。不要在这一步给"谁更好"的判断,下一阶段会单独做。

已有 skill 清单:
${catalog || '(无)'}

请输出如下 JSON 结构(不要任何额外说明):
{
  "candidates": [
    {
      "displayTitle": "中文展示名",
      "displayDescription": "中文一句话简介",
      "category": "workflow",
      "capabilities": ["能力1", "能力2"],
      "instructions": "完整指令正文",
      "possibleDuplicateOf": "已有skill的id或省略"
    }
  ]
}

SKILL 文本(来源文件:${fileName}):
${truncated}`;

  const reply = await chat({ cfg, model, system, text, signal, scene: 'import-skill' });
  const candidates = parseSkillCandidates(reply, fileName);
  if (candidates.length === 0) {
    throw new Error('姬子未从文本中解析出可用的 skill 候选,请检查文件内容或重试。');
  }
  if (shouldRunSplitAudit(fileContent, candidates)) {
    try {
      const audited = await analyzeSplitAudit({
        fileContent,
        fileName,
        catalog,
        cfg,
        model,
        signal,
        skillCreatorGuidelines,
      });
      if (audited.length > 1) return { candidates: audited };
    } catch {
      // 二次拆分审查失败时保留首次结果,避免导入流程中断。
    }
  }
  return { candidates };
}

async function analyzeSplitAudit(params: {
  fileContent: string;
  fileName: string;
  catalog: string;
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
  skillCreatorGuidelines: string;
}): Promise<SkillCandidate[]> {
  const {
    fileContent,
    fileName,
    catalog,
    cfg,
    model,
    signal,
    skillCreatorGuidelines,
  } = params;
  const truncated = analysisExcerpt(fileContent);

  const system =
    '你只负责把长篇 SKILL 文档拆分成多个可独立导入的候选 skill,只输出 JSON 对象,不输出自然语言解释,不使用 Markdown 代码块。';
  const text = `第一次分析只得到 1 个候选,但这份文档较长或章节较多。请重新做拆分审查。

拆分标准:
1. 只要章节可以独立触发、独立维护、独立组合,就拆成单独候选。不要因为它们同属一个大领域就合并。
2. 对超过 8000 字或包含多个 ##/### 章节的规范文档,优先输出 3-8 个候选。
3. 每个候选的 instructions 只保留该候选需要执行的规则。可以保留必要共享约束,但不要把全文复制进每个候选。
4. 只有当所有章节每次都必须整体执行,拆开后会失去意义时,才允许输出 1 个候选。
5. 对每个候选,继续在已有 skill 清单里粗筛 possibleDuplicateOf。
6. 拆分和复写时必须调用并遵循以下 skill-creator。它是 Skill 写作质量的规范来源；不要在输出中复述这段规范：
${skillCreatorGuidelines}

已有 skill 清单:
${catalog || '(无)'}

输出 JSON:
{
  "candidates": [
    {
      "displayTitle": "中文展示名",
      "displayDescription": "中文一句话简介",
      "category": "workflow",
      "capabilities": ["能力1", "能力2"],
      "instructions": "只属于该候选的完整指令正文",
      "possibleDuplicateOf": "已有skill的id或省略"
    }
  ]
}

SKILL 文本(来源文件:${fileName}):
${truncated}`;

  const reply = await chat({ cfg, model, system, text, signal, scene: 'import-skill' });
  return parseSkillCandidates(reply, fileName);
}

function shouldRunSplitAudit(fileContent: string, candidates: SkillCandidate[]): boolean {
  if (candidates.length !== 1) return false;
  const h2Count = (fileContent.match(/^##\s+/gm) ?? []).length;
  const h3Count = (fileContent.match(/^###\s+/gm) ?? []).length;
  return fileContent.length > 8_000 || h2Count >= 5 || h3Count >= 8;
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
${sliceUnicode(existing.instructions, SKILL_INSTRUCTION_CHAR_LIMIT)}

【新 skill 候选】
指令:
${sliceUnicode(candidate.instructions, SKILL_INSTRUCTION_CHAR_LIMIT)}

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

export async function rewriteExistingSkill(params: {
  skill: {
    id: string;
    title: string;
    description: string;
    capabilities: string[];
    instructions: string;
    rawContent?: string;
  };
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
}): Promise<SkillCandidate> {
  const { skill, cfg, model, signal } = params;
  const source = analysisExcerpt(skill.rawContent || skill.instructions, false);
  const skillCreatorGuidelines = await loadSkillCreatorGuidelines();
  const system =
    '你只负责把旧版 SKILL 复写为专业、精炼的新格式候选,只输出 JSON 对象,不输出自然语言解释,不使用 Markdown 代码块。';
  const text = `请把下面这份旧版 skill 复写成新的中文 Skill 候选。要求:

必须调用并遵循以下 skill-creator。它是 Skill 写作质量的规范来源；结合旧 Skill 完成复写，不要在输出中复述这段规范：
${skillCreatorGuidelines}

保留原 skill 的核心能力和边界，但可以重组、压缩、修正不专业表达。
索引沿用原 id，不要改名为英文语义索引。

输出 JSON:
{
  "candidates": [
    {
      "index": "${skill.id}",
      "displayTitle": "中文 Skill 名称",
      "displayDescription": "中文一句话描述",
      "category": "workflow",
      "capabilities": ["能力1", "能力2", "能力3"],
      "instructions": "专业化后的做事方法正文"
    }
  ]
}

旧版 skill 摘要:
- id: ${skill.id}
- 当前名称: ${skill.title}
- 当前描述: ${skill.description}
- 当前能力: ${skill.capabilities.join(' | ') || '(无)'}

旧版 skill 原文:
${source}`;

  const reply = await chat({ cfg, model, system, text, signal, scene: 'import-skill' });
  const candidates = parseSkillCandidates(reply, skill.id);
  const candidate = candidates[0];
  if (!candidate) {
    throw new Error(`未能复写「${skill.title || skill.id}」`);
  }
  return {
    ...candidate,
    index: skill.id,
  };
}

function parseSkillCandidates(reply: string, fileName: string): SkillCandidate[] {
  let root: { candidates?: unknown };
  try {
    root = JSON.parse(cleanJsonFence(reply)) as { candidates?: unknown };
  } catch {
    throw new Error(
      '模型返回的 Skill 结果不完整或格式错误，通常是回复长度不足导致。系统已支持分批分析，请重试；若仍失败，请换用输出能力更强的模型。',
    );
  }
  const arr = Array.isArray(root.candidates) ? root.candidates : [];
  const candidates: SkillCandidate[] = [];
  for (const item of arr) {
    const obj = item as Record<string, unknown>;
    const candidate = coerceCandidate(obj, fileName);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function coerceCandidate(
  obj: Record<string, unknown>,
  sourceFile: string,
): SkillCandidate | null {
  const displayTitle = strField(obj, 'displayTitle');
  const displayDescription = strField(obj, 'displayDescription');
  const index = strField(obj, 'index') || undefined;
  const categoryValue = strField(obj, 'category');
  const category: JiziSkillCategory =
    categoryValue === 'tool' ||
    categoryValue === 'diagnosis' ||
    categoryValue === 'model' ||
    categoryValue === 'skill'
      ? categoryValue
      : 'workflow';
  const instructions = strField(obj, 'instructions');
  const capabilities = normalizeCapabilities(Array.isArray(obj.capabilities)
    ? (obj.capabilities as unknown[])
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
    : []);
  const possibleDuplicateOf = strField(obj, 'possibleDuplicateOf') || undefined;
  if (
    !displayTitle ||
    !displayDescription ||
    !instructions ||
    capabilities.length === 0
  ) {
    return null;
  }
  return {
    sourceFile,
    index,
    displayTitle,
    displayDescription,
    category,
    capabilities,
    instructions: sliceUnicode(instructions, SKILL_INSTRUCTION_CHAR_LIMIT).trim(),
    possibleDuplicateOf,
  };
}

function strField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v.trim() : '';
}

// ── 原文照存模式 ──────────────────────────────────────────────
// 适用于已带规范 frontmatter 的高质量 skill 文本。直接读取中文元数据,
// 并从原文 frontmatter+body 原样提取能力和正文。

interface ParsedFrontmatter {
  index: string;
  title: string;
  description: string;
  category: JiziSkillCategory;
  capabilities: string[];
  instructions: string;
}

function parseFrontmatter(text: string): ParsedFrontmatter | null {
  const parsed = parseSkillDocument(text);
  if (!parsed) return null;
  const { frontmatter, body } = parsed;
  const index =
    skillFrontmatterValue(frontmatter, 'index') ||
    skillFrontmatterValue(frontmatter, 'name');
  const title =
    skillFrontmatterValue(frontmatter, 'title') ||
    skillFrontmatterValue(frontmatter, 'display_title') ||
    index;
  const displayTitle = skillFrontmatterValue(frontmatter, 'display_title') || undefined;
  const description =
    skillFrontmatterValue(frontmatter, 'display_description') ||
    skillFrontmatterValue(frontmatter, 'description') ||
    displayTitle ||
    title;
  const capabilities = skillFrontmatterList(frontmatter, 'capabilities');
  const categoryValue = skillFrontmatterValue(frontmatter, 'category');
  const category: JiziSkillCategory =
    categoryValue === 'tool' ||
    categoryValue === 'diagnosis' ||
    categoryValue === 'model' ||
    categoryValue === 'skill'
      ? categoryValue
      : 'workflow';
  if (!index || !title || !description || !body) return null;
  return { index, title, description, category, capabilities, instructions: body };
}

// 原文照存阶段1:解析 frontmatter → 原样提取字段 → 粗筛重复。
export async function analyzeImportedSkillPreserve(params: {
  fileContent: string;
  fileName: string;
  existingSkills: { id: string; displayDescription?: string; capabilities: string[] }[];
  cfg: LLMConfig;
  model: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<{ candidates: SkillCandidate[] }> {
  const { fileContent, fileName, existingSkills, onProgress } = params;
  onProgress?.('正在读取原文 Skill 元数据...');
  const parsed = parseFrontmatter(fileContent);
  if (!parsed) {
    throw new Error('该文件没有规范的 frontmatter(--- title/description/capabilities ---),无法原文照存。请改用智能整理模式。');
  }
  if (unicodeLength(parsed.instructions) > SKILL_INSTRUCTION_CHAR_LIMIT) {
    throw new Error(
      `原文正文超过 ${SKILL_INSTRUCTION_CHAR_LIMIT} 个字符，无法原文照存。请改用智能整理模式。`,
    );
  }

  return {
    candidates: [
      {
        sourceFile: fileName,
        index: parsed.index,
        displayTitle: parsed.title,
        displayDescription: parsed.description,
        category: parsed.category,
        capabilities: normalizeCapabilities(parsed.capabilities),
        instructions: parsed.instructions,
        preserveRaw: true,
        possibleDuplicateOf: findPossibleDuplicate(parsed.description, parsed.capabilities, existingSkills),
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
