/**
 * Physical constants of the chemical model.
 *
 * The engine is defined at 25 °C. Kw is fixed at 1.0 × 10⁻¹⁴ (pKw = 14.000) as
 * specified for the model; the temperature dependence of Kw is documented in
 * CHEMISTRY.md (pKw ranges from 14.94 at 0 °C to 13.26 at 50 °C, CRC Handbook,
 * "Ionization Constant of Water") but no other temperature is supported because
 * the pKa database is tabulated at 25 °C only.
 */

export const DEFAULT_TEMPERATURE_C = 25;

/** −log10 Kw at 25 °C used by the model (Kw = 1.0e−14). */
export const PKW_25C = 14.0;

/**
 * Debye–Hückel A parameter (kg^½ mol^−½) at 25 °C for water, used by the Davies equation.
 * Value from Davies, C. W. (1962) "Ion Association", Butterworths (0.5085 at 25 °C);
 * rounded to 0.51 in many textbooks and in the project specification.
 */
export const DAVIES_A_25C = 0.5085;

/** Davies empirical linear coefficient. */
export const DAVIES_B = 0.3;

/** Ionic strength (mol/L) above which the Davies equation is no longer considered reliable. */
export const DAVIES_VALID_IONIC_STRENGTH = 0.5;

/** Physically meaningful pH search interval; 10 M strong acid gives pH −1, 10 M strong base pH 15. */
export const PH_BRACKET_MIN = -2.5;
export const PH_BRACKET_MAX = 16.5;

/** Root-finder absolute tolerance in pH units. */
export const PH_TOLERANCE = 1e-11;

/** Maximum root-finder iterations per solve. */
export const MAX_ROOT_ITERATIONS = 200;

/** Maximum outer activity-coefficient iterations. */
export const MAX_ACTIVITY_ITERATIONS = 100;

/** Relative convergence tolerance for the ionic-strength fixed point. */
export const IONIC_STRENGTH_TOLERANCE = 1e-10;

/** Charge-balance validation: |residual| ≤ CHARGE_ABS_TOL + CHARGE_REL_TOL × Σ|terms|. */
export const CHARGE_ABS_TOL = 1e-12;
export const CHARGE_REL_TOL = 1e-8;

/** Mass-balance validation tolerance (relative). */
export const MASS_BALANCE_TOL = 1e-9;

/** Input bounds enforced by the UI and the validation layer. */
export const LIMITS = {
  analyteVolumeML: { min: 1, max: 1000 },
  analyteConcentrationM: { min: 0.0001, max: 10 },
  titrantConcentrationM: { min: 0.0001, max: 10 },
  dropRateHz: { min: 0.2, max: 20 },
  dropVolumeML: { min: 0.005, max: 0.5 },
  indicatorStockConcentrationM: { min: 1e-6, max: 0.1 },
  indicatorVolumeML: { min: 0.01, max: 10 },
  indicatorDrops: { min: 1, max: 50 },
  indicatorDropVolumeML: 0.05,
  titrantLimitFactor: { min: 1, max: 5 },
} as const;
