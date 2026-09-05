/**
 * Top bar: title, lighting mode, theme, mute, indicator panel, screenshot, reset.
 */
import { useExperimentStore } from '../state/experimentStore';

interface TopBarProps {
  onScreenshot: () => void;
}

export function TopBar({ onScreenshot }: TopBarProps) {
  const s = useExperimentStore();
  return (
    <header className="glass-panel fixed top-3 left-1/2 -translate-x-1/2 z-30 rounded-2xl px-3 py-1.5 flex items-center gap-2 flex-wrap justify-center max-w-[96vw]" data-testid="top-bar">
      <span className="font-semibold text-sm mr-1">TitrVis</span>
      <div className="flex gap-1" role="group" aria-label="Lighting mode">
        {([1, 2, 3] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className="tv-btn text-xs px-2 py-1"
            data-active={s.lightingMode === mode ? 'true' : 'false'}
            aria-pressed={s.lightingMode === mode}
            data-testid={`lighting-${mode}`}
            onClick={() => s.setLightingMode(mode)}
          >
            {mode === 1 ? 'Lab' : mode === 2 ? 'Studio' : 'Camera'}
          </button>
        ))}
      </div>
      <button type="button" className="tv-btn text-xs px-2 py-1" onClick={() => s.toggleTheme()} data-testid="theme-toggle" aria-pressed={s.theme === 'dark'}>
        {s.theme === 'dark' ? 'Light UI' : 'Dark UI'}
      </button>
      <button type="button" className="tv-btn text-xs px-2 py-1" onClick={() => s.toggleMute()} data-testid="mute-toggle" aria-pressed={s.muted}>
        {s.muted ? 'Unmute' : 'Mute'}
      </button>
      <button type="button" className="tv-btn text-xs px-2 py-1" onClick={() => s.setIndicatorPanelOpen(true)} data-testid="indicator-panel-button">
        Indicator
      </button>
      <button type="button" className="tv-btn text-xs px-2 py-1" onClick={onScreenshot} data-testid="screenshot-button">
        Screenshot
      </button>
      <button type="button" className="tv-btn text-xs px-2 py-1" onClick={() => s.togglePanels()} data-testid="panels-toggle" aria-pressed={!s.panelsVisible}>
        {s.panelsVisible ? 'Hide panels' : 'Show panels'}
      </button>
      <button
        type="button"
        className="tv-btn text-xs px-2 py-1"
        onClick={() => {
          s.reset();
          s.pushToast('Experiment reset.', 'info');
        }}
        data-testid="reset-button"
      >
        Reset
      </button>
    </header>
  );
}
