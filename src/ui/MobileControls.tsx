/**
 * Touch controls with hold semantics: pressing activates, releasing (or leaving the button,
 * or cancellation) deactivates. Pointer events cover touch, pen and mouse.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useExperimentStore } from '../state/experimentStore';
import { dropAudio } from '../utils/audio';

function HoldButton({ label, active, onChange, testId }: { label: string; active: boolean; onChange: (active: boolean) => void; testId: string }) {
  const pressed = useRef(false);
  const set = useCallback(
    (value: boolean) => {
      if (pressed.current === value) return;
      pressed.current = value;
      onChange(value);
    },
    [onChange],
  );
  useEffect(() => {
    const release = () => set(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [set]);
  return (
    <button
      type="button"
      className="tv-btn tv-btn-primary text-base px-6 py-3 rounded-2xl select-none"
      data-active={active ? 'true' : 'false'}
      data-testid={testId}
      aria-pressed={active}
      onPointerDown={(e) => {
        e.preventDefault();
        dropAudio.unlock();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onPointerLeave={() => set(false)}
      onTouchStart={(e) => {
        e.preventDefault();
        dropAudio.unlock();
        set(true);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        set(false);
      }}
      onTouchCancel={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          set(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') set(false);
      }}
    >
      {label}
    </button>
  );
}

export function MobileControls() {
  const isTitrating = useExperimentStore((s) => s.isTitrating);
  const isStirring = useExperimentStore((s) => s.isStirring);
  const limitReached = useExperimentStore((s) => s.limitReached);
  const setTitrating = useExperimentStore((s) => s.setTitrating);
  const setStirring = useExperimentStore((s) => s.setStirring);
  return (
    <div className="tv-touch-only fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex gap-3" data-testid="mobile-controls">
      <HoldButton label={limitReached ? 'Limit reached' : 'Titrate (hold)'} active={isTitrating} onChange={setTitrating} testId="mobile-titrate" />
      <HoldButton label="Stir (hold)" active={isStirring} onChange={setStirring} testId="mobile-stir" />
    </div>
  );
}
