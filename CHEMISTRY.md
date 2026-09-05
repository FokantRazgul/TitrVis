# Chemistry model

All quantities: concentrations in mol L⁻¹, volumes in mL, T = 25 °C.

## 1. Species model

A dissolved substance contributes

- **protonation ladders**: a most-protonated species H_nA with charge z₀ and n successive
  deprotonations with constants pKa₁ ≤ pKa₂ ≤ … ≤ pKaₙ (species charges z₀, z₀−1, …, z₀−n);
- **spectator ions** with fixed charge (Na⁺, K⁺, Ca²⁺, Cl⁻, NO₃⁻, …).

Strong electrolytes have no ladder: HCl is a Cl⁻ spectator (its proton is accounted for by
electroneutrality), NaOH is a Na⁺ spectator. H₂SO₄ is a ladder that starts at HSO₄⁻ (charge −1,
first dissociation complete) with pKa₂ = 1.99. Bases stored as pKb are converted with
pKa(BH⁺) = pKw − pKb and re-ordered so the ladder is ascending. Salts and ampholytes reuse the
parent acid ladder plus their counter-ions (NaHCO₃ = carbonate ladder + Na⁺). Ammonium acetate has
two ladders. Borax contributes four borate units and two Na⁺ per formula unit.

Proton capacities are derived, not stored. With Q = Σ z·count over spectator ions and Σ over
ladders of units × (max charge) and units × (min charge):

```
acceptable = max(0, Σ units·zmax + Q)      donatable = max(0, −Q − Σ units·zmin)
```

## 2. Equilibrium equations

Activities a_i = γ_i c_i. For each ladder step k and for water:

```
Ka,k = a_H · a_{k+1} / a_k          Kw = a_H · a_OH = 10⁻¹⁴          pH = −log10 a_H
```

Species fractions of a ladder at a given pH follow analytically. With t₀ = 1 and

```
log10 t_i = log10 t_{i−1} + pH − pKa_i + log10 γ_{i−1} − log10 γ_i
α_i = t_i / Σ_j t_j
```

computed in log space (the largest exponent is factored out) so that ladders spanning 20 pH units
never overflow. **Mass balance** Σ_i α_i C = C is satisfied by construction and verified after
every solve (relative error < 10⁻⁹).

**Electroneutrality** is the single equation solved:

```
f(pH) = [H⁺] − [OH⁻] + Σ_spectators z c + Σ_ladders C Σ_i z_i α_i(pH) = 0
[H⁺] = 10^−pH / γ₁       [OH⁻] = 10^(pH − pKw) / γ₋₁
```

Every term is non-increasing in pH and [H⁺] − [OH⁻] is strictly decreasing, so f has exactly one
root. This is verified numerically in the test-suite (monotonicity over −1 ≤ pH ≤ 15).

## 3. Numerical method

1. Evaluate f on the bracket [−2.5, 16.5] (10 M strong acid/base lie inside); expand
   geometrically up to [−6.5, 20.5] if needed; abort with `notBracketed` otherwise.
2. Brent–Dekker root finding (inverse quadratic interpolation safeguarded by bisection),
   absolute pH tolerance 10⁻¹¹, ≤ 200 iterations. Typical solves converge in 10–25 evaluations.
3. Davies mode: outer fixed-point iteration on the ionic strength I = ½ Σ c z² →
   γ(I) → pH → species → I, until |ΔI| ≤ 10⁻¹⁰·I (oscillation guard: averaging step), ≤ 100 outer
   iterations. The result is deterministic.
4. Validation of the solution: finite pH; all concentrations finite and ≥ 0;
   |f| ≤ 10⁻¹² + 10⁻⁸·Σ|terms|; mass-balance error ≤ 10⁻⁹. Failure throws a structured
   `ChemistryError {type, message, problem, details}`; the store keeps the previous valid state
   and notifies the user. No fabricated fallback values exist.

`SolverResult` returns pH, pOH, a_H, [H⁺], [OH⁻], every species with γ, α and concentration,
iteration counts, residual, ionic strength, bracket, warnings and timing.

## 4. Activity model

Ideal: γ = 1. Davies (Davies, *Ion Association*, 1962):

```
log10 γ_i = −A z_i² ( √I / (1 + √I) − 0.3 I ),  A = 0.5085 kg^½ mol^−½ at 25 °C
```

Neutral species keep γ = 1. When I exceeds 0.5 M a warning is attached to the result and shown in
the data panel; the equation is not claimed to be accurate beyond that range.

## 5. Dilution and titration

At added titrant volume V_t: V_total = V_analyte + V_t + V_indicator, and every analytical total
is n / V_total. The titration state at V_t is one solve. The direction of the reaction (titrant
acting as base or acid) is decided by comparing the pH of the pure titrant solution with the pH
of the pure analyte solution, together with the derived capacities.

Neutralisation degree = (C_t V_t cap_t) / (C_a V_a cap_a).

## 6. Equivalence points

```
V_eq,k = k · C_a V_a / (C_t · cap_t),   k = 1 … cap_a
```

For each V_eq the solver gives pH(V_eq), the slope dpH/dV from a ±0.5 % central difference and
the jump pH(1.01 V_eq) − pH(0.99 V_eq). A point is *detectable* when |jump| ≥ 0.5. For H₃PO₄/NaOH
this marks steps 1 and 2 as detectable and step 3 as not (pKa₃ = 12.32 is too close to the
titrant pH) — consistent with laboratory practice. The dense reference curve (adaptively refined
where |ΔpH| > 0.05) is used for numerical dpH/dV maxima shown as diagnostics.

## 7. Indicator

The indicator is a monoprotic ladder HIn ⇌ H⁺ + In⁻ included in the equilibrium problem with its
own charge and counter-ions (its concentration is ~10⁻⁵–10⁻⁶ M so it barely perturbs the pH, but
it is part of mass and charge balance). Its fraction

```
f_In = Ka / (Ka + a_H),  f_HIn = 1 − f_In,  [HIn]/[In⁻] = f_HIn / f_In
```

is read from the solved species. The **transition volume** is the root of pH(V) − pKa = 0 found
with Brent's method over [0, V_limit] (pH(V) is monotonic). **Indicator error**:
ΔV = V_transition − V_eq (nearest detectable equivalence point), error % = 100 ΔV / V_eq.

## 8. Spectra and colour

Common grid: 380–780 nm in 5 nm steps (81 samples). Indicator spectra are molar absorptivities
ε(λ) reconstructed as sums of Gaussian bands from cited λmax / ε values (see ASSUMPTIONS.md).

```
ε(λ) = f_HIn ε_HIn(λ) + f_In ε_In(λ)
A(λ) = ε(λ) · c_indicator · l           (Beer–Lambert; l = mean chord of the flask cross-section)
T(λ) = 10^−A(λ)
X = k Σ S_D65(λ) T(λ) x̄(λ),  Y = …ȳ…,  Z = …z̄…,   k = 1 / Σ S_D65 ȳ   (illuminant → Y = 1)
linear sRGB = M_sRGB(D65) · XYZ  (IEC 61966-2-1), clipped to [0,1] (flagged), sRGB transfer curve
```

The Indicator panel swatch, the numerical XYZ/sRGB values and the liquid renderer all use the
output of this function (`transmittanceToColour`). The renderer additionally converts the linear
colour to per-channel absorbance and rescales it with the per-pixel optical path — a documented
approximation of the wavelength integral for path lengths other than l.

## 9. Tolerances summary

| quantity | tolerance |
| --- | --- |
| pH root | 10⁻¹¹ (absolute) |
| charge balance | 10⁻¹² + 10⁻⁸ × Σ|terms| mol/L (tests additionally assert < 10⁻⁶) |
| mass balance | 10⁻⁹ relative |
| ionic-strength fixed point | 10⁻¹⁰ relative |
| indicator transition volume | 10⁻⁹ mL |
| reconstructed λmax vs cited | ≤ 10 nm (tested) |

## 10. Constants and provenance

pKa/pKb: CRC Handbook of Chemistry and Physics, 97th ed., Section 5 (25 °C, thermodynamic).
Molecular weights: PubChem. Indicator pKa, ranges, λmax: Sabnis, *Handbook of Acid-Base
Indicators* (2008) with structures from PubChem. CIE 1931 2° observer and D65: CIE 15:2004 via the
colour-science reference tables. Every database entry carries a `provenance` object with source,
level, reference, access date, temperature, conditions and data quality; the validator rejects
missing or placeholder provenance at start-up and in tests.
