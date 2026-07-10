import { useEffect, useRef } from 'react';
import { useUiStore } from '../stores/uiStore';

interface Props {
  side: 'left' | 'right';
}

// 侧栏边缘的竖直拖动手柄:左栏挂右边缘、右栏挂左边缘
export default function ResizeHandle({ side }: Props) {
  const setLeftWidth = useUiStore((s) => s.setLeftWidth);
  const setRightWidth = useUiStore((s) => s.setRightWidth);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 用 Pointer Capture:即使指针移出窗口再松开,pointerup / lostpointercapture
    // 仍会派发到捕获元素,不会像 document.mouseup 那样漏触发导致监听泄漏、宽度跳变。
    let active = false;
    let startX = 0;
    let startW = 0;

    function onMove(ev: PointerEvent) {
      if (!active) return;
      const dx = ev.clientX - startX;
      if (side === 'left') setLeftWidth(startW + dx);
      else setRightWidth(startW - dx);
    }

    function stop() {
      if (!active) return;
      active = false;
      document.body.classList.remove('resizing');
      el!.removeEventListener('pointermove', onMove);
    }

    function onDown(e: PointerEvent) {
      e.preventDefault();
      e.stopPropagation();
      active = true;
      startX = e.clientX;
      startW =
        side === 'left'
          ? useUiStore.getState().leftWidth
          : useUiStore.getState().rightWidth;
      el!.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      el!.addEventListener('pointermove', onMove);
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', stop);
    el.addEventListener('lostpointercapture', stop);
    return () => {
      stop();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('lostpointercapture', stop);
    };
  }, [side, setLeftWidth, setRightWidth]);

  return (
    <div
      ref={ref}
      className={`resize-handle resize-handle--${side}`}
      title="拖动调整宽度"
    />
  );
}
