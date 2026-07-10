import type { MasterAction } from '../../lib/masterActions';
import type { UserChoiceOption } from '../../lib/jiziIntentPlanner';

export type ActionChoice = 'confirm' | 'cancel' | 'custom';

export interface PendingActionView {
  action: MasterAction;
  choice: ActionChoice;
  customValue: string;
  // 卡片所属会话。store 的 key 是「槽位 id」(普通对话=sessionId,诊断=incidentId),不再等同
  // sessionId,故这里显式记录,UI 才能按会话过滤出本会话该展示的所有卡片。
  sessionId: string;
  // 该待确认动作若源自某次节点失败诊断，记录事件 id，安装成功后据此触发重跑画布。
  // 诊断动作的槽位 id 即 incidentId,使多个失败的确认卡片互不覆盖。
  incidentId?: string;
}

export type UserChoiceSelection = 'custom' | string;

export interface PendingUserChoiceView {
  sessionId: string;
  originalText: string;
  title: string;
  summary: string;
  options: UserChoiceOption[];
  choice: UserChoiceSelection;
  customValue: string;
  customPlaceholder: string;
}

export interface Attachment {
  id: string;
  file: File;
  isImage: boolean;
  previewUrl?: string;
}
