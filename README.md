# TitrVis — interactive 3D acid–base titration simulator

TitrVis is a browser application in which a real chemical equilibrium engine, a GPU fluid
simulation and a physically based renderer form one system:

```
configuration → chemical state → drop impact → equilibrium solve → pH → indicator equilibrium
             → absorption spectrum → CIE colour → liquid colour → titration curve → equivalence
```

Drops detach from the burette, fall, hit the liquid, create waves and a local titrant plume that
advects and diffuses through a WebGL2 Stable-Fluids field; holding Shift swirls the flask and the
liquid keeps circulating after release with an exponential decay. Every pH value is solved from
mass and charge balance; every colour is integrated from spectra with the CIE 1931 observer.

## Use it

### 1. In the browser — nothing to install

**<https://fokantrazgul.github.io/TitrVis/>**

Every push to the default branch rebuilds the site and publishes it to GitHub Pages
(`.github/workflows/deploy-pages.yml`). Repository owner, once: *Settings → Pages → Source:
"GitHub Actions"*; afterwards every push deploys. All you need is a laptop with a WebGL2 browser
(Chrome, Edge, Firefox, Safari ≥ 15). Without WebGL2 the app shows an explicit message instead
of the simulator.

### 2. On your own machine — one command

Requires [Node.js](https://nodejs.org/) ≥ 18.17 (the repo pins 22 in `.nvmrc`). Then:

```bash
npm install && npm start
```

`npm start` runs the Vite dev server and opens <http://localhost:5173> in your default browser.

<details>
<summary>Alternative: Docker, no Node.js on the host</summary>

```bash
docker build -t titrvis . && docker run --rm -p 4173:4173 titrvis
```

Then open <http://localhost:4173>.
</details>

## Development

```bash
npm run dev          # Vite dev server at http://localhost:5173 (no auto-open)
npm run typecheck    # strict TypeScript
```

## Production build

```bash
npm run build        # typecheck + Vite build into dist/
npm run preview      # serve dist/ at http://localhost:4173
```

## Tests

```bash
npm test             # Vitest: chemistry, solver, spectra/colour, store, CPU simulation, UI (jsdom)
npm run test:e2e     # Playwright: builds, serves dist/ and runs the browser acceptance suite,
                     # including the GPU fluid tests (software WebGL in headless Chromium)
npm run audit:code   # scans sources for placeholders, mocks, TODOs, `any`, console.log
```

The browser suite needs Playwright's Chromium once: `npx playwright install chromium`.

## Controls

| Input | Action |
| --- | --- |
| `Space` (hold) | open the burette: drops form, fall and titrate |
| `Shift` (hold) | swirl the flask; release to watch the motion decay |
| `1` / `2` / `3` | laboratory / studio / camera lighting |
| `R` | reset the experiment |
| `S` | save a PNG screenshot (scene + data overlay + curve inset) |
| `H` | hide / show the panels |
| mouse drag / wheel | orbit / zoom the camera |
| **Titrate (hold)** / **Stir (hold)** | touch controls on phones and tablets |

## Feature overview

- **Chemistry** — generic polyprotic acid/base ladders (up to 4 steps), strong electrolytes,
  salts and ampholytes, water autoionisation, dilution to the total volume, Brent root finding of
  the charge balance in pH space, optional Davies activity corrections, validated species
  (mass balance, charge balance, non-negativity, finiteness).
- **Database** — 74 substances with CRC Handbook constants and PubChem masses; 12 indicators with
  PubChem structures, literature pKa/λmax and reconstructed spectra on a 5 nm grid.
- **Titration** — one equilibrium solve per drop impact, recorded curve, stoichiometric
  equivalence points evaluated by the solver (with a detectability criterion), numerical dpH/dV
  features, indicator transition volume (pH = pKa) and indicator error ΔV / %.
- **Colour** — Beer–Lambert absorbance of the HIn/In⁻ mixture, D65 illumination, CIE 1931 2°
  XYZ, IEC sRGB. The swatch in the Indicator panel and the liquid share the same pipeline output.
- **Simulation** — GPU velocity/pressure solver (advection, diffusion, forces, divergence,
  pressure, projection), GPU mixing scalar, 64×64 CPU wave surface with normals, ballistic drops
  with pendant/fall/impact states, stirring with 12° tilt, 2.5 Hz orbit and 1.5 s half-life decay.
- **Rendering** — procedural Erlenmeyer flask (ISO 1773 sizes) with transmissive glass, custom
  liquid shader (Fresnel, refraction, spectral tint, local mixing), burette with drops, table,
  paper, three lighting rigs (camera mode uses the device camera when granted).
- **UI** — glassmorphism panels, searchable substance cards, validated inputs, Plotly titration
  curve throttled to 10 Hz, Indicator panel with spectra/structure/colour and PNG export, CSV
  export, dark UI theme, resizable and collapsible panels, mobile hold controls, toasts,
  2 × analyte-volume titrant safety limit, drop-impact audio with mute.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, data flow, GPU pipeline, worker decision
- [CHEMISTRY.md](CHEMISTRY.md) — equations, numerical method, tolerances, colour model
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — every simplification and its justification
- [THIRD_PARTY.md](THIRD_PARTY.md) — libraries, licences, datasets, provenance
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) — requirement ledger with verification

## Licence

MIT (see `package.json`). Third-party licences are listed in THIRD_PARTY.md.
