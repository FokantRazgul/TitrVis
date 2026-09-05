/**
 * Right panel: live pH, added volume, neutralisation degree, equivalence and indicator error,
 * and the titration curve (pH vs added volume) rendered with Plotly at ≤ 10 updates/s.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { findIndicator } from '../chemistry/indicators';
import { useExperimentStore } from '../state/experimentStore';
import { titrationToCSV, downloadText, timestampForFilename } from '../utils/export';
import { formatPercent, formatVolume } from '../utils/format';
import { Plot } from './plotly';

const GRAPH_INTERVAL_MS = 100;

/** Subscribe to the store but re-render at most every `intervalMs`. */
function useThrottledSnapshot(intervalMs: number) {
  const [snapshot, setSnapshot] = useState(() => useExperimentStore.getState());
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmit = useRef(0);
  useEffect(() => {
    return useExperimentStore.subscribe((state) => {
      const now = performance.now();
      const emit = () => {
        lastEmit.current = performance.now();
        pending.current = null;
        setSnapshot(useExperimentStore.getState());
      };
      if (now - lastEmit.current >= intervalMs) {
        emit();
      } else if (!pending.current) {
        pending.current = setTimeout(emit, intervalMs - (now - lastEmit.current));
      }
      void state;
    });
  }, [intervalMs]);
  return snapshot;
}

export const GRAPH_DIV_ID = 'titration-graph';

export function DataPanel() {
  const s = useThrottledSnapshot(GRAPH_INTERVAL_MS);
  const dark = s.theme === 'dark';
  const state = s.currentState;
  const analysis = s.analysis;
  const points = s.titrationPoints;
  const indicator = s.addedIndicator ? findIndicator(s.addedIndicator.indicatorId) : undefined;

  const { data, layout } = useMemo(() => {
    const text = dark ? '#eef1f6' : '#14181f';
    const grid = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
    const traces: Data[] = [
      {
        x: points.map((p) => p.addedVolumeML),
        y: points.map((p) => p.pH),
        type: 'scatter',
        mode: points.length > 300 ? 'lines' : 'lines+markers',
        name: 'pH (recorded)',
        line: { color: '#2563eb', width: 2 },
        marker: { size: 4 },
        hovertemplate: 'V = %{x:.3f} mL<br>pH = %{y:.2f}<extra></extra>',
      },
    ];
    const shapes: Partial<NonNullable<Layout['shapes']>[number]>[] = [];
    const annotations: Partial<NonNullable<Layout['annotations']>[number]>[] = [];
    if (analysis) {
      for (const eq of analysis.equivalence.points) {
        shapes.push({
          type: 'line',
          x0: eq.volumeML,
          x1: eq.volumeML,
          y0: 0,
          y1: 14,
          line: { color: eq.detectable ? '#dc2626' : 'rgba(220,38,38,0.35)', width: 1.5, dash: eq.detectable ? 'dash' : 'dot' },
        });
        annotations.push({
          x: eq.volumeML,
          y: eq.pH,
          text: `eq${analysis.equivalence.points.length > 1 ? eq.index : ''} ${eq.volumeML.toFixed(2)} mL, pH ${eq.pH.toFixed(2)}`,
          showarrow: true,
          arrowhead: 2,
          ax: 40,
          ay: -20,
          font: { size: 10, color: text },
        });
        traces.push({
          x: [eq.volumeML],
          y: [eq.pH],
          type: 'scatter',
          mode: 'markers',
          name: `Equivalence ${eq.index}`,
          marker: { color: '#dc2626', size: 9, symbol: 'diamond' },
          showlegend: eq.index === 1,
          hovertemplate: `Equivalence ${eq.index}<br>V = %{x:.3f} mL<br>pH = %{y:.2f}<extra></extra>`,
        });
      }
      if (analysis.transition) {
        shapes.push({
          type: 'line',
          x0: analysis.transition.volumeML,
          x1: analysis.transition.volumeML,
          y0: 0,
          y1: 14,
          line: { color: '#9333ea', width: 1.5, dash: 'dashdot' },
        });
        traces.push({
          x: [analysis.transition.volumeML],
          y: [analysis.transition.pH],
          type: 'scatter',
          mode: 'markers',
          name: 'Indicator transition (pH = pKa)',
          marker: { color: '#9333ea', size: 9, symbol: 'circle' },
          hovertemplate: 'Indicator transition<br>V = %{x:.3f} mL<br>pH = %{y:.2f}<extra></extra>',
        });
      }
    }
    const xMax = analysis ? analysis.vMaxML : s.analyteVolumeML * s.titrantLimitFactor;
    const lay: Partial<Layout> = {
      autosize: true,
      height: 300,
      margin: { l: 44, r: 12, t: 12, b: 40 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: text, size: 11 },
      xaxis: { title: { text: 'Added titrant, mL' }, range: [0, xMax], gridcolor: grid, zerolinecolor: grid },
      yaxis: { title: { text: 'pH' }, range: [0, 14], gridcolor: grid, zerolinecolor: grid },
      legend: { orientation: 'h', y: -0.28, font: { size: 10 } },
      shapes: shapes as Layout['shapes'],
      annotations: annotations as Layout['annotations'],
      hovermode: 'closest',
    };
    return { data: traces, layout: lay };
  }, [points, analysis, dark, s.analyteVolumeML, s.titrantLimitFactor]);

  const exportCsv = () => {
    const csv = titrationToCSV(points);
    downloadText(csv, `titration-${timestampForFilename()}.csv`);
    useExperimentStore.getState().pushToast(`CSV exported (${points.length} points).`, 'success');
  };

  const eq = analysis?.equivalence.points ?? [];
  const err = analysis?.error ?? null;

  return (
    <div className="p-4 text-sm">
      <h2 className="text-sm font-semibold mb-2 tracking-wide">Measurements</h2>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Stat label="Bulk pH" value={state ? state.pH.toFixed(2) : '—'} testId="ph-value" large />
        <Stat label="Added titrant" value={state ? formatVolume(state.addedVolumeML) : '—'} testId="volume-value" large />
        <Stat label="Neutralisation degree" value={state ? `${(state.neutralisationDegree * 100).toFixed(1)} %` : '—'} testId="neutralisation-value" />
        <Stat label="Total volume" value={state ? formatVolume(state.totalVolumeML, 2) : '—'} />
        <Stat label="[H⁺]" value={state ? `${state.solver.hydrogenConcentration.toExponential(2)} M` : '—'} />
        <Stat label="Ionic strength" value={state ? `${state.solver.diagnostics.ionicStrength.toExponential(2)} M` : '—'} />
      </div>
      {s.chemistryError && (
        <p className="text-xs mb-2" role="alert" style={{ color: 'var(--danger)' }}>
          {s.chemistryError}
        </p>
      )}
      {state?.solver.diagnostics.warnings.map((w) => (
        <p key={w} className="text-xs mb-2" style={{ color: 'var(--warning)' }}>
          {w}
        </p>
      ))}

      <h2 className="text-sm font-semibold mb-2 tracking-wide">Titration curve</h2>
      <div className="rounded-lg overflow-hidden" data-testid="titration-graph" data-points={points.length}>
        <Plot divId={GRAPH_DIV_ID} data={data} layout={layout} config={{ displayModeBar: false, responsive: true }} useResizeHandler style={{ width: '100%' }} />
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" className="tv-btn" onClick={exportCsv} data-testid="export-csv" disabled={points.length === 0}>
          Export CSV
        </button>
        <span className="text-xs tv-muted self-center" data-testid="point-count">
          {points.length} points
        </span>
      </div>

      <h2 className="text-sm font-semibold mt-4 mb-2 tracking-wide">Equivalence &amp; indicator</h2>
      {analysis && analysis.equivalence.role === 'none' ? (
        <p className="text-xs tv-muted">No acid–base reaction between the selected analyte and titrant.</p>
      ) : (
        <ul className="text-xs space-y-1" data-testid="equivalence-list">
          {eq.map((p) => (
            <li key={p.index}>
              Equivalence {eq.length > 1 ? p.index : ''}: <strong>{p.volumeML.toFixed(3)} mL</strong>, pH {p.pH.toFixed(2)}
              {p.detectable ? '' : ' (no sharp jump — not detectable)'}
            </li>
          ))}
          {analysis && analysis.inflectionVolumesML.length > 0 && (
            <li className="tv-muted">
              dpH/dV maxima of the model curve at {analysis.inflectionVolumesML.map((v) => `${v.toFixed(2)} mL`).join(', ')}
            </li>
          )}
        </ul>
      )}
      {indicator && (
        <div className="text-xs mt-2 space-y-1" data-testid="indicator-error">
          {analysis?.transition ? (
            <>
              <p>
                {indicator.name} transition ([HIn] = [In⁻], pH = {indicator.pKa.toFixed(2)}) at <strong>{analysis.transition.volumeML.toFixed(3)} mL</strong>
              </p>
              {err && (
                <p>
                  Indicator error vs equivalence {err.equivalenceIndex}: <strong>{err.deltaML >= 0 ? '+' : ''}{err.deltaML.toFixed(3)} mL</strong> ({formatPercent(err.percent)})
                </p>
              )}
            </>
          ) : (
            <p className="tv-muted">{indicator.name} does not reach its transition pH within the titrant limit.</p>
          )}
          {state?.indicator && (
            <p>
              Now: {(state.indicator.fractionBase * 100).toFixed(1)} % In⁻ ·{' '}
              <span className="inline-block w-4 h-3 align-middle rounded border" style={{ background: state.indicator.colour.hex }} aria-hidden />{' '}
              <span className="font-mono">{state.indicator.colour.hex}</span>
            </p>
          )}
          <button type="button" className="tv-btn" data-testid="open-indicator-panel" onClick={() => useExperimentStore.getState().setIndicatorPanelOpen(true)}>
            Open indicator panel
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, testId, large }: { label: string; value: string; testId?: string; large?: boolean }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5" style={{ background: 'var(--card-bg)', border: '1px solid var(--input-border)' }}>
      <div className="text-[0.65rem] uppercase tracking-wide tv-muted">{label}</div>
      <div className={large ? 'text-lg font-semibold font-mono' : 'text-sm font-mono'} data-testid={testId}>
        {value}
      </div>
    </div>
  );
}
