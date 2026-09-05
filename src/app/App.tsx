/**
 * Application shell: WebGL2 gate, 3D scene, panels, overlays and global controls.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { findIndicator } from '../chemistry/indicators';
import { findSubstance } from '../chemistry/substances';
import { initialiseExperiment, useExperimentStore } from '../state/experimentStore';
import { DataPanel, GRAPH_DIV_ID } from '../ui/DataPanel';
import { ExperimentPanel } from '../ui/ExperimentPanel';
import { IndicatorPanel } from '../ui/IndicatorPanel';
import { MobileControls } from '../ui/MobileControls';
import { ResizablePanel } from '../ui/ResizablePanel';
import { ToastStack } from '../ui/Toast';
import { TopBar } from '../ui/TopBar';
import { Plotly } from '../ui/plotly';
import { useKeyboardControls } from '../ui/useKeyboardControls';
import { downloadScreenshot } from '../utils/screenshot';

const Scene = lazy(() => import('../rendering/Scene').then((m) => ({ default: m.Scene })));

export function detectWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    const ok = typeof gl.getParameter === 'function' && gl.getParameter(gl.VERSION) !== null;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

function WebGLUnavailable() {
  return (
    <main className="h-full flex items-center justify-center p-6" style={{ background: '#101318', color: '#eef1f6' }} data-testid="webgl-unavailable">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-xl font-semibold">Your browser does not support WebGL2.</h1>
        <p>Please use a modern browser with WebGL2 support (recent Chrome, Edge, Firefox or Safari) to run the 3D titration simulator.</p>
      </div>
    </main>
  );
}

export function App() {
  const [webgl2] = useState(() => detectWebGL2());
  const theme = useExperimentStore((s) => s.theme);
  const panelsVisible = useExperimentStore((s) => s.panelsVisible);

  useEffect(() => {
    initialiseExperiment();
    useExperimentStore.getState().setWebgl2Available(webgl2);
  }, [webgl2]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const screenshot = useCallback(async () => {
    const s = useExperimentStore.getState();
    const analyte = findSubstance(s.analyteId);
    const titrant = findSubstance(s.titrantId);
    const indicator = s.addedIndicator ? findIndicator(s.addedIndicator.indicatorId) : undefined;
    const lines = [
      `TitrVis — ${new Date().toLocaleString()}`,
      `Analyte: ${analyte?.nameEn ?? '—'} ${s.analyteConcentrationM} M, ${s.analyteVolumeML} mL`,
      `Titrant: ${titrant?.nameEn ?? '—'} ${s.titrantConcentrationM} M`,
      `Indicator: ${indicator ? `${indicator.name} (${s.addedIndicator?.volumeML.toFixed(2)} mL)` : 'none'}`,
      `Added titrant: ${s.currentState ? s.currentState.addedVolumeML.toFixed(3) : '—'} mL   pH: ${s.currentState ? s.currentState.pH.toFixed(2) : '—'}`,
    ];
    let graphDataUrl: string | undefined;
    const graph = document.getElementById(GRAPH_DIV_ID);
    if (graph && s.titrationPoints.length > 0) {
      try {
        graphDataUrl = await Plotly.toImage(graph as never, { format: 'png', width: 900, height: 520, scale: 1 });
      } catch {
        graphDataUrl = undefined;
      }
    }
    const ok = await downloadScreenshot({ lines, graphDataUrl, dark: s.theme === 'dark' });
    s.pushToast(ok ? 'Screenshot saved as PNG.' : 'Screenshot unavailable (no 3D scene).', ok ? 'success' : 'warning');
  }, []);

  const actions = useMemo(() => ({ screenshot: () => void screenshot() }), [screenshot]);
  useKeyboardControls(actions);

  if (!webgl2) return <WebGLUnavailable />;

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="app-root">
      <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-white/70">Loading 3D scene…</div>}>
        <Scene />
      </Suspense>
      <TopBar onScreenshot={() => void screenshot()} />
      {panelsVisible && (
        <>
          <ResizablePanel side="left" testId="experiment-panel">
            <ExperimentPanel />
          </ResizablePanel>
          <ResizablePanel side="right" testId="data-panel">
            <DataPanel />
          </ResizablePanel>
          <MobilePanels />
        </>
      )}
      <MobileControls />
      <IndicatorPanel />
      <ToastStack />
    </div>
  );
}

/** On narrow screens the panels stack as collapsible drawers at the bottom. */
function MobilePanels() {
  const [tab, setTab] = useState<'none' | 'experiment' | 'data'>('none');
  return (
    <div className="tv-mobile-only fixed left-2 right-2 bottom-20 z-20" data-testid="mobile-panels">
      <div className="flex gap-2 justify-center mb-2">
        <button type="button" className="tv-btn text-xs" data-active={tab === 'experiment' ? 'true' : 'false'} onClick={() => setTab(tab === 'experiment' ? 'none' : 'experiment')} data-testid="mobile-tab-experiment">
          Experiment
        </button>
        <button type="button" className="tv-btn text-xs" data-active={tab === 'data' ? 'true' : 'false'} onClick={() => setTab(tab === 'data' ? 'none' : 'data')} data-testid="mobile-tab-data">
          Data
        </button>
      </div>
      {tab !== 'none' && (
        <div className="glass-panel rounded-2xl max-h-[55vh] overflow-y-auto tv-scroll">{tab === 'experiment' ? <ExperimentPanel /> : <DataPanel />}</div>
      )}
    </div>
  );
}
