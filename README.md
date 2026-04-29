# 3D Space Demo

## Overview

A browser-based, interactive 3D space sandbox built entirely with Three.js (v0.164.0), Tailwind CSS, and vanilla JavaScript ES modules. No build tools, no bundlers, no frameworks — opens directly in any modern browser.

The demo currently has four views, switchable via the top-bar tabs:

- **☀ Solar System** — Procedurally generated sun + planets with continent textures, click-to-focus, drag-to-rotate.
- **🌌 Local Cluster** — Procedural 3D star field around the current system, WASD to fly, click stars to travel.
- **🌠 Milkyway** — Realistic 50 nearest stars to Sol, positioned and scaled from the [HYG v4.2 database](https://www.astronexus.com/projects/hyg).
- **🕳️ Black Hole** — Ray-marched Gargantua-style black hole with Schwarzschild lensing, accretion disk, photon ring, and cinematic post-processing.

## Tech Stack

- **Three.js v0.164.0** — 3D rendering, geometry, materials, post-processing
- **WebGL** — GPU-accelerated rendering
- **Tailwind CSS (CDN)** — UI styling
- **Vanilla JS (ES modules)** — No framework, no build step
- **HTML Canvas API** — Procedural texture generation

## File Structure

- `index.html` — HTML shell, top nav bar, view-specific UI panels
- `main.js` — Scene setup, camera, animation loop, view switching, input
- `starSystem.js` — Builds a procedural star system from a seed
- `cluster.js` — Procedural local cluster generation and rendering
- `milkyway.js` — HYG-database-driven realistic nearest-stars view
- `blackhole.js` — Black hole scene objects, orbit camera, particles
- `textures.js` — Procedural planet/sun textures (3D Perlin + fBm)
- `spectral.js` — Spectral types, planet palettes, layout constants
- `utils.js` — PRNG, hashing, star name generator, easing
- `hyg_v42.csv` — Astronexus HYG v4.2 star catalog (used by milkyway.js)

## Running the Project

The Milkyway view uses `fetch()` to load the CSV, so you need a local HTTP server (opening `index.html` from disk won't work for that view). Pick one:

```sh
# Option 1 — Node (no install needed if you have npx)
npx serve .

# Option 2 — Python 3
python -m http.server 8000

# Option 3 — Python 2
python -m SimpleHTTPServer 8000
```

Then open the printed URL (typically <http://localhost:8000> or <http://localhost:3000>) in a browser.

## Credits

Star data from the [HYG database v4.2](https://www.astronexus.com/projects/hyg) (CC BY-SA 2.5). Built with Three.js and Tailwind CSS.
