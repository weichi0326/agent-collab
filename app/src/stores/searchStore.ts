import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import {
  SEARCH_PROVIDERS,
  DEFAULT_SEARCH_ORDER,
  getSearchProvider,
  type SearchApi,
} from '../lib/searchProviders';

// 多家搜索厂商配置 + 优先级顺序。Key 明文存 localStorage(个人使用,与 LLM 配置同思路)。
// 发送时按 order 顺序取「已启用且填了 Key」的厂商,逐家尝试(见 searchClient.searchWithFailover)。

interface ProviderState {
  apiKey: string;
  enabled: boolean;
}

interface SearchState {
  configs: Record<string, ProviderState>;
  order: string[]; // 优先级,靠前先用
  setKey: (providerId: string, key: string) => void;
  setEnabled: (providerId: string, enabled: boolean) => void;
  move: (providerId: string, dir: -1 | 1) => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      configs: {},
      order: [...DEFAULT_SEARCH_ORDER],

      setKey: (providerId, key) =>
        set((s) => ({
          configs: {
            ...s.configs,
            [providerId]: {
              apiKey: key.trim(),
              enabled: s.configs[providerId]?.enabled ?? false,
            },
          },
        })),

      setEnabled: (providerId, enabled) =>
        set((s) => ({
          configs: {
            ...s.configs,
            [providerId]: {
              apiKey: s.configs[providerId]?.apiKey ?? '',
              enabled,
            },
          },
        })),

      move: (providerId, dir) =>
        set((s) => {
          const order = orderedIds(s.order);
          const i = order.indexOf(providerId);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= order.length) return {};
          const next = [...order];
          [next[i], next[j]] = [next[j], next[i]];
          return { order: next };
        }),
    }),
    {
      name: 'multi-agent-search',
      storage: createProjectStorage(),
      version: 2,
      migrate: (persisted, version) => {
        // v1 只有单个 serperKey;迁到 v2 的多厂商结构
        if (version < 2 && persisted && typeof persisted === 'object') {
          const old = persisted as { serperKey?: string };
          return {
            configs: old.serperKey
              ? { serper: { apiKey: old.serperKey, enabled: true } }
              : {},
            order: [...DEFAULT_SEARCH_ORDER],
          } as SearchState;
        }
        return persisted as SearchState;
      },
    },
  ),
);

// 把持久化的 order 规整成:已知 id 保序 + 名单里新增但 order 缺失的追加在后
export function orderedIds(order: string[]): string[] {
  const known = order.filter((id) => getSearchProvider(id));
  const missing = SEARCH_PROVIDERS.map((p) => p.id).filter(
    (id) => !known.includes(id),
  );
  return [...known, ...missing];
}

export interface ActiveSearchEntry {
  providerId: string;
  api: SearchApi;
  apiKey: string;
}

// 按优先级取「已启用且填了 Key」的厂商,供故障转移链使用。纯函数,不做 hook。
export function activeSearchEntries(state: SearchState): ActiveSearchEntry[] {
  return orderedIds(state.order)
    .map((id) => {
      const preset = getSearchProvider(id);
      const cfg = state.configs[id];
      return preset && cfg?.enabled && cfg.apiKey
        ? { providerId: id, api: preset.api, apiKey: cfg.apiKey }
        : null;
    })
    .filter((e): e is ActiveSearchEntry => e !== null);
}

// 是否至少有一家可用(供禁用「联网搜索」开关判断)。返回布尔,做 selector 安全。
export function hasConfiguredSearch(state: SearchState): boolean {
  return Object.entries(state.configs).some(
    ([id, cfg]) => getSearchProvider(id) && cfg.enabled && !!cfg.apiKey,
  );
}
