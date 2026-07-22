import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import type { TestStatus } from '../lib/llmClient';
import { CUSTOM_ID } from '../lib/providers';
import { clockTime } from '../lib/time';
import { inferModelCaps, mergeInferredModelCaps } from '../lib/modelCapabilityInfer';

// 子模型能力:声明给 agent,决定该模型是否支持长上下文/图像/语音
export interface ModelCaps {
  longContext: boolean; // 长上下文(1M)
  vision: boolean; // 视觉/图像
  audio: boolean; // 语音/音频
}

export interface ModelEntry {
  id: string; // 真实模型 id(调用用,不可改)
  label?: string; // 用户自定义显示名/备注
  enabled: boolean;
  caps: ModelCaps;
}

export interface TestResult {
  status: 'idle' | 'testing' | TestStatus;
  latencyMs?: number;
  at?: string;
}

export interface ProviderConfig {
  id: string; // 唯一实例 id(同厂商可多份)
  providerId: string; // 来源预设 id(决定协议/默认地址);自定义为 'custom'
  name: string; // 展示名/备注(可自定义)
  apiKey: string;
  baseURL: string;
  starred: boolean; // 精选置顶
  starredAt?: number; // 标星时间(用于置顶排序)
  models: ModelEntry[];
  test: TestResult;
}

type ProviderPatch = Partial<Pick<ProviderConfig, 'name' | 'apiKey' | 'baseURL'>>;

interface ModelState {
  configs: ProviderConfig[];

  addProvider: (
    providerId: string,
    name: string,
    apiKey: string,
    baseURL: string,
  ) => string; // 返回新实例 id
  updateProvider: (id: string, patch: ProviderPatch) => void;
  removeProvider: (id: string) => void;
  toggleStar: (id: string) => void;

  setModels: (id: string, ids: string[]) => void;
  addModel: (id: string, modelId: string) => void;
  removeModel: (id: string, modelId: string) => void;
  toggleModel: (id: string, modelId: string, enabled: boolean) => void;
  renameModel: (id: string, modelId: string, label: string) => void;
  toggleCap: (id: string, modelId: string, cap: keyof ModelCaps) => void;
  inferCaps: (id: string, modelId: string) => void;

  setTest: (id: string, test: TestResult) => void;
}

function newId(): string {
  return `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// 更新指定实例的某个模型
function mapModel(
  configs: ProviderConfig[],
  id: string,
  modelId: string,
  fn: (m: ModelEntry) => ModelEntry,
): ProviderConfig[] {
  return configs.map((c) =>
    c.id === id
      ? { ...c, models: c.models.map((m) => (m.id === modelId ? fn(m) : m)) }
      : c,
  );
}

function normalizeModelCapsInConfig(config: ProviderConfig): ProviderConfig {
  return {
    ...config,
    models: config.models.map((model) => ({
      ...model,
      caps: mergeInferredModelCaps(model.caps, model.id),
    })),
  };
}

export const useModelStore = create<ModelState>()(
  persist(
    (set) => ({
      configs: [],

      addProvider: (providerId, name, apiKey, baseURL) => {
        const id = newId();
        set((s) => ({
          configs: [
            ...s.configs,
            {
              id,
              providerId,
              name,
              apiKey,
              baseURL,
              starred: false,
              models: [],
              test: { status: 'idle' },
            },
          ],
        }));
        return id;
      },

      updateProvider: (id, patch) =>
        set((s) => ({
          configs: s.configs.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        })),

      removeProvider: (id) =>
        set((s) => ({ configs: s.configs.filter((c) => c.id !== id) })),

      toggleStar: (id) =>
        set((s) => ({
          configs: s.configs.map((c) =>
            c.id === id
              ? {
                  ...c,
                  starred: !c.starred,
                  starredAt: !c.starred ? Date.now() : undefined,
                }
              : c,
          ),
        })),

      // 合并拉取到的模型:保留已有模型的 enabled / label / caps,
      // 并保留用户此前手动添加、但不在本次 API 返回里的模型(避免静默丢失)。
      setModels: (id, ids) =>
        set((s) => ({
          configs: s.configs.map((c) => {
            if (c.id !== id) return c;
            const fetched = new Set(ids);
            const merged = ids.map((mid) => {
              const old = c.models.find((m) => m.id === mid);
              return old ?? { id: mid, enabled: true, caps: inferModelCaps(mid) };
            });
            // 追加不在本次返回中的既有模型(手动添加或上次拉取残留)
            const kept = c.models.filter((m) => !fetched.has(m.id));
            return { ...c, models: [...merged, ...kept] };
          }),
        })),

      addModel: (id, modelId) =>
        set((s) => ({
          configs: s.configs.map((c) => {
            if (c.id !== id) return c;
            if (c.models.some((m) => m.id === modelId)) return c;
            return {
              ...c,
              models: [
                ...c.models,
                { id: modelId, enabled: true, caps: inferModelCaps(modelId) },
              ],
            };
          }),
        })),

      removeModel: (id, modelId) =>
        set((s) => ({
          configs: s.configs.map((c) =>
            c.id === id
              ? { ...c, models: c.models.filter((m) => m.id !== modelId) }
              : c,
          ),
        })),

      toggleModel: (id, modelId, enabled) =>
        set((s) => ({
          configs: mapModel(s.configs, id, modelId, (m) => ({ ...m, enabled })),
        })),

      renameModel: (id, modelId, label) =>
        set((s) => ({
          configs: mapModel(s.configs, id, modelId, (m) => ({
            ...m,
            label: label.trim() || undefined,
          })),
        })),

      toggleCap: (id, modelId, cap) =>
        set((s) => ({
          configs: mapModel(s.configs, id, modelId, (m) => ({
            ...m,
            caps: { ...m.caps, [cap]: !m.caps[cap] },
          })),
        })),

      inferCaps: (id, modelId) =>
        set((s) => ({
          configs: mapModel(s.configs, id, modelId, (m) => ({
            ...m,
            caps: inferModelCaps(modelId),
          })),
        })),

      setTest: (id, test) =>
        set((s) => ({
          configs: s.configs.map((c) =>
            c.id === id
              ? { ...c, test: { ...test, at: test.at ?? clockTime() } }
              : c,
          ),
        })),
    }),
    {
      name: 'multi-agent-models',
      storage: createProjectStorage(),
      version: 2,
      // L7 修复：migrate 用 try-catch 包裹，损坏的持久化数据只会触发重置而非崩溃
      migrate: (persisted: unknown, version: number) => {
        try {
          if (version >= 1) {
            const current = persisted as { configs?: ProviderConfig[] } | null;
            return {
              configs: Array.isArray(current?.configs)
                ? current!.configs.map(normalizeModelCapsInConfig)
                : [],
            };
          }
          const old = persisted as { configs?: unknown[] } | null;
          const list = Array.isArray(old?.configs) ? old!.configs : [];
          const configs: ProviderConfig[] = list.map((raw, i) => {
            const c = raw as Record<string, unknown>;
            const models = Array.isArray(c.models) ? c.models : [];
            return {
              id:
                typeof c.id === 'string'
                  ? c.id
                  : `cfg_${Date.now()}_${i}`,
              providerId:
                typeof c.providerId === 'string' ? c.providerId : CUSTOM_ID,
              name: typeof c.name === 'string' ? c.name : '未命名配置',
              apiKey: typeof c.apiKey === 'string' ? c.apiKey : '',
              baseURL: typeof c.baseURL === 'string' ? c.baseURL : '',
              starred: false,
              models: models.map((m) => {
                const mm = m as Record<string, unknown>;
                return {
                  id: String(mm.id ?? ''),
                  label: typeof mm.label === 'string' ? mm.label : undefined,
                  enabled: mm.enabled !== false,
                  caps: mergeInferredModelCaps(
                    mm.caps && typeof mm.caps === 'object' ? mm.caps as ModelCaps : undefined,
                    String(mm.id ?? ''),
                  ),
                };
              }),
              test: { status: 'idle' },
            };
          });
          return { configs: configs.map(normalizeModelCapsInConfig) };
        } catch (e) {
          console.error('[modelStore] migrate 失败，重置为空配置', e);
          return { configs: [] };
        }
      },
    },
  ),
);

export interface EnabledModel {
  configId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string; // 展示名(优先 label,回落 modelId)
  caps: ModelCaps;
}

// 供后续 agent 选模型使用:所有已启用模型(含能力标签)
// 注意:selector 只取原始的 configs 引用(状态不变时引用稳定),派生数组放 useMemo 计算,
// 避免每次渲染都返回新数组/新对象触发 useSyncExternalStore 无限重渲染(Maximum update depth exceeded → 白屏)
export function useEnabledModels(): EnabledModel[] {
  const configs = useModelStore((s) => s.configs);
  return useMemo(
    () =>
      configs.flatMap((c) =>
        c.models
          .filter((m) => m.enabled)
          .map((m) => ({
            configId: c.id,
            providerId: c.providerId,
            providerName: c.name,
            modelId: m.id,
            label: m.label || m.id,
            caps: m.caps,
          })),
      ),
    [configs],
  );
}

export interface ModelOption {
  value: string; // `configId::modelId`
  label: string;
}

// 已启用模型 → Select 选项。withProvider 为真时在标签后附厂商名(属性面板/Agent 配置用),
// 总控面板只显示模型名。派生数组用 useMemo,遵循上面的引用稳定约定。
export function useModelOptions(withProvider = true): ModelOption[] {
  const models = useEnabledModels();
  return useMemo(
    () =>
      models.map((m) => ({
        value: `${m.configId}::${m.modelId}`,
        label: withProvider ? `${m.label}（${m.providerName}）` : m.label,
      })),
    [models, withProvider],
  );
}

