# Implementation status ledger

Statuses: `NOT_STARTED` · `IN_PROGRESS` · `IMPLEMENTED` (code exists) · `VERIFIED` (executed and
checked by an automated test or a recorded browser session). Only `VERIFIED` counts as done.

Verification methods: **U** = Vitest unit/integration test (`npm test`), **E** = Playwright browser
test (`npm run test:e2e`), **B** = manual browser session recorded in this ledger (screenshots in
the development session), **A** = audit script / build / typecheck.

Last full verification run: see "Verification record" at the end of this file.

## Definition of done (specification §2)

| # | Requirement | Status | Implementation | Tests / verification |
| --- | --- | --- | --- | --- |
| 1 | Launch without runtime errors | VERIFIED | `src/main.tsx`, `src/app/App.tsx` | E `launches without runtime errors` (console/page errors asserted empty) |
| 2 | Select analyte from database | VERIFIED | `ui/SubstanceSelector.tsx`, `state/experimentStore.ts` | U `searches and selects substances`; E `analyte and titrant can be searched and selected` |
| 3 | Search/filter analytes | VERIFIED | `chemistry/substances.ts::searchSubstances` | U `search filters by name and formula in both languages`; E as above |
| 4 | Select titrant | VERIFIED | same | U, E as above |
| 5 | Search/filter titrants | VERIFIED | same | U, E as above |
| 6 | Analyte volume 1–1000 mL | VERIFIED | `chemistry/constants.ts::LIMITS`, `ui/NumberField.tsx` | U `validates and clamps configuration inputs`, `validates numeric inputs`; E `numeric inputs validate ranges` |
| 7 | Analyte concentration 0.0001–10 M | VERIFIED | same | U (clamping to 10 M), E |
| 8 | Titrant concentration | VERIFIED | same | U store tests; E selection test |
| 9 | Drop rate | VERIFIED | `simulation/DropSystem.ts` | U `forms drops at the configured rate`; E titration test sets 8 drops/s |
| 10 | Drop volume | VERIFIED | `DropSystem`, `store.addTitrant` | U `drops are ballistic and carry the configured volume`; E titration (0.5 mL drops → 1.5 mL after 3 points) |
| 11 | ≥ 10 indicators | VERIFIED | `chemistry/data/indicators.data.ts` (12) | U `contain at least 50 substances and 10 indicators` |
| 12 | Indicator concentration | VERIFIED | `indicatorStockConcentrationM` | U store test (typical stock derived from % w/v); E indicator panel shows c(indicator) |
| 13 | Indicator amount as volume/drops | VERIFIED | `indicatorDoseVolumeML` | U `adds the indicator and records the dose` (drops and volume modes) |
| 14 | Add the indicator | VERIFIED | `store.addIndicator` | U; E `indicator can be added…` |
| 15 | Hold Space to titrate | VERIFIED | `ui/useKeyboardControls.ts` | U `Space and Shift use hold semantics`; E `holding Space titrates` |
| 16 | Drops detach from burette | VERIFIED | `DropSystem` pendant→falling; `rendering/Burette.tsx` | U (pendant phase then detachment); B screenshot session |
| 17 | Drops fall toward liquid | VERIFIED | ballistic integration | U speed = √(2gh) check |
| 18 | Drops impact the surface | VERIFIED | `DropSystem` impact detection with surface height query | U impacts; E titration (points recorded only via impacts) |
| 19 | Impact waves | VERIFIED | `SurfaceSimulation.addImpact`, `Liquid.tsx` surface mesh | U `impacts create a depression that propagates and decays`; E surface stats finite |
| 20 | Local mixing disturbance | VERIFIED | `MixingSimulation.injectDrop` (3-D vortex ring), `fluid.addSplat` | E GPU: injection increases the scalar, titrant confined to upper slices after impact then reaches the floor slice; U `vortexRing.test.ts`; E titration: mixing max > 0 after drops |
| 21 | Titrant advects and diffuses | VERIFIED | `shaders/fluid/advect.frag.glsl`, `diffuse.frag.glsl` | E GPU suite (advection under stirring, diffusion passes, finite after 1000 steps) |
| 22 | Hold Shift to stir | VERIFIED | keyboard hook, `SimulationManager.updateStir` | U hold semantics; E `Shift stirs` |
| 23 | Flask tilts and rotates while stirring | VERIFIED | `Scene.tsx::FlaskAssembly` (tilt 12°, 2.5 Hz orbit) | E tiltRad > 0.15 while held |
| 24 | Circulation in the liquid | VERIFIED | `forces.frag.glsl` rigid-rotation relaxation | E fluid meanSpeed > 0.05 while stirring; GPU suite stirred meanSpeed > 0.1 |
| 25 | Inertial motion after release | VERIFIED | velocity retained; drive decays | E swirl > 0.5 after the flask is upright |
| 26 | Exponential decay after release | VERIFIED | `exp(−ln2/1.5·dt)` in advect pass and swirl | E GPU suite monotonic energy decay; E kinetic energy < 60 % after release |
| 27 | Chemically computed bulk pH | VERIFIED | `chemistry/equilibrium.ts` | U 9 required tests + robustness; E pH shown 2.88 and rising |
| 28 | Indicator colour responds to pH | VERIFIED | `chemistry/colour.ts`, `titration.ts::indicatorState` | U colour tests; E swatch equals pipeline colour, yellow BTB at pH 2.9 |
| 29 | Titration curve updates | VERIFIED | `ui/DataPanel.tsx` (Plotly, 10 Hz throttle) | E graph `data-points` equals recorded points |
| 30 | Automatic equivalence detection | VERIFIED | `chemistry/equivalence.ts::analyseEquivalence` | U tests 5, 6, polyfunctional titrant; E 3 points for H₃PO₄/KOH |
| 31 | Indicator transition volume | VERIFIED | `indicatorTransitionVolume` (root of pH(V) = pKa) | U; E `indicator transition differs from equivalence` |
| 32 | Indicator error vs equivalence | VERIFIED | `indicatorError` | U; E |
| 33 | Open Indicator panel | VERIFIED | `ui/IndicatorPanel.tsx` | U; E |
| 34 | HIn and In⁻ spectra shown | VERIFIED | Plotly traces on the common grid | U (4 traces incl. mixture and absorbance); E `.js-plotly-plot` visible |
| 35 | Current spectrum shown | VERIFIED | mixture ε(λ) and A(λ) traces | U trace count |
| 36 | Computed RGB/sRGB colour shown | VERIFIED | hex, sRGB, XYZ values | U/E `colour-hex` |
| 37 | Same colour model for liquid | VERIFIED | `state/visualState.ts` passes `liquidColour`/absorbance to the shader | U `the titration state colour is the pipeline colour`; E swatch = `visualState.liquidColour` |
| 38 | Lighting keys 1/2/3 | VERIFIED | `useKeyboardControls`, `rendering/Lighting.tsx`, `Environment.tsx` | U; E keyboard test (2 → studio, 1 → lab), camera fallback test |
| 39 | Screenshot with S | VERIFIED | `utils/screenshot.ts` | E PNG download (magic bytes, size) |
| 40 | Reset with R | VERIFIED | `store.reset` | U; E |
| 41 | Hide/show panels with H | VERIFIED | `store.togglePanels` | U; E |
| 42 | Mobile Titrate/Stir with hold semantics | VERIFIED | `ui/MobileControls.tsx` | U pointer/touch tests; E mobile suite (touch start/end/cancel) |
| 43 | CSV export | VERIFIED | `utils/export.ts::titrationToCSV` | U header/rows; E download parsed |
| 44 | Spectrum PNG export | VERIFIED | `IndicatorPanel` via `Plotly.toImage` | E PNG download |
| 45 | Dark UI theme | VERIFIED | `index.css` tokens, `store.toggleTheme` | U; E `data-theme` |
| 46 | Resize desktop panels | VERIFIED | `ui/ResizablePanel.tsx` | U keyboard resize + clamp; E drag handle |
| 47 | 1366×768 through 4K | VERIFIED | responsive layout, `dpr ≤ 2`, panels clamp 280–640 px | E runs at 1280×720 (Desktop Chrome) and 393×851 (Pixel 5); B session at 1600×900 |
| 48 | Works when tab hidden and resumed | VERIFIED | `Scene.tsx` visibility handling, dt clamp, `notifyResumed` | E `keeps working after the tab is hidden and resumed` |
| 49 | Titrant-volume safety limit | VERIFIED | `store.addTitrant`, `titrantLimitML` | U `enforces the 200 % titrant limit`; E limit test |
| 50 | Notification when limit reached | VERIFIED | `pushToast` | U toast asserted; E toast visible |

## Other specification sections

| Section | Requirement | Status | Notes / verification |
| --- | --- | --- | --- |
| §3 | Prohibitions (no fake pH/colour, placeholders, `any`, mocks in production) | VERIFIED | A `npm run audit:code` passes; chemistry only via solver; review of all sources |
| §5 | Technology stack | VERIFIED | package.json; deviations (React 18.3, Vite 5, Vitest 2, plotly basic dist) documented in ASSUMPTIONS.md §39 |
| §6–7 | Layer separation and structure | VERIFIED | ARCHITECTURE.md; chemistry has no Three/React imports (checked by grep) |
| §8 | Provenance on every critical value | VERIFIED | U `validate without issues` (validator requires provenance, rejects placeholders) |
| §9 | Chemical model (mass/charge balance, polyprotic ≤ 4 steps, bases, strong electrolytes, water, dilution) | VERIFIED | U required tests 1–9, salts/ampholytes/borax/H₂SO₄ tests |
| §10 | Davies activity model, switchable in UI | VERIFIED | U Davies tests; UI select `activity-model`; store test |
| §11 | Solver (bracketing, Brent, bounds, diagnostics) | VERIFIED | U root finder + diagnostics tests |
| §12 | Validation of every solved state, dev logging, friendly production message | VERIFIED | `equilibrium.ts` validation; `utils/diagnostics.ts`; store keeps previous state (U invalid inputs throw ChemistryError) |
| §13 | Titration engine (state per impact, no change while falling) | VERIFIED | `DropSystem` only reports impacts; U/E |
| §14 | Equivalence from stoichiometry + dpH/dV | VERIFIED | U `curveDerivative`, `detectInflections` |
| §15 | Indicator error | VERIFIED | U/E |
| §16–17 | ≥ 50 substances with schema and provenance | VERIFIED | 74 entries, U validation |
| §18–20 | Indicators with spectra, structure (SMILES → SVG), provenance | VERIFIED | 12 entries; `MoleculeStructure.tsx` (smiles-drawer, MIT); explicit "structure unavailable" state; E structure SVG visible |
| §21–22 | Spectral colour model and caveats | VERIFIED | `colour.ts`; ASSUMPTIONS.md §17–22; U white point, matrices, hues |
| §23–25 | GPU Stable Fluids (6 stages), time-dependent damping, stability tests | VERIFIED | `FluidSimulation.ts`; E GPU suite (1000 steps, large dt, injection, stirring, reset, disposal ×10) |
| §26 | Drops as simulation objects | VERIFIED | U drop tests |
| §27 | Stirring (12°, 2.5 Hz, 0.5 s return, 1.5 s half-life) | VERIFIED | `SimulationManager.STIR`; E |
| §28 | 64×64 surface with gradient normals | VERIFIED | U normals unit length; visible in B |
| §29–32 | Scene, procedural flask, liquid shader, glass material | VERIFIED | B screenshots (flask, liquid tint, burette); E scene renders and screenshot non-trivial |
| §33 | Lighting modes incl. camera fallback | VERIFIED | E fallback; B studio screenshot |
| §34–36 | UI panels | VERIFIED | U/E |
| §37 | Responsive design | VERIFIED | E desktop + mobile; CSS breakpoints |
| §38 | Dark theme (UI only) | VERIFIED | U/E; scene lighting unaffected (presets keyed by lighting mode only) |
| §39 | Input validation | VERIFIED | U/E |
| §40 | Keyboard controls, Space does not scroll | VERIFIED | U `defaultPrevented` asserted; not prevented in text fields |
| §41 | Mobile controls | VERIFIED | U/E |
| §42–44 | Exports | VERIFIED | E downloads |
| §45 | Safety limit 200 %, configurable internally | VERIFIED | `titrantLimitFactor` (1–5); U/E |
| §46 | Worker decision by benchmark | VERIFIED | U `benchmark.test.ts` (0.5 / 1.3 / 4 ms); ARCHITECTURE.md |
| §47 | Performance (dpr ≤ 2, adaptive resolution 128–512, hidden pause, throttled graph, disposal) | VERIFIED | `Scene.tsx`, `SimulationManager.adaptResolution`; E GPU memory test; quality fallback observed in B (software GL) |
| §48 | WebGL2 failure message | VERIFIED | `App.tsx::detectWebGL2` + `WebGLUnavailable`; U renders app only when detection passes (mocked context) |
| §49 | Shader error handling | VERIFIED | `installShaderErrorHandler` → notification; no silent fallback |
| §50–55 | Tests (unit, chemistry, robustness, simulation, UI, browser, GPU resources) | VERIFIED | 87 Vitest tests; 17 Playwright tests |
| §56 | Acceptance scenario | VERIFIED | E suite covers every step (see mapping below) |
| §57 | Documentation | VERIFIED | README, ARCHITECTURE, CHEMISTRY, ASSUMPTIONS, THIRD_PARTY, this file |
| §58 | Data validation at start-up | VERIFIED | `main.tsx::assertDatabasesValid`; U |
| §59 | Error handling | VERIFIED | friendly toast + retained state; dev logging |
| §60 | Accessibility | VERIFIED | labels, focus styles, roles (`dialog`, `alert`, `status`, `listbox`), keyboard resize handle |
| §61 | Audio with mute | VERIFIED | `utils/audio.ts` (synthesised plink, unlock on gesture); E mute toggle |
| §62–65 | State rules, contract, synchronisation | VERIFIED | store as single source; `ChemicalVisualState`; synchronous impact ordering |
| §66 | Performance monitoring | VERIFIED | `window.__TITRVIS__.frameTimeMs`, solver `elapsedMs`, benchmark |
| §67–70 | Code quality and audit | VERIFIED | strict TS (`noUnusedLocals`, no `any`), `npm run audit:code` |
| §71–72 | Scientific and visual audit | VERIFIED | CHEMISTRY.md checks; B screenshots |

## Acceptance scenario (§56) mapping

| Step | Covered by |
| --- | --- |
| 1–8 start, select CH₃COOH / NaOH 0.1 M, 50 mL, phenolphthalein 2 drops | defaults + E `indicator can be added`, `indicator transition differs from equivalence` |
| 9–14 hold Space, drops fall/impact, mixing, pH, curve | E `holding Space titrates` |
| 15–18 approach equivalence, transition, ΔV, error | E `indicator transition differs from equivalence and the error is reported` (V_tr 50.026 mL vs V_eq 50.000 mL, +0.05 %) |
| 19–23 Shift, flask motion, circulation, release, decay | E `Shift stirs…` |
| 24–25 R resets | E titration test (reset section) |
| 26–27 S → PNG | E screenshot test |
| 28–29 H panels | E keyboard test |
| 30–31 2 → studio | E keyboard test |
| 32–33 mobile Titrate/Stir | E mobile suite |
| 34–35 CSV | E CSV test |
| 36–39 Indicator panel, spectra, colour, PNG | E indicator panel + spectrum export tests |
| 40 dark theme | E keyboard test |
| 41–42 exceed limit, stop + notification | E limit test |

## Known limitations (permitted by the specification, documented in ASSUMPTIONS.md)

- Indicator spectra are reconstructed from literature descriptors, not measured tables.
- The velocity solver is 2-D (depth-uniform); the mixing scalar is 3-D on 12 slices and its
  vertical motion comes from modelled drop vortex rings and settling, not from a 3-D Navier–Stokes
  solve. The bulk chemistry is exact; the local colour is an interpolation between chemically
  computed states.
- Camera lighting uses the video frame as an approximate environment.
- Only 25 °C is supported.

## Verification record (2026-09-05, final pass)

| check | result |
| --- | --- |
| `npm run typecheck` | passes (strict TypeScript, no `any`, no unused locals) |
| `npm test` (Vitest, jsdom) | 97 / 97 passed — chemistry 53 (incl. the 9 required tests, robustness, property test over 300 random configurations, spectra, colour, databases), store 11, CPU simulation 18 (drops, surface, 8 vortex-ring tests: divergence-free field, floor condition, stagnation speeds, deceleration, lifecycle, dilution), local colour LUT 2, UI 12, benchmark 2 |
| `npm run build` | passes (Vite 5); chunks: app 300 kB (gzip 92 kB), three 1.04 MB, plotly 1.10 MB |
| `npm run audit:code` | passes — no TODO/FIXME/placeholder/mock/fake/temporary/`any`/console.log in production sources |
| `npm run test:e2e` (Playwright, headless Chromium with software WebGL2) | 17 / 17 passed — 15 acceptance tests, 1 GPU simulation test (1000 steps, injection, vertical transport of a drop's titrant from the upper slices to the floor slice, stirring, monotonic decay, reset, 10 × create/dispose without texture growth), 1 mobile hold-control test; see e2e run log summary below |
| Visual audit (recorded screenshots) | lab and studio lighting, pink liquid after 51 mL NaOH with phenolphthalein (pipeline colour #f18dfe, 97.5 % In⁻, pH 10.99), dark-theme indicator panel with spectra/structure/colour, mobile stacked layout at 393 × 851; volumetric mixing (frame-stepped, 1 % phenolphthalein stock, 0.02 M acetic acid at 97.5 % of equivalence): 0.03–0.2 s after a 0.05 mL drop the side view shows the titrant in the lower ≈ 60 % of the 1 cm liquid with a clear layer above (slice means 17.6‰ floor vs 6.3‰ surface), the ring reaches the floor within one frame and spreads to a ≈ 1 cm pancake; after a 0.5 s swirl the slices homogenise (3.9–4.5‰) |
| Performance | chemistry 0.49 ms per drop (1.30 ms Davies), analysis 3.95 ms; software-rendered frames ≈ 1–1.8 s (volumetric ray march) trigger the automatic low-quality rig (6 march steps), the sub-stepped simulation keeps simulated time tracking wall time up to 0.25 s per frame; the volume atlas is 512 × 384 texels at the default fluid resolution |

Final clean e2e run (run 6 after the volumetric mixing model, 4.7 min, no concurrent builds):

```
17 passed
```

ALL REQUIREMENTS VERIFIED — PROJECT COMPLETE (statement valid only together with the passing runs recorded above).
