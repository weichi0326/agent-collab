import { LoadingOutlined } from '@ant-design/icons';
import type { TestResult } from '../stores/modelStore';

// 手机信号天线样式:三格竖条。
// ok-low 满格绿(低延迟)、ok-high 满格黄(高延迟)、fail 红色空心(失败/超时)、testing 灰色转圈。

const COLORS: Record<string, string> = {
  'ok-low': '#00b42a',
  'ok-high': '#ff9a2e',
  fail: '#f53f3f',
  idle: '#c9cdd4',
};

const LABELS: Record<string, string> = {
  'ok-low': '低延迟',
  'ok-high': '高延迟',
  fail: '不通过',
  idle: '未测试',
  testing: '测试中',
};

function SignalIcon({ test }: { test: TestResult }) {
  const { status, latencyMs } = test;

  if (status === 'testing') {
    return (
      <span className="signal" style={{ color: '#86909c' }}>
        <LoadingOutlined spin />
        <span className="signal__label">测试中…</span>
      </span>
    );
  }

  const color = COLORS[status] ?? COLORS.idle;
  const active = status === 'ok-low' || status === 'ok-high';
  // fail:三格全画但淡红空心;正常:按档位填色
  const bars = [6, 11, 16];

  return (
    <span className="signal" style={{ color }} title={LABELS[status]}>
      <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden>
        {bars.map((h, i) => {
          const x = i * 7 + 1;
          const y = 17 - h;
          const filled = active || status === 'fail';
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width="5"
              height={h}
              rx="1"
              fill={filled ? color : 'none'}
              stroke={color}
              strokeWidth="1"
              opacity={status === 'fail' ? 0.55 : 1}
            />
          );
        })}
        {status === 'fail' && (
          <line
            x1="2"
            y1="16"
            x2="20"
            y2="2"
            stroke={color}
            strokeWidth="1.6"
          />
        )}
      </svg>
      <span className="signal__label">
        {LABELS[status] ?? '未测试'}
        {active && latencyMs != null ? ` · ${latencyMs}ms` : ''}
      </span>
    </span>
  );
}

export default SignalIcon;
