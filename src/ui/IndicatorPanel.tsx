/**
 * Indicator panel: identity, pKa/range, structure, HIn / In⁻ / current spectra on the common
 * wavelength grid, [HIn]/[In⁻], colour swatch with numerical values, PNG export of the spectrum.
 */
import { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js';
import { findIndicator, indicatorAbsorptivities } from '../chemistry/indicators';
import { GRID } from '../chemistry/spectra';
import { useExperimentStore } from '../state/experimentStore';
import { timestampForFilename, downloadBlob } from '../utils/export';
import { formatFormula } from '../utils/format';
import { MoleculeStructure } from './MoleculeStructure';
import { Plot, Plotly } from './plotly';

export const SPECTRUM_DIV_ID = 'indicator-spectrum-graph';

export function IndicatorPanel() {
  const open = useExperimentStore((s) => s.indicatorPanelOpen);
  const dose = useExperimentStore((s) => s.addedIndicator);
  const state = useExperimentStore((s) => s.currentState);
  const theme = useExperimentStore((s) => s.theme);
  const close = useExperimentStore((s) => s.setIndicatorPanelOpen);
  const indicator = dose ? findIndicator(dose.indicatorId) : undefined;
  const dark = theme === 'dark';
  const ind = state?.indicator ?? null;

  const { data, layout } = useMemo(() => {
    if (!indicator) return { data: [] as Data[], layout: {} as Partial<Layout> };
    const eps = indicatorAbsorptivities(indicator);
    const text = dark ? '#eef1f6' : '#14181f';
    const grid = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
    const traces: Data[] = [
      { x: [...GRID], y: eps.acid, type: 'scatter', mode: 'lines', name: 'HIn (acid form)', line: { color: '#f59e0b', width: 2 } },
      { x: [...GRID], y: eps.base, type: 'scatter', mode: 'lines', name: 'In⁻ (base form)', line: { color: '#3b82f6', width: 2 } },
    ];
    if (ind) {
      traces.push({
        x: [...GRID],
        y: ind.molarAbsorptivity,
        type: 'scatter',
        mode: 'lines',
        name: `Current mixture (${(ind.fractionBase * 100).toFixed(1)} % In⁻)`,
        line: { color: '#10b981', width: 3, dash: 'dot' },
      });
      traces.push({
        x: [...GRID],
        y: ind.absorbance,
        type: 'scatter',
        mode: 'lines',
        name: `Absorbance A(λ), l = ${ind.pathLengthCm.toFixed(1)} cm`,
        yaxis: 'y2',
        line: { color: '#ef4444', width: 1.5 },
      });
    }
    const lay: Partial<Layout> = {
      autosize: true,
      height: 320,
      margin: { l: 56, r: 56, t: 10, b: 40 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: text, size: 11 },
      xaxis: { title: { text: 'Wavelength, nm' }, range: [380, 780], gridcolor: grid },
      yaxis: { title: { text: 'ε, L mol⁻¹ cm⁻¹' }, gridcolor: grid, rangemode: 'tozero' },
      yaxis2: { title: { text: 'A' }, overlaying: 'y' as never, side: 'right', rangemode: 'tozero', showgrid: false },
      legend: { orientation: 'h', y: -0.25, font: { size: 10 } },
    };
    return { data: traces, layout: lay };
  }, [indicator, ind, dark]);

  if (!open) return null;

  const exportPng = async () => {
    const el = document.getElementById(SPECTRUM_DIV_ID);
    if (!el) return;
    try {
      const url = await Plotly.toImage(el as never, { format: 'png', width: 1200, height: 700, scale: 2 });
      const blob = await (await fetch(url)).blob();
      downloadBlob(blob, `spectrum-${indicator?.id ?? 'indicator'}-${timestampForFilename()}.png`);
      useExperimentStore.getState().pushToast('Spectrum exported as PNG.', 'success');
    } catch {
      useExperimentStore.getState().pushToast('Spectrum export failed.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="indicator-panel-title" data-testid="indicator-panel">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="Close indicator panel" onClick={() => close(false)} />
      <div className="glass-panel relative rounded-2xl w-full max-w-4xl max-h-full overflow-y-auto tv-scroll p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="indicator-panel-title" className="text-lg font-semibold">
              {indicator ? indicator.name : 'No indicator added'}
            </h2>
            {indicator && (
              <p className="text-xs tv-muted">
                {formatFormula(indicator.formula)} · M = {indicator.molecularWeight} g/mol · pKa {indicator.pKa.toFixed(2)} · transition pH {indicator.transitionRange[0]}–{indicator.transitionRange[1]} ·{' '}
                {indicator.colourNames.acid} → {indicator.colourNames.base} · PubChem CID {indicator.pubchemCid}
              </p>
            )}
          </div>
          <button type="button" className="tv-btn" onClick={() => close(false)} data-testid="close-indicator-panel">
            Close
          </button>
        </div>

        {!indicator && <p className="text-sm mt-3">Add an indicator from the experiment panel to see its spectra and colour.</p>}

        {indicator && (
          <div className="grid gap-4 mt-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div data-testid="spectrum-graph">
                <Plot divId={SPECTRUM_DIV_ID} data={data} layout={layout} config={{ displayModeBar: false, responsive: true }} useResizeHandler style={{ width: '100%' }} />
              </div>
              <p className="text-[0.7rem] tv-muted mt-1">
                Spectra: {indicator.spectra.base.dataQuality} — {indicator.reconstruction?.method}. Grid 380–780 nm, 5 nm (same grid as the colour model).
              </p>
              <div className="flex gap-2 mt-2">
                <button type="button" className="tv-btn" onClick={exportPng} data-testid="export-spectrum">
                  Export spectrum PNG
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <MoleculeStructure smiles={indicator.smiles} name={indicator.name} dark={dark} />
              {ind ? (
                <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: 'var(--card-bg)', border: '1px solid var(--input-border)' }} data-testid="indicator-colour">
                  <div className="flex items-center gap-3">
                    <span className="block w-14 h-14 rounded-lg border" style={{ background: ind.colour.hex }} aria-label={`Computed colour ${ind.colour.hex}`} data-testid="colour-swatch" />
                    <div>
                      <div className="font-mono text-sm" data-testid="colour-hex">
                        {ind.colour.hex}
                      </div>
                      <div className="font-mono">
                        sRGB {ind.colour.srgb.map((c) => Math.round(c * 255)).join(', ')}
                      </div>
                      <div className="font-mono">
                        XYZ {ind.colour.xyz.map((c) => c.toFixed(3)).join(', ')}
                      </div>
                      {ind.colour.clipped && <div style={{ color: 'var(--warning)' }}>out of sRGB gamut (clipped)</div>}
                    </div>
                  </div>
                  <div>
                    c(indicator) = {ind.concentrationM.toExponential(2)} M · path {ind.pathLengthCm.toFixed(1)} cm (flask mean chord)
                  </div>
                  <div data-testid="indicator-ratio">
                    [HIn]/[In⁻] = {Number.isFinite(ind.ratioAcidToBase) ? ind.ratioAcidToBase.toPrecision(3) : '∞'} · {(ind.fractionAcid * 100).toFixed(1)} % HIn / {(ind.fractionBase * 100).toFixed(1)} % In⁻
                  </div>
                  <div>bulk pH {state?.pH.toFixed(2)} · Illuminant D65, CIE 1931 2° observer</div>
                </div>
              ) : null}
              <p className="text-[0.7rem] tv-muted">
                Source: {indicator.provenance.source}. {indicator.provenance.notes}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
