import { useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import {
  useEnabledModels,
  useModelOptions,
  useModelStore,
} from '../stores/modelStore';
import { packModelRef, unpackModelRef, isValidModelRef } from '../lib/modelRef';
import { useUiStore } from '../stores/uiStore';
import { usePendingActionStore } from '../stores/pendingActionStore';
import {
  useMasterAgentStore,
  SESSION_MESSAGE_CAP,
  DIAGNOSIS_SESSION_ID,
  type AttachmentMeta,
  type ChatMessage,
  type ChatMessageMeta,
  type SourceRef,
} from '../stores/masterAgentStore';
import {
  useSearchStore,
  hasConfiguredSearch,
  activeSearchEntries,
} from '../stores/searchStore';
import { getProvider } from '../lib/providers';
import {
  chat,
  type ChatImage,
  type ChatTurn,
  type LLMConfig,
} from '../lib/llmClient';
import {
  searchWithFailover,
  type SearchResult,
} from '../lib/searchClient';
import { isTextFile, fileToText } from '../lib/textFile';
import {
  describeMasterAction,
  isCancelText,
  isConfirmText,
} from '../lib/masterActions';
import { buildJiziSkillContext, type SelectedJiziSkill } from '../lib/jiziSkills';
import {
  buildJiziHealthReport,
  buildJiziRuntimeContext,
} from '../lib/jiziRuntimeContext';
import {
  extractJiziMemoryWithLLM,
  selectRelevantJiziMemoryWithLLM,
} from '../lib/jiziMemory';
import {
  planJiziSearchWithLLM,
  type JiziSearchDecision,
} from '../lib/jiziSearchPlanner';
import { planJiziTurnWithLLM } from '../lib/jiziTurnPlanner';
import { observeJiziProject } from '../lib/jiziProjectObservation';
import { enrichSearchResults } from '../lib/jiziDeepSearch';
import { useJiziAutonomyStore } from '../stores/jiziAutonomyStore';
import { assessSearchResultsWithLLM } from '../lib/jiziSearchQuality';
import type { JiziTurnDecision } from '../lib/jiziTurnPlanner';
import { generateToolWithLLM } from '../lib/toolGenerator';
import {
  AUTO_SCROLL_THRESHOLD,
  DOC_CHAR_CAP,
  EMPTY_MESSAGES,
  HISTORY_TURNS,
  SUMMARY_KEEP_TURNS,
  SUMMARY_MIN_MESSAGES,
  SUMMARY_TRIGGER_CHARS,
  SUGGESTIONS,
} from './MasterAgentPanel/constants';
import type {
  Attachment,
  PendingUserChoiceView,
} from './MasterAgentPanel/types';
import {
  fileToBase64,
  isSafeHttpUrl,
  newAttachmentId,
  searchWarning,
} from './MasterAgentPanel/fileHelpers';
import {
  buildSummaryPrompt,
  messageTextLength,
} from './MasterAgentPanel/summary';
import { actionDefaultCustomValue } from './MasterAgentPanel/actionCustomization';
import { MessageList } from './MasterAgentPanel/MessageList';
import { Composer } from './MasterAgentPanel/Composer';
import { SkillManagerModal } from './MasterAgentPanel/SkillManagerModal';

// 联网搜索前把省略式追问(如"现在呢")结合最近对话补成可独立检索的查询,否则搜索引擎收到残句会搜偏。
// 无上下文/改写失败时回退原文,不阻断搜索。
async function condenseSearchQuery(params: {
  text: string;
  history: ChatTurn[];
  cfg: LLMConfig;
  model: string;
  signal: AbortSignal;
}): Promise<string> {
  const { text, history, cfg, model, signal } = params;
  if (history.length === 0) return text; // 首轮无上下文可补,省一次调用
  try {
    const ctx = history
      .slice(-4)
      .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`)
      .join('\n');
    const rewritten = await chat({
      cfg,
      model,
      system:
        '你是检索词改写器。结合对话上下文，把用户最新一句可能省略、含指代的话补全成一个能独立提交给搜索引擎的简洁中文检索词。只输出检索词本身，不要解释、不要加引号。若原句已能独立检索，原样输出。',
      text: `【对话上下文】\n${ctx}\n\n【用户最新输入】\n${text}\n\n改写后的检索词：`,
      signal,
      scene: 'input-rewrite',
    });
    const q = rewritten.trim().replace(/^["'「」『』\s]+|["'「」『』\s]+$/g, '');
    return q || text;
  } catch {
    return text;
  }
}

function routeLabel(kind: JiziTurnDecision['kind'] | 'attachment-chat'): string {
  if (kind === 'action') return '操作画布/Agent';
  if (kind === 'generate-tool') return '生成工具候选';
  if (kind === 'ask-choice') return '等待用户选择';
  if (kind === 'system-check') return '配置体检';
  return '普通聊天';
}

function searchLabel(decision: JiziSearchDecision | null): string {
  if (!decision) return '未判断';
  if (decision.shouldSearch) return `需要联网：${decision.query}`;
  return decision.reason ? `不联网：${decision.reason}` : '不联网';
}

function skillSummaries(selected: SelectedJiziSkill[]): ChatMessageMeta['skills'] {
  return selected.map(({ skill, reason }) => ({
    id: skill.id,
    title: skill.title,
    reason,
  }));
}

function readableError(err: unknown): string {
  if (err instanceof Error) return err.message || '未知错误';
  if (typeof err === 'string') return err || '未知错误';
  if (err && typeof err === 'object') {
    const data = err as Record<string, unknown>;
    const direct =
      data.message ?? data.error ?? data.detail ?? data.reason ?? data.statusText;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    try {
      const json = JSON.stringify(data);
      if (json && json !== '{}') return json.slice(0, 500);
    } catch {
      /* ignore stringify failure */
    }
  }
  return '未知错误';
}

function isLikelyImageRequestError(detail: string): boolean {
  return /image|vision|visual|multimodal|multi-modal|unsupported|support|content type|image_url|base64|400|415|422|不支持|图片|视觉|多模态/i.test(
    detail,
  );
}

function readableChatError(err: unknown, hasImages: boolean): string {
  const detail = readableError(err);
  if (hasImages && isLikelyImageRequestError(detail)) {
    return `图片发送失败：当前模型或中转接口可能不支持图片。请换支持视觉的模型，或在模型配置里关闭这个模型的“视觉/图像”能力标记。原始错误：${detail}`;
  }
  return detail;
}

interface SessionImageContext extends ChatImage {
  name: string;
}

function messageContentForHistory(message: ChatMessage): string {
  const parts: string[] = [];
  const content = message.content.trim();
  if (content) parts.push(content);
  if (message.attachments?.length) {
    parts.push(
      '【这条历史消息带附件】\n' +
        message.attachments
          .map((att) => `- ${att.isImage ? '图片' : '文件'}：${att.name}`)
          .join('\n'),
    );
  }
  return parts.join('\n\n') || '(空消息)';
}

function buildTurnMeta(params: {
  kind: JiziTurnDecision['kind'] | 'attachment-chat';
  reason?: string;
  search: JiziSearchDecision | null;
  skills?: SelectedJiziSkill[];
  skillWarning?: string;
  modelLabel?: string;
  imageContextLabel?: string;
}): ChatMessageMeta {
  const { kind, reason, search, skills = [], skillWarning, modelLabel, imageContextLabel } = params;
  const flow: ChatMessageMeta['flow'] = [
    {
      label: '理解意图',
      status: 'done',
      detail: routeLabel(kind),
    },
    {
      label: '判断联网',
      status: search?.shouldSearch ? 'done' : 'skipped',
      detail: searchLabel(search),
    },
    {
      label: '检查模型',
      status: 'done',
      detail: [modelLabel, imageContextLabel].filter(Boolean).join('；') || '已选择可用模型',
    },
    {
      label: '选择技能',
      status: skills.length > 0 ? 'done' : 'skipped',
      detail: skillWarning || (skills.length > 0 ? skills.map((item) => item.skill.title).join('、') : '未启用额外 skill'),
    },
    {
      label: '生成回复',
      status: 'done',
    },
  ];

  return {
    routeLabel: routeLabel(kind),
    reason,
    searchLabel: searchLabel(search),
    modelLabel,
    imageContextLabel,
    skills: skillSummaries(skills),
    skillWarning,
    flow,
  };
}

function MasterAgentPanel() {
  const { message, modal } = App.useApp();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingUserChoice, setPendingUserChoice] =
    useState<PendingUserChoiceView | null>(null);
  const [webSearchOn, setWebSearchOn] = useState(false);
  const [skillManagerOpen, setSkillManagerOpen] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const recentImagesRef = useRef(new Map<string, SessionImageContext[]>());
  const bodyRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const models = useEnabledModels();
  const masterModel = useUiStore((s) => s.masterModel);
  const setMasterModel = useUiStore((s) => s.setMasterModel);
  const searchReady = useSearchStore(hasConfiguredSearch);

  const memory = useMasterAgentStore((s) => s.memory);
  const systemPrompt = useMasterAgentStore((s) => s.systemPrompt);
  const addMessage = useMasterAgentStore((s) => s.addMessage);
  const updateMessage = useMasterAgentStore((s) => s.updateMessage);
  const renameSession = useMasterAgentStore((s) => s.renameSession);
  const addMemory = useMasterAgentStore((s) => s.addMemory);
  const updateSessionSummary = useMasterAgentStore(
    (s) => s.updateSessionSummary,
  );

  // 只订阅「当前活动会话的消息」:selector 直接返回 store 里的 messages 数组引用
  // (不变则引用稳定),无活动会话回退到共享空数组,均不产生新引用,避免无谓重渲染/白屏。
  const activeSession = useMasterAgentStore((s) =>
    s.sessions.find((x) => x.id === s.activeId),
  );
  const messages = activeSession?.messages ?? EMPTY_MESSAGES;
  const activeSessionId = activeSession?.id ?? null;
  const isDiagnosisSession = activeSessionId === DIAGNOSIS_SESSION_ID;

  // 待确认动作已上提到常驻 store(见 stores/pendingActionStore.ts),抽屉卸载不丢失。
  const setPending = usePendingActionStore((s) => s.setPending);
  const setPendingActionChoice = usePendingActionStore((s) => s.setChoice);
  const setPendingActionCustomValue = usePendingActionStore((s) => s.setCustomValue);
  const resetPending = usePendingActionStore((s) => s.reset);
  const runPending = usePendingActionStore((s) => s.runPending);
  const abortPending = usePendingActionStore((s) => s.abortPending);
  // 卡片按「槽位 id」存储:普通对话槽位 id=sessionId,诊断槽位 id=incidentId。选整张 map
  // (map 引用稳定),再用 useMemo 派生本会话该展示的所有卡片,避免 selector 现算新数组触发白屏。
  const pendingActionsMap = usePendingActionStore((s) => s.pendingActions);
  // 文本确认/取消(isConfirmText/isCancelText)只作用于普通对话,其槽位 id 即 sessionId。
  const activePendingAction = activeSessionId
    ? pendingActionsMap[activeSessionId]
    : undefined;
  const activePendingActions = useMemo(
    () =>
      Object.values(pendingActionsMap).filter(
        (v) => v.sessionId === activeSessionId,
      ),
    [pendingActionsMap, activeSessionId],
  );
  const activeSending = messages.some((m) => m.status === 'sending');

  const options = useModelOptions(false);

  const currentValue = packModelRef(masterModel);
  const valueValid = isValidModelRef(currentValue, options);

  const onChangeModel = (val: string | undefined) => {
    setMasterModel(unpackModelRef(val));
  };

  const runHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      const report = await buildJiziHealthReport();
      modal.info({
        title: '姬子体检报告',
        width: 680,
        content: <pre className="jizi-health-report-text">{report}</pre>,
        okText: '知道了',
      });
    } finally {
      setCheckingHealth(false);
    }
  };

  // 消息更新后仅在用户本来接近底部时自动滚到底部
  useEffect(() => {
    const el = bodyRef.current;
    if (el && autoScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 搜索配置被清空时,自动关闭已开启的联网搜索
  useEffect(() => {
    if (!searchReady && webSearchOn) setWebSearchOn(false);
  }, [searchReady, webSearchOn]);

  // H4 修复：组件卸载时 abort 未完成的请求，防止写入已不活跃的会话
  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  // M3 修复：组件卸载时释放所有未清理的附件 Blob URL，防止内存泄漏
  // 用 ref 跟踪最新 attachments，避免 useEffect 依赖导致过早重建清理函数
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(
        (a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl),
      );
    };
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const binaryNames = list
      .filter((file) => !file.type.startsWith('image/') && !isTextFile(file))
      .map((file) => file.name);
    if (binaryNames.length > 0) {
      message.warning(
        `这些附件暂不能在对话中解析内容，只会保留文件名：${binaryNames.join('、')}`,
      );
    }
    setAttachments((prev) => [
      ...prev,
      ...list.map((file) => {
        const isImage = file.type.startsWith('image/');
        return {
          id: newAttachmentId(),
          file,
          isImage,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        };
      }),
    ]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const clearAttachments = () => {
    setAttachments((prev) => {
      prev.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  };

  const onStop = () => {
    if (!activeSessionId) return;
    abortControllersRef.current.get(activeSessionId)?.abort();
    // 待确认动作的执行用独立的模块级控制器,一并中止(保持原「停止」语义)。
    abortPending(activeSessionId);
  };

  const refreshContextSummary = async (
    sessionId: string,
    sessionMessages: ChatMessage[],
    previousSummary: string | undefined,
    previousCount: number,
    cfgForSummary: LLMConfig,
    model: string,
  ) => {
    const compactable = sessionMessages.filter(
      (m) => m.status !== 'sending' && m.status !== 'error' && m.content,
    );
    const cutoff = Math.max(0, compactable.length - SUMMARY_KEEP_TURNS);
    if (compactable.length < SUMMARY_MIN_MESSAGES) return;
    if (messageTextLength(compactable) < SUMMARY_TRIGGER_CHARS) return;
    if (cutoff <= previousCount) return;

    const newMessages = compactable.slice(previousCount, cutoff);
    if (newMessages.length === 0) return;

    try {
      const summary = await chat({
        cfg: cfgForSummary,
        model,
        system: '你是对话上下文压缩器，只负责生成简洁、准确、可延续任务的中文摘要。',
        text: buildSummaryPrompt(previousSummary, newMessages),
        scene: 'session-summary',
      });
      updateSessionSummary(sessionId, summary, cutoff);
      message.info('已自动压缩较早对话上下文，后续对话会继续引用摘要');
    } catch {
      // 摘要是后台增强能力，失败不影响正常对话。
    }
  };

  // 1.12：首轮问答后用 LLM 生成精炼会话标题,替代按 20 字截断的临时标题;失败则保留截断标题。
  const generateSessionTitle = async (
    sessionId: string,
    userText: string,
    assistantReply: string,
    cfgForTitle: LLMConfig,
    model: string,
  ) => {
    try {
      const raw = await chat({
        cfg: cfgForTitle,
        model,
        system:
          '你是会话标题生成器。依据首轮问答,输出一个不超过 16 字、精准概括主题的中文短标题。只输出标题本身,不要引号、句号或任何多余说明。',
        text: `用户：${userText.slice(0, 500)}\n\n助手：${assistantReply.slice(0, 500)}`,
        scene: 'session-title',
      });
      const clean = raw
        .trim()
        .replace(/^["'「『]+|["'」』]+$/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 20);
      if (clean) renameSession(sessionId, clean);
    } catch {
      // 标题生成失败不影响对话,保留原截断标题即可。
    }
  };

  const refreshLongTermMemory = async (
    userText: string,
    assistantReply: string,
    cfgForMemory: LLMConfig,
    model: string,
  ) => {
    try {
      const currentMemory = useMasterAgentStore.getState().memory;
      const draftMemory = await extractJiziMemoryWithLLM(
        userText,
        assistantReply,
        currentMemory,
        cfgForMemory,
        model,
      );
      for (const item of draftMemory.profile ?? []) addMemory('profile', item);
      for (const item of draftMemory.preferences ?? []) {
        addMemory('preferences', item);
      }
      for (const item of draftMemory.resources ?? []) addMemory('resources', item);
    } catch {
      // 长期记忆整理失败不影响本轮回复。
    }
  };

  const onSend = async (
    overrideText?: string,
    options?: { skipChoicePlanner?: boolean },
  ) => {
    if (activeSending) return;
    const text = (overrideText ?? draft).trim();
    if (!text && attachments.length === 0) return;
    if (!overrideText) setPendingUserChoice(null);
    let targetSessionId =
      activeSessionId ?? useMasterAgentStore.getState().newSession();
    // 4.2：当前会话消息达上限,自动开启延续会话(继承摘要),后续消息写入新会话
    const currentCount =
      useMasterAgentStore
        .getState()
        .sessions.find((s) => s.id === targetSessionId)?.messages.length ?? 0;
    if (currentCount >= SESSION_MESSAGE_CAP) {
      targetSessionId = useMasterAgentStore
        .getState()
        .spawnContinuation(targetSessionId);
      message.info('当前会话消息较多，已自动开启延续会话并沿用上下文');
    }
    // 1.12：首轮问答后再用 LLM 生成标题;此处记录进入本轮时该会话是否尚无用户消息
    const isFirstExchange = (
      useMasterAgentStore
        .getState()
        .sessions.find((s) => s.id === targetSessionId)?.messages ?? []
    ).every((m) => m.role !== 'user');

    // 规划分支若已回显用户消息+思考占位,记录下来供后续聊天回落分支复用(避免重复回显)。
    let planUserMsgAdded = false;
    let planAssistantId: string | undefined;

    if (attachments.length === 0) {
      if (activePendingAction && isCancelText(text)) {
        addMessage({ role: 'user', content: text, status: 'done' });
        addMessage({ role: 'assistant', content: '已取消这次操作。', status: 'done' });
        resetPending(targetSessionId);
        setDraft('');
        return;
      }

      if (activePendingAction && isConfirmText(text)) {
        addMessage({ role: 'user', content: text, status: 'done' });
        setDraft('');
        await runPending(targetSessionId, 'confirm');
        return;
      }
    }

    // 前置拦截:模型
    if (!valueValid || !masterModel) {
      message.warning('请先在右下角选择对话模型');
      return;
    }
    const cfg = useModelStore
      .getState()
      .configs.find((c) => c.id === masterModel.configId);
    const enabled = models.find(
      (m) =>
        m.configId === masterModel.configId && m.modelId === masterModel.modelId,
    );
    if (!cfg || !enabled) {
      message.warning('所选模型已失效，请重新选择');
      return;
    }
    if (!cfg.apiKey) {
      message.warning('所选模型未配置密钥，请到「模型配置」补全');
      return;
    }

    const imgAtts = attachments.filter((a) => a.isImage);
    if (imgAtts.length > 0 && !enabled.caps.vision) {
      message.warning('当前模型不支持图片，请移除图片或更换支持视觉的模型');
      return;
    }

    // 联网搜索是否允许执行。是否真的搜索，后面再交给 LLM 判断。
    const searchEntries = activeSearchEntries(useSearchStore.getState());
    const canSearch = webSearchOn && searchEntries.length > 0;

    const preset = getProvider(cfg.providerId);
    const llmCfg: LLMConfig = {
      api: preset?.api ?? 'openai',
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
    };
    const runtimeContext = await buildJiziRuntimeContext();
    const currentModelLabel = `${enabled.label}（${enabled.providerName}）`;

    // 抓取目标会话的历史轮次(在落库新消息之前),仅取已完成、有正文的文本轮次。
    // 从 store 按 targetSessionId 取,确保延续会话场景下用的是新会话的(空)历史与继承摘要。
    const workingSession = useMasterAgentStore
      .getState()
      .sessions.find((s) => s.id === targetSessionId);
    const effectiveSummary = workingSession?.contextSummary;
    const effectiveSummarizedCount = workingSession?.summarizedMessageCount ?? 0;
    const history: ChatTurn[] = (workingSession?.messages ?? [])
      .filter(
        (m) =>
          m.status !== 'sending' &&
          m.status !== 'error' &&
          (m.content || m.attachments?.length),
      )
      .slice(effectiveSummarizedCount)
      .map((m) => ({ role: m.role, content: messageContentForHistory(m) }))
      .slice(-HISTORY_TURNS);
    let plannedSearchDecision: JiziSearchDecision | null = null;

    if (attachments.length === 0) {
      // 总规划器统一判断本轮主路线(action/tool/choice/check/chat)与联网需求。
      // 先回显用户消息 + 思考占位再 await，避免 UI 干等。
      addMessage({ role: 'user', content: text, status: 'done' });
      setDraft('');
      planUserMsgAdded = true;
      planAssistantId = addMessage({
        role: 'assistant',
        content: '',
        status: 'sending',
      });

      try {
        const turnPlan = await planJiziTurnWithLLM(
          text,
          history,
          llmCfg,
          masterModel.modelId,
          {
            runtimeContext,
            allowSearch: canSearch,
            allowChoice: !options?.skipChoicePlanner,
            allowActions: true,
          },
        );

        plannedSearchDecision = turnPlan.search;

        if (turnPlan.kind === 'action') {
          const plannedAction = turnPlan.action;
          useJiziAutonomyStore.getState().start(
            targetSessionId,
            text,
            plannedAction.steps,
            await observeJiziProject(),
          );
          const notice =
            plannedAction.type === 'plan'
              ? '我已理解为一组操作计划，需要确认后执行。'
              : `我将为你${describeMasterAction(plannedAction)}，需要确认后执行。`;
          updateMessage(planAssistantId, {
            content: notice,
            status: 'done',
            meta: buildTurnMeta({
              kind: turnPlan.kind,
              reason: turnPlan.reason,
              search: turnPlan.search,
              modelLabel: currentModelLabel,
            }),
          });
          setPending(targetSessionId, {
            action: plannedAction,
            choice: 'confirm',
            customValue: actionDefaultCustomValue(plannedAction),
            sessionId: targetSessionId,
          });
          return;
        }

        if (turnPlan.kind === 'generate-tool') {
          const genController = new AbortController();
          abortControllersRef.current.set(targetSessionId, genController);
          try {
            const toolAction = await generateToolWithLLM(
              turnPlan.requirement,
              llmCfg,
              masterModel.modelId,
              genController.signal,
              runtimeContext,
            );
            updateMessage(planAssistantId, {
              content: `${describeMasterAction(toolAction)}`,
              status: 'done',
              meta: buildTurnMeta({
                kind: turnPlan.kind,
                reason: turnPlan.reason,
                search: turnPlan.search,
              }),
            });
            setPending(targetSessionId, {
              action: toolAction,
              choice: 'confirm',
              customValue: actionDefaultCustomValue(toolAction),
              sessionId: targetSessionId,
            });
          } catch (err) {
            const detail = readableError(err);
            updateMessage(planAssistantId, {
              content: `生成工具失败：${detail}`,
              status: 'error',
            });
          } finally {
            abortControllersRef.current.delete(targetSessionId);
          }
          return;
        }

        if (turnPlan.kind === 'system-check') {
          const report = await buildJiziHealthReport();
          updateMessage(planAssistantId, {
            content: report,
            status: 'done',
            meta: buildTurnMeta({
              kind: turnPlan.kind,
              reason: turnPlan.reason,
              search: turnPlan.search,
              modelLabel: currentModelLabel,
            }),
          });
          return;
        }

        if (turnPlan.kind === 'ask-choice') {
          updateMessage(planAssistantId, {
            content: '我需要你先选一种处理方式。',
            status: 'done',
            meta: buildTurnMeta({
              kind: turnPlan.kind,
              reason: turnPlan.reason,
              search: turnPlan.search,
              modelLabel: currentModelLabel,
            }),
          });
          setPendingUserChoice({
            sessionId: targetSessionId,
            originalText: text,
            title: turnPlan.title,
            summary: turnPlan.summary,
            options: turnPlan.options,
            choice: turnPlan.options[0]?.id ?? 'custom',
            customValue: '',
            customPlaceholder: turnPlan.customPlaceholder,
          });
          return;
        }
      } catch (err) {
        console.warn('[planJiziTurnWithLLM]', err);
      }
    }

    // 组装附件:图片转 base64;文本读内容;其它记文件名
    const images: SessionImageContext[] = [];
    const docs: string[] = [];
    const pending = attachments;
    const hasPendingAttachments = pending.length > 0;
    const attMeta: AttachmentMeta[] = pending.map((a) => ({
      name: a.file.name,
      isImage: a.isImage,
    }));

    const controller = new AbortController();
    abortControllersRef.current.set(targetSessionId, controller);

    // 用户消息先落库(规划分支已回显过则跳过,避免重复)
    if (!planUserMsgAdded) {
      addMessage({
        role: 'user',
        content: text,
        attachments: attMeta.length > 0 ? attMeta : undefined,
        status: 'done',
      });
    }
    // 附件内容已捕获到 pending;发送后立即清空本地附件栏,不等模型回复。
    setDraft('');
    if (hasPendingAttachments) clearAttachments();

    // 复用规划分支已建的思考占位;否则新建。
    const assistantId =
      planAssistantId ??
      addMessage({
        role: 'assistant',
        content: '',
        status: 'sending',
      });
    const replySessionId = targetSessionId;

    try {
      // 并行读取所有附件(各自独立 I/O),再按原顺序归入图片/文档
      const parts = await Promise.all(
        pending.map(async (a) => {
          if (a.isImage) {
            return {
              kind: 'image' as const,
              image: {
                name: a.file.name,
                mediaType: a.file.type || 'image/png',
                base64: await fileToBase64(a.file),
              },
            };
          }
          if (isTextFile(a.file)) {
            const content = (await fileToText(a.file)).slice(0, DOC_CHAR_CAP);
            return {
              kind: 'doc' as const,
              doc: `文件「${a.file.name}」内容：\n${content}`,
            };
          }
          return {
            kind: 'doc' as const,
            doc: `文件「${a.file.name}」为二进制格式，暂无法解析其内容。`,
          };
        }),
      );
      for (const p of parts) {
        if (p.kind === 'image') images.push(p.image);
        else docs.push(p.doc);
      }
      let omittedRecentImageNames: string[] = [];
      let imageContextLabel = '本轮没有图片';
      if (images.length > 0 && replySessionId) {
        recentImagesRef.current.set(replySessionId, images.slice(-3));
        imageContextLabel = `已发送 ${images.length} 张图片给模型`;
      } else if (images.length === 0 && pending.length === 0 && replySessionId) {
        const recentImages = recentImagesRef.current.get(replySessionId) ?? [];
        if (enabled.caps.vision) {
          images.push(...recentImages);
          imageContextLabel = images.length > 0 ? `沿用本会话最近 ${images.length} 张图片` : '本轮没有图片';
        } else {
          omittedRecentImageNames = recentImages.map((img) => img.name);
          imageContextLabel = omittedRecentImageNames.length > 0
            ? `当前模型不看图，未发送 ${omittedRecentImageNames.length} 张历史图片`
            : '本轮没有图片';
        }
      }

      // 联网搜索
      let sources: SourceRef[] = [];
      let searchResults: SearchResult[] = [];
      if (canSearch) {
        try {
          const searchDecision =
            plannedSearchDecision ??
            (await planJiziSearchWithLLM(
              text,
              history,
              llmCfg,
              masterModel.modelId,
              controller.signal,
            ));
          if (searchDecision.shouldSearch) {
            const query = await condenseSearchQuery({
              text: searchDecision.query,
              history,
              cfg: llmCfg,
              model: masterModel.modelId,
              signal: controller.signal,
            });
            const outcome = await searchWithFailover(
              searchEntries,
              query,
              5,
              controller.signal,
            );
            const safeResults = outcome.results.filter((r) => isSafeHttpUrl(r.link));
            const quality = await assessSearchResultsWithLLM({
              userText: text,
              query,
              results: safeResults,
              cfg: llmCfg,
              model: masterModel.modelId,
              signal: controller.signal,
            });
            searchResults = await enrichSearchResults(
              quality.kept,
              undefined,
              controller.signal,
            );
            if (quality.droppedCount > 0) {
              plannedSearchDecision = {
                shouldSearch: true,
                query,
                reason: `${searchDecision.reason}；${quality.summary}`,
              };
            }
            sources = searchResults.map((r) => ({ title: r.title, link: r.link }));
          }
        } catch (err) {
          message.warning(searchWarning(err));
        }
      }
      // 记忆由 LLM 按语义筛选，避免本地关键词门槛。
      const memHits = await selectRelevantJiziMemoryWithLLM(
        text,
        memory,
        llmCfg,
        masterModel.modelId,
        history,
        controller.signal,
      );

      // 拼 prompt
      const segs: string[] = [];
      // 注入当前时间(放 text 而非 system:system 是缓存块,含分钟会每轮击穿缓存)
      segs.push(
        '【当前时间】' +
          new Date().toLocaleString('zh-CN', {
            dateStyle: 'full',
            timeStyle: 'short',
          }) +
          '（用户本地时间，回答涉及"今天/现在/几点"以此为准）',
      );
      segs.push(
        [
          '【本项目默认语境】',
          '用户说的 Agent，默认是本应用画布里的 Agent 节点，不是 Dify、Coze、CrewAI 或其他外部平台。',
          '用户说的工具，默认是本项目里可安装、可调用的 Python 工具。',
          '如果用户要求给 Agent 增加能力，优先理解为给本项目的 Agent 节点补工具或补工作流能力，不要反问“你用哪个 Agent 平台”。',
        ].join('\n'),
      );
      segs.push(runtimeContext);
      if (effectiveSummary) {
        segs.push(`【较早对话摘要】\n${effectiveSummary}`);
      }
      if (memHits.length > 0) {
        segs.push('【已知背景】\n' + memHits.map((m) => `- ${m}`).join('\n'));
      }
      if (searchResults.length > 0) {
        segs.push(
          '【联网检索到的参考资料】\n' +
            searchResults
              .map(
                (r, i) =>
                  `[${i + 1}] ${r.title}\n${r.excerpt || r.snippet}\n资料层级：${
                    r.authority === 'official'
                      ? '官方来源'
                      : r.authority === 'community'
                        ? '社区来源'
                        : '一般来源'
                  }；读取方式：${r.contentMode === 'body' ? '网页正文' : '搜索摘要（正文读取失败）'}\n来源：${r.link}`,
              )
              .join('\n\n') +
            '\n\n请结合以上资料作答，并在合适处标注引用编号。关键事实优先使用至少两个独立来源交叉核对；只有一个来源时必须明确说明证据不足。',
        );
      }
      if (docs.length > 0) {
        segs.push('【用户上传的文件】\n' + docs.join('\n\n'));
      }
      if (images.length > 0) {
        segs.push(
          [
            hasPendingAttachments
              ? '【用户上传的图片】'
              : '【本会话最近上传的图片】',
            hasPendingAttachments
              ? '本轮消息已随请求附带以下图片，请直接查看图片内容回答。'
              : '本轮用户没有重新上传图片，但系统已附带本会话最近上传的图片，用于回答“这张图/刚才图片/图里是什么”等追问。若用户问题与图片无关，请忽略这些图片。',
            ...images.map((img, index) => `${index + 1}. ${img.name}`),
          ].join('\n'),
        );
      }
      if (omittedRecentImageNames.length > 0) {
        segs.push(
          [
            '【本会话有图片但本轮未发送】',
            '本会话之前上传过图片，但当前选择的模型没有开启视觉/图像能力，所以本轮没有把图片内容发给模型。',
            '如果用户追问图片内容，请直接说明需要切换到支持视觉的模型后再问，不要假装看到了图片。',
            ...omittedRecentImageNames.map((name, index) => `${index + 1}. ${name}`),
          ].join('\n'),
        );
      }
      segs.push('【用户问题】\n' + (text || '(无文字，仅附件)'));
      const prompt = segs.join('\n\n');
      const skillContext = await buildJiziSkillContext(
        [text, docs.join('\n')].join('\n'),
        llmCfg,
        masterModel.modelId,
        controller.signal,
      );
      const systemWithSkills = skillContext.block
        ? `${systemPrompt}\n\n${skillContext.block}`
        : systemPrompt;

      const reply = await chat({
        cfg: llmCfg,
        model: masterModel.modelId,
        system: systemWithSkills,
        text: prompt,
        images,
        history,
        signal: controller.signal,
        scene: 'master-reply',
      });

      updateMessage(assistantId, {
        content: reply,
        sources: sources.length > 0 ? sources : undefined,
        meta: buildTurnMeta({
          kind: hasPendingAttachments ? 'attachment-chat' : 'chat',
          reason: plannedSearchDecision ? '总规划器判定为普通聊天' : '带附件或规划器回落到普通聊天',
          search:
            plannedSearchDecision ??
            (canSearch
              ? searchResults.length > 0
                ? { shouldSearch: true, query: '已执行联网搜索', reason: '搜索结果已注入回答' }
                : { shouldSearch: false, reason: '未执行联网搜索' }
              : { shouldSearch: false, reason: '未开启或未配置联网搜索' }),
          skills: skillContext.selected,
          skillWarning: skillContext.selectionWarning,
          modelLabel: currentModelLabel,
          imageContextLabel,
        }),
        status: 'done',
      });
      void refreshLongTermMemory(
        text,
        reply,
        llmCfg,
        masterModel.modelId,
      );
      if (replySessionId) {
        // 1.12：首轮问答成功后生成精炼标题
        if (isFirstExchange && reply.trim()) {
          void generateSessionTitle(
            replySessionId,
            text,
            reply,
            llmCfg,
            masterModel.modelId,
          );
        }
        const latest = useMasterAgentStore
          .getState()
          .sessions.find((session) => session.id === replySessionId);
        if (latest) {
          void refreshContextSummary(
            replySessionId,
            latest.messages,
            latest.contextSummary,
            latest.summarizedMessageCount ?? 0,
            llmCfg,
            masterModel.modelId,
          );
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        updateMessage(assistantId, {
          content: '(已取消)',
          status: 'cancelled',
        });
      } else {
        const detail = readableChatError(err, images.length > 0);
        updateMessage(assistantId, {
          content: `出错了：${detail}`,
          status: 'error',
        });
      }
    } finally {
      abortControllersRef.current.delete(targetSessionId);
    }
  };

  const setPendingUserChoiceChoice = (choice: string) => {
    setPendingUserChoice((current) =>
      current ? { ...current, choice } : current,
    );
  };

  const setPendingUserChoiceCustomValue = (customValue: string) => {
    setPendingUserChoice((current) =>
      current ? { ...current, customValue } : current,
    );
  };

  const submitPendingUserChoice = () => {
    const current = pendingUserChoice;
    if (!current || activeSending) return;
    const selected = current.options.find((item) => item.id === current.choice);
    const selectedText =
      current.choice === 'custom'
        ? current.customValue.trim()
        : selected
          ? `${selected.title}：${selected.description}`
          : '';
    if (!selectedText) return;

    setPendingUserChoice(null);
    void onSend(
      [
        `原问题：${current.originalText}`,
        `用户选择的方案：${selectedText}`,
        '请基于这个选择继续处理。',
      ].join('\n\n'),
      { skipChoicePlanner: true },
    );
  };

  return (
    <div className="master-chat">
      <div
        className="master-chat__body"
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          autoScrollRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <
            AUTO_SCROLL_THRESHOLD;
        }}
      >
        <MessageList
          messages={messages}
          pendingActions={activePendingActions}
          pendingUserChoice={pendingUserChoice}
          activeSessionId={activeSessionId}
          activeSending={activeSending}
          onSuggestion={setDraft}
          suggestions={SUGGESTIONS}
          setPendingActionChoice={setPendingActionChoice}
          setPendingActionCustomValue={setPendingActionCustomValue}
          runPendingAction={runPending}
          setPendingUserChoiceChoice={setPendingUserChoiceChoice}
          setPendingUserChoiceCustomValue={setPendingUserChoiceCustomValue}
          submitPendingUserChoice={submitPendingUserChoice}
        />
      </div>

      <Composer
        draft={draft}
        setDraft={setDraft}
        attachments={attachments}
        removeAttachment={removeAttachment}
        addFiles={addFiles}
        fileInputRef={fileInputRef}
        searchReady={searchReady}
        webSearchOn={webSearchOn}
        setWebSearchOn={setWebSearchOn}
        modelsLength={models.length}
        valueValid={valueValid}
        currentValue={currentValue}
        onChangeModel={onChangeModel}
        options={options}
        activeSending={activeSending}
        onOpenSkillManager={() => setSkillManagerOpen(true)}
        onRunHealthCheck={() => void runHealthCheck()}
        healthChecking={checkingHealth}
        onStop={onStop}
        onSend={onSend}
        readOnly={isDiagnosisSession}
      />
      <SkillManagerModal
        open={skillManagerOpen}
        onClose={() => setSkillManagerOpen(false)}
      />
    </div>
  );
}

export default MasterAgentPanel;




