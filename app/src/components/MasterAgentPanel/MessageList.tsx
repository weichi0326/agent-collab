import { Button, Input, Radio, Tag } from 'antd';
import {
  FileUnknownOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { ChatMessage } from '../../stores/masterAgentStore';
import {
  describeMasterAction,
  masterActionItems,
  actionRiskNotice,
} from '../../lib/masterActions';
import {
  actionAllowsCustom,
  actionCustomLabel,
} from './actionCustomization';
import { fileIcon, isSafeHttpUrl } from './fileHelpers';
import type {
  ActionChoice,
  PendingActionView,
  PendingUserChoiceView,
} from './types';
import { useJiziAutonomyStore } from '../../stores/jiziAutonomyStore';
import { AssistantMarkdown } from './AssistantMarkdown';

function flowStatusLabel(status: 'done' | 'skipped' | 'pending'): string {
  if (status === 'done') return '完成';
  if (status === 'pending') return '等待';
  return '跳过';
}

function autonomyStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    observing: '观察项目',
    planning: '制定计划',
    'awaiting-confirmation': '等待确认',
    'awaiting-destructive-confirmation': '等待删除确认',
    executing: '执行中',
    verifying: '验证结果',
    replanning: '重新规划',
    completed: '已完成',
    failed: '已停止',
    cancelled: '已取消',
  };
  return labels[status] ?? '未知';
}

interface MessageListProps {
  messages: ChatMessage[];
  // 本会话该展示的所有待确认卡片。普通对话至多一张;诊断固定会话可同时有多张(每个失败一张,
  // 按 incidentId 分槽互不覆盖)。
  pendingActions: PendingActionView[];
  pendingUserChoice?: PendingUserChoiceView | null;
  activeSessionId: string | null;
  activeSending: boolean;
  onSuggestion: (value: string) => void;
  suggestions: string[];
  setPendingActionChoice: (sessionId: string, choice: ActionChoice) => void;
  setPendingActionCustomValue: (sessionId: string, value: string) => void;
  runPendingAction: (sessionId: string, choice?: ActionChoice) => void;
  setPendingUserChoiceChoice: (choice: string) => void;
  setPendingUserChoiceCustomValue: (value: string) => void;
  submitPendingUserChoice: () => void;
}

export function MessageList({
  messages,
  pendingActions,
  pendingUserChoice,
  activeSessionId,
  activeSending,
  onSuggestion,
  suggestions,
  setPendingActionChoice,
  setPendingActionCustomValue,
  runPendingAction,
  setPendingUserChoiceChoice,
  setPendingUserChoiceCustomValue,
  submitPendingUserChoice,
}: MessageListProps) {
  const autonomyRuns = useJiziAutonomyStore((state) => state.runs);
  if (messages.length === 0) {
    return (
      <>
        <div className="master-hello">
          <div className="master-hello__title">你好 👋</div>
          <div className="master-hello__desc">
            我是姬子，帮你理解与规划画布、Agent 与工作流
          </div>
        </div>
        <div className="master-suggests">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="master-suggest"
              onClick={() => onSuggestion(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="master-msgs">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`master-msg master-msg--${m.role}${
            m.status === 'error' ? ' master-msg--error' : ''
          }`}
        >
          <div className="master-msg__bubble">
            {m.attachments && m.attachments.length > 0 && (
              <div className="master-msg__atts">
                {m.attachments.map((a, i) => (
                  <span className="master-msg__att" key={i}>
                    {a.isImage ? <FileUnknownOutlined /> : fileIcon(a.name)}
                    {a.name}
                  </span>
                ))}
              </div>
            )}
            {m.status === 'sending' && !m.content ? (
              <span className="master-msg__loading">
                <LoadingOutlined /> 思考中…
              </span>
            ) : (
              <div className="master-msg__text">
                {m.role === 'assistant' ? (
                  <AssistantMarkdown content={m.content} />
                ) : (
                  m.content
                )}
              </div>
            )}
            {m.sources && m.sources.length > 0 && (
              <div className="master-msg__sources">
                <div className="master-msg__sources-title">参考来源</div>
                {m.sources.filter((s) => isSafeHttpUrl(s.link)).map((s, i) => (
                  <a
                    key={i}
                    className="master-msg__source"
                    href={s.link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {i + 1}. {s.title || s.link}
                  </a>
                ))}
              </div>
            )}
            {m.role === 'assistant' && m.meta && (
              <details className="master-msg-meta">
                <summary>本轮判断摘要</summary>
                <div className="master-msg-meta__grid">
                  {m.meta.routeLabel && (
                    <div>
                      <span>路线</span>
                      <strong>{m.meta.routeLabel}</strong>
                    </div>
                  )}
                  {m.meta.searchLabel && (
                    <div>
                      <span>联网</span>
                      <strong>{m.meta.searchLabel}</strong>
                    </div>
                  )}
                  {m.meta.modelLabel && (
                    <div>
                      <span>模型</span>
                      <strong>{m.meta.modelLabel}</strong>
                    </div>
                  )}
                  {m.meta.imageContextLabel && (
                    <div>
                      <span>图片</span>
                      <strong>{m.meta.imageContextLabel}</strong>
                    </div>
                  )}
                  {m.meta.reason && (
                    <div>
                      <span>原因</span>
                      <strong>{m.meta.reason}</strong>
                    </div>
                  )}
                </div>
                {m.meta.skills && m.meta.skills.length > 0 && (
                  <div className="master-msg-meta__skills">
                    <div className="master-msg-meta__title">启用技能</div>
                    {m.meta.skills.map((skill) => (
                      <div className="master-msg-meta__skill" key={skill.id}>
                        <Tag color="blue" variant="filled">
                          {skill.title}
                        </Tag>
                        {skill.reason && <span>{skill.reason}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {m.meta.skillWarning && (
                  <div className="master-msg-meta__warning">{m.meta.skillWarning}</div>
                )}
                {m.meta.flow && m.meta.flow.length > 0 && (
                  <div className="master-flow">
                    {m.meta.flow.map((step, index) => (
                      <div className="master-flow__item" key={`${step.label}-${index}`}>
                        <div className={`master-flow__dot master-flow__dot--${step.status}`} />
                        <div className="master-flow__body">
                          <div className="master-flow__label">{step.label}</div>
                          <div className="master-flow__detail">
                            {flowStatusLabel(step.status)}
                            {step.detail ? `：${step.detail}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            )}
          </div>
        </div>
      ))}
      {activeSessionId &&
        pendingActions.map((pendingAction) => {
          // 槽位 id:诊断动作用 incidentId(多失败互不覆盖),普通对话回落 sessionId。
          const slotId = pendingAction.incidentId ?? pendingAction.sessionId;
          const autonomyRun = autonomyRuns[pendingAction.sessionId];
          return (
            <div key={slotId} className="master-msg master-msg--assistant">
              <div className="master-action-card">
                <div className="master-action-card__title">
                  {pendingAction.confirmationStage === 'destructive-final'
                    ? '最终确认：以下删除操作执行后将从当前项目移除对象'
                    : `我将为你${describeMasterAction(pendingAction.action)}`}
                </div>
                {pendingAction.action.type === 'plan' && (
                  <ol className="master-action-card__steps">
                    {masterActionItems(pendingAction.action).map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ol>
                )}
                {actionRiskNotice(pendingAction.action) && (
                  <div className="master-action-card__risk">
                    {actionRiskNotice(pendingAction.action)}
                  </div>
                )}
                {autonomyRun && (
                  <div className="master-action-card__risk">
                    自主任务阶段：{autonomyStatusLabel(autonomyRun.task.status)}；已执行 {autonomyRun.task.executedSteps}/8 步；已重新规划 {autonomyRun.task.replans}/2 次。
                  </div>
                )}
                {pendingAction.action.type === 'create-tool' && (
                  <div className="master-action-card__code">
                    <div className="master-action-card__code-hint">
                      安装前请审阅完整代码，确认无风险后再执行：
                    </div>
                    <pre className="master-action-card__code-block">
                      {pendingAction.action.code}
                    </pre>
                  </div>
                )}
                <Radio.Group
                  className="master-action-card__choices"
                  value={pendingAction.choice}
                  onChange={(e) => setPendingActionChoice(slotId, e.target.value)}
                >
                  <Radio value="confirm">
                    {pendingAction.confirmationStage === 'destructive-final'
                      ? '确认删除'
                      : '确认执行'}
                  </Radio>
                  <Radio value="cancel">取消</Radio>
                  {actionAllowsCustom(pendingAction.action) && (
                    <Radio value="custom">自定义</Radio>
                  )}
                </Radio.Group>
                {pendingAction.choice === 'custom' &&
                  actionAllowsCustom(pendingAction.action) && (
                    <Input
                      className="master-action-card__input"
                      value={pendingAction.customValue}
                      placeholder={actionCustomLabel(pendingAction.action)}
                      onChange={(e) =>
                        setPendingActionCustomValue(slotId, e.target.value)
                      }
                      onPressEnter={() => void runPendingAction(slotId, 'custom')}
                    />
                  )}
                <div className="master-action-card__footer">
                  <Button
                    size="small"
                    type="primary"
                    loading={activeSending}
                    disabled={
                      pendingAction.choice === 'custom' &&
                      actionAllowsCustom(pendingAction.action) &&
                      !pendingAction.customValue.trim()
                    }
                    onClick={() => void runPendingAction(slotId)}
                  >
                    提交
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      {pendingUserChoice && activeSessionId === pendingUserChoice.sessionId && (
        <div className="master-msg master-msg--assistant">
          <div className="master-choice-card">
            <div className="master-choice-card__title">
              {pendingUserChoice.title}
            </div>
            {pendingUserChoice.summary && (
              <div className="master-choice-card__summary">
                {pendingUserChoice.summary}
              </div>
            )}
            <Radio.Group
              className="master-choice-card__choices"
              value={pendingUserChoice.choice}
              onChange={(e) => setPendingUserChoiceChoice(e.target.value)}
            >
              {pendingUserChoice.options.map((option) => (
                <Radio
                  key={option.id}
                  className="master-choice-card__option"
                  value={option.id}
                >
                  <span className="master-choice-card__option-main">
                    <span className="master-choice-card__option-title">
                      {option.title}
                    </span>
                    {option.recommended && (
                      <Tag color="green" variant="filled">
                        推荐
                      </Tag>
                    )}
                  </span>
                  <span className="master-choice-card__option-desc">
                    {option.description}
                  </span>
                </Radio>
              ))}
              <Radio className="master-choice-card__option" value="custom">
                <span className="master-choice-card__option-title">自定义</span>
                <span className="master-choice-card__option-desc">
                  自己输入方案，再交给姬子继续处理
                </span>
              </Radio>
            </Radio.Group>
            {pendingUserChoice.choice === 'custom' && (
              <Input
                className="master-choice-card__input"
                value={pendingUserChoice.customValue}
                placeholder={pendingUserChoice.customPlaceholder}
                onChange={(e) =>
                  setPendingUserChoiceCustomValue(e.target.value)
                }
                onPressEnter={() => submitPendingUserChoice()}
              />
            )}
            <div className="master-choice-card__footer">
              <Button
                size="small"
                type="primary"
                loading={activeSending}
                disabled={
                  pendingUserChoice.choice === 'custom' &&
                  !pendingUserChoice.customValue.trim()
                }
                onClick={submitPendingUserChoice}
              >
                提交给姬子
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


