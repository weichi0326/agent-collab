import { Collapse } from 'antd';

// 特殊组件调色板:门控 + 定时等「控制类节点」,拖入画布即建。
// 门控与 CanvasArea.onDrop 的 'application/gate' 约定对应;定时对应 'application/timer'。
type SpecialChip =
  | { kind: 'gate'; gateType: 'or' | 'and'; label: string; hint: string; dot: string }
  | { kind: 'timer'; label: string; hint: string; dot: string };

const CHIPS: SpecialChip[] = [
  { kind: 'gate', gateType: 'or', label: '或门', hint: '任一上游通过 → 通过', dot: '#2f54eb' },
  { kind: 'gate', gateType: 'and', label: '与门', hint: '全部上游通过 → 通过', dot: '#389e0d' },
  { kind: 'timer', label: '定时', hint: '上游通过后倒计时,计时完毕放行下游', dot: '#f7de98' },
];

function onDragStart(e: React.DragEvent, chip: SpecialChip) {
  if (chip.kind === 'gate') {
    e.dataTransfer.setData('application/gate', JSON.stringify({ gateType: chip.gateType }));
  } else {
    e.dataTransfer.setData('application/timer', JSON.stringify({ timerSeconds: 300 }));
  }
  e.dataTransfer.effectAllowed = 'move';
}

export function SpecialPalette() {
  return (
    <div className="special-palette">
      <Collapse
        ghost
        defaultActiveKey={['special']}
        items={[
          {
            key: 'special',
            label: '特殊组件（拖入画布）',
            children: (
              <div className="special-palette__grid">
                {CHIPS.map((chip) => (
                  <div
                    key={chip.kind === 'gate' ? `gate-${chip.gateType}` : 'timer'}
                    className={`special-chip${chip.kind === 'timer' ? ' special-chip--timer' : ''}`}
                    draggable
                    title={chip.hint}
                    onDragStart={(e) => onDragStart(e, chip)}
                  >
                    <span className="special-chip__dot" style={{ background: chip.dot }} />
                    <span>{chip.label}</span>
                  </div>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
