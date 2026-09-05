/**
 * Left panel: analyte, titrant, indicator configuration and control help.
 */
import { LIMITS } from '../chemistry/constants';
import { INDICATORS, findIndicator } from '../chemistry/indicators';
import { findSubstance } from '../chemistry/substances';
import { indicatorDoseVolumeML, titrantLimitML, useExperimentStore } from '../state/experimentStore';
import { formatFormula } from '../utils/format';
import { NumberField } from './NumberField';
import { SubstanceSelector } from './SubstanceSelector';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="text-sm font-semibold mb-2 tracking-wide">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function ExperimentPanel() {
  const s = useExperimentStore();
  const analyte = findSubstance(s.analyteId);
  const titrant = findSubstance(s.titrantId);
  const indicator = findIndicator(s.indicatorId);
  const solubilityWarning = (sub: typeof analyte, conc: number) =>
    sub && sub.solubilityLimitM !== undefined && conc > sub.solubilityLimitM
      ? `${sub.nameEn} is only soluble to ≈${sub.solubilityLimitM.toPrecision(2)} M; higher concentrations are not attainable in practice.`
      : undefined;
  const doseML = indicatorDoseVolumeML(s);

  return (
    <div className="p-4 text-sm">
      <Section title="Analyte">
        <SubstanceSelector label="Substance" selectedId={s.analyteId} onSelect={(id) => s.setConfig({ analyteId: id })} testId="analyte" />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Volume"
            value={s.analyteVolumeML}
            min={LIMITS.analyteVolumeML.min}
            max={LIMITS.analyteVolumeML.max}
            unit="mL"
            onChange={(v) => s.setConfig({ analyteVolumeML: v })}
            testId="analyte-volume"
          />
          <NumberField
            label="Concentration"
            value={s.analyteConcentrationM}
            min={LIMITS.analyteConcentrationM.min}
            max={LIMITS.analyteConcentrationM.max}
            unit="M"
            onChange={(v) => s.setConfig({ analyteConcentrationM: v })}
            help={solubilityWarning(analyte, s.analyteConcentrationM)}
            testId="analyte-concentration"
          />
        </div>
      </Section>

      <Section title="Titrant">
        <SubstanceSelector label="Substance" selectedId={s.titrantId} onSelect={(id) => s.setConfig({ titrantId: id })} testId="titrant" />
        <NumberField
          label="Concentration"
          value={s.titrantConcentrationM}
          min={LIMITS.titrantConcentrationM.min}
          max={LIMITS.titrantConcentrationM.max}
          unit="M"
          onChange={(v) => s.setConfig({ titrantConcentrationM: v })}
          help={solubilityWarning(titrant, s.titrantConcentrationM)}
          testId="titrant-concentration"
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Drop rate"
            value={s.dropRateHz}
            min={LIMITS.dropRateHz.min}
            max={LIMITS.dropRateHz.max}
            step={0.1}
            unit="drops/s"
            onChange={(v) => s.setConfig({ dropRateHz: v })}
            testId="drop-rate"
          />
          <NumberField
            label="Drop volume"
            value={s.dropVolumeML}
            min={LIMITS.dropVolumeML.min}
            max={LIMITS.dropVolumeML.max}
            step={0.005}
            unit="mL"
            onChange={(v) => s.setConfig({ dropVolumeML: v })}
            testId="drop-volume"
          />
        </div>
        <p className="text-xs tv-muted">
          Safety limit: {titrantLimitML(s).toFixed(1)} mL ({Math.round(s.titrantLimitFactor * 100)} % of the analyte volume).
        </p>
      </Section>

      <Section title="Indicator">
        <label className="block text-xs">
          <span className="font-medium">Indicator</span>
          <select
            className="tv-input mt-1"
            value={s.indicatorId}
            data-testid="indicator-select"
            onChange={(e) => s.setConfig({ indicatorId: e.target.value })}
          >
            {INDICATORS.map((ind) => (
              <option key={ind.id} value={ind.id}>
                {ind.name} (pKa {ind.pKa.toFixed(2)}, {ind.transitionRange[0]}–{ind.transitionRange[1]})
              </option>
            ))}
          </select>
        </label>
        {indicator && (
          <p className="text-xs tv-muted">
            {formatFormula(indicator.formula)} · {indicator.colourNames.acid} → {indicator.colourNames.base}
          </p>
        )}
        <NumberField
          label="Stock concentration"
          value={s.indicatorStockConcentrationM}
          min={LIMITS.indicatorStockConcentrationM.min}
          max={LIMITS.indicatorStockConcentrationM.max}
          unit="M"
          onChange={(v) => s.setConfig({ indicatorStockConcentrationM: v })}
          format={(v) => v.toPrecision(3)}
          testId="indicator-stock"
        />
        <div className="grid grid-cols-2 gap-2 items-end">
          <label className="block text-xs">
            <span className="font-medium">Amount as</span>
            <select
              className="tv-input mt-1"
              value={s.indicatorAmountMode}
              data-testid="indicator-amount-mode"
              onChange={(e) => s.setConfig({ indicatorAmountMode: e.target.value as 'drops' | 'volume' })}
            >
              <option value="drops">drops (0.05 mL each)</option>
              <option value="volume">volume (mL)</option>
            </select>
          </label>
          {s.indicatorAmountMode === 'drops' ? (
            <NumberField
              label="Drops"
              value={s.indicatorDrops}
              min={LIMITS.indicatorDrops.min}
              max={LIMITS.indicatorDrops.max}
              step={1}
              unit=""
              onChange={(v) => s.setConfig({ indicatorDrops: v })}
              testId="indicator-drops"
            />
          ) : (
            <NumberField
              label="Volume"
              value={s.indicatorVolumeML}
              min={LIMITS.indicatorVolumeML.min}
              max={LIMITS.indicatorVolumeML.max}
              step={0.01}
              unit="mL"
              onChange={(v) => s.setConfig({ indicatorVolumeML: v })}
              testId="indicator-volume"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="tv-btn tv-btn-primary" data-testid="add-indicator" onClick={() => s.addIndicator()}>
            {s.addedIndicator ? 'Replace indicator' : 'Add indicator'} ({doseML.toFixed(2)} mL)
          </button>
          {s.addedIndicator && (
            <span className="text-xs" style={{ color: 'var(--success)' }} data-testid="indicator-added">
              {findIndicator(s.addedIndicator.indicatorId)?.name} in flask
            </span>
          )}
        </div>
      </Section>

      <Section title="Model">
        <label className="block text-xs">
          <span className="font-medium">Activity model</span>
          <select
            className="tv-input mt-1"
            value={s.activityModel}
            data-testid="activity-model"
            onChange={(e) => s.setConfig({ activityModel: e.target.value as 'ideal' | 'davies' })}
          >
            <option value="ideal">Ideal solution (γ = 1)</option>
            <option value="davies">Davies activity correction</option>
          </select>
        </label>
        <p className="text-xs tv-muted">25 °C, Kw = 1.0 × 10⁻¹⁴. Davies equation valid up to I ≈ 0.5 M.</p>
      </Section>

      <Section title="Controls">
        <ul className="text-xs space-y-1">
          <li>
            <span className="tv-kbd">Space</span> hold to titrate
          </li>
          <li>
            <span className="tv-kbd">Shift</span> hold to stir
          </li>
          <li>
            <span className="tv-kbd">1</span> <span className="tv-kbd">2</span> <span className="tv-kbd">3</span> laboratory / studio / camera lighting
          </li>
          <li>
            <span className="tv-kbd">R</span> reset · <span className="tv-kbd">S</span> screenshot · <span className="tv-kbd">H</span> hide panels
          </li>
          <li className="tv-muted">Drag to orbit the camera, scroll to zoom.</li>
        </ul>
      </Section>
    </div>
  );
}
