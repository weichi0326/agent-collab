import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import { uid } from '../lib/id'; // L5+L6 修复：复用已有 uid() 代替重复的 ID 生成函数
import {
  migrateLegacyMemory,
  type JiziMemoryKind,
  type JiziMemoryRecord,
} from '../lib/jiziMemoryRecords';

// 总 Agent 对话消息与记忆。附件不落盘(File 无法序列化,且图片 base64 会撑爆 localStorage),
// 只在消息里留一份元信息(文件名/是否图片)供气泡展示;真正的文件内容只在发送时读取使用。
// 会话(session)按 ChatGPT 惯例组织:每条会话独立消息流,可新建/切换/删除;记忆全局共享,不随会话删除而丢失。

export type ChatRole = 'user' | 'assistant';
export type MessageStatus = 'sending' | 'done' | 'error' | 'cancelled';

// 联网搜索的参考来源(展示在 AI 回复下方,可点击)
export interface SourceRef {
  title: string;
  link: string;
}

export interface AttachmentMeta {
  name: string;
  isImage: boolean;
}

export interface TurnSkillSummary {
  id: string;
  title: string;
  reason: string;
}

export interface TurnFlowStep {
  label: string;
  status: 'done' | 'skipped' | 'pending';
  detail?: string;
}

export interface ChatMessageMeta {
  routeLabel?: string;
  reason?: string;
  searchLabel?: string;
  modelLabel?: string;
  imageContextLabel?: string;
  skills?: TurnSkillSummary[];
  skillWarning?: string;
  flow?: TurnFlowStep[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: AttachmentMeta[];
  sources?: SourceRef[];
  meta?: ChatMessageMeta;
  status?: MessageStatus;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  contextSummary?: string;
  summarizedMessageCount?: number;
  createdAt: number;
  updatedAt: number;
}

// 记忆:用户画像 / 偏好 / 已知资源(如常用 Agent、画布名)。由姬子按语义筛选后注入系统提示词。
export interface MasterMemory {
  profile: string[];
  preferences: string[];
  resources: string[];
}

export type MemoryKind = keyof MasterMemory;

type MessagePatch = Partial<Pick<ChatMessage, 'content' | 'sources' | 'status' | 'meta'>>;

const DEFAULT_TITLE = '新对话';

// 4.2：单会话消息上限,达到后自动开启延续会话(继承上下文摘要),避免单会话无限膨胀
export const SESSION_MESSAGE_CAP = 100;

// 姬子诊断专用固定会话:所有节点失败诊断/修复日志与确认卡都落这里,与用户正常对话隔离
// (不污染用户会话的 LLM 上下文)。固定 id、不可删除/改名、置顶展示、只读输入、只保留最近 100 条。
export const DIAGNOSIS_SESSION_ID = '__diagnosis__';
export const DIAGNOSIS_SESSION_TITLE = '诊断信息';

// 姬子的默认系统提示词(可在「姬子配置」弹窗里修改,修改后持久化保存)。
export const DEFAULT_SYSTEM_PROMPT = `你是「姬子」，多 Agent 协同工具里的项目级助手。这个工具的核心概念：
- 画布(Canvas)：编排多个 Agent 节点与连线的容器，连线代表数据流向。
- Agent：配置了系统提示词、工具标签、选用某个 LLM、可独立运行的智能体。
- 工具(Tool)：最小执行单元，标签化(如 excel、file-read)。
你的职责是用简体中文，帮助用户理解并规划画布、Agent 与工作流，给出务实、简洁的建议。
你可以把明确的项目内操作整理为受控计划；所有写操作必须先由用户确认，删除操作必须再次确认。不要声称未执行的操作已经完成。超出受控动作集时，说明限制并给出可执行建议。`;

interface MasterAgentState {
  sessions: ChatSession[]; // 最近的排在前面
  activeId: string | null;
  memory: MasterMemory;
  memoryRecords: JiziMemoryRecord[];
  systemPrompt: string;
  systemPromptSourceName: string | null; // 当前提示词来源的文件名;null 表示无关联文件(默认或早期手动编辑)

  newSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  // 达到消息上限时,开一条延续会话并继承上下文摘要,返回新会话 id
  spawnContinuation: (fromId: string) => string;

  addMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  // 定向写入指定会话(编排层异步诊断时用户可能已切走当前会话,不能只写 active)。
  // 会话不存在时返回空串不写入。
  addMessageToSession: (
    sessionId: string,
    msg: Omit<ChatMessage, 'id' | 'createdAt'>,
  ) => string;
  // 写入诊断固定会话:自动确保会话存在,不触发「(续)」会话,只保留最近 SESSION_MESSAGE_CAP 条。
  addDiagnosisMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  // 确保诊断固定会话存在(水合/首次失败前调用),返回其 id。
  ensureDiagnosisSession: () => string;
  updateMessage: (id: string, patch: MessagePatch) => void;
  updateSessionSummary: (
    id: string,
    summary: string,
    summarizedMessageCount: number,
  ) => void;

  addMemory: (kind: MemoryKind, text: string) => void;
  removeMemory: (kind: MemoryKind, index: number) => void;
  organizeMemory: () => void;

  applySystemPrompt: (text: string, sourceName: string | null) => void;
}

// L5+L6 修复：用 uid() 替换功能等价的 newMsgId/newSessionId，消除重复代码
function emptyMemory(): MasterMemory {
  return { profile: [], preferences: [], resources: [] };
}

function recordKind(kind: MemoryKind): JiziMemoryKind {
  if (kind === 'preferences') return 'preference';
  if (kind === 'resources') return 'resource';
  return 'profile';
}

function appendUniqueMemory(
  memory: MasterMemory,
  kind: MemoryKind,
  text: string,
): MasterMemory {
  const t = text.trim();
  if (!t) return memory;
  const exists = memory[kind].some((item) => item.trim() === t);
  if (exists) return memory;
  return { ...memory, [kind]: [...memory[kind], t].slice(-30) };
}

function normalizeMemoryLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function organizeMemoryList(items: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of items) {
    const text = normalizeMemoryLine(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
  }
  return cleaned.slice(-30);
}

function makeSession(): ChatSession {
  const now = Date.now();
  return {
    id: uid('ses'),
    title: DEFAULT_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeDiagnosisSession(): ChatSession {
  const now = Date.now();
  return {
    id: DIAGNOSIS_SESSION_ID,
    title: DIAGNOSIS_SESSION_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

// 从首条用户消息截取标题(去空白,截断到 20 字)
function deriveTitle(content: string): string {
  const t = content.trim().replace(/\s+/g, ' ');
  if (!t) return DEFAULT_TITLE;
  return t.length > 20 ? `${t.slice(0, 20)}…` : t;
}

export const useMasterAgentStore = create<MasterAgentState>()(
  persist(
    (set, get) => ({
      sessions: [makeDiagnosisSession()],
      activeId: null,
      memory: emptyMemory(),
      memoryRecords: [],
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      systemPromptSourceName: null,

      newSession: () => {
        const session = makeSession();
        set((s) => ({
          sessions: [session, ...s.sessions],
          activeId: session.id,
        }));
        return session.id;
      },

      switchSession: (id) => set({ activeId: id }),

      deleteSession: (id) =>
        set((s) => {
          if (id === DIAGNOSIS_SESSION_ID) return s; // 诊断会话不可删除
          const sessions = s.sessions.filter((x) => x.id !== id);
          const activeId =
            s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId;
          return { sessions, activeId };
        }),

      renameSession: (id, title) =>
        set((s) => {
          if (id === DIAGNOSIS_SESSION_ID) return s; // 诊断会话不可改名
          return {
            sessions: s.sessions.map((x) =>
              x.id === id ? { ...x, title: title.trim() || DEFAULT_TITLE } : x,
            ),
          };
        }),

      spawnContinuation: (fromId) => {
        const from = get().sessions.find((x) => x.id === fromId);
        const now = Date.now();
        const cont: ChatSession = {
          id: uid('ses'),
          title: from ? `${from.title}(续)` : DEFAULT_TITLE,
          messages: [],
          // 继承摘要,让延续会话仍能引用之前的对话背景;计数从 0 起(新会话无历史消息)
          contextSummary: from?.contextSummary,
          summarizedMessageCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ sessions: [cont, ...s.sessions], activeId: cont.id }));
        return cont.id;
      },

      addMessage: (msg) => {
        const id = uid('msg');
        const now = Date.now();
        set((s) => {
          // 无活动会话则新建一条,置顶并激活
          let sessions = s.sessions;
          let activeId = s.activeId;
          if (!activeId || !sessions.some((x) => x.id === activeId)) {
            const created = makeSession();
            sessions = [created, ...sessions];
            activeId = created.id;
          }
          // 4.2 兜底:写消息前若当前会话已达上限,先开延续会话(继承摘要)再写,
          // 覆盖取消/确认/自定义值等所有写入路径,确保没有任何路径能越过上限。
          const target = sessions.find((x) => x.id === activeId);
          if (target && target.messages.length >= SESSION_MESSAGE_CAP) {
            const cont: ChatSession = {
              id: uid('ses'),
              title: `${target.title}(续)`,
              messages: [],
              contextSummary: target.contextSummary,
              summarizedMessageCount: 0,
              createdAt: now,
              updatedAt: now,
            };
            sessions = [cont, ...sessions];
            activeId = cont.id;
          }
          const message: ChatMessage = { ...msg, id, createdAt: now };
          sessions = sessions.map((x) => {
            if (x.id !== activeId) return x;
            const isFirstUser =
              msg.role === 'user' &&
              x.title === DEFAULT_TITLE &&
              !x.messages.some((m) => m.role === 'user');
            return {
              ...x,
              title: isFirstUser ? deriveTitle(msg.content) : x.title,
              messages: [...x.messages, message],
              updatedAt: now,
            };
          });
          return { sessions, activeId };
        });
        return id;
      },

      addMessageToSession: (sessionId, msg) => {
        const id = uid('msg');
        const now = Date.now();
        set((s) => {
          const target = s.sessions.find((x) => x.id === sessionId);
          if (!target) return s;
          let sessions = s.sessions;
          // 兜底:目标会话已达上限则先开延续会话(继承摘要),消息写入延续会话。
          let writeId = sessionId;
          if (target.messages.length >= SESSION_MESSAGE_CAP) {
            const cont: ChatSession = {
              id: uid('ses'),
              title: `${target.title}(续)`,
              messages: [],
              contextSummary: target.contextSummary,
              summarizedMessageCount: 0,
              createdAt: now,
              updatedAt: now,
            };
            sessions = [cont, ...sessions];
            writeId = cont.id;
          }
          const message: ChatMessage = { ...msg, id, createdAt: now };
          sessions = sessions.map((x) =>
            x.id === writeId
              ? { ...x, messages: [...x.messages, message], updatedAt: now }
              : x,
          );
          return { sessions };
        });
        return id;
      },

      addDiagnosisMessage: (msg) => {
        const id = uid('msg');
        const now = Date.now();
        set((s) => {
          let sessions = s.sessions;
          if (!sessions.some((x) => x.id === DIAGNOSIS_SESSION_ID)) {
            sessions = [makeDiagnosisSession(), ...sessions];
          }
          const message: ChatMessage = { ...msg, id, createdAt: now };
          sessions = sessions.map((x) =>
            x.id === DIAGNOSIS_SESSION_ID
              ? {
                  ...x,
                  // 只保留最近 CAP 条,超出裁最旧;绝不开「(续)」会话,保持单条固定日志。
                  messages: [...x.messages, message].slice(-SESSION_MESSAGE_CAP),
                  updatedAt: now,
                }
              : x,
          );
          return { sessions };
        });
        return id;
      },

      ensureDiagnosisSession: () => {
        set((s) =>
          s.sessions.some((x) => x.id === DIAGNOSIS_SESSION_ID)
            ? s
            : { sessions: [makeDiagnosisSession(), ...s.sessions] },
        );
        return DIAGNOSIS_SESSION_ID;
      },

      updateMessage: (id, patch) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.messages.some((m) => m.id === id)
              ? {
                  ...x,
                  messages: x.messages.map((m) =>
                    m.id === id ? { ...m, ...patch } : m,
                  ),
                  updatedAt: Date.now(),
                }
              : x,
          ),
        })),

      updateSessionSummary: (id, summary, summarizedMessageCount) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  contextSummary: summary.trim() || undefined,
                  summarizedMessageCount,
                  updatedAt: Date.now(),
                }
              : x,
          ),
        })),

      addMemory: (kind, text) => {
        set((s) => {
          const content = normalizeMemoryLine(text);
          const mappedKind = recordKind(kind);
          const exists = s.memoryRecords.some(
            (record) =>
              record.status === 'active' &&
              record.kind === mappedKind &&
              record.content.toLocaleLowerCase() === content.toLocaleLowerCase(),
          );
          const now = Date.now();
          return {
            memory: appendUniqueMemory(s.memory, kind, text),
            memoryRecords:
              !content || exists
                ? s.memoryRecords
                : [
                    ...s.memoryRecords,
                    {
                      id: uid('mem'),
                      kind: mappedKind,
                      content,
                      source: { origin: 'conversation' },
                      createdAt: now,
                      updatedAt: now,
                      confidence: 0.8,
                      scope: 'global',
                      status: 'active',
                    },
                  ],
          };
        });
      },

      removeMemory: (kind, index) =>
        set((s) => {
          const removed = s.memory[kind][index];
          const mappedKind = recordKind(kind);
          return {
            memory: {
            ...s.memory,
            [kind]: s.memory[kind].filter((_, i) => i !== index),
          },
            memoryRecords: s.memoryRecords.map((record) =>
              record.kind === mappedKind && record.content === removed
                ? { ...record, status: 'superseded' as const, updatedAt: Date.now() }
                : record,
            ),
          };
        }),

      organizeMemory: () =>
        set((s) => ({
          memory: {
            profile: organizeMemoryList(s.memory.profile),
            preferences: organizeMemoryList(s.memory.preferences),
            resources: organizeMemoryList(s.memory.resources),
          },
        })),

      applySystemPrompt: (text, sourceName) => {
        const trimmed = text.trim();
        set({
          systemPrompt: trimmed || DEFAULT_SYSTEM_PROMPT,
          systemPromptSourceName: trimmed ? sourceName : null,
        });
      },
    }),
    {
      name: 'multi-agent-master',
      storage: createProjectStorage(),
      version: 6,
      migrate: (persisted, version) => {
        try {
        const state = (persisted ?? {}) as Record<string, unknown>;
        let next: Record<string, unknown> = state;
        if (version < 2) {
          // v1 是扁平 messages[];迁移为单条会话
          const oldMsgs = Array.isArray(state.messages)
            ? (state.messages as ChatMessage[])
            : [];
          const memory = (state.memory as MasterMemory) ?? emptyMemory();
          if (oldMsgs.length === 0) {
            next = { sessions: [], activeId: null, memory };
          } else {
            const now = Date.now();
            const firstUser = oldMsgs.find((m) => m.role === 'user');
            const session: ChatSession = {
              id: uid('ses'),
              title: firstUser ? deriveTitle(firstUser.content) : DEFAULT_TITLE,
              messages: oldMsgs,
              createdAt: now,
              updatedAt: now,
            };
            next = { sessions: [session], activeId: session.id, memory };
          }
        }
        if (version < 3) {
          const withPrompt = next as { systemPrompt?: string };
          next = {
            ...next,
            systemPrompt: withPrompt.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          };
        }
        if (version < 4) {
          next = { ...next, systemPromptSourceName: null };
        }
        if (version < 5) {
          const sessions = Array.isArray((next as { sessions?: unknown }).sessions)
            ? ((next as { sessions: ChatSession[] }).sessions ?? [])
            : [];
          next = {
            ...next,
            sessions: sessions.map((session) => ({
              ...session,
              contextSummary: session.contextSummary ?? undefined,
              summarizedMessageCount: session.summarizedMessageCount ?? 0,
            })),
          };
        }
        if (version < 6) {
          const memory = (next.memory as MasterMemory | undefined) ?? emptyMemory();
          next = {
            ...next,
            memory,
            memoryRecords: migrateLegacyMemory(memory, Date.now(), () => uid('mem')),
          };
        }
        return next;
        } catch {
          return {
            sessions: [],
            activeId: null,
            memory: emptyMemory(),
            memoryRecords: [],
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            systemPromptSourceName: null,
          };
        }
      },
      // 水合后确保诊断固定会话存在(老用户持久化数据里没有它)。
      onRehydrateStorage: () => (state) => {
        if (state && !state.sessions.some((x) => x.id === DIAGNOSIS_SESSION_ID)) {
          state.sessions = [makeDiagnosisSession(), ...state.sessions];
        }
      },
    },
  ),
);


