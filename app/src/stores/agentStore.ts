import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '../lib/id';
import { createProjectStorage } from '../lib/tauriStorage';
import { normalizeToolTags } from '../lib/toolTagMigration';

// Agent 定义:画布节点只引用其 id(见开发清单 7.2),LLM 只存引用不含密钥。
export interface AgentDef {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolTags: string[]; // 取值来自工具标签 value
  modelRef: { configId: string; modelId: string } | null; // 指向 modelStore 某条已启用模型
  version: number; // Agent 定义自身的 schema 版本
  inputSchemaText?: string;
  outputSchemaText?: string;
  createdAt: number;
  updatedAt: number;
}

// 画布节点 data 中与 Agent 关联的部分:agentId 是事实源,label 为缓存/回退显示名
export interface AgentNodeRef {
  agentId?: string;
  label?: string;
}

// 新建 Agent 时可填充的字段(不含 id/version/时间戳)
export type AgentDraft = Pick<
  AgentDef,
  | 'name'
  | 'description'
  | 'systemPrompt'
  | 'toolTags'
  | 'modelRef'
  | 'inputSchemaText'
  | 'outputSchemaText'
>;

// 预置模板:不自动播种(避免删光后又冒出),由「新建 Agent」下拉主动实例化
export const PRESET_TEMPLATES: { key: string; label: string; draft: AgentDraft }[] =
  [
    {
      key: 'req-analyst',
      label: '需求分析师',
      draft: {
        name: '需求分析师',
        description: '解析需求文档,提炼可测试的功能点与验收要点。',
        systemPrompt:
          '你是一名资深需求分析师。请阅读用户提供的需求文档,提炼其中的功能点、边界条件与验收标准,按优先级(高/中/低)组织输出,语言简洁准确。',
        toolTags: ['file', 'docx', 'pdf-read', 'llm-calling'],
        modelRef: null,
      },
    },
    {
      key: 'test-case-gen',
      label: '测试用例生成器',
      draft: {
        name: '测试用例生成器',
        description: '基于功能点批量生成结构化测试用例。',
        systemPrompt:
          '你是一名测试用例设计专家。根据输入的功能点,生成覆盖正常、边界、异常场景的测试用例,每条包含用例标题、前置条件、操作步骤、预期结果与优先级。',
        toolTags: ['file', 'excel', 'llm-calling'],
        modelRef: null,
      },
    },
    {
      key: 'bug-report-gen',
      label: 'Bug 报告生成器',
      draft: {
        name: 'Bug 报告生成器',
        description: '把零散的问题描述整理成规范的缺陷报告。',
        systemPrompt:
          '你是一名测试工程师。请把用户提供的问题描述整理为规范缺陷报告,包含标题、复现步骤、实际结果、预期结果、严重级别与环境信息,措辞客观。',
        toolTags: ['file', 'llm-calling'],
        modelRef: null,
      },
    },
  ];

// L4 修复：blankDraft 只是 emptyDraft 的无意义包装，合并为一个导出函数
export function blankDraft(): AgentDraft {
  return {
    name: '',
    description: '',
    systemPrompt: '',
    toolTags: [],
    modelRef: null,
    inputSchemaText: '',
    outputSchemaText: '',
  };
}

type AgentPatch = Partial<AgentDraft>;

interface AgentState {
  agents: AgentDef[];
  addAgent: (draft: AgentDraft) => string; // 返回新 id
  updateAgent: (id: string, patch: AgentPatch) => void;
  removeAgent: (id: string) => void;
  cloneAgent: (id: string) => string | null; // 返回副本 id,源不存在返回 null
  reorderAgent: (fromId: string, toId: string) => void;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set) => ({
      agents: [],

      addAgent: (draft) => {
        const id = uid('agent');
        const now = Date.now();
        const agent: AgentDef = {
          id,
          name: draft.name,
          description: draft.description,
          systemPrompt: draft.systemPrompt,
          toolTags: draft.toolTags,
          modelRef: draft.modelRef,
          inputSchemaText: draft.inputSchemaText,
          outputSchemaText: draft.outputSchemaText,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ agents: [agent, ...s.agents] }));
        return id;
      },

      updateAgent: (id, patch) =>
        set((s) => ({
          agents: s.agents.map((a) =>
            a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
          ),
        })),

      removeAgent: (id) =>
        set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),

      reorderAgent: (fromId, toId) =>
        set((s) => {
          if (fromId === toId) return s;
          const fromIndex = s.agents.findIndex((a) => a.id === fromId);
          const toIndex = s.agents.findIndex((a) => a.id === toId);
          if (fromIndex < 0 || toIndex < 0) return s;
          const agents = [...s.agents];
          const [moved] = agents.splice(fromIndex, 1);
          agents.splice(toIndex, 0, moved);
          return { agents };
        }),

      // L3 修复：使用 set 回调的 s 参数代替 getState()，避免 Zustand 反模式
      cloneAgent: (id) => {
        let newId: string | null = null;
        const now = Date.now();
        set((s) => {
          const src = s.agents.find((a) => a.id === id);
          if (!src) return s;
          newId = uid('agent');
          const copy: AgentDef = {
            ...src,
            id: newId,
            name: `${src.name} 副本`,
            toolTags: [...src.toolTags],
            modelRef: src.modelRef ? { ...src.modelRef } : null,
            createdAt: now,
            updatedAt: now,
          };
          return { agents: [copy, ...s.agents] };
        });
        return newId;
      },
    }),
    {
      name: 'multi-agent-agents',
      storage: createProjectStorage(),
      version: 2,
      // v1→v2:读写分离旧标签(file-read/file-write/docx-read/…)归一为 file/docx。
      migrate: (persisted, version) => {
        if (typeof persisted !== 'object' || persisted === null) {
          return {} as Partial<AgentState>;
        }
        const s = persisted as Partial<AgentState>;
        if (version < 2 && Array.isArray(s.agents)) {
          s.agents = s.agents.map((a) => ({
            ...a,
            toolTags: normalizeToolTags((a as AgentDef).toolTags),
          }));
        }
        return s;
      },
    },
  ),
);
