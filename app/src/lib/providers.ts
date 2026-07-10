// 模型厂商预置清单:以 chip 网格展示,点选后自动带出 baseURL 与接口协议,只需再填密钥。
// 分两组:official = 各家官方 API;relay = 三方中转/聚合平台(OpenAI 兼容)。
// 名单外的中转商统一通过「自定义配置」添加(可命名、可多个)。

export type ProviderApi = 'openai' | 'anthropic' | 'gemini';
export type ProviderGroup = 'official' | 'relay';

export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string; // 为空表示需用户手填
  api: ProviderApi;
  group?: ProviderGroup;
  defaultModels?: string[]; // 拉不到列表时的兜底
}

export const CUSTOM_ID = 'custom';

export const PROVIDERS: ProviderPreset[] = [
  // ===== 官方 API =====
  {
    id: 'qwen',
    name: '通义千问 Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai',
    group: 'official',
    defaultModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai',
    group: 'official',
    defaultModels: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    baseURL: 'https://api.deepseek.com/v1',
    api: 'openai',
    group: 'official',
    defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    baseURL: 'https://api.moonshot.cn/v1',
    api: 'openai',
    group: 'official',
    defaultModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    api: 'openai',
    group: 'official',
    defaultModels: ['abab6.5s-chat', 'abab6.5g-chat'],
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    baseURL: 'https://api.xiaomimimo.com/v1',
    api: 'openai',
    group: 'official',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    api: 'openai',
    group: 'official',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    baseURL: 'https://api.anthropic.com/v1',
    api: 'anthropic',
    group: 'official',
    defaultModels: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    api: 'gemini',
    group: 'official',
    defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'grok',
    name: 'Grok (xAI)',
    baseURL: 'https://api.x.ai/v1',
    api: 'openai',
    group: 'official',
    defaultModels: ['grok-3', 'grok-3-mini'],
  },

  // ===== 三方中转 / 聚合平台(OpenAI 兼容) =====
  {
    id: 'siliconflow',
    name: 'SiliconFlow 硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    api: 'openai',
    group: 'relay',
    defaultModels: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    api: 'openai',
    group: 'relay',
    defaultModels: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'],
  },
  {
    id: 'together',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    api: 'openai',
    group: 'relay',
    defaultModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  },
];

export function getProvider(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
