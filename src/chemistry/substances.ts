/**
 * Substance database access and normalisation of raw acid/base data into
 * protonation ladders consumed by the equilibrium engine.
 */

import { SUBSTANCE_DATA } from './data/substances.data';
import { PKW_25C } from './constants';
import type { LadderComponent, Substance } from './types';

export const SUBSTANCES: readonly Substance[] = SUBSTANCE_DATA;

const byId = new Map<string, Substance>(SUBSTANCES.map((s) => [s.id, s]));

export function getSubstance(id: string): Substance {
  const s = byId.get(id);
  if (!s) throw new Error(`Unknown substance id "${id}"`);
  return s;
}

export function findSubstance(id: string): Substance | undefined {
  return byId.get(id);
}

/** Normalised ladder description (independent of concentration). */
export interface LadderTemplate {
  pKas: number[];
  maxCharge: number;
  speciesFormulas: string[];
  unitsPerFormula: number;
}

/**
 * Convert the raw acid/base systems of a substance into ladder templates.
 * Base systems given as pKb are converted with pKa = pKw − pKb; the ladder is
 * then re-ordered so that the most protonated species comes first.
 */
export function substanceLadders(substance: Substance, pKw: number = PKW_25C): LadderTemplate[] {
  const ladders: LadderTemplate[] = [];
  if (substance.acidSystem) {
    const a = substance.acidSystem;
    ladders.push({
      pKas: [...a.pKas],
      maxCharge: a.charges[0] + 1,
      speciesFormulas: [...a.speciesFormulas],
      unitsPerFormula: a.unitsPerFormula ?? 1,
    });
  }
  if (substance.baseSystem) {
    const b = substance.baseSystem;
    // pKa of the conjugate acid formed in protonation step i (i = 0 is the first protonation).
    const conjugatePKas: number[] = b.conjugateAcidPKas
      ? [...b.conjugateAcidPKas]
      : (b.pKbs ?? []).map((pKb) => pKw - pKb);
    const n = conjugatePKas.length;
    // Most protonated species charge = charge after the last protonation step.
    const maxCharge = b.charges[n - 1];
    // Ladder order: most protonated first, so deprotonation k removes the proton added in step n−1−k.
    const pKas = conjugatePKas.slice().reverse();
    const speciesFormulas = b.speciesFormulas.slice().reverse();
    ladders.push({ pKas, maxCharge, speciesFormulas, unitsPerFormula: b.unitsPerFormula ?? 1 });
  }
  return ladders;
}

/** Total spectator charge released per formula unit. */
export function spectatorChargePerFormula(substance: Substance): number {
  return substance.stoichiometry.spectatorIons.reduce((sum, ion) => sum + ion.charge * ion.count, 0);
}

export interface ProtonCapacity {
  /** Protons the substance can donate per formula unit (acid capacity). */
  donatable: number;
  /** Protons the substance can accept per formula unit (base capacity). */
  acceptable: number;
}

/**
 * Derive the acid/base capacities of a substance from electroneutrality:
 * the ladder species actually supplied must balance the spectator charge Q.
 *   acceptable = Σ units·maxCharge + Q
 *   donatable  = −Q − Σ units·minCharge
 * (strong electrolytes have no ladder and contribute only through Q).
 */
export function protonCapacity(substance: Substance, pKw: number = PKW_25C): ProtonCapacity {
  const q = spectatorChargePerFormula(substance);
  const ladders = substanceLadders(substance, pKw);
  let sumMax = 0;
  let sumMin = 0;
  for (const l of ladders) {
    sumMax += l.unitsPerFormula * l.maxCharge;
    sumMin += l.unitsPerFormula * (l.maxCharge - l.pKas.length);
  }
  return {
    acceptable: Math.max(0, sumMax + q),
    donatable: Math.max(0, -q - sumMin),
  };
}

/** Build the ladder components contributed by `moles` of a substance dissolved in `volumeL` litres. */
export function substanceLadderComponents(
  substance: Substance,
  moles: number,
  volumeL: number,
  pKw: number = PKW_25C,
): LadderComponent[] {
  return substanceLadders(substance, pKw).map((t, index) => ({
    pKas: t.pKas,
    maxCharge: t.maxCharge,
    totalConcentration: (moles * t.unitsPerFormula) / volumeL,
    speciesFormulas: t.speciesFormulas,
    origin: index === 0 ? substance.id : `${substance.id}#${index}`,
  }));
}

/** Case-insensitive search over id, English/Russian names and formula. */
export function searchSubstances(query: string, list: readonly Substance[] = SUBSTANCES): Substance[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter(
    (s) =>
      s.nameEn.toLowerCase().includes(q) ||
      s.nameRu.toLowerCase().includes(q) ||
      s.formula.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q),
  );
}

/** Substances usable as analyte/titrant (anything that can donate or accept protons). */
export function reactiveSubstances(list: readonly Substance[] = SUBSTANCES): Substance[] {
  return list.filter((s) => {
    const c = protonCapacity(s);
    return c.acceptable > 0 || c.donatable > 0;
  });
}
