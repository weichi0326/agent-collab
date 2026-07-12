export type SettingsSection = 'models' | 'search' | 'jizi' | 'tools' | 'system';

export type SettingsGroup = 'AI 能力' | '姬子' | '扩展' | '系统';

export interface SettingsCatalogItem {
  id: SettingsSection;
  group: SettingsGroup;
  title: string;
  description: string;
  keywords: readonly string[];
}

export const SETTINGS_CATALOG: SettingsCatalogItem[] = [
  {
    id: 'models',
    group: 'AI 能力',
    title: '模型服务',
    description: '管理模型厂商、接口地址、密钥和可用模型。',
    keywords: ['厂商', 'API Key', 'BaseURL', '模型', '密钥', '中转'],
  },
  {
    id: 'search',
    group: 'AI 能力',
    title: '联网搜索',
    description: '配置搜索厂商、密钥、启用状态和优先级。',
    keywords: ['搜索', 'API Key', 'Key', '优先级', 'Serper', 'Tavily', 'Brave'],
  },
  {
    id: 'jizi',
    group: '姬子',
    title: '姬子配置',
    description: '管理人格、长期记忆和节点失败自动诊断。',
    keywords: ['人格', '提示词', '记忆', '诊断', '系统提示词'],
  },
  {
    id: 'tools',
    group: '扩展',
    title: '工具库',
    description: '查看内置与自定义工具及 Python 服务状态。',
    keywords: ['工具', 'Python', '依赖', '能力', '注册'],
  },
  {
    id: 'system',
    group: '系统',
    title: '系统与数据',
    description: '查看版本、环境、目录、日志和本地数据占用。',
    keywords: ['Python', '日志', '输出', '环境', '数据目录', '版本', '后台'],
  },
];

export function filterSettingsCatalog(query: string): SettingsCatalogItem[] {
  const keyword = query.trim().toLocaleLowerCase('zh-CN');
  if (!keyword) return SETTINGS_CATALOG;
  return SETTINGS_CATALOG.filter((item) =>
    [item.title, item.description, ...item.keywords]
      .join('\n')
      .toLocaleLowerCase('zh-CN')
      .includes(keyword),
  );
}
