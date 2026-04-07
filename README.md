# 3D Space Demo

## Overview

Endless Horizons is a browser-based, interactive 3D space and civilization builder demo inspired by Endless Space. Built entirely with Three.js (v0.164.0), Tailwind CSS, and vanilla JavaScript ES modules, it runs directly in any modern browser—no build tools, no bundlers, no frameworks required.

The project features:
- A fully interactive 3D solar system with a sun and multiple planets
- Procedurally generated planet textures and atmospheric effects
- Black hole scene with ray-marched lensing and starfield
- Click-to-focus, drag-to-rotate, and smooth camera controls
- Cinematic post-processing (bloom, custom shaders)
- Modular codebase for easy experimentation

## Tech Stack

- **Three.js v0.164.0** — 3D rendering, geometry, materials, post-processing
- **WebGL** — GPU-accelerated rendering
- **Tailwind CSS (CDN)** — UI styling
- **Vanilla JS (ES modules)** — No framework, no build step
- **HTML Canvas API** — Procedural texture generation

## File Structure

- `index.html` — HTML shell, UI overlays, Tailwind CSS via CDN
- `main.js` — Main Three.js scene logic and game state
- `blackhole.js` — Black hole scene, camera, starfield, particles
- `starSystem.js` — Solar system/planet logic
- `textures.js` — Procedural texture generation
- `utils.js` — Utility functions
- `spectral.js` — Color and spectral calculations
- `planned.txt`, `next-steps.txt` — Planning notes
- `project-writeup.txt`, `project-status.txt` — Documentation

## Running the Project

Just open `index.html` in your browser, or serve the folder with a static server:

```sh
npx serve .
# or
python -m http.server
```

## Credits

Created by Brice. Built with Three.js, Tailwind CSS, and a love for space games.
