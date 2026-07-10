// 联网搜索厂商预置清单。多家配置 + 优先级排序,发送时按序故障转移(一家失败/额度耗尽自动换下一家)。
// 各家协议不同,归一化逻辑在 searchClient.ts 里按 api 分派。

export type SearchApi = 'serper' | 'tavily' | 'brave';

export interface SearchProviderPreset {
  id: string;
  name: string;
  api: SearchApi;
  signup: string; // 注册获取 Key 的地址
  freeNote: string; // 免费额度说明(以官网为准)
}

// 数组顺序即默认优先级:Tavily > Brave > Serper
export const SEARCH_PROVIDERS: SearchProviderPreset[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    api: 'tavily',
    signup: 'https://tavily.com',
    freeNote: '约 1000 次/月,按月刷新,为 AI 检索设计',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    api: 'brave',
    signup: 'https://brave.com/search/api/',
    freeNote: '约 2000 次/月,按月刷新,独立索引',
  },
  {
    id: 'serper',
    name: 'Serper',
    api: 'serper',
    signup: 'https://serper.dev',
    freeNote: 'Google 结果,2500 次一次性赠额',
  },
];

export const DEFAULT_SEARCH_ORDER = SEARCH_PROVIDERS.map((p) => p.id);

export function getSearchProvider(id: string): SearchProviderPreset | undefined {
  return SEARCH_PROVIDERS.find((p) => p.id === id);
}
