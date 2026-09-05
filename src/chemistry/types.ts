/**
 * Core chemistry type definitions.
 *
 * The chemical engine is pure TypeScript: it must never import rendering or
 * simulation code. Everything here is expressed in SI-derived laboratory units:
 * concentrations in mol/L (M), volumes in mL, temperatures in °C, wavelengths in nm.
 */

/** Where a numerical value came from. Every critical constant carries one of these. */
export interface Provenance {
  /** Human-readable source name, e.g. "CRC Handbook of Chemistry and Physics, 97th ed." */
  source: string;
  /** Tier of the source: primary literature / authoritative database, or an authoritative compilation. */
  sourceLevel: 'primary' | 'secondary';
  /** Exact table / section / record identifier within the source, where applicable. */
  reference?: string;
  url?: string;
  doi?: string;
  /** ISO date on which the value was consulted. */
  accessed: string;
  /** Temperature (°C) at which the value applies. */
  temperature: number;
  /** Ionic-strength or other conditions stated by the source. */
  conditions: string;
  /** Whether the value was measured, reconstructed from literature descriptors, or derived from other data. */
  dataQuality: 'measured' | 'reconstructed' | 'derived';
  notes?: string;
}

export type SubstanceType = 'strongAcid' | 'weakAcid' | 'strongBase' | 'weakBase' | 'ampholyte' | 'salt';

/** An ion that does not participate in proton transfer but contributes to charge and ionic strength. */
export interface SpectatorIon {
  formula: string;
  charge: number;
  /** Number of such ions released per formula unit of the substance. */
  count: number;
}

/**
 * Successive deprotonation steps of an acid.
 * `pKas[i]` is the pKa of the step that produces the species with charge `charges[i]`.
 * The most protonated species has charge `charges[0] + 1`.
 * `speciesFormulas` lists species from most protonated to least (length = pKas.length + 1).
 */
export interface AcidSystem {
  pKas: number[];
  charges: number[];
  speciesFormulas: string[];
  /** Ladder units per formula unit (e.g. 4 for Na2B4O7 which yields 4 borate units). Defaults to 1. */
  unitsPerFormula?: number;
}

/**
 * Successive protonation steps of a base, stored in the form given by the source:
 * either pKb values (B + H2O ⇌ BH+ + OH−) or pKa values of the conjugate acids.
 * `charges[i]` is the charge of the conjugate acid formed in protonation step i.
 * `speciesFormulas` lists species from least protonated (the base) to most protonated.
 */
export interface BaseSystem {
  pKbs?: number[];
  conjugateAcidPKas?: number[];
  charges: number[];
  speciesFormulas: string[];
  unitsPerFormula?: number;
}

export interface Substance {
  id: string;
  nameRu: string;
  nameEn: string;
  formula: string;
  type: SubstanceType;
  /** g/mol */
  molecularWeight: number;
  acidSystem?: AcidSystem;
  baseSystem?: BaseSystem;
  stoichiometry: {
    /** Nominal proton-transfer equivalents per formula unit (informational; capacities are derived). */
    equivalents: number;
    spectatorIons: SpectatorIon[];
  };
  /** Aqueous solubility limit (mol/L) at 25 °C when the substance is sparingly soluble. */
  solubilityLimitM?: number;
  provenance: Provenance;
}

/** Wavelength-resolved molar absorptivity (L mol⁻¹ cm⁻¹). */
export interface Spectrum {
  unit: 'nm';
  data: { wavelength: number; molarAbsorptivity: number }[];
  dataQuality: 'measured' | 'reconstructed';
  source?: string;
  notes?: string;
}

/** Gaussian band used to reconstruct an absorption spectrum from literature descriptors. */
export interface SpectralBand {
  /** Band centre (nm), taken from a cited λmax. */
  centreNm: number;
  /** Full width at half maximum (nm). */
  fwhmNm: number;
  /** Peak molar absorptivity (L mol⁻¹ cm⁻¹). */
  epsilonMax: number;
}

export interface Indicator {
  id: string;
  name: string;
  nameRu: string;
  formula: string;
  /** SMILES string of the supplied form (from PubChem). */
  smiles: string;
  pubchemCid: number;
  molecularWeight: number;
  pKa: number;
  transitionRange: [number, number];
  /** Charge of the acid form HIn (the base form In⁻ has charge acidFormCharge − 1). */
  acidFormCharge: number;
  /** Counter-ions released when the supplied form is a salt (e.g. Na⁺ for methyl orange sodium salt). */
  spectatorIons: SpectatorIon[];
  /** Descriptive colours, used only for labels (never for colour computation). */
  colourNames: { acid: string; base: string };
  spectra: {
    acid: Spectrum;
    base: Spectrum;
  };
  /** Literature descriptors the spectra were reconstructed from (present when dataQuality is 'reconstructed'). */
  reconstruction?: {
    acidBands: SpectralBand[];
    baseBands: SpectralBand[];
    method: string;
  };
  provenance: Provenance;
}

export type ActivityModel = 'ideal' | 'davies';

/** One protonation ladder inside an equilibrium problem, with its analytical total. */
export interface LadderComponent {
  /** pKa values for successive deprotonations, most protonated species first. */
  pKas: number[];
  /** Charge of the most protonated species. */
  maxCharge: number;
  /** Analytical (total) concentration of the ladder, mol/L. */
  totalConcentration: number;
  /** Labels for species from most protonated to least. */
  speciesFormulas: string[];
  /** Identifier of the source component (substance or indicator id). */
  origin: string;
}

export interface SpectatorComponent {
  formula: string;
  charge: number;
  concentration: number;
  origin: string;
}

export interface EquilibriumProblem {
  ladders: LadderComponent[];
  spectators: SpectatorComponent[];
  /** −log10 Kw at the working temperature. */
  pKw: number;
  activityModel: ActivityModel;
  temperatureC: number;
}

export interface SpeciesState {
  formula: string;
  charge: number;
  /** mol/L */
  concentration: number;
  /** Activity coefficient used (1 for the ideal model). */
  activityCoefficient: number;
  /** Fraction of its ladder total (α), or 1 for spectators/water ions. */
  fraction: number;
  origin: string;
  kind: 'water' | 'ladder' | 'spectator';
  /** Index of the ladder within the problem for ladder species. */
  ladderIndex?: number;
}

export interface SolverDiagnostics {
  /** Root-finder iterations in the final activity iteration. */
  rootIterations: number;
  /** Outer activity-coefficient iterations (1 for the ideal model). */
  activityIterations: number;
  /** Ionic strength (mol/L) of the converged solution. */
  ionicStrength: number;
  /** Bracket used by the root finder, in pH units. */
  bracket: [number, number];
  /** Absolute charge-balance residual (mol/L). */
  chargeResidual: number;
  /** Largest relative mass-balance error over all ladders. */
  massBalanceError: number;
  /** Non-fatal warnings (e.g. Davies validity range exceeded). */
  warnings: string[];
  /** Wall-clock time of the solve in milliseconds (0 when unavailable). */
  elapsedMs: number;
}

export interface SolverResult {
  pH: number;
  pOH: number;
  /** Hydrogen-ion activity (10^−pH). */
  hydrogenActivity: number;
  /** Hydrogen-ion concentration, mol/L. */
  hydrogenConcentration: number;
  hydroxideConcentration: number;
  species: SpeciesState[];
  converged: boolean;
  iterations: number;
  residual: number;
  diagnostics: SolverDiagnostics;
}

export interface ChemistryErrorInfo {
  type: 'invalidInput' | 'notBracketed' | 'notConverged' | 'validationFailed';
  message: string;
  problem?: EquilibriumProblem;
  details?: Record<string, number | string | boolean>;
}

/** Colour result of the spectral pipeline. Components are in [0, 1]; `hex` is display sRGB. */
export interface RGBColour {
  /** CIE XYZ relative to the illuminant white (Y of the illuminant = 1). */
  xyz: [number, number, number];
  /** Linear sRGB before gamma, clipped to [0, 1]. */
  linear: [number, number, number];
  /** Gamma-encoded sRGB in [0, 1]. */
  srgb: [number, number, number];
  hex: string;
  /** True if any linear channel was outside [0, 1] before clipping (out of gamut). */
  clipped: boolean;
}

export interface IndicatorEquilibriumState {
  /** Total indicator concentration in the flask (mol/L). */
  concentrationM: number;
  /** Fraction present as the base form In⁻. */
  fractionBase: number;
  fractionAcid: number;
  /** [HIn]/[In⁻]; Infinity when no base form is present. */
  ratioAcidToBase: number;
  /** Absorbance spectrum on the common grid at the configured path length. */
  absorbance: number[];
  /** Mixture molar absorptivity ε(λ) on the common grid. */
  molarAbsorptivity: number[];
  transmittance: number[];
  colour: RGBColour;
  pathLengthCm: number;
}

/**
 * Contract between the chemical engine and the simulation/rendering layers.
 * Produced by the experiment store after every chemistry update; consumed read-only.
 */
export interface ChemicalVisualState {
  bulkPH: number;
  /** Fraction of indicator present as the base form (0 when no indicator is present). */
  indicatorFraction: number;
  /** Colour of the bulk liquid from the spectral pipeline (reference white when no indicator). */
  liquidColour: RGBColour;
  /** Per-channel linear-RGB absorbance of the bulk liquid at the reference path length (−log10 T_channel). */
  liquidAbsorbanceRGB: [number, number, number];
  addedTitrantVolume: number;
  totalVolumeML: number;
  /**
   * Colours of the bulk liquid mixed with an increasing local excess of titrant
   * (index 0 = bulk, last = bulk + LOCAL_EXCESS_FRACTION of titrant), each computed by the
   * equilibrium solver. The GPU mixing field interpolates between these chemically computed
   * endpoint states — a documented rendering approximation, never the bulk truth.
   */
  localColourLUT: RGBColour[];
  analyticalState: SolverResult;
}
