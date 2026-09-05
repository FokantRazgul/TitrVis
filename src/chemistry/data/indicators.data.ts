/**
 * Indicator database — raw tabulated descriptors.
 *
 * Provenance
 * ----------
 * pKa values, transition ranges, colours and absorption maxima (λmax) of the acid (HIn) and base (In⁻)
 * forms: R. W. Sabnis, "Handbook of Acid-Base Indicators", CRC Press, 2008 (secondary compilation of
 * the primary literature, chiefly I. M. Kolthoff, "Acid-Base Indicators", Macmillan, 1937, and later
 * spectrophotometric studies). Peak molar absorptivities are the values quoted there where available
 * and otherwise typical literature magnitudes for the dye class; they are flagged in `notes`.
 *
 * Molecular structures (SMILES), formulae, molecular weights and CIDs: PubChem
 * (https://pubchem.ncbi.nlm.nih.gov/), accessed 2026-09-05, for the CID given on each entry.
 *
 * Spectra are NOT experimentally tabulated here: they are reconstructed on the common 5 nm grid from
 * the cited λmax / bandwidth / ε descriptors as sums of Gaussian bands (see spectra.ts) and carry
 * dataQuality = "reconstructed". A test asserts that each reconstructed maximum lies within ±10 nm
 * of the cited λmax.
 */

import type { Provenance, SpectralBand } from '../types';

const ACCESSED = '2026-09-05';

export interface IndicatorRaw {
  id: string;
  name: string;
  nameRu: string;
  formula: string;
  smiles: string;
  pubchemCid: number;
  molecularWeight: number;
  pKa: number;
  transitionRange: [number, number];
  acidFormCharge: number;
  sodiumSalt: boolean;
  colourNames: { acid: string; base: string };
  acidBands: SpectralBand[];
  baseBands: SpectralBand[];
  /** Typical working stock solution strength, % w/v (g per 100 mL). */
  typicalStockPercentWV: number;
  notes: string;
}

export const INDICATOR_PROVENANCE: Provenance = {
  source: 'R. W. Sabnis, Handbook of Acid-Base Indicators, CRC Press (2008); structures from PubChem',
  sourceLevel: 'secondary',
  reference: 'Monographs for each indicator (pKa, pH range, colour change, λmax); PubChem CID per entry',
  url: 'https://pubchem.ncbi.nlm.nih.gov/',
  accessed: ACCESSED,
  temperature: 25,
  conditions: 'aqueous solution, room temperature, low ionic strength, as stated by the compilation',
  dataQuality: 'reconstructed',
  notes:
    'pKa and λmax are literature values; the full spectra are Gaussian reconstructions of those descriptors, not measured data.',
};

// Sulfonephthalein yellow (monoanion) forms share a ≈433 nm π→π* band; the blue/red dianion forms have a
// strong band at 560–620 nm. Bandwidths (FWHM) of 75–105 nm are typical of these dyes in water.
export const INDICATOR_DATA: IndicatorRaw[] = [
  {
    id: 'methyl_orange',
    name: 'Methyl orange',
    nameRu: 'Метиловый оранжевый',
    formula: 'C14H14N3NaO3S',
    smiles: 'CN(C)C1=CC=C(C=C1)N=NC2=CC=C(C=C2)S(=O)(=O)[O-].[Na+]',
    pubchemCid: 23673835,
    molecularWeight: 327.34,
    pKa: 3.46,
    transitionRange: [3.1, 4.4],
    acidFormCharge: 0,
    sodiumSalt: true,
    colourNames: { acid: 'red', base: 'yellow-orange' },
    acidBands: [{ centreNm: 507, fwhmNm: 100, epsilonMax: 33000 }],
    baseBands: [{ centreNm: 464, fwhmNm: 95, epsilonMax: 26000 }],
    typicalStockPercentWV: 0.04,
    notes: 'Azo dye; acid form is the red azonium/ammonium tautomer (λmax 507 nm), base form yellow (λmax 464 nm, ε ≈ 2.6 × 10⁴).',
  },
  {
    id: 'bromophenol_blue',
    name: 'Bromophenol blue',
    nameRu: 'Бромфеноловый синий',
    formula: 'C19H10Br4O5S',
    smiles: 'C1=CC=C2C(=C1)C(OS2(=O)=O)(C3=CC(=C(C(=C3)Br)O)Br)C4=CC(=C(C(=C4)Br)O)Br',
    pubchemCid: 8272,
    molecularWeight: 670.0,
    pKa: 4.0,
    transitionRange: [3.0, 4.6],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'blue-violet' },
    acidBands: [{ centreNm: 436, fwhmNm: 90, epsilonMax: 20000 }],
    baseBands: [{ centreNm: 592, fwhmNm: 80, epsilonMax: 68000 }],
    typicalStockPercentWV: 0.04,
    notes: 'Sulfonephthalein; λmax 436 nm (yellow) / 592 nm (blue), ε₅₉₂ ≈ 6.8 × 10⁴.',
  },
  {
    id: 'bromocresol_green',
    name: 'Bromocresol green',
    nameRu: 'Бромкрезоловый зелёный',
    formula: 'C21H14Br4O5S',
    smiles: 'CC1=C(C(=C(C=C1C2(C3=CC=CC=C3S(=O)(=O)O2)C4=CC(=C(C(=C4C)Br)O)Br)Br)O)Br',
    pubchemCid: 6451,
    molecularWeight: 698.0,
    pKa: 4.7,
    transitionRange: [3.8, 5.4],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'blue' },
    acidBands: [{ centreNm: 444, fwhmNm: 90, epsilonMax: 18000 }],
    baseBands: [{ centreNm: 617, fwhmNm: 80, epsilonMax: 42000 }],
    typicalStockPercentWV: 0.04,
    notes: 'Sulfonephthalein; pKa 4.7 (4.66–4.9 reported); λmax 444 nm / 617 nm, ε₆₁₇ ≈ 4.2 × 10⁴.',
  },
  {
    id: 'methyl_red',
    name: 'Methyl red',
    nameRu: 'Метиловый красный',
    formula: 'C15H15N3O2',
    smiles: 'CN(C)C1=CC=C(C=C1)N=NC2=CC=CC=C2C(=O)O',
    pubchemCid: 10303,
    molecularWeight: 269.3,
    pKa: 5.1,
    transitionRange: [4.4, 6.2],
    acidFormCharge: 0,
    sodiumSalt: false,
    colourNames: { acid: 'red', base: 'yellow' },
    acidBands: [{ centreNm: 520, fwhmNm: 105, epsilonMax: 37000 }],
    baseBands: [{ centreNm: 435, fwhmNm: 95, epsilonMax: 22000 }],
    typicalStockPercentWV: 0.02,
    notes: 'Azo dye; red zwitterionic acid form λmax 520 nm, yellow anion λmax 435 nm.',
  },
  {
    id: 'chlorophenol_red',
    name: 'Chlorophenol red',
    nameRu: 'Хлорфеноловый красный',
    formula: 'C19H12Cl2O5S',
    smiles: 'C1=CC=C2C(=C1)C(OS2(=O)=O)(C3=CC(=C(C=C3)O)Cl)C4=CC(=C(C=C4)O)Cl',
    pubchemCid: 20486,
    molecularWeight: 423.3,
    pKa: 6.0,
    transitionRange: [5.2, 6.8],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'red-violet' },
    acidBands: [{ centreNm: 433, fwhmNm: 90, epsilonMax: 19000 }],
    baseBands: [{ centreNm: 573, fwhmNm: 80, epsilonMax: 50000 }],
    typicalStockPercentWV: 0.04,
    notes: 'Sulfonephthalein; λmax 433 nm / 573 nm. ε₅₇₃ is a typical class magnitude (≈5 × 10⁴).',
  },
  {
    id: 'bromocresol_purple',
    name: 'Bromocresol purple',
    nameRu: 'Бромкрезоловый пурпурный',
    formula: 'C21H16Br2O5S',
    smiles: 'CC1=CC(=CC(=C1O)Br)C2(C3=CC=CC=C3S(=O)(=O)O2)C4=CC(=C(C(=C4)C)O)Br',
    pubchemCid: 8273,
    molecularWeight: 540.2,
    pKa: 6.3,
    transitionRange: [5.2, 6.8],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'purple' },
    acidBands: [{ centreNm: 433, fwhmNm: 90, epsilonMax: 19000 }],
    baseBands: [{ centreNm: 591, fwhmNm: 80, epsilonMax: 54000 }],
    typicalStockPercentWV: 0.04,
    notes: 'Sulfonephthalein; λmax 433 nm / 591 nm, ε₅₉₁ ≈ 5.4 × 10⁴.',
  },
  {
    id: 'bromothymol_blue',
    name: 'Bromothymol blue',
    nameRu: 'Бромтимоловый синий',
    formula: 'C27H28Br2O5S',
    smiles: 'CC1=C(C=C(C(=C1Br)O)C(C)C)C2(C3=CC=CC=C3S(=O)(=O)O2)C4=C(C(=C(C(=C4)C(C)C)O)Br)C',
    pubchemCid: 6450,
    molecularWeight: 624.4,
    pKa: 7.1,
    transitionRange: [6.0, 7.6],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'blue' },
    acidBands: [{ centreNm: 433, fwhmNm: 90, epsilonMax: 17000 }],
    baseBands: [{ centreNm: 617, fwhmNm: 80, epsilonMax: 38000 }],
    typicalStockPercentWV: 0.04,
    notes: 'Sulfonephthalein; pKa 7.1 (7.0–7.1 reported); λmax 433 nm / 617 nm, ε₆₁₇ ≈ 3.8 × 10⁴.',
  },
  {
    id: 'phenol_red',
    name: 'Phenol red',
    nameRu: 'Феноловый красный',
    formula: 'C19H14O5S',
    smiles: 'C1=CC=C2C(=C1)C(OS2(=O)=O)(C3=CC=C(C=C3)O)C4=CC=C(C=C4)O',
    pubchemCid: 4766,
    molecularWeight: 354.4,
    pKa: 7.9,
    transitionRange: [6.8, 8.2],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'red' },
    acidBands: [{ centreNm: 433, fwhmNm: 90, epsilonMax: 20000 }],
    baseBands: [{ centreNm: 558, fwhmNm: 75, epsilonMax: 56000 }],
    typicalStockPercentWV: 0.02,
    notes: 'Phenolsulfonphthalein; pKa 7.9 (7.8–8.0 reported); λmax 433 nm / 558 nm, ε₅₅₈ ≈ 5.6 × 10⁴.',
  },
  {
    id: 'cresol_red',
    name: 'Cresol red',
    nameRu: 'Крезоловый красный',
    formula: 'C21H18O5S',
    smiles: 'CC1=C(C=CC(=C1)C2(C3=CC=CC=C3S(=O)(=O)O2)C4=CC(=C(C=C4)O)C)O',
    pubchemCid: 73013,
    molecularWeight: 382.4,
    pKa: 8.3,
    transitionRange: [7.2, 8.8],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'red-purple' },
    acidBands: [{ centreNm: 434, fwhmNm: 90, epsilonMax: 20000 }],
    baseBands: [{ centreNm: 572, fwhmNm: 78, epsilonMax: 54000 }],
    typicalStockPercentWV: 0.04,
    notes: 'o-Cresolsulfonphthalein; λmax 434 nm / 572 nm. ε₅₇₂ is a typical class magnitude (≈5.4 × 10⁴).',
  },
  {
    id: 'thymol_blue',
    name: 'Thymol blue',
    nameRu: 'Тимоловый синий',
    formula: 'C27H30O5S',
    smiles: 'CC1=CC(=C(C=C1C2(C3=CC=CC=C3S(=O)(=O)O2)C4=CC(=C(C=C4C)O)C(C)C)C(C)C)O',
    pubchemCid: 65565,
    molecularWeight: 466.6,
    pKa: 8.9,
    transitionRange: [8.0, 9.6],
    acidFormCharge: -1,
    sodiumSalt: false,
    colourNames: { acid: 'yellow', base: 'blue' },
    acidBands: [{ centreNm: 435, fwhmNm: 90, epsilonMax: 17000 }],
    baseBands: [{ centreNm: 596, fwhmNm: 80, epsilonMax: 36000 }],
    typicalStockPercentWV: 0.04,
    notes: 'Thymolsulfonphthalein; only the alkaline transition (pKa₂ 8.9, yellow → blue) is modelled; the acid transition (pKa₁ ≈ 1.7, red → yellow) is outside the monoprotic indicator model.',
  },
  {
    id: 'phenolphthalein',
    name: 'Phenolphthalein',
    nameRu: 'Фенолфталеин',
    formula: 'C20H14O4',
    smiles: 'C1=CC=C2C(=C1)C(=O)OC2(C3=CC=C(C=C3)O)C4=CC=C(C=C4)O',
    pubchemCid: 4764,
    molecularWeight: 318.3,
    pKa: 9.4,
    transitionRange: [8.2, 10.0],
    acidFormCharge: 0,
    sodiumSalt: false,
    colourNames: { acid: 'colourless', base: 'pink-magenta' },
    acidBands: [],
    baseBands: [{ centreNm: 553, fwhmNm: 70, epsilonMax: 32000 }],
    typicalStockPercentWV: 0.1,
    notes:
      'Phthalein; the colourless lactone loses two protons in closely spaced steps (pKa ≈ 9.05 and ≈ 9.5) to the quinoid dianion; modelled as one effective step with pKa 9.4. λmax 553 nm, ε ≈ 3.2 × 10⁴. Fading in strong alkali (carbinol formation) is not modelled.',
  },
  {
    id: 'thymolphthalein',
    name: 'Thymolphthalein',
    nameRu: 'Тимолфталеин',
    formula: 'C28H30O4',
    smiles: 'CC1=CC(=C(C=C1C2(C3=CC=CC=C3C(=O)O2)C4=CC(=C(C=C4C)O)C(C)C)C(C)C)O',
    pubchemCid: 31316,
    molecularWeight: 430.5,
    pKa: 9.9,
    transitionRange: [9.3, 10.5],
    acidFormCharge: 0,
    sodiumSalt: false,
    colourNames: { acid: 'colourless', base: 'blue' },
    acidBands: [],
    baseBands: [{ centreNm: 595, fwhmNm: 80, epsilonMax: 38000 }],
    typicalStockPercentWV: 0.1,
    notes: 'Phthalein; two closely spaced deprotonations modelled as one effective step (pKa 9.9). λmax 595 nm, ε₅₉₅ = 3.8 × 10⁴.',
  },
];
