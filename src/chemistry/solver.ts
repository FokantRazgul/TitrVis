/**
 * Robust one-dimensional root finding.
 *
 * `brent` implements the Brent–Dekker method (inverse quadratic interpolation
 * safeguarded by bisection). It requires a bracket [a, b] with f(a)·f(b) ≤ 0 and
 * converges superlinearly for smooth functions while never leaving the bracket.
 * Reference: Brent, R. P. (1973) "Algorithms for Minimization without Derivatives",
 * Prentice-Hall, ch. 4; the formulation follows Press et al., Numerical Recipes, §9.3.
 */

export interface RootResult {
  root: number;
  fRoot: number;
  iterations: number;
  converged: boolean;
  bracket: [number, number];
}

export interface RootOptions {
  /** Absolute tolerance on the root. */
  xTolerance: number;
  /** Absolute tolerance on |f(root)|; 0 disables the function-value stopping criterion. */
  fTolerance?: number;
  maxIterations: number;
}

function isFiniteNumber(x: number): boolean {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Find a root of `f` inside [a, b] with Brent's method.
 * Throws if the interval does not bracket a root or if f is non-finite there.
 */
export function brent(f: (x: number) => number, a0: number, b0: number, options: RootOptions): RootResult {
  let a = a0;
  let b = b0;
  let fa = f(a);
  let fb = f(b);
  if (!isFiniteNumber(fa) || !isFiniteNumber(fb)) {
    throw new Error(`brent: non-finite function value at bracket (f(${a})=${fa}, f(${b})=${fb})`);
  }
  if (fa === 0) return { root: a, fRoot: 0, iterations: 0, converged: true, bracket: [a0, b0] };
  if (fb === 0) return { root: b, fRoot: 0, iterations: 0, converged: true, bracket: [a0, b0] };
  if (fa * fb > 0) {
    throw new Error(`brent: root not bracketed (f(${a})=${fa}, f(${b})=${fb})`);
  }

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  const fTol = options.fTolerance ?? 0;

  for (let iter = 1; iter <= options.maxIterations; iter++) {
    // Ensure b is the best estimate and c is on the other side of the root.
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * options.xTolerance;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0 || (fTol > 0 && Math.abs(fb) <= fTol)) {
      return { root: b, fRoot: fb, iterations: iter, converged: true, bracket: [a0, b0] };
    }
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      // Attempt inverse quadratic interpolation (or secant when a === c).
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      const min1 = 3 * xm * q - Math.abs(tol1 * q);
      const min2 = Math.abs(e * q);
      if (2 * p < Math.min(min1, min2)) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    if (Math.abs(d) > tol1) {
      b += d;
    } else {
      b += xm >= 0 ? tol1 : -tol1;
    }
    fb = f(b);
    if (!isFiniteNumber(fb)) {
      throw new Error(`brent: non-finite function value f(${b})=${fb}`);
    }
  }
  return { root: b, fRoot: fb, iterations: options.maxIterations, converged: false, bracket: [a0, b0] };
}

/**
 * Expand a bracket outward geometrically until f changes sign or the limits are hit.
 * Returns null if no sign change could be found within the limits.
 */
export function expandBracket(
  f: (x: number) => number,
  a: number,
  b: number,
  limitLow: number,
  limitHigh: number,
  maxSteps = 20,
): [number, number] | null {
  let lo = a;
  let hi = b;
  let flo = f(lo);
  let fhi = f(hi);
  for (let i = 0; i < maxSteps; i++) {
    if (!isFiniteNumber(flo) || !isFiniteNumber(fhi)) return null;
    if (flo === 0 || fhi === 0 || flo * fhi < 0) return [lo, hi];
    const width = hi - lo;
    lo = Math.max(limitLow, lo - width);
    hi = Math.min(limitHigh, hi + width);
    flo = f(lo);
    fhi = f(hi);
    if (lo === limitLow && hi === limitHigh) {
      if (isFiniteNumber(flo) && isFiniteNumber(fhi) && flo * fhi <= 0) return [lo, hi];
      return null;
    }
  }
  return null;
}
