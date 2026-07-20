import { createElement } from 'react';
import { Button } from 'antd';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '../lib/tauriStorage';
import { uid } from '../lib/id';
import { chat, type LLMConfig } from '../lib/llmClient';
import { generateToolWithLLM } from '../lib/toolGenerator';
import { getProvider } from '../lib/providers';
import { searchWithFailover } from '../lib/searchClient';
import { getMessage, getNotification } from '../lib/appNotify';
import { actionDefaultCustomValue } from '../components/MasterAgentPanel/actionCustomization';
import { useUiStore } from './uiStore';
import { useMasterAgentStore } from './masterAgentStore';
import {
  isSessionVisible,
  buildAwaitingNotification,
  buildDiagnosticPrompt,
  type Incident,
  type ReportInput,
} from '../lib/orchestrator/diagnosis';
import { canAutoNavigateToWorkspace } from '../settings/settingsNavigation';
import {
  capIncidents,
  reduceFinalizeRepair,
  reduceIgnore,
  reduceRevertToFailed,
} from '../lib/orchestrator/incidents';
import { errorMessage } from '../lib/agentRunner/utils';
import { PREFLIGHT_NODE_ID } from '../lib/agentRunner/constants';
import { abortRunByCanvasId } from '../lib/runControllers';
import { useModelStore } from './modelStore';
import {
  activeSearchEntries,
  hasConfiguredSearch,
  useSearchStore,
} from './searchStore';
import { usePendingActionStore } from './pendingActionStore';
import { useCanvasStore } from './canvasStore';
import {
  MISSING_TOOL_TAG_MARKER,
  requiredToolTagsForNode,
} from '../lib/agentRunner/inputs';
import { listTools } from '../lib/pythonClient';
import { getToolDef } from '../lib/toolRegistry';
import { registerOrchestratorBridge } from '../lib/orchestratorBridge';
import {
  parseFailureDiagnosis,
  unknownFailureDiagnosis,
} from '../lib/orchestrator/diagnosisParser';

// 画布节点失败时上报 → 诊断(是否缺工具/库,联网搜候选库) → 生成候选工具挂起待人工确认
// (绝不自动安装,沿用 RCE 硬底线)。安装后由 pendingActionStore 回调 onToolInstalled 触发重跑。
// agentRunner、canvasStore 与 pendingActionStore 通过 orchestratorBridge 回报事件，
// 编排层可在这里显式持有业务依赖，同时保持依赖方向单向。

const NOTIF_KEY = 'orchestrator-awaiting';
const INCIDENT_CAP = 50;

// 防重跑死循环:同 canvas+node+error 只诊断一次。模块级,存活于 incidents 数组裁剪之外。
const diagnosedKeys = new Set<string>();
function dedupKey(input: { canvasId: string; nodeId: string; errorDetail: string }): string {
  return `${input.canvasId}::${input.nodeId}::${input.errorDetail}`;
}

interface OrchestratorState {
  enabled: boolean;
  incidents: Incident[];
  // 姬子自愈「思考行为」累计计数(持久化,展示到报告中心):
  autoGrantedToolCount: number; // 自动补上的「已注册工具」标签累计数
  installedToolCount: number; // 经人工确认安装的新工具累计数
  setEnabled: (v: boolean) => void;
  reportNodeFailure: (input: ReportInput) => void;
  onToolInstalled: (incidentId: string, sessionId: string) => void;
  recordToolInstalled: () => void;
  ignoreIncident: (id: string) => void;
  clearDiagnosedForRun: (runId: string) => void;
  finalizeRepair: (incidentId: string, ok: boolean) => void;
  revertToFailed: (incidentId: string) => void;
}

export const useOrchestratorStore = create<OrchestratorState>()(
  persist(
    (set, get) => {
      const patchIncident = (id: string, patch: Partial<Incident>) =>
        set((s) => ({
          incidents: s.incidents.map((i) =>
            i.id === id ? { ...i, ...patch } : i,
          ),
        }));

      // 当前抽屉是否正好展示着该 incident 所属会话(展示则不弹通知,直接用确认卡片)。
      const visibleForSession = (sessionId: string): boolean => {
        const ui = useUiStore.getState();
        const master = useMasterAgentStore.getState();
        return isSessionVisible(
          {
            view: ui.view,
            drawerExpanded: ui.drawerExpanded,
            activeSessionId: master.activeId,
          },
          sessionId,
        );
      };

      const goToConfirm = (incident: Incident) => {
        const ui = useUiStore.getState();
        if (!canAutoNavigateToWorkspace(ui.view, ui.settingsDirty)) {
          getMessage()?.warning('设置页有未保存修改，请先保存或放弃修改后再去确认。');
          return;
        }
        ui.setView('workspace');
        ui.setDrawerExpanded(true);
        useMasterAgentStore.getState().switchSession(incident.sessionId);
        getNotification()?.destroy(NOTIF_KEY);
      };

      // 单条常驻通知,聚合所有 awaiting-confirm,标题带计数;「去确认」跳回最近一条所属会话。
      const refreshNotification = () => {
        const n = getNotification();
        if (!n) return;
        const awaiting = get().incidents.filter(
          (i) => i.status === 'awaiting-confirm',
        );
        const text = buildAwaitingNotification(awaiting);
        if (!text) {
          n.destroy(NOTIF_KEY);
          return;
        }
        const latest = awaiting[awaiting.length - 1];
        n.open({
          key: NOTIF_KEY,
          message: text.message,
          description: text.description,
          duration: 0,
          btn: createElement(
            Button,
            {
              type: 'primary',
              size: 'small',
              onClick: () => goToConfirm(latest),
            },
            '去确认',
          ),
        });
      };

      // 诊断收尾(无法自动修复):完整结论写入诊断固定会话;concise 卡片文案写到 incident.diagnosisText,
      // 供右上角状态卡④展示。状态置 'failed'。卡片由 runState+incident 派生,这里不再挂 autoToolNotice。
      const finishFailed = (
        incident: Incident,
        sessionContent: string,
        cardText?: string,
      ) => {
        useMasterAgentStore.getState().addDiagnosisMessage({
          role: 'assistant',
          content: sessionContent,
          status: 'done',
        });
        patchIncident(incident.id, {
          status: 'failed',
          diagnosisText: cardText ?? sessionContent,
        });
      };

      const diagnose = async (incident: Incident) => {
        const master = useMasterAgentStore.getState();
        const incidentAlive = () => get().incidents.some((item) => item.id === incident.id);

        const masterModel = useUiStore.getState().masterModel;
        const cfg = masterModel
          ? useModelStore
              .getState()
              .configs.find((c) => c.id === masterModel.configId)
          : undefined;
        if (!masterModel || !cfg || !cfg.apiKey) {
          finishFailed(
            incident,
            `检测到节点「${incident.nodeLabel}」运行失败，但尚未配置姬子对话模型或密钥，无法自动诊断。\n报错：${incident.errorDetail}`,
            '尚未配置姬子对话模型或密钥，无法自动诊断，请先在设置里配置后重试。',
          );
          return;
        }
        const preset = getProvider(cfg.providerId);
        const llmCfg: LLMConfig = {
          api: preset?.api ?? 'openai',
          baseURL: cfg.baseURL,
          apiKey: cfg.apiKey,
        };
        const modelId = masterModel.modelId;

        let diagnosis = unknownFailureDiagnosis();
        try {
          const prompt = await buildDiagnosticPrompt(incident, llmCfg, modelId);
          const reply = await chat({
            cfg: llmCfg,
            model: modelId,
            system: prompt.system,
            text: prompt.text,
            scene: 'orchestrate',
          });
          if (!incidentAlive()) return;
          diagnosis = parseFailureDiagnosis(reply);
        } catch {
          diagnosis = unknownFailureDiagnosis();
        }
        if (!incidentAlive()) return;

        const {
          category,
          capability,
          suggestedQuery,
          reason,
          summary,
          consequence,
          fixCost,
          nextStep,
          severity,
          evidence,
          likelyCause,
          worthFixing,
        } = diagnosis;

        if (category !== 'missing-tool') {
          finishFailed(
            incident,
            [
              `诊断结果：节点「${incident.nodeLabel}」失败了。`,
              `症状：${summary || '节点运行中断，后续节点拿不到它的结果。'}`,
              `故障分类：${category === 'unknown' ? '未知，证据不足以自动修复' : category}。`,
              `最可能病因：${likelyCause || '这次不像是缺工具，更像是节点配置、输入数据或模型调用本身出了问题。'}`,
              `判断证据：${evidence || incident.errorDetail}`,
              `影响：${consequence || '这个节点和它后面的节点暂时跑不下去。'}`,
              `严重程度：${severity || '中'}`,
              `修复代价：${fixCost || '中'}`,
              `值不值得修：${worthFixing || '值得马上修'}`,
              `建议处理：${nextStep || '先检查这个节点的输入、模型配置和提示词，再重跑当前画布。'}`,
              `原始报错：${incident.errorDetail}`,
            ].join('\n'),
            likelyCause || summary || '疑似节点配置、输入数据或模型调用问题，建议检查后重跑。',
          );
          return;
        }

        let candidatesText = '';
        if (hasConfiguredSearch(useSearchStore.getState())) {
          const entries = activeSearchEntries(useSearchStore.getState());
          const query =
            suggestedQuery ||
            `${capability || incident.nodeLabel} python library site:pypi.org`;
          try {
            const outcome = await searchWithFailover(entries, query, 5);
            if (!incidentAlive()) return;
            candidatesText = outcome.results
              .slice(0, 5)
              .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.link}`)
              .join('\n\n');
          } catch {
            // 搜索失败不阻断,仅按报错生成。
          }
        }

        let toolAction;
        try {
          const requirement = [
            '某画布 Agent 节点运行失败，需要一个 Python 工具来补齐缺失能力，请据此生成能修复该失败的工具。',
            `节点：${incident.nodeLabel}`,
            `报错信息：${incident.errorDetail}`,
            capability ? `推测缺失能力：${capability}` : '',
            candidatesText
              ? `联网检索到的候选库/资料（择优复用现成库，不要重复造轮子）：\n${candidatesText}`
              : '',
          ]
            .filter(Boolean)
            .join('\n');
          toolAction = await generateToolWithLLM(requirement, llmCfg, modelId);
          if (!incidentAlive()) return;
        } catch (err) {
          const detail = errorMessage(err);
          finishFailed(
            incident,
            `无法自动修复节点「${incident.nodeLabel}」：生成工具失败（${detail}）。\n报错：${incident.errorDetail}`,
            `生成修复工具失败（${detail}），暂时无法自动修复。`,
          );
          return;
        }

        patchIncident(incident.id, {
          generatedToolName: toolAction.name,
          diagnosisSummary: summary || reason,
          consequence,
          fixCost,
          // 状态卡⑦(待确认安装)展示的 concise 文案。
          diagnosisText: `可修复：疑似缺少${capability ? `「${capability}」` : '某项工具能力'}，姬子已生成候选工具「${toolAction.name}」，需你在诊断会话确认安装。`,
        });

        usePendingActionStore.getState().setPending(incident.id, {
          action: toolAction,
          choice: 'confirm',
          customValue: actionDefaultCustomValue(toolAction),
          sessionId: incident.sessionId,
          incidentId: incident.id,
        });
        master.addDiagnosisMessage({
          role: 'assistant',
          content: [
            `诊断结果：节点「${incident.nodeLabel}」失败了，我判断大概率缺少${capability ? `「${capability}」` : '某项工具能力'}。`,
            `症状：${summary || '节点运行中断，后续节点拿不到它的结果。'}`,
            `最可能病因：${likelyCause || '当前工具能力覆盖不到这个节点要做的事。'}`,
            `判断证据：${evidence || incident.errorDetail}`,
            `影响：${consequence || '这个节点和它后面的节点暂时跑不下去。'}`,
            `严重程度：${severity || '中'}`,
            `修复代价：${fixCost || '中'}，需要你审阅并确认安装一个候选工具。`,
            `值不值得修：${worthFixing || '值得马上修'}`,
            `治疗方案：我已生成候选工具「${toolAction.name}」。确认安装后，我会先自动试运行；如果试运行失败，会尝试自修一次；通过后再挂到失败节点并重跑验证。`,
            `原始报错：${incident.errorDetail}`,
          ].filter(Boolean).join('\n'),
          status: 'done',
        });
        patchIncident(incident.id, { status: 'awaiting-confirm' });
        if (!visibleForSession(incident.sessionId)) refreshNotification();
      };

      // 严格工具门控失败的专门处理: 若失败仅仅是"节点没勾选某个已存在工具的标签",
      // 直接自动补上标签并挂起重跑, 无需走"造新工具"重流程。返回是否已处理。
      const tryAutoGrantToolTags = async (incident: Incident): Promise<boolean> => {
        if (incident.nodeId === PREFLIGHT_NODE_ID) return false;
        if (!incident.errorDetail.includes(MISSING_TOOL_TAG_MARKER)) return false;

        const canvas = useCanvasStore
          .getState()
          .canvases.find((c) => c.id === incident.canvasId);
        const node = canvas?.nodes.find((n) => n.id === incident.nodeId);
        if (!canvas || !node) return false;

        const required = requiredToolTagsForNode(canvas, node);
        const rawTags = (node.data as { toolTags?: unknown }).toolTags;
        const current = Array.isArray(rawTags)
          ? rawTags.filter((t): t is string => typeof t === 'string')
          : [];
        const missing = required.filter((tag) => !current.includes(tag));
        if (missing.length === 0) return false;

        // 仅当缺失标签全是"已注册的现成工具"时才自动补; 否则是真缺能力, 交回 diagnose 造工具。
        let available: string[];
        try {
          available = await listTools();
        } catch (e) {
          console.warn('[orchestrator] 列出已注册工具失败,放弃自动补标签', e);
          return false;
        }
        const availableSet = new Set(available);
        if (!missing.every((tag) => availableSet.has(tag))) return false;

        const nextTags = Array.from(new Set([...current, ...missing]));
        // 自动补标签 → 写回源画布节点(修复未来整图运行；nodeId 与运行副本一致)。
        useCanvasStore.getState().updateNodeData(incident.canvasId, incident.nodeId, {
          toolTags: nextTags,
        });

        const labels = missing.map((tag) => getToolDef(tag)?.label ?? tag);
        const canvasName = canvas.name ?? '目标画布';
        // 累计「自动补工具」计数(思考行为,展示到报告中心)。
        set((s) => ({ autoGrantedToolCount: s.autoGrantedToolCount + missing.length }));

        // 判定能否「就地重跑失败节点及其下游」: 运行副本 tab 仍在(id+runId 都对得上)
        // 且该 tab 上有目标 node。命中则不新开画布,直接在既有只读快照上重跑失败子图。
        const runTab =
          incident.runTabId && incident.runId
            ? useCanvasStore
                .getState()
                .canvases.find(
                  (c) => c.id === incident.runTabId && c.runId === incident.runId,
                )
            : undefined;

        if (runTab && runTab.nodes.some((n) => n.id === incident.nodeId)) {
          // 双写标签: 运行副本节点也补上, 让本次 ensureNodeCapabilities 过门控。
          useCanvasStore.getState().updateNodeData(runTab.id, incident.nodeId, {
            toolTags: nextTags,
          });
          useMasterAgentStore.getState().addDiagnosisMessage({
            role: 'assistant',
            content: `节点「${incident.nodeLabel}」缺少工具标签，且这些工具已存在，无需新建。我已自动为其补上：${labels.join('、')}，并将就地重跑失败节点及其下游验证修复（不新开画布）。`,
            status: 'done',
          });
          usePendingActionStore.getState().setPending(incident.id, {
            action: {
              type: 'rerun-canvas-node',
              runTabId: runTab.id,
              nodeId: incident.nodeId,
              sourceCanvasId: incident.canvasId,
            },
            choice: 'confirm',
            customValue: '',
            sessionId: incident.sessionId,
            incidentId: incident.id,
          });
          useCanvasStore.getState().setActive(runTab.id);
          // status 'repairing' + diagnosisText 驱动状态卡⑥/⑤(修复中→重新运行中);
          // 卡片按 runState 派生终态,无需再挂 autoToolNotice。
          patchIncident(incident.id, {
            status: 'repairing',
            diagnosisText: `可自动修复：节点缺少 ${labels.join('、')}，该工具已存在，姬子已自动补上并就地重跑验证。`,
          });
          void usePendingActionStore.getState().runPending(incident.id, 'confirm');
          return true;
        }

        // 回落: 无法就地重跑(预检失败/tab 已关/节点缺失)→ v2.86 整图重跑。
        // 整图重跑会新开只读运行快照(runId 与本 incident 不同),新快照上的状态卡按 runState
        // 独立派生;诊断固定会话仍保有完整记录。这里置 'repairing' 以反映「已修复,正在重新运行」。
        useMasterAgentStore.getState().addDiagnosisMessage({
          role: 'assistant',
          content: `节点「${incident.nodeLabel}」缺少工具标签，且这些工具已存在，无需新建。我已自动为其补上：${labels.join('、')}，并将重跑画布「${canvasName}」验证修复。`,
          status: 'done',
        });
        usePendingActionStore.getState().setPending(incident.id, {
          action: { type: 'run-active-canvas' },
          choice: 'confirm',
          customValue: '',
          sessionId: incident.sessionId,
          incidentId: incident.id,
        });
        useCanvasStore.getState().setActive(incident.canvasId);
        patchIncident(incident.id, {
          status: 'repairing',
          diagnosisText: `可自动修复：节点缺少 ${labels.join('、')}，该工具已存在，姬子已自动补上并重跑画布验证。`,
        });
        void usePendingActionStore.getState().runPending(incident.id, 'confirm');
        return true;
      };

      // 失败处理入口: 先尝试"自动补已有工具标签", 命中即结束; 否则回落到 diagnose 造工具。
      const tryAutoGrantThenDiagnose = async (incident: Incident) => {
        if (await tryAutoGrantToolTags(incident)) return;
        await diagnose(incident);
      };

      return {
        enabled: true,
        incidents: [],
        autoGrantedToolCount: 0,
        installedToolCount: 0,

        setEnabled: (v) => set({ enabled: v }),

        recordToolInstalled: () =>
          set((s) => ({ installedToolCount: s.installedToolCount + 1 })),

        // 忽略 = 放弃这块画布:标记 ignored(移出问题列表),并停止其仍在进行的运行。
        // 停得到(手动运行有登记的中止控制器)→ 运行走中止收尾为「已取消」终态;停不到说明
        // 运行早已结束(通常已是失败终态),无需再动。
        ignoreIncident: (id) => {
          const incident = get().incidents.find((i) => i.id === id);
          set((s) => ({ incidents: reduceIgnore(s.incidents, id) }));
          if (incident) abortRunByCanvasId(incident.canvasId);
          refreshNotification();
        },

        // 用户在确认卡片上取消修复:退回「失败」重新进问题列表,可再忽略或手动排查。
        // 仅对仍在等待确认(awaiting-confirm)的 incident 生效。
        revertToFailed: (incidentId) => {
          set((s) => ({
            incidents: reduceRevertToFailed(s.incidents, incidentId),
          }));
          refreshNotification();
        },

        // 运行记录被删除:清掉挂在该 run 上的失败去重键,使该节点日后同样失败仍能被重新诊断。
        // 只清 diagnosedKeys,不动 incidents(瞬态,自有裁剪);无匹配则不触发状态更新。
        clearDiagnosedForRun: (runId) => {
          for (const inc of get().incidents) {
            if (inc.runId === runId) diagnosedKeys.delete(dedupKey(inc));
          }
        },

        // 自愈重跑收尾:重跑结束后由 pendingActionStore 回读画布运行结果调用。
        // 重跑不抛错(全节点通过)→ 'resolved';抛错(仍有节点失败/被中止)→ 'failed'。
        // 仅收尾仍在修复窗口(repairing)或已乐观标 resolved 的 incident,其它状态不动。
        finalizeRepair: (incidentId, ok) =>
          set((s) => ({
            incidents: reduceFinalizeRepair(s.incidents, incidentId, ok),
          })),

        reportNodeFailure: (input) => {
          if (!get().enabled) return;
          const key = dedupKey(input);
          if (diagnosedKeys.has(key)) return;
          diagnosedKeys.add(key);

          // 诊断信息统一写入固定「诊断信息」会话,不再污染用户当前对话上下文。
          const master = useMasterAgentStore.getState();
          const sessionId = master.ensureDiagnosisSession();

          const incident: Incident = {
            id: uid('incident'),
            canvasId: input.canvasId,
            nodeId: input.nodeId,
            nodeLabel: input.nodeLabel,
            errorDetail: input.errorDetail,
            sessionId,
            status: 'diagnosing',
            createdAt: Date.now(),
            runTabId: input.runTabId,
            runId: input.runId,
          };
          // 裁剪超限的终态 incident;被裁掉的同步清掉其 diagnosedKeys 去重键,避免 Set 无限
          // 增长、也让同一失败日后能再诊断。
          set((s) => {
            const all = [...s.incidents, incident];
            const { kept, removedIds } = capIncidents(all, INCIDENT_CAP);
            if (removedIds.length > 0) {
              const removedSet = new Set(removedIds);
              for (const inc of all) {
                if (removedSet.has(inc.id)) diagnosedKeys.delete(dedupKey(inc));
              }
            }
            return { incidents: kept };
          });
          refreshNotification();
          void tryAutoGrantThenDiagnose(incident).catch((e) =>
            console.error('[orchestrator] 自愈诊断流程异常', e),
          );
        },

        onToolInstalled: async (incidentId, sessionId) => {
          const incident = get().incidents.find((i) => i.id === incidentId);
          if (!incident) return;
          const canvas = useCanvasStore
            .getState()
            .canvases.find((c) => c.id === incident.canvasId);
          const canvasName = canvas?.name ?? '目标画布';
          if (canvas && incident.generatedToolName) {
            const node = canvas.nodes.find((n) => n.id === incident.nodeId);
            const rawTags = (node?.data as { toolTags?: unknown } | undefined)?.toolTags;
            const current = Array.isArray(rawTags)
              ? rawTags.filter((tag): tag is string => typeof tag === 'string')
              : [];
            if (!current.includes(incident.generatedToolName)) {
              useCanvasStore.getState().updateNodeData(incident.canvasId, incident.nodeId, {
                toolTags: [...current, incident.generatedToolName],
              });
            }
          }
          useMasterAgentStore.getState().addDiagnosisMessage({
            role: 'assistant',
            content: incident.generatedToolName
              ? `工具「${incident.generatedToolName}」已安装完成。我已把它补到失败节点「${incident.nodeLabel}」上，现在自动重跑画布「${canvasName}」验证修复。`
              : `工具已安装完成。现在自动重跑画布「${canvasName}」验证节点「${incident.nodeLabel}」是否已修复。`,
            status: 'done',
          });
          usePendingActionStore.getState().setPending(incident.id, {
            action: { type: 'run-active-canvas' },
            choice: 'confirm',
            customValue: '',
            sessionId,
            incidentId: incident.id,
          });
          // run-active-canvas 只跑 active 画布,重跑前先把 active 切到源画布。
          if (canvas) useCanvasStore.getState().setActive(incident.canvasId);
          // 先置 repairing(重跑中),重跑结束由 pendingActionStore 回读结果 finalizeRepair 收尾为
          // resolved/failed;不再乐观直接标 resolved。
          patchIncident(incident.id, { status: 'repairing' });
          refreshNotification();
          void usePendingActionStore.getState().runPending(incident.id, 'confirm');
        },
      };
    },
    {
      name: 'multi-agent-orchestrator',
      storage: createProjectStorage(),
      version: 1,
      // 持久化诊断开关 + 两个自愈计数;incidents 为瞬态,不入盘。
      partialize: (s) => ({
        enabled: s.enabled,
        autoGrantedToolCount: s.autoGrantedToolCount,
        installedToolCount: s.installedToolCount,
      }),
      // 只合并 partialize 写入的字段,incidents 等瞬态字段永远保留 current 默认值。
      merge: (persisted, current) => {
        const saved = persisted as Partial<OrchestratorState> | undefined;
        return {
          ...current,
          enabled: saved?.enabled ?? current.enabled,
          autoGrantedToolCount: saved?.autoGrantedToolCount ?? 0,
          installedToolCount: saved?.installedToolCount ?? 0,
        };
      },
    },
  ),
);

registerOrchestratorBridge({
  reportNodeFailure: (input) =>
    useOrchestratorStore.getState().reportNodeFailure(input),
  clearDiagnosedForRun: (runId) =>
    useOrchestratorStore.getState().clearDiagnosedForRun(runId),
  revertToFailed: (incidentId) =>
    useOrchestratorStore.getState().revertToFailed(incidentId),
  recordToolInstalled: () =>
    useOrchestratorStore.getState().recordToolInstalled(),
  onToolInstalled: (incidentId, sessionId) =>
    useOrchestratorStore.getState().onToolInstalled(incidentId, sessionId),
  finalizeRepair: (incidentId, ok) =>
    useOrchestratorStore.getState().finalizeRepair(incidentId, ok),
});

