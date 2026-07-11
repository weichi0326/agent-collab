import { useEffect, useRef, useState } from 'react';
import { Switch, Tooltip } from 'antd';
import { RobotOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import MasterAgentPanel from './MasterAgentPanel';
import MasterSessionRail from './MasterSessionRail';
import MasterConfigModal from './MasterConfigModal';
import { useMasterAgentStore } from '../stores/masterAgentStore';
import { useUiStore } from '../stores/uiStore';

// 收起超过该时长后卸载抽屉内容,释放会话/消息占用的内存与渲染;再次展开即重新挂载。
const UNMOUNT_DELAY_MS = 5 * 60 * 1000;

export function masterDrawerClassName(
  expanded: boolean,
  fullscreen: boolean,
): string {
  return expanded && fullscreen
    ? 'master-drawer master-drawer--fullscreen'
    : 'master-drawer';
}

export function DrawerModeSwitch({
  fullscreen,
  onChange,
}: {
  fullscreen: boolean;
  onChange: (value: boolean) => void;
}) {
  const state = fullscreen ? '全屏' : '半屏';
  return (
    <Tooltip title={fullscreen ? '切换为半屏' : '切换为全屏'}>
      <Switch
        checked={fullscreen}
        checkedChildren="全屏"
        unCheckedChildren="半屏"
        aria-label={`姬子显示模式，当前${state}`}
        onChange={onChange}
      />
    </Tooltip>
  );
}

// 顶部抽屉外壳:pill 徽章触发展开/收起。展开即挂载(mounted)内容,
// 并保留在 DOM 里靠 CSS height 过渡;收起超过 UNMOUNT_DELAY_MS 后卸载,省去无谓的内存与渲染。
// 4.4 修订:收起时若仍有 in-flight 请求(任意会话有 sending 消息),等任务跑完再开始倒计时,
// 避免卸载 abort 掉还在跑的姬子回复;展开抽屉直接打断倒计时。
function MasterAgentDrawer() {
  const expanded = useUiStore((s) => s.drawerExpanded);
  const setExpanded = useUiStore((s) => s.setDrawerExpanded);
  const fullscreen = useUiStore((s) => s.drawerFullscreen);
  const setFullscreen = useUiStore((s) => s.setDrawerFullscreen);
  const [configOpen, setConfigOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const unmountTimerRef = useRef<number | null>(null);
  // 是否有任意会话正在生成回复(不区分当前会话,因为卸载会 abort 所有 in-flight)
  const anySending = useMasterAgentStore((s) =>
    s.sessions.some((sess) =>
      sess.messages.some((m) => m.status === 'sending'),
    ),
  );

  useEffect(() => {
    const clearTimer = () => {
      if (unmountTimerRef.current !== null) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    };
    if (expanded) {
      // 展开即挂载并打断倒计时
      setMounted(true);
      clearTimer();
    } else if (mounted) {
      clearTimer();
      // 有任务在跑时不设倒计时;等 anySending 变 false 时 effect 重跑再设
      if (!anySending) {
        unmountTimerRef.current = window.setTimeout(
          () => setMounted(false),
          UNMOUNT_DELAY_MS,
        );
      }
    }
    return clearTimer;
  }, [expanded, mounted, anySending]);

  return (
    <div className={masterDrawerClassName(expanded, fullscreen)}>
      <div className="master-drawer__bar">
        <button
          type="button"
          className="master-drawer__trigger"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? '收起姬子' : '展开姬子'}
          title={expanded ? '收起姬子' : '展开姬子'}
        >
          <span className="master-drawer__handle">
            <RobotOutlined />
            姬子
            {expanded ? <UpOutlined /> : <DownOutlined />}
          </span>
        </button>
        {expanded && (
          <div className="master-drawer__mode">
            <DrawerModeSwitch
              fullscreen={fullscreen}
              onChange={setFullscreen}
            />
          </div>
        )}
      </div>
      <div
        className={`master-drawer__content${
          expanded ? ' master-drawer__content--open' : ''
        }`}
      >
        {mounted && (
          <div className="master-drawer__layout">
            <MasterSessionRail onOpenConfig={() => setConfigOpen(true)} />
            <MasterAgentPanel />
          </div>
        )}
      </div>
      <MasterConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}

export default MasterAgentDrawer;
