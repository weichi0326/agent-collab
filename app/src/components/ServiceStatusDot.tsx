import { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { getServiceStatus, type ServiceStatus } from '../lib/pythonClient';

const POLL_INTERVAL = 8000;

const TOOLTIP_TEXT: Record<ServiceStatus, string> = {
  running: '后台服务运行中',
  starting: '后台服务启动中…',
  stopped: '后台服务未启动，可点右侧「重启后台」',
};

/**
 * 常驻服务状态指示灯：组件本地 state 轮询 getServiceStatus()，不接 zustand。
 * 绿=运行中 / 黄=启动中 / 红=未启动。
 */
export default function ServiceStatusDot({ className = '' }: { className?: string }) {
  const [status, setStatus] = useState<ServiceStatus>('starting');

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const next = await getServiceStatus();
      if (alive) setStatus(next);
    };
    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Tooltip title={TOOLTIP_TEXT[status]}>
      <span className={`service-dot service-dot--${status} ${className}`.trim()} />
    </Tooltip>
  );
}
