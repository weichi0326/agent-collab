import type {
  JiziEvaluationCase,
  JiziEvaluationCategory,
} from './types';

const GOALS: Record<JiziEvaluationCategory, string[]> = {
  canvas: [
    '创建研究画布', '重命名当前画布', '添加两个节点', '连接上下游节点',
    '修改节点输出格式', '删除指定节点', '运行当前画布并验证',
  ],
  agent: [
    '创建研究 Agent', '修改 Agent 描述', '修改 Agent 系统提示词',
    '切换 Agent 模型', '增加 Agent 工具标签', '同步节点 Agent 配置', '拒绝不存在的 Agent',
  ],
  tool: [
    '生成自定义工具候选', '拒绝无证据工具生成', '覆盖自定义工具', '删除自定义工具',
    '拒绝覆盖内置工具', '工具试运行失败后修正', '工具恢复旧版本',
  ],
  recovery: [
    '补齐已有工具标签并重跑', '节点临时错误后重试', '配置错误不生成工具',
    '缺输入时停止诊断', '模型错误给出证据', '服务不可用时停止', '修复后验证运行结果',
  ],
  search: [
    '搜索最新官方文档', '正文失败时使用摘要', '拒绝私网网页', '限制网页响应大小',
    '识别官方来源', '标注单一来源不足', '两个来源交叉验证',
  ],
  memory: [
    '迁移旧用户画像', '记录长期偏好', '新偏好覆盖旧偏好', '冲突偏好暂停使用',
    '过期记忆不注入', '项目记忆隔离', '删除记忆后不再使用',
  ],
  correction: [
    '用户改口后重新规划', '用户修改目标画布', '用户修改 Agent 名称',
    '用户撤回工具需求', '用户缩小任务范围', '新写操作重新确认', '超过重新规划上限停止',
  ],
  cancellation: [
    '规划时取消', '普通确认时取消', '删除最终确认时取消', '执行前取消',
    '运行画布时取消', '搜索正文时取消', '取消后不执行排队步骤',
  ],
  rollback: [
    '第二步失败恢复画布', 'Agent 修改失败恢复', '工具覆盖后续失败恢复旧版',
    '工具删除后续失败恢复', '回滚失败保留原错误', '运行失败恢复配置', '半成品节点全部清理',
  ],
};

export const JIZI_EVALUATION_CASES: JiziEvaluationCase[] = (
  Object.entries(GOALS) as Array<[JiziEvaluationCategory, string[]]>
).flatMap(([category, goals]) =>
  goals.map((goal, index) => ({
    id: `${category}-${String(index + 1).padStart(2, '0')}`,
    category,
    goal,
    expectedTerminalStatus:
      category === 'cancellation'
        ? 'cancelled'
        : goal.includes('拒绝') || goal.includes('上限')
          ? 'failed'
          : 'completed',
    expectedEvidenceCode: `${category}:${index + 1}`,
    maxSteps: Math.min(8, index + 1),
    requiresConfirmation: !['search', 'memory'].includes(category),
    requiresSecondConfirmation:
      goal.includes('删除') || goal.includes('最终确认'),
  })),
);
