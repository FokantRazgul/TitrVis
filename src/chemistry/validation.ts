/**
 * Static-data and input validation. Invalid database entries throw during module
 * initialisation in development/test so that bad data can never reach the solver.
 */

import { GRID } from './spectra';
import { protonCapacity } from './substances';
import type { Indicator, Provenance, Spectrum, Substance } from './types';

export interface ValidationIssue {
  entity: string;
  message: string;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateProvenance(p: Provenance, entity: string, issues: ValidationIssue[]): void {
  if (!p) {
    issues.push({ entity, message: 'provenance missing' });
    return;
  }
  if (!p.source || p.source.trim().length < 5) issues.push({ entity, message: 'provenance.source missing' });
  if (p.sourceLevel !== 'primary' && p.sourceLevel !== 'secondary') issues.push({ entity, message: 'provenance.sourceLevel invalid' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.accessed)) issues.push({ entity, message: 'provenance.accessed must be an ISO date' });
  if (!isFiniteNumber(p.temperature)) issues.push({ entity, message: 'provenance.temperature must be finite' });
  if (!p.conditions) issues.push({ entity, message: 'provenance.conditions missing' });
  if (!['measured', 'reconstructed', 'derived'].includes(p.dataQuality)) {
    issues.push({ entity, message: 'provenance.dataQuality invalid' });
  }
  if (/unknown|tbd|todo|\?\?\?/i.test(`${p.source} ${p.reference ?? ''}`)) {
    issues.push({ entity, message: 'provenance contains a placeholder' });
  }
}

export function validateSubstance(s: Substance, issues: ValidationIssue[]): void {
  const entity = `substance:${s.id}`;
  if (!/^[a-z0-9_]+$/.test(s.id)) issues.push({ entity, message: 'id must be snake_case' });
  if (!s.nameEn || !s.nameRu) issues.push({ entity, message: 'names missing' });
  if (!s.formula) issues.push({ entity, message: 'formula missing' });
  if (!isFiniteNumber(s.molecularWeight) || s.molecularWeight <= 0) issues.push({ entity, message: 'molecularWeight invalid' });
  if (s.acidSystem) {
    const a = s.acidSystem;
    if (a.pKas.length === 0) issues.push({ entity, message: 'acidSystem.pKas empty' });
    if (a.pKas.length !== a.charges.length) issues.push({ entity, message: 'acidSystem pKas/charges length mismatch' });
    if (a.speciesFormulas.length !== a.pKas.length + 1) issues.push({ entity, message: 'acidSystem speciesFormulas length mismatch' });
    if (a.pKas.some((p) => !isFiniteNumber(p) || p < -5 || p > 20)) issues.push({ entity, message: 'acidSystem pKa out of range' });
    for (let i = 1; i < a.pKas.length; i++) if (a.pKas[i] <= a.pKas[i - 1]) issues.push({ entity, message: 'acidSystem pKas not ascending' });
    for (let i = 0; i < a.charges.length; i++) {
      if (!Number.isInteger(a.charges[i])) issues.push({ entity, message: 'acidSystem charge not integer' });
      if (i > 0 && a.charges[i] !== a.charges[i - 1] - 1) issues.push({ entity, message: 'acidSystem charges must decrease by 1' });
    }
    if (a.unitsPerFormula !== undefined && (!Number.isInteger(a.unitsPerFormula) || a.unitsPerFormula < 1)) {
      issues.push({ entity, message: 'acidSystem.unitsPerFormula invalid' });
    }
  }
  if (s.baseSystem) {
    const b = s.baseSystem;
    const hasPKb = Array.isArray(b.pKbs);
    const hasPKa = Array.isArray(b.conjugateAcidPKas);
    if (hasPKb === hasPKa) issues.push({ entity, message: 'baseSystem must have exactly one of pKbs / conjugateAcidPKas' });
    const values = b.pKbs ?? b.conjugateAcidPKas ?? [];
    if (values.length === 0) issues.push({ entity, message: 'baseSystem constants empty' });
    if (values.length !== b.charges.length) issues.push({ entity, message: 'baseSystem constants/charges length mismatch' });
    if (b.speciesFormulas.length !== values.length + 1) issues.push({ entity, message: 'baseSystem speciesFormulas length mismatch' });
    if (values.some((p) => !isFiniteNumber(p) || p < -5 || p > 20)) issues.push({ entity, message: 'baseSystem constant out of range' });
    for (let i = 0; i < b.charges.length; i++) {
      if (!Number.isInteger(b.charges[i])) issues.push({ entity, message: 'baseSystem charge not integer' });
      if (i > 0 && b.charges[i] !== b.charges[i - 1] + 1) issues.push({ entity, message: 'baseSystem charges must increase by 1' });
    }
    // Successive protonations must become harder: conjugate-acid pKa decreases, pKb increases.
    if (hasPKa) {
      for (let i = 1; i < values.length; i++) if (values[i] >= values[i - 1]) issues.push({ entity, message: 'conjugateAcidPKas must decrease' });
    } else {
      for (let i = 1; i < values.length; i++) if (values[i] <= values[i - 1]) issues.push({ entity, message: 'pKbs must increase' });
    }
  }
  for (const ion of s.stoichiometry.spectatorIons) {
    if (!Number.isInteger(ion.charge) || ion.charge === 0) issues.push({ entity, message: `spectator ${ion.formula} charge invalid` });
    if (!Number.isInteger(ion.count) || ion.count < 1) issues.push({ entity, message: `spectator ${ion.formula} count invalid` });
  }
  if (!Number.isInteger(s.stoichiometry.equivalents) || s.stoichiometry.equivalents < 0) {
    issues.push({ entity, message: 'stoichiometry.equivalents invalid' });
  }
  if (s.solubilityLimitM !== undefined && (!isFiniteNumber(s.solubilityLimitM) || s.solubilityLimitM <= 0)) {
    issues.push({ entity, message: 'solubilityLimitM invalid' });
  }
  // Type consistency with derived proton capacities.
  const cap = protonCapacity(s);
  switch (s.type) {
    case 'strongAcid':
      if (cap.donatable === 0 || cap.acceptable !== 0) issues.push({ entity, message: 'strongAcid must only donate protons' });
      break;
    case 'weakAcid':
      if (!s.acidSystem || cap.donatable === 0) issues.push({ entity, message: 'weakAcid must have an acidSystem and donate protons' });
      break;
    case 'strongBase':
      if (cap.acceptable === 0 || cap.donatable !== 0 || s.acidSystem || s.baseSystem) issues.push({ entity, message: 'strongBase must only accept protons' });
      break;
    case 'weakBase':
      if (!s.baseSystem || cap.acceptable === 0) issues.push({ entity, message: 'weakBase must have a baseSystem and accept protons' });
      break;
    case 'ampholyte':
      if (cap.acceptable === 0 || cap.donatable === 0) issues.push({ entity, message: 'ampholyte must donate and accept protons' });
      break;
    case 'salt':
      break;
    default:
      issues.push({ entity, message: `unknown type ${String(s.type)}` });
  }
  validateProvenance(s.provenance, entity, issues);
}

export function validateSpectrum(sp: Spectrum, entity: string, issues: ValidationIssue[]): void {
  if (sp.unit !== 'nm') issues.push({ entity, message: 'spectrum unit must be nm' });
  if (!['measured', 'reconstructed'].includes(sp.dataQuality)) issues.push({ entity, message: 'spectrum dataQuality invalid' });
  if (sp.data.length < 2) issues.push({ entity, message: 'spectrum needs at least two points' });
  for (let i = 0; i < sp.data.length; i++) {
    const p = sp.data[i];
    if (!isFiniteNumber(p.wavelength)) issues.push({ entity, message: `wavelength[${i}] not finite` });
    if (!isFiniteNumber(p.molarAbsorptivity) || p.molarAbsorptivity < 0) issues.push({ entity, message: `absorptivity[${i}] negative or not finite` });
    if (i > 0 && p.wavelength <= sp.data[i - 1].wavelength) issues.push({ entity, message: 'wavelengths must be strictly ascending' });
    if (i > 0 && p.wavelength - sp.data[i - 1].wavelength > 5 + 1e-9) issues.push({ entity, message: 'wavelength step must be ≤ 5 nm' });
  }
  if (sp.data.length > 0 && (sp.data[0].wavelength > GRID[0] || sp.data[sp.data.length - 1].wavelength < GRID[GRID.length - 1])) {
    issues.push({ entity, message: 'spectrum must cover the visible grid 380–780 nm' });
  }
}

export function validateIndicator(ind: Indicator, issues: ValidationIssue[]): void {
  const entity = `indicator:${ind.id}`;
  if (!/^[a-z0-9_]+$/.test(ind.id)) issues.push({ entity, message: 'id must be snake_case' });
  if (!ind.name || !ind.formula || !ind.smiles) issues.push({ entity, message: 'name/formula/smiles missing' });
  if (!Number.isInteger(ind.pubchemCid) || ind.pubchemCid <= 0) issues.push({ entity, message: 'pubchemCid invalid' });
  if (!isFiniteNumber(ind.pKa) || ind.pKa < 0 || ind.pKa > 14) issues.push({ entity, message: 'pKa out of range' });
  const [lo, hi] = ind.transitionRange;
  if (!isFiniteNumber(lo) || !isFiniteNumber(hi) || lo >= hi) issues.push({ entity, message: 'transitionRange invalid' });
  if (isFiniteNumber(lo) && isFiniteNumber(hi) && (ind.pKa < lo - 0.5 || ind.pKa > hi + 0.5)) issues.push({ entity, message: 'pKa outside transition range' });
  if (!Number.isInteger(ind.acidFormCharge)) issues.push({ entity, message: 'acidFormCharge not integer' });
  if (!isFiniteNumber(ind.molecularWeight) || ind.molecularWeight <= 0) issues.push({ entity, message: 'molecularWeight invalid' });
  validateSpectrum(ind.spectra.acid, `${entity}:acid`, issues);
  validateSpectrum(ind.spectra.base, `${entity}:base`, issues);
  const anyAbsorbing =
    ind.spectra.acid.data.some((p) => p.molarAbsorptivity > 0) || ind.spectra.base.data.some((p) => p.molarAbsorptivity > 0);
  if (!anyAbsorbing) issues.push({ entity, message: 'indicator has no visible absorption in either form' });
  if (ind.spectra.acid.dataQuality === 'reconstructed' && !ind.reconstruction) {
    issues.push({ entity, message: 'reconstructed spectrum without reconstruction descriptors' });
  }
  validateProvenance(ind.provenance, entity, issues);
}

export function validateDatabases(substances: readonly Substance[], indicators: readonly Indicator[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  for (const s of substances) {
    if (ids.has(s.id)) issues.push({ entity: `substance:${s.id}`, message: 'duplicate id' });
    ids.add(s.id);
    validateSubstance(s, issues);
  }
  const indIds = new Set<string>();
  for (const ind of indicators) {
    if (indIds.has(ind.id)) issues.push({ entity: `indicator:${ind.id}`, message: 'duplicate id' });
    indIds.add(ind.id);
    validateIndicator(ind, issues);
  }
  return issues;
}

/** Throw a descriptive error when the static databases are invalid. */
export function assertDatabasesValid(substances: readonly Substance[], indicators: readonly Indicator[]): void {
  const issues = validateDatabases(substances, indicators);
  if (issues.length > 0) {
    const text = issues.map((i) => `  - ${i.entity}: ${i.message}`).join('\n');
    throw new Error(`Chemical database validation failed:\n${text}`);
  }
}

export interface NumberRange {
  min: number;
  max: number;
}

export interface InputCheck {
  ok: boolean;
  value: number;
  message?: string;
}

/** Validate a numerical user input against a closed range; returns a clamped value and a message on failure. */
export function checkNumber(raw: number | string, range: NumberRange, unit: string): InputCheck {
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(value)) return { ok: false, value: range.min, message: `Enter a finite number (${unit}).` };
  if (value < range.min) return { ok: false, value: range.min, message: `Minimum is ${range.min} ${unit}.` };
  if (value > range.max) return { ok: false, value: range.max, message: `Maximum is ${range.max} ${unit}.` };
  return { ok: true, value };
}
