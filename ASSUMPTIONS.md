# Assumptions and approximations

Every simplification of the physical, chemical, optical or computational model is listed here
with its justification and its consequences. Items marked **(tested)** have a dedicated test.

## Chemistry

1. **Temperature 25 °C, Kw = 1.0 × 10⁻¹⁴.** All tabulated constants are 25 °C values; the model
   refuses other temperatures. Real pKw is 13.995 at 25 °C — the 0.005 difference is below the
   uncertainty of the pKa data. Kw changes from 14.94 (0 °C) to 13.26 (50 °C) (CRC Handbook), so
   results at other temperatures would differ; this is documented, not modelled.
2. **Ideal solution by default (γ = 1).** Concentration equals activity. **(tested)**
3. **Davies equation as the optional activity model**, A = 0.5085 (the specification quotes the
   rounded 0.51), b = 0.3, neutral species γ = 1. Valid to I ≈ 0.5 M; above that a warning is
   emitted and shown. No Pitzer/SIT treatment. **(tested)**
4. **Ionic strength includes every dissolved ion**, including the indicator's ions and the
   counter-ions of salts; it is computed from the solved species and iterated to self-consistency.
5. **No atmospheric CO₂ exchange.** Carbonic/sulfurous systems are closed: no loss of CO₂/SO₂,
   no absorption from air. Real open-flask titrations near pH 8–10 are affected by CO₂.
6. **Instantaneous equilibrium, no kinetics.** Each drop is assumed fully reacted before the next
   frame; slow reactions (e.g. CO₂ hydration) are not modelled.
7. **Strong electrolytes are completely dissociated** (HCl, HBr, HI, HNO₃, HClO₄, NaOH, KOH,
   LiOH, Ca(OH)₂, Ba(OH)₂, Mg(OH)₂). H₂SO₄: first step complete, second with pKa₂ = 1.99. Ion
   pairing (e.g. CaOH⁺, NaSO₄⁻) is neglected.
8. **Sparingly soluble hydroxides** (Ca(OH)₂, Ba(OH)₂, Mg(OH)₂) are treated as fully dissolved
   at the requested concentration; the UI warns when the concentration exceeds the tabulated
   solubility. Precipitation is not simulated.
9. **Polyprotic ladders use stepwise thermodynamic pKa values** as tabulated; micro-species
   (tautomers) are not distinguished. Amino acids are modelled as zwitterion ladders.
10. **Bases stored as pKb** are converted with pKa = 14.00 − pKb.
11. **Reaction direction** (titrant acts as base or acid) is decided by comparing the pH of the
    pure titrant solution with that of the pure analyte solution plus the derived proton
    capacities. Pairs that cannot react (acid + acid) yield no equivalence points and a notice.
12. **Equivalence detectability** uses the model criterion |pH(1.01 V_eq) − pH(0.99 V_eq)| ≥ 0.5.
    This is a display classification only; all stoichiometric points are computed and listed.
13. **Indicator error** is reported against the nearest *detectable* equivalence point (or the
    nearest point if none is detectable).
14. **Indicators are monoprotic** HIn/In⁻ with one effective pKa. Phenolphthalein and
    thymolphthalein lose two protons in closely spaced steps; thymol blue has a second (acid)
    transition at pH 1.2–2.8 that is not modelled; fading of phenolphthalein in strong alkali is
    not modelled. Indicator charge conventions (acid form charge, Na⁺ counter-ion of methyl
    orange) are stated per entry. **(tested for fractions and ratio)**
15. **Indicator dose** is a stock solution of user-set molarity; the default is the typical
    laboratory % w/v strength converted with the molecular weight (e.g. 0.1 % w/v
    phenolphthalein = 3.1 × 10⁻³ M). Solvent (ethanol) effects on pKa are ignored.
16. **Titrant safety limit** = 2 × initial analyte volume (configurable factor 1–5 internally).
    Drops beyond the limit are refused: no chemistry, no injection.

## Spectra and colour

17. **Reconstructed spectra.** No tabulated ε(λ) datasets with a redistribution licence were
    available offline, so each form is reconstructed as a sum of Gaussian bands
    ε(λ) = Σ εmax·exp(−4 ln 2 ((λ − λmax)/FWHM)²) from the cited λmax and εmax, with FWHM 70–105
    nm typical of azo and sulfonephthalein dyes. Every spectrum carries
    `dataQuality: "reconstructed"`, the descriptors and the method; a test asserts the maxima are
    within ±10 nm of the cited values. Reconstructed spectra are never labelled as measured.
    **(tested)**
18. **Beer–Lambert linearity** at the indicator concentrations used (≤ 10⁻⁴ M): no dimerisation,
    no deviation at high absorbance.
19. **Optical path** for the swatch and the bulk colour = mean horizontal chord of the circular
    liquid cross-section at half the liquid height, (π/4)·D of the flask at that level. The
    renderer scales the channel absorbance with an estimated per-pixel path (depth for the top
    surface, chord for the wall). **(tested for magnitude)**
20. **Illumination D65**; observer CIE 1931 2°; output sRGB (IEC 61966-2-1) with clipping (flagged
    when out of gamut). Display calibration and viewing conditions are not modelled.
21. **Scattering and glass transmission** are neglected in the colour model (the rendering adds
    a small visual in-scatter term). The flask glass is assumed colourless.
22. **Per-channel absorbance scaling in the shader** (A_RGB = −log10 of the linear channel
    transmittance at the reference path, multiplied by path ratio) is a rendering approximation of
    the wavelength integral; the reference colour itself is spectrally exact.

## Simulation (visual)

23. **Exact bulk state vs visual local state.** The equilibrium solver defines the bulk
    composition. The GPU mixing scalar m ∈ [0, 1] is the *local fraction of freshly added
    titrant*; the liquid colour at a pixel is looked up in an 8-entry LUT whose entries are
    equilibrium solves of the flask with an extra 0, …, 4 % of titrant. Interpolating between these
    chemically computed states is a rendering approximation; it never feeds back into the bulk
    chemistry. **(GPU tests: injection, advection, decay)**
24. **2-D depth-averaged fluid.** Velocity and mixing live on a horizontal slice of the liquid
    disc (unit square, disc radius 0.49 UV); the colour of a vertical column is uniform. Real
    plumes sink and spread in 3-D.
25. **Stable Fluids scheme** (Stam 1999): semi-Lagrangian advection is dissipative; the projection
    enforces incompressibility to the tolerance of 30 Jacobi iterations. Energy is not conserved
    by design (physical damping `exp(−ln2/1.5·dt)` plus numerical dissipation); tests check
    finiteness, boundedness, response to forcing and monotonic decay, not exact conservation.
    **(tested)**
26. **Mixing relaxation**: the scalar decays towards the bulk with rate 1/6 s⁻¹ at rest and
    1/1.2 s⁻¹ while stirring, representing homogenisation. The rates are visual parameters.
27. **Stirring model**: 12° tilt, 2.5 Hz orbit of 6 mm, liquid target angular speed 0.9 rev/s,
    relaxation gain 3 s⁻¹, half-life 1.5 s after release. The flask tilts about the axis
    perpendicular to the orbit direction. The sloshing acceleration a = r ω² drives the fluid and
    the surface slope a/g. A hand-swirled flask is not a magnetic stirrer. **(tested)**
28. **Surface**: 64×64 damped wave equation (c = 0.35 m/s, damping 2.5 s⁻¹) with Neumann walls,
    volume-conserving impacts (mean removed), equilibrium shape = paraboloid ω²r²/2g + slope.
    Capillary effects, meniscus and breaking waves are not modelled. **(tested)**
29. **Drops** are spheres of the configured volume, growing at the tip for 55 % of the drop
    interval, then falling under g = 9.81 m/s² without drag (fall height ≈ 20 cm → ≈ 0.2 s;
    drag would change this by < 1 %). Only impact transfers volume. **(tested)**
30. **Frame-rate independence**: the manager advances simulated time by min(Δt, 0.25 s) per
    frame in sub-steps ≤ 1/30 s; when the tab is hidden the loop pauses and resumes without a
    jump. On very slow renderers simulated time runs slower than wall time rather than becoming
    unstable.

## Geometry and rendering

31. **Flask**: ISO 1773 Erlenmeyer sizes (50 mL – 5 L). Profile = fillet + straight cone to the
    shoulder at 70 % height + cylindrical neck; the true blown shape has a curved shoulder. Liquid
    height is the numerical inverse of V(h) = ∫ π r² dh of this profile. The smallest flask whose
    body holds analyte + limit with 20 % headroom is chosen automatically. **(tested)**
32. **Glass**: MeshPhysicalMaterial transmission 0.95, roughness 0.05, IOR 1.5, metalness 0.
    Low-quality mode (slow devices) uses alpha-blended glass without the transmission pass.
33. **Liquid refraction** is screen-space (offset of the background sample by the refracted
    direction), not ray-traced; reflections use a procedural environment matching the lighting
    preset rather than a captured environment map.
34. **Camera lighting mode** uses the device video as background and as an equirectangular
    environment approximation; a phone camera is not a 360° light probe. Without permission or a
    camera the mode falls back to laboratory lighting with a notification. **(tested fallback)**
35. **Screenshot** composes the WebGL frame with a natively drawn data overlay and the Plotly
    curve image; the HTML panels themselves are not rasterised (no html2canvas dependency).

## Data

36. **Constants come from authoritative secondary compilations** (CRC Handbook; Sabnis) and are
    marked `sourceLevel: "secondary"`; no value is invented. Where the compilation notes a range
    (e.g. bromocresol green pKa 4.66–4.9) the entry states the chosen value.
37. **Molecular weights** are PubChem computed values (derived data, IUPAC atomic weights).
38. **Field naming**: the specification's `Spectrum.absorbance` is stored as
    `molarAbsorptivity` (L mol⁻¹ cm⁻¹) for dimensional clarity — the quantity Beer–Lambert needs.

## Software

39. **React 18.3 / Vite 5 / Vitest 2** are used instead of React 18.2 / Vite 4 / Vitest 1: the
    same APIs, with Node 22 compatibility and current security fixes. Plotly is loaded from the
    `plotly.js-basic-dist-min` build (Plotly.js 2.x) to keep the bundle at ~1.1 MB.
40. **No Web Worker**: measured chemistry cost (≈ 0.5–1.3 ms per drop) does not threaten the
    frame budget; see ARCHITECTURE.md.
41. **Diagnostic hook** `window.__TITRVIS__` exposes read-only state, frame statistics and the
    simulation classes for browser tests. It cannot alter chemistry.
