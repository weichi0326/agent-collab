// 姬子自愈闭环的纯函数与类型: 从 orchestratorStore 抽出, 接受 state 作参数, 不持有 store 引用。
// 拆分目的: 让 orchestratorStore 顶层 store 导入收敛, 依赖方向单向 (store → 本文件), 便于独立测试。

import { buildJiziSkillSystemBlock } from '../jiziSkills';
import type { LLMConfig } from '../llmClient';

export type IncidentStatus =
  | 'diagnosing'
  | 'awaiting-confirm'
  | 'repairing' // 已判定可自动修复(补已有工具)的修复/重跑窗口:RunStatusCard 里 runState=failed 时渲染「修复中」卡(variant repairing),runState=running 时渲染「修复成功·重新运行」卡(variant rerun)
  | 'resolved'
  | 'failed';

export interface Incident {
  id: string;
  canvasId: string; // 源画布 id(用于整图重跑,非只读运行副本)
  nodeId: string;
  nodeLabel: string;
  errorDetail: string;
  sessionId: string; // 诊断消息写入的姬子会话
  status: IncidentStatus;
  createdAt: number;
  generatedToolName?: string;
  diagnosisSummary?: string;
  consequence?: string;
  fixCost?: string;
  // 状态卡④⑥⑦展示的「诊断信息」正文(去掉标题的一段结论);由 orchestrator 在诊断收尾时写入。
  diagnosisText?: string;
  // 失败时正在运行的只读运行副本定位(用于「就地重跑失败子节点」);预检失败时为空 → 回落整图重跑。
  runTabId?: string;
  runId?: string;
  // 用户在指挥中心手动「忽略」的失败:不再计入问题数、不再提示(incident 本身是瞬态,忽略随会话失效)。
  ignored?: boolean;
}

export interface ReportInput {
  canvasId: string;
  nodeId: string;
  nodeLabel: string;
  errorDetail: string;
  runTabId?: string;
  runId?: string;
}

// 只取 visibleForSession 需要的字段, 避免导出整个 UiState/MasterState。
export interface SessionVisibilityInput {
  view: string;
  drawerExpanded: boolean;
  activeSessionId: string | null;
}

/** 当前抽屉是否正好展示着该 incident 所属会话(展示则不弹通知,直接用确认卡片)。 */
export function isSessionVisible(
  input: SessionVisibilityInput,
  sessionId: string,
): boolean {
  return (
    input.view === 'workspace' &&
    !!input.drawerExpanded &&
    input.activeSessionId === sessionId
  );
}

/** 单条常驻通知文案: 聚合所有 awaiting-confirm, 标题带计数。空列表返回 null(由调用方销毁通知)。 */
export function buildAwaitingNotification(
  awaiting: Incident[],
): { message: string; description: string } | null {
  if (awaiting.length === 0) return null;
  const latest = awaiting[awaiting.length - 1];
  return {
    message:
      awaiting.length > 1
        ? `姬子有 ${awaiting.length} 项待确认`
        : '姬子诊断出一个可修复的失败',
    description: `节点「${latest.nodeLabel}」失败，已生成候选修复工具，去确认后可重跑画布。`,
  };
}

/** 诊断 LLM 调用的 system + text prompt。 */
export async function buildDiagnosticPrompt(
  incident: Incident,
  cfg: LLMConfig,
  model: string,
  signal?: AbortSignal,
): Promise<{
  system: string;
  text: string;
}> {
  const skillBlock = await buildJiziSkillSystemBlock(
    `节点失败 报错 ${incident.nodeLabel} ${incident.errorDetail}`,
    cfg,
    model,
    signal,
    { requiredIds: ['failure-diagnosis'], autoSelect: false },
  );
  return {
    system: [
      '你是运行失败诊断器，只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释。',
      skillBlock,
    ]
      .filter(Boolean)
      .join('\n\n'),
    text: [
      '一个多 Agent 协同工具的画布节点运行失败了。请根据报错证据分类，不要为了修复而假定缺少工具。',
      `节点名称：${incident.nodeLabel}`,
      `报错信息：${incident.errorDetail}`,
      '只输出 JSON，字段：',
      '- category: string，只能填 missing-tool、tool-parameters、node-configuration、missing-input、model-call、network-or-service 或 unknown。',
      '- confidence: number，0 到 1 之间；没有直接证据时低于 0.7。',
      '- capability: string，缺失的能力简述（中文，如「读取 .xyz 格式文件」）。',
      '- suggestedQuery: string，用于联网搜索现成 Python 库的英文查询词。',
      '- reason: string，一句话判断理由（中文）。',
      '- summary: string，用大白话说明哪里坏了。',
      '- consequence: string，如果不修会造成什么后果。',
      '- fixCost: string，修复代价，填“低”“中”或“高”。',
      '- nextStep: string，下一步建议。',
      '- severity: string，严重程度，填“低”“中”或“高”。',
      '- evidence: string，判断依据，指出你从报错里看到了什么直接证据；category 为 missing-tool 时必须非空。',
      '- likelyCause: string，最可能病因，用大白话说明。',
      '- worthFixing: string，值不值得修，填“值得马上修”“可以稍后修”或“不建议自动修”。',
    ].join('\n'),
  };
}

