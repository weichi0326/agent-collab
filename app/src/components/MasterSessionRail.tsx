import { useMemo, useState } from 'react';
import { App, Input, Tooltip } from 'antd';
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  SettingOutlined,
  LoadingOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';
import {
  useMasterAgentStore,
  DIAGNOSIS_SESSION_ID,
} from '../stores/masterAgentStore';

interface Props {
  onOpenConfig: () => void;
}

// 左侧会话栏:新建 / 切换 / 重命名(双击标题)/ 删除。删除即从 store 移除并落盘,永久销毁。
function MasterSessionRail({ onOpenConfig }: Props) {
  const { modal } = App.useApp();
  const sessions = useMasterAgentStore((s) => s.sessions);
  const activeId = useMasterAgentStore((s) => s.activeId);
  const newSession = useMasterAgentStore((s) => s.newSession);
  const switchSession = useMasterAgentStore((s) => s.switchSession);
  const deleteSession = useMasterAgentStore((s) => s.deleteSession);
  const renameSession = useMasterAgentStore((s) => s.renameSession);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // 诊断固定会话始终置顶(不可删除/改名),其余按最近更新排序。
  const ordered = useMemo(() => {
    const diagnosis = sessions.filter((s) => s.id === DIAGNOSIS_SESSION_ID);
    const rest = sessions
      .filter((s) => s.id !== DIAGNOSIS_SESSION_ID)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return [...diagnosis, ...rest];
  }, [sessions]);

  const beginRename = (id: string, title: string) => {
    setEditingId(id);
    setEditText(title);
  };

  const commitRename = () => {
    if (editingId) renameSession(editingId, editText);
    setEditingId(null);
    setEditText('');
  };

  const onDelete = (id: string, title: string) => {
    modal.confirm({
      title: '删除会话',
      content: `确定删除「${title}」？该会话的消息将被永久销毁，不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteSession(id),
    });
  };

  return (
    <div className="session-rail">
      <div className="session-rail__top">
        <button
          type="button"
          className="session-rail__new"
          onClick={() => newSession()}
        >
          <PlusOutlined /> 新建会话
        </button>
        <Tooltip title="姬子配置">
          <button
            type="button"
            className="session-rail__config"
            onClick={onOpenConfig}
          >
            <SettingOutlined />
          </button>
        </Tooltip>
      </div>

      <div className="session-rail__list">
        {ordered.length === 0 ? (
          <div className="session-rail__empty">暂无会话</div>
        ) : (
          ordered.map((s) => {
            // 4.7：会话内有正在生成的回复(可能不是当前会话)时,列表项显示 loading,提示后台仍在处理
            const busy = s.messages.some((m) => m.status === 'sending');
            const isDiagnosis = s.id === DIAGNOSIS_SESSION_ID;
            return (
            <div
              key={s.id}
              className={`session-item${
                s.id === activeId ? ' session-item--active' : ''
              }${isDiagnosis ? ' session-item--diagnosis' : ''}`}
              onClick={() => switchSession(s.id)}
            >
              {isDiagnosis ? (
                <MedicineBoxOutlined className="session-item__icon" />
              ) : busy ? (
                <LoadingOutlined className="session-item__icon" spin />
              ) : (
                <MessageOutlined className="session-item__icon" />
              )}
              {!isDiagnosis && editingId === s.id ? (
                <Input
                  size="small"
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={commitRename}
                  onPressEnter={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  className="session-item__edit"
                />
              ) : (
                <span
                  className="session-item__title"
                  onDoubleClick={(e) => {
                    if (isDiagnosis) return; // 诊断会话不可改名
                    e.stopPropagation();
                    beginRename(s.id, s.title);
                  }}
                  title={isDiagnosis ? '姬子诊断信息(固定会话)' : '双击重命名'}
                >
                  {s.title}
                </span>
              )}
              {!isDiagnosis && (
                <Tooltip title="删除会话">
                  <DeleteOutlined
                    className="session-item__del"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(s.id, s.title);
                    }}
                  />
                </Tooltip>
              )}
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default MasterSessionRail;
