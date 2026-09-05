/**
 * Parametric Erlenmeyer flask geometry (pure math, no Three.js).
 *
 * Standard sizes follow ISO 1773 (narrow-neck Erlenmeyer flasks): nominal capacity, body
 * diameter, overall height and neck outer diameter. The profile is simplified to a flat
 * base with a fillet, a conical body up to the shoulder, and a cylindrical neck. The
 * liquid height for a given volume is obtained by numerically integrating the profile
 * (V(h) = ∫ π r(h)² dh) and inverting the monotonic table. The simplification of the true
 * blown-glass shape is documented in ASSUMPTIONS.md.
 */

export interface FlaskSpec {
  nominalML: number;
  /** Body (base) diameter, m. */
  bodyDiameter: number;
  /** Overall height, m. */
  height: number;
  /** Neck outer diameter, m. */
  neckDiameter: number;
  /** Glass wall thickness, m. */
  wallThickness: number;
}

/** ISO 1773 narrow-neck Erlenmeyer flask dimensions (mm → m). */
export const FLASK_SPECS: readonly FlaskSpec[] = [
  { nominalML: 50, bodyDiameter: 0.051, height: 0.085, neckDiameter: 0.022, wallThickness: 0.0012 },
  { nominalML: 100, bodyDiameter: 0.064, height: 0.105, neckDiameter: 0.022, wallThickness: 0.0013 },
  { nominalML: 250, bodyDiameter: 0.085, height: 0.14, neckDiameter: 0.034, wallThickness: 0.0015 },
  { nominalML: 500, bodyDiameter: 0.105, height: 0.175, neckDiameter: 0.034, wallThickness: 0.0016 },
  { nominalML: 1000, bodyDiameter: 0.131, height: 0.22, neckDiameter: 0.042, wallThickness: 0.0018 },
  { nominalML: 2000, bodyDiameter: 0.166, height: 0.28, neckDiameter: 0.05, wallThickness: 0.002 },
  { nominalML: 3000, bodyDiameter: 0.187, height: 0.31, neckDiameter: 0.05, wallThickness: 0.0022 },
  { nominalML: 5000, bodyDiameter: 0.22, height: 0.365, neckDiameter: 0.05, wallThickness: 0.0025 },
];

/** Fraction of the overall height at which the conical body meets the neck. */
const SHOULDER_FRACTION = 0.7;
/** Fraction of the body radius used as the bottom fillet radius. */
const FILLET_FRACTION = 0.12;

export interface FlaskProfile {
  spec: FlaskSpec;
  /** Inner radius as a function of height above the inner floor (m). */
  innerRadius: (h: number) => number;
  /** Outer radius as a function of height above the outer floor (m). */
  outerRadius: (h: number) => number;
  /** Inner height of the flask (floor to rim), m. */
  innerHeight: number;
  /** Shoulder height (start of the neck), m. */
  shoulderHeight: number;
  /** Table of cumulative inner volume (mL) vs height (m), monotonic. */
  volumeTable: { h: number; volumeML: number }[];
  /** Total inner volume to the rim, mL. */
  capacityML: number;
  /** Inner volume of the conical body up to the shoulder, mL. */
  bodyCapacityML: number;
}

function makeRadiusFn(baseRadius: number, neckRadius: number, height: number, shoulder: number) {
  const fillet = baseRadius * FILLET_FRACTION;
  return (h: number): number => {
    if (h <= 0) return 0;
    if (h >= height) return neckRadius;
    // Conical body radius (linear from base to shoulder).
    const cone = h < shoulder ? baseRadius + ((neckRadius - baseRadius) * h) / shoulder : neckRadius;
    if (h < fillet) {
      // Quarter-circle fillet at the base: radius grows from (base − fillet) to base.
      const t = 1 - h / fillet;
      const r = baseRadius - fillet + Math.sqrt(Math.max(0, fillet * fillet - (fillet * t) * (fillet * t)));
      return Math.min(r, cone);
    }
    return cone;
  };
}

const profileCache = new Map<number, FlaskProfile>();

export function flaskProfile(spec: FlaskSpec): FlaskProfile {
  const cached = profileCache.get(spec.nominalML);
  if (cached) return cached;
  const outerBase = spec.bodyDiameter / 2;
  const outerNeck = spec.neckDiameter / 2;
  const shoulder = spec.height * SHOULDER_FRACTION;
  const innerHeight = spec.height - spec.wallThickness;
  const innerRadius = makeRadiusFn(outerBase - spec.wallThickness, outerNeck - spec.wallThickness, innerHeight, shoulder - spec.wallThickness);
  const outerRadius = makeRadiusFn(outerBase, outerNeck, spec.height, shoulder);

  const steps = 800;
  const table: { h: number; volumeML: number }[] = [{ h: 0, volumeML: 0 }];
  let volume = 0;
  let bodyCapacity = 0;
  const dh = innerHeight / steps;
  for (let i = 1; i <= steps; i++) {
    const h0 = (i - 1) * dh;
    const h1 = i * dh;
    // Trapezoidal rule on π r²
    const a0 = Math.PI * innerRadius(h0) ** 2;
    const a1 = Math.PI * innerRadius(h1) ** 2;
    volume += 0.5 * (a0 + a1) * dh;
    table.push({ h: h1, volumeML: volume * 1e6 });
    if (h1 <= shoulder - spec.wallThickness) bodyCapacity = volume * 1e6;
  }
  const profile: FlaskProfile = {
    spec,
    innerRadius,
    outerRadius,
    innerHeight,
    shoulderHeight: shoulder,
    volumeTable: table,
    capacityML: volume * 1e6,
    bodyCapacityML: bodyCapacity,
  };
  profileCache.set(spec.nominalML, profile);
  return profile;
}

/** Height of the liquid surface above the inner floor for a volume (mL); clamped to the rim. */
export function liquidHeightForVolume(profile: FlaskProfile, volumeML: number): number {
  const table = profile.volumeTable;
  if (volumeML <= 0) return 0;
  if (volumeML >= profile.capacityML) return profile.innerHeight;
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid].volumeML < volumeML) lo = mid;
    else hi = mid;
  }
  const a = table[lo];
  const b = table[hi];
  const t = (volumeML - a.volumeML) / (b.volumeML - a.volumeML);
  return a.h + t * (b.h - a.h);
}

/** Inner volume (mL) below a given height (m). */
export function volumeForHeight(profile: FlaskProfile, h: number): number {
  const table = profile.volumeTable;
  if (h <= 0) return 0;
  if (h >= profile.innerHeight) return profile.capacityML;
  const dh = profile.innerHeight / (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(h / dh));
  const t = (h - table[i].h) / dh;
  return table[i].volumeML + t * (table[i + 1].volumeML - table[i].volumeML);
}

/** Smallest standard flask whose conical body holds `maxVolumeML` with headroom (≤ 80 % of the body). */
export function selectFlask(maxVolumeML: number): FlaskProfile {
  for (const spec of FLASK_SPECS) {
    const p = flaskProfile(spec);
    if (maxVolumeML <= 0.8 * p.bodyCapacityML) return p;
  }
  return flaskProfile(FLASK_SPECS[FLASK_SPECS.length - 1]);
}

/**
 * Optical path length (cm) through the liquid used for the Beer–Lambert colour: the mean
 * horizontal chord of the circular cross-section at half the liquid height, (π/4)·D.
 * Documented in ASSUMPTIONS.md.
 */
export function opticalPathCm(profile: FlaskProfile, volumeML: number): number {
  const h = liquidHeightForVolume(profile, volumeML);
  const r = profile.innerRadius(Math.max(0.5 * h, 1e-4));
  return ((Math.PI / 4) * 2 * r) * 100;
}
