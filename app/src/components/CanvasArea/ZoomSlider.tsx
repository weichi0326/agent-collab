import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, useReactFlow, useViewport } from '@xyflow/react';
import { Slider } from 'antd';
import { DISPLAY_MAX, toDisplay, toZoom } from './zoom';

export function ZoomSlider() {
  const { zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const reveal = useCallback(() => {
    setVisible(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), 3000);
  }, []);

  useEffect(() => {
    reveal();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [zoom, reveal]);

  const d = Math.min(DISPLAY_MAX, Math.max(0, toDisplay(zoom)));

  return (
    <Panel position="bottom-left">
      <div
        className={`zoom-bar${visible ? '' : ' zoom-bar--hidden'}`}
        onMouseEnter={() => {
          setVisible(true);
          if (timer.current) window.clearTimeout(timer.current);
        }}
        onMouseLeave={reveal}
      >
        <span className="zoom-bar__label">{d}%</span>
        <Slider
          vertical
          min={0}
          max={DISPLAY_MAX}
          value={d}
          onChange={(v) => zoomTo(toZoom(v))}
          tooltip={{ open: false }}
          style={{ height: 140 }}
        />
      </div>
    </Panel>
  );
}
