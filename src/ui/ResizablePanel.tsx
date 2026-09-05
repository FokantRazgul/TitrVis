/**
 * Side panel with a draggable edge (desktop). Width is stored in the experiment store.
 */
import { useRef } from 'react';
import { PANEL_WIDTH, useExperimentStore } from '../state/experimentStore';

interface ResizablePanelProps {
  side: 'left' | 'right';
  children: React.ReactNode;
  testId: string;
}

export function ResizablePanel({ side, children, testId }: ResizablePanelProps) {
  const width = useExperimentStore((s) => (side === 'left' ? s.leftPanelWidth : s.rightPanelWidth));
  const setPanelWidth = useExperimentStore((s) => s.setPanelWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startWidth: width };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !Number.isFinite(e.clientX)) return;
    const delta = e.clientX - drag.current.startX;
    setPanelWidth(side, drag.current.startWidth + (side === 'left' ? delta : -delta));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <aside
      className={`glass-panel absolute top-16 bottom-4 ${side === 'left' ? 'left-3 rounded-2xl' : 'right-3 rounded-2xl'} overflow-y-auto tv-scroll tv-desktop-only`}
      style={{ width }}
      data-testid={testId}
    >
      <div
        className="tv-resize-handle"
        style={side === 'left' ? { right: -4 } : { left: -4 }}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${side} panel`}
        aria-valuemin={PANEL_WIDTH.min}
        aria-valuemax={PANEL_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        data-testid={`${testId}-handle`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          const step = 20;
          if (e.key === 'ArrowLeft') setPanelWidth(side, width + (side === 'left' ? -step : step));
          if (e.key === 'ArrowRight') setPanelWidth(side, width + (side === 'left' ? step : -step));
        }}
      />
      {children}
    </aside>
  );
}
