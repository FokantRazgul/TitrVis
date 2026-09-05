/**
 * Non-intrusive notifications (auto-dismiss after 6 s).
 */
import { useEffect } from 'react';
import { useExperimentStore, type Toast as ToastModel } from '../state/experimentStore';

const COLOURS: Record<ToastModel['kind'], string> = {
  info: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
};

function ToastItem({ toast }: { toast: ToastModel }) {
  const dismiss = useExperimentStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 6000);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);
  return (
    <div className="glass-panel rounded-xl px-3 py-2 text-sm flex items-start gap-2 max-w-sm" role="status" data-testid="toast" data-kind={toast.kind}>
      <span className="mt-1 block w-2 h-2 rounded-full shrink-0" style={{ background: COLOURS[toast.kind] }} aria-hidden />
      <span className="flex-1">{toast.message}</span>
      <button type="button" className="tv-muted text-xs" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
        ✕
      </button>
    </div>
  );
}

export function ToastStack() {
  const toasts = useExperimentStore((s) => s.toasts);
  return (
    <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none [&>*]:pointer-events-auto" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
