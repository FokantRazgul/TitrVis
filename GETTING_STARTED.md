# TitrVis — Getting Started

Choose your preferred setup method below.

## Option 1: Automated Setup (Recommended for macOS/Linux)

```bash
chmod +x setup.sh
./setup.sh
npm run dev
```

The script checks your Node.js version and installs all dependencies automatically.

---

## Option 2: Manual Setup

### Prerequisites

- **Node.js ≥ 18.17** (recommend 22.x) — [download](https://nodejs.org/)
- **npm ≥ 9** (comes with Node.js)
- **WebGL2 browser** — Chrome, Edge, Firefox, or Safari ≥ 15

### Steps

1. **Clone the repository** (if not already done)
   ```bash
   git clone <repository-url>
   cd titrvis
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Option 3: Docker Setup (Recommended for any OS)

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (macOS, Windows, Linux)

### Development with hot reload

```bash
docker-compose up titrvis-dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. Changes to code are reflected instantly.

### Production build

```bash
docker-compose up titrvis-prod
```

Open [http://localhost:4173](http://localhost:4173).

---

## Option 4: Node Version Manager (nvm)

If you use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm):

```bash
nvm install 22    # or fnm install 22
nvm use           # uses version from .nvmrc
npm install
npm run dev
```

---

## First Launch

### Default experiment

On startup, you'll see a pre-configured acid–base titration:
- **Acid**: Hydrochloric acid (HCl)
- **Base**: Sodium hydroxide (NaOH)
- **Indicator**: Methyl red

### Controls

| Input | Action |
|-------|--------|
| **Space** (hold) | Open burette → drops fall and titrate |
| **Shift** (hold) | Swirl flask (release to watch decay) |
| **1 / 2 / 3** | Switch lighting modes |
| **R** | Reset experiment |
| **S** | Save PNG screenshot |
| **H** | Hide/show panels |
| **Mouse drag** | Orbit camera |
| **Mouse wheel** | Zoom |

### On mobile/tablet

- **Titrate** button (hold) — same as Space key
- **Stir** button (hold) — same as Shift key

---

## Common Commands

```bash
npm run dev            # Start dev server (auto-reload on code changes)
npm run build          # Compile TypeScript + build production bundle
npm run preview        # Serve the production build locally
npm test               # Run unit tests (chemistry, solver, UI)
npm run test:e2e       # Run browser tests (includes GPU simulation)
npm run typecheck      # Check TypeScript errors without building
npm run audit:code     # Scan for TODO, console.log, any, mocks
```

---

## Troubleshooting

### "WebGL2 not supported"

Your browser doesn't support WebGL2. Try:
- Chrome/Chromium (≥ 56)
- Firefox (≥ 51)
- Safari (≥ 15)
- Edge (≥ 79)

### "Module not found" or "npm ERR!"

Delete `node_modules/` and `package-lock.json`, then reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Docker container won't start

Ensure Docker Desktop is running and check port availability:

```bash
# Check if ports 5173 (dev) or 4173 (prod) are in use
lsof -i :5173
# Kill the process if needed and retry
```

### Slow performance

The app adapts quality based on frame rate. If it's too slow:
- Close other browser tabs
- Try a different lighting mode (press **1** or **2**)
- Switch to a recent Chrome/Edge for best GPU support

---

## Next Steps

Once running:

1. **Explore the UI** — adjust acid/base concentration, swap substances, change indicators
2. **Export data** — CSV (Data panel) or PNG (Indicator panel)
3. **Read the docs** — [ARCHITECTURE.md](ARCHITECTURE.md), [CHEMISTRY.md](CHEMISTRY.md)
4. **Run tests** — verify the simulator works correctly: `npm test && npm run test:e2e`

---

## Need Help?

- Check [README.md](README.md) for features and controls
- See [ASSUMPTIONS.md](ASSUMPTIONS.md) for physics/chemistry simplifications
- Review [THIRD_PARTY.md](THIRD_PARTY.md) for dependencies and data sources
