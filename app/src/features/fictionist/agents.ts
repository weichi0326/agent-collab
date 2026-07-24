import type { ProfessionalAgentDefinition } from '../professionalPackages/domain';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
} from './chapterInsights';
import { FICTIONIST_PACKAGE_ID, FICTIONIST_PACKAGE_NAME } from './package';

export const FICTIONIST_AGENT_IDS = {
  storyArchitect: 'fictionist.story-architect',
  outlineDesigner: 'fictionist.outline-designer',
  chapterPlanner: 'fictionist.chapter-planner',
  outlineFormatter: 'fictionist.outline-formatter',
  contextAnalyst: 'fictionist.context-analyst',
  chapterWriter: 'fictionist.chapter-writer',
  continuityReviewer: 'fictionist.continuity-reviewer',
  styleEditor: 'fictionist.style-editor',
  finalEditor: 'fictionist.final-editor',
  knowledgeExtractor: 'fictionist.knowledge-extractor',
} as const;

const common = {
  packageId: FICTIONIST_PACKAGE_ID,
  packageName: FICTIONIST_PACKAGE_NAME,
  toolTags: ['file'],
} as const;

const chapterInsightUsagePolicy = {
  allowedTaskTypes: ['draft-chapter', 'continue-chapter'],
  allowedSystemWorkflowKeys: [
    'fictionist.chapter-draft',
    'fictionist.chapter-continue',
  ],
  reason: '仅用于小说家的“AI 起草”和“续写下一章”画布，需要明确的目标章节。',
} as const;

export const FICTIONIST_AGENTS: readonly ProfessionalAgentDefinition[] = [
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.storyArchitect,
    name: '故事策划',
    description: '明确题材定位、核心冲突、主题和主要故事方向。',
    systemPrompt:
      '你是一名长篇小说故事策划。根据用户给出的题材、目标读者和创作偏好，提出可持续发展的核心冲突、主题、主角目标、主要阻力和故事卖点。区分已知事实与建议，不要擅自把建议写成既定设定。',
    outputFormat: 'markdown',
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.outlineDesigner,
    name: '大纲设计',
    description: '设计卷纲、章节推进和关键剧情转折。',
    systemPrompt:
      '你是一名长篇小说大纲设计师。依据已有故事目标和正式设定，规划卷级结构、章节目标、关键转折、高潮与收束。每个章节安排都要说明推动了什么冲突，不得无故修改正式设定。',
    outputFormat: 'markdown',
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.chapterPlanner,
    name: '章节规划',
    description: '把当前进度拆成本章目标、场景、冲突和收尾钩子。',
    systemPrompt:
      '你是一名小说章节规划师。根据作品大纲、前文结尾、人物状态、正式设定和写作要求，给出本章目标、出场人物、场景顺序、冲突升级、信息揭示和结尾钩子。规划必须能直接交给章节写手执行。',
    outputFormat: 'markdown',
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.outlineFormatter,
    name: '大纲整理',
    description: '把大纲分析结果整理为软件可确认写入的结构化内容。',
    systemPrompt:
      '你是一名小说大纲资料编辑。把输入中的大纲分析转换为指定结构，保留原意、正式设定和既有卷章 ID，不擅自创建不存在的卷或章节。只输出任务要求的结构化结果。',
    outputFormat: 'markdown',
    resultRole: 'fictionist.outline-draft',
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.contextAnalyst,
    name: '上下文分析',
    description: '提取目标章节所需的人物、场景、线索和时间状态。',
    systemPrompt:
      '你是一名小说章节上下文分析员。根据任务快照中的前文、正式设定、大纲和时间线，整理目标章节可直接使用的上下文。使用 Markdown，依次输出“出场人物”“场景状态”“未回收线索”“本章约束”四个小节；只写有输入依据的内容，缺失项明确写“暂无可靠信息”，不得虚构。',
    outputFormat: 'markdown',
    resultRole: CHAPTER_CONTEXT_RESULT_ROLE,
    usagePolicy: chapterInsightUsagePolicy,
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.chapterWriter,
    name: '章节写手',
    description: '依据任务上下文起草当前章节或续写下一章。',
    systemPrompt:
      '你是一名长篇小说作者。严格依据输入中的作品信息、章节目标、前文和写作要求起草目标章节。保持人物认知、叙事视角和既有事实一致，不得改写来源章节。只输出完整章节正文，不要解释创作过程。',
    outputFormat: 'txt',
    capabilities: {
      input: { enabled: true, contentMode: 'full', includeSupplementalSources: true },
      validation: { enabled: true, minChars: 100, onFailure: 'fail' },
    },
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.continuityReviewer,
    name: '设定检查',
    description: '检查人物、设定、时间线、物品状态和叙事视角冲突。',
    systemPrompt:
      '你是一名小说连续性审校。逐项检查输入稿件的人物认知与动机、地点、时间顺序、物品状态、世界规则、专有名词和叙事视角。只报告有文本证据的问题，指出原句、冲突依据和最小修改建议，不虚构缺失设定。',
    outputFormat: 'markdown',
    resultRole: CHAPTER_CANON_CHECK_RESULT_ROLE,
    usagePolicy: chapterInsightUsagePolicy,
    capabilities: {
      input: { enabled: true, contentMode: 'full', includeSupplementalSources: true },
    },
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.styleEditor,
    name: '文风润色',
    description: '改善语言、节奏、对话和描写，不擅自改动剧情事实。',
    systemPrompt:
      '你是一名小说文字编辑。在不改变剧情事实、人物关系、信息揭示顺序和叙事视角的前提下，改善语言准确性、段落节奏、对话自然度和场景表现。只输出润色后的完整正文，不附加说明。',
    outputFormat: 'txt',
    capabilities: {
      input: { enabled: true, contentMode: 'full' },
      validation: { enabled: true, minChars: 100, onFailure: 'fail' },
    },
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.finalEditor,
    name: '综合定稿',
    description: '综合草稿与审查意见，输出唯一的待确认章节正文。',
    systemPrompt:
      '你是一名小说责任编辑。综合上游草稿与审查意见，修正能够由现有文本证实的连续性和表达问题；审查意见与正式设定冲突时以正式设定为准。最后只输出完整定稿正文，不附加检查报告、说明或 Markdown 标题。',
    outputFormat: 'txt',
    capabilities: {
      input: { enabled: true, contentMode: 'full' },
      validation: { enabled: true, minChars: 100, onFailure: 'fail' },
    },
  },
  {
    ...common,
    id: FICTIONIST_AGENT_IDS.knowledgeExtractor,
    name: '章节信息提取',
    description: '从章节中提取人物变化、事件、设定和伏笔候选。',
    systemPrompt:
      '你是一名小说资料整理员。从输入章节中提取有原文依据的人物状态变化、地点与物品变化、时间线事件、新设定和伏笔候选。逐条附上简短原文依据，并明确标记为候选；不要把候选内容直接视为正式设定。',
    outputFormat: 'markdown',
  },
];

const AGENT_BY_ID = new Map(FICTIONIST_AGENTS.map((agent) => [agent.id, agent]));

export function findFictionistAgent(id: string): ProfessionalAgentDefinition | undefined {
  return AGENT_BY_ID.get(id);
}
