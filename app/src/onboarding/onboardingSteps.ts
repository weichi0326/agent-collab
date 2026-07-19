import type { SettingsSection } from '../settings/settingsCatalog';

export interface GuidedStep {
  key: string;
  title: string;
  description: string;
  target: string;
  allowedTargets?: readonly string[];
  requirement?: string;
}

export function interactionTargets(step: GuidedStep): readonly string[] {
  return step.allowedTargets ?? [step.target];
}

export const MODEL_STEPS: readonly GuidedStep[] = [
  {
    key: 'model-entry',
    title: '模型服务',
    description: '所有 Agent 和姬子都需要模型才能工作。先完成一个可用配置。',
    target: 'settings-models',
  },
  {
    key: 'model-provider',
    title: '选择服务商',
    description: '选择官方服务商、第三方中转或自定义兼容接口。',
    target: 'model-provider-list',
  },
  {
    key: 'model-credentials',
    title: '保存连接信息',
    description: '填写接口地址和密钥并保存。已填写内容不会被引导复制。',
    target: 'model-credentials',
    requirement: 'saved-provider',
  },
  {
    key: 'model-list',
    title: '启用模型',
    description: '获取或手动添加模型，并确保至少一个模型处于启用状态。',
    target: 'model-list',
    requirement: 'enabled-model',
  },
  {
    key: 'model-test',
    title: '测试模型连接',
    description: '执行真实通信测试。只有测试成功后才能进入示例工作流。',
    target: 'model-test',
    requirement: 'validated-model',
  },
];

export const CAPABILITY_STEPS: readonly (GuidedStep & {
  section: SettingsSection;
})[] = [
  {
    key: 'search',
    section: 'search',
    title: '联网搜索',
    description: '需要实时资料时，可为 Agent 或姬子启用联网搜索。此项可以稍后配置。',
    target: 'settings-search',
  },
  {
    key: 'tools',
    section: 'tools',
    title: '工具库',
    description: '工具让节点能够读写文件、处理文档和执行外部操作。',
    target: 'settings-tools',
  },
  {
    key: 'jizi',
    section: 'jizi',
    title: '姬子配置',
    description: '在这里管理姬子的模型、人格、记忆、Skill、自动诊断与显示模式。',
    target: 'settings-jizi',
  },
];

export const TUTORIAL_STEPS: readonly GuidedStep[] = [
  {
    key: 'first-agent',
    title: '拖入需求分析师',
    description: '把教程 Agent“需求分析师”拖到中央画布。',
    target: 'tutorial-agent-first',
    allowedTargets: ['tutorial-agent-first', 'canvas-surface'],
    requirement: 'first-agent',
  },
  {
    key: 'second-agent',
    title: '拖入方案整理员',
    description: '再把“方案整理员”拖入画布，放在第一个节点右侧。',
    target: 'tutorial-agent-second',
    allowedTargets: ['tutorial-agent-second', 'canvas-surface'],
    requirement: 'second-agent',
  },
  {
    key: 'connection',
    title: '建立执行顺序',
    description: '从需求分析师拖出连线，连接到方案整理员。',
    target: 'canvas-surface',
    requirement: 'connection',
  },
  {
    key: 'inspect-properties',
    title: '查看节点属性',
    description: '选中节点后，可在右侧查看模型、数据来源、输出格式和补充提示词。',
    target: 'properties-panel',
    allowedTargets: ['canvas-surface', 'properties-panel'],
    requirement: 'inspect-properties',
  },
  {
    key: 'saved-canvas',
    title: '保存示例画布',
    description: '保存当前画布。首次保存时可以直接使用“新手示例画布”作为名称。',
    target: 'canvas-save',
    requirement: 'saved-canvas',
  },
  {
    key: 'optional-run',
    title: '按需运行工作流',
    description: '数据来源已经配置好时，可以点击运行验证工作流；也可以直接进入下一步，稍后完善数据来源再运行。',
    target: 'canvas-run',
    requirement: 'optional-run',
  },
  {
    key: 'use-jizi',
    title: '使用姬子',
    description: '点击姬子展开协作面板。你可以让她规划工作流、协助配置节点，或诊断运行中遇到的问题。',
    target: 'jizi-entry',
    allowedTargets: ['jizi-entry', 'jizi-panel'],
    requirement: 'use-jizi',
  },
];
