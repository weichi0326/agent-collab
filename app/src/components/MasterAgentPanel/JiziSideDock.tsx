import { useMemo, useState } from 'react';
import { App, Dropdown, Tooltip, type MenuProps } from 'antd';
import {
  RobotOutlined,
  PlusOutlined,
  DownOutlined,
  MenuFoldOutlined,
  DeleteOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';
import MasterAgentPanel from '../MasterAgentPanel';
import ResizeHandle from '../ResizeHandle';
import { useUiStore } from '../../stores/uiStore';
import {
  useMasterAgentStore,
  DIAGNOSIS_SESSION_ID,
} from '../../stores/masterAgentStore';

// 侧栏模式下姬子常驻:折叠成窄条(点图标展开)/展开为会话下拉 + 复用聊天面板。
// 会话切换收成顶部下拉,避免 208px 会话栏挤占窄侧栏宽度。
function JiziSideDock() {
  const { modal } = App.useApp();
  const width = useUiStore((s) => s.jiziWidth);
  const collapsed = useUiStore((s) => s.jiziSideCollapsed);
  const setCollapsed = useUiStore((s) => s.setJiziSideCollapsed);

  const sessions = useMasterAgentStore((s) => s.sessions);
  const activeId = useMasterAgentStore((s) => s.activeId);
  const newSession = useMasterAgentStore((s) => s.newSession);
  const switchSession = useMasterAgentStore((s) => s.switchSession);
  const deleteSession = useMasterAgentStore((s) => s.deleteSession);
  const [menuOpen, setMenuOpen] = useState(false);

  const ordered = useMemo(() => {
    const diagnosis = sessions.filter((s) => s.id === DIAGNOSIS_SESSION_ID);
    const rest = sessions
      .filter((s) => s.id !== DIAGNOSIS_SESSION_ID)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return [...diagnosis, ...rest];
  }, [sessions]);

  const activeTitle =
    sessions.find((s) => s.id === activeId)?.title ?? '姬子';

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

  const items: MenuProps['items'] = ordered.map((s) => {
    const isDiagnosis = s.id === DIAGNOSIS_SESSION_ID;
    return {
      key: s.id,
      icon: isDiagnosis ? <MedicineBoxOutlined /> : undefined,
      label: (
        <span className="jizi-side-dock__session-item">
          <span className="jizi-side-dock__session-title">{s.title}</span>
          {!isDiagnosis && (
            <Tooltip title="删除会话">
              <DeleteOutlined
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id, s.title);
                }}
              />
            </Tooltip>
          )}
        </span>
      ),
    };
  });

  if (collapsed) {
    return (
      <div className="jizi-side-dock jizi-side-dock--collapsed">
        <div className="jizi-side-dock__inner">
          <Tooltip title="展开姬子" placement="left">
            <button
              type="button"
              className="jizi-side-dock__expand"
              aria-label="展开姬子"
              onClick={() => setCollapsed(false)}
            >
              <RobotOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="jizi-side-dock" style={{ width }}>
      <ResizeHandle side="jizi" />
      <div className="jizi-side-dock__inner">
        <div className="jizi-side-dock__header">
          <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={['click']}
          menu={{
            items,
            selectedKeys: activeId ? [activeId] : [],
            onClick: ({ key }) => {
              switchSession(key);
              setMenuOpen(false);
            },
          }}
        >
          <button type="button" className="jizi-side-dock__session-switch">
            <RobotOutlined />
            <span className="jizi-side-dock__session-current">{activeTitle}</span>
            <DownOutlined />
          </button>
        </Dropdown>
        <div className="jizi-side-dock__actions">
          <Tooltip title="新建会话">
            <button
              type="button"
              className="jizi-side-dock__icon-btn"
              aria-label="新建会话"
              onClick={() => newSession()}
            >
              <PlusOutlined />
            </button>
          </Tooltip>
          <Tooltip title="折叠">
            <button
              type="button"
              className="jizi-side-dock__icon-btn"
              aria-label="折叠姬子"
              onClick={() => setCollapsed(true)}
            >
              <MenuFoldOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
        <div className="jizi-side-dock__body">
          <MasterAgentPanel />
        </div>
      </div>
    </div>
  );
}

export default JiziSideDock;
