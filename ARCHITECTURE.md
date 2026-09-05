# Architecture

## Layers

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  UI (React + Tailwind)          src/ui, src/app                                │
│  panels, inputs, Plotly graphs, toasts, keyboard & touch controls              │
└───────────────▲───────────────────────────────┬────────────────────────────────┘
                │ selectors / actions            │ read-only state
┌───────────────┴───────────────────────────────▼────────────────────────────────┐
│  Experiment state (Zustand)     src/state/experimentStore.ts                    │
│  inputs (substances, volumes, concentrations, indicator dose, preferences)     │
│  authoritative results (current TitrationState, recorded points, analysis)     │
│  derives ChemicalVisualState (src/state/visualState.ts)                        │
└───────────────▲───────────────────────────────┬────────────────────────────────┘
                │ setup + added volume           │ ChemicalVisualState
┌───────────────┴───────────────┐   ┌───────────▼────────────────────────────────┐
│  Chemical engine (pure TS)    │   │  Simulation           src/simulation        │
│  src/chemistry                │   │  DropSystem (CPU) · SurfaceSimulation (CPU) │
│  equilibrium · titration      │   │  FluidSimulation (GPU) · MixingSimulation   │
│  equivalence · spectra        │   │  SimulationManager (coupling, stirring)     │
│  colour · validation · data   │   └───────────┬────────────────────────────────┘
└───────────────────────────────┘               │ textures, heights, drops, stir
                                    ┌───────────▼────────────────────────────────┐
                                    │  Rendering (Three.js / R3F)  src/rendering  │
                                    │  Scene · Flask · Liquid · Burette · Lights  │
                                    └────────────────────────────────────────────┘
```

Rules enforced by the code structure:

- `src/chemistry` imports nothing from Three.js, React or the simulation. It is the only place
  where equilibrium, stoichiometry, spectra and colour are computed.
- `src/simulation` consumes `ChemicalVisualState` and produces spatial/visual state; it never
  redefines bulk chemistry. Its only call into chemistry is through the store's `addTitrant`.
- `src/rendering` reads the store and the simulation; it never computes equilibrium.
- The store is the single source of truth. Derived values (pH, indicator fraction, colour,
  equivalence) are recomputed from inputs by one function (`refreshChemistry`) and are never
  edited independently. The recorded titration points are kept because the history would
  otherwise have to be re-solved.

## Data flow of one drop

1. `SimulationManager.update` sub-steps the frame (≤ 1/30 s per step, ≤ 0.25 s per frame).
2. `DropSystem` moves drops ballistically; a drop reaching the surface emits an `ImpactEvent`.
3. The manager calls `onDropImpact(volume)` → `store.addTitrant(volume)`:
   - the safety limit is checked (2 × analyte volume by default);
   - `computeTitrationState` builds the equilibrium problem for analyte + titrant + indicator at
     the new total volume and solves it (`solveEquilibrium`);
   - `deriveVisualState` computes the bulk colour and the 8-entry local-excess colour LUT (each
     entry is a genuine solve of the flask with extra titrant);
   - the new point `{addedVolume, pH}` is appended and `chemistryVersion` increments.
4. Only if the chemistry accepted the drop does the manager inject a velocity impulse (fluid),
   a vortex ring carrying the drop fluid (volumetric mixing) and a crater (surface). No injection
   happens on a refused drop, so the GPU field never runs ahead of chemical truth.
5. The renderer, later in the same frame, reads `visualState` (bulk absorbance, LUT) and the
   simulation textures/heights. All of this is synchronous on one thread: no race conditions.

## Stirring

`SimulationManager.updateStir` integrates a drive ∈ [0, 1] (rise τ 0.12 s while Shift is held,
release τ 0.17 s so the flask is upright after ≈0.5 s), a phase advancing at 2.5 Hz, tilt = 12°·drive,
orbit offset 6 mm·drive, and a bulk swirl that relaxes towards ω_target while driven and decays as
`exp(−ln2/1.5 · dt)` afterwards. The same drive feeds the GPU forcing (`uStirDrive`, `uStirOmega`,
slosh acceleration), the mixing relaxation rate and the surface equilibrium (paraboloid + slope).

## GPU architecture

Both GPU simulations run on the same `THREE.WebGLRenderer` as the scene so that their textures can
be sampled directly by the liquid shader (no readback in the render path).

- `GpuPass` — a full-screen triangle with a `RawShaderMaterial` (GLSL ES 3.00). Renderer state
  is saved/restored around every batch (`withSimulationState`).
- Render targets are RGBA32F (or RGBA16F when float colour buffers are unavailable), linear
  filtered, clamped, in ping-pong pairs.
- `FluidSimulation.step(dt)`: advect (semi-Lagrangian + `exp(−k·dt)` damping) → implicit Jacobi
  diffusion → forces (stirring relaxation, slosh, radial splats) → divergence → 30 Jacobi
  pressure iterations (warm-started) → gradient subtraction. The liquid disc (radius 0.49 in UV)
  is the domain; outside is wall (velocity 0, Neumann pressure).
- `MixingSimulation.step(dt, velocity)`: the scalar is volumetric — 12 horizontal slices of the
  liquid tiled 4 × 3 into one atlas (`shaders/mixing/volume.glsl` holds the slice ↔ atlas mapping,
  trilinear sampling and the Hill-vortex field, shared with the liquid shader). Sphere injection
  at drop impacts → 3-D semi-Lagrangian advection (midpoint back-trace; velocity = depth-uniform
  2-D solver flow + analytic drop vortex rings with floor images + settling; relaxation towards 0
  at 1/10 s⁻¹ at rest, 1/1.2 s⁻¹ while stirring; entrainment dilution inside rings), sub-stepped
  up to 3× while rings are fast → implicit 6-neighbour diffusion. Ring kinematics live on the CPU
  in `vortexRing.ts` (pure, unit-tested) and are uploaded as uniforms each sub-step.
- Resolution adapts between 128 / 256 / 384 / 512 from the smoothed frame time (the mixing tile
  is half the fluid resolution); resizing resamples the fields with a copy pass. `readRenderTargetPixels` is used only by tests and
  diagnostics (`stats()`).
- Shader compile/link failures are routed through `renderer.debug.onShaderError` to the
  manager, which surfaces an error notification; nothing is silently replaced.

## Rendering pipeline (per frame)

1. `useFrame(-2)`: simulation update (above).
2. `useFrame(-1)`: background pass — the scene without liquid and glass (layers 1 and 2) is
   rendered into a half-resolution HDR target used by the liquid shader for refraction.
3. Default R3F render: table, paper, backdrop, stand, burette, drops, flask
   (`MeshPhysicalMaterial` transmission 0.95 / roughness 0.05 / IOR 1.5; Three's transmission
   pass renders the liquid behind the glass), liquid side wall and 64×64 surface mesh
   (custom `ShaderMaterial`: Fresnel, environment reflection, Blinn–Phong highlights,
   screen-space refraction of the background target, and a ray march of the refracted ray through
   the volumetric mixing field — 12 steps (6 in low quality) up to the floor, free surface or wall,
   each accumulating the Beer–Lambert absorbance of the LUT colour for the local fresh-titrant
   fraction (log-spaced LUT, `mixingLutPosition`) over the step length; tone mapping and
   colour-space conversion via Three's chunks).
4. Automatic quality: sustained frame times > 90 ms switch to the low rig (no transmission,
   1024² shadows, DPR 1, quarter-resolution background) and back when < 20 ms.

## Chemistry–simulation contract

`ChemicalVisualState` (src/chemistry/types.ts) carries `bulkPH`, `indicatorFraction`,
`liquidColour`, `liquidAbsorbanceRGB`, `addedTitrantVolume`, `totalVolumeML`,
`localColourLUT` and the full `analyticalState` (species, diagnostics). The renderer only reads it.

## Worker decision

The specification asks to move chemistry to a Web Worker only if it threatens frame
responsiveness. Measured with Vitest on the development machine (`src/chemistry/benchmark.test.ts`):

| operation | cost |
| --- | --- |
| per-drop state + 8-entry colour LUT, triprotic acid + indicator, ideal model | ≈ 0.5 ms |
| same with Davies activity iteration | ≈ 1.3 ms |
| equivalence analysis + indicator transition + 600-point reference curve | ≈ 4 ms (debounced 150 ms) |

A drop arrives at most 20 times per second, so chemistry consumes < 3 % of a 16.7 ms frame even
with the activity model; the analysis is debounced and runs once per configuration change.
Chemistry therefore stays on the main thread — which also keeps the drop → chemistry → GPU
injection ordering strictly synchronous. There is no second chemical engine anywhere.

## Persistence and preferences

UI preferences (theme, panel widths, lighting, mute) live in the store; they are not persisted to
storage, which keeps every session reproducible.

## Testing layout

- `src/**/*.test.ts(x)` — Vitest (jsdom): chemistry, databases, store, CPU simulation, UI.
- `e2e/*.spec.ts` — Playwright: acceptance scenario, mobile hold controls, GPU simulation tests
  executed against the live renderer through the read-only `window.__TITRVIS__` diagnostic hook.
