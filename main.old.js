import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";

// ── Scene, Camera, Renderer ────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010108);

// Subtle fog for depth
scene.fog = new THREE.FogExp2(0x010108, 0.008);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);

// ── Soft Lighting ───────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x90a0c0, 0.7));

const keyLight = new THREE.PointLight(0xdde4ff, 1.4, 100);
keyLight.position.set(8, 5, 10);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0xffeedd, 0.8, 60);
fillLight.position.set(-6, -3, 5);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0x8899cc, 0.7, 70);
rimLight.position.set(0, 4, -8);
scene.add(rimLight);

// ── Constants ───────────────────────────────────────────────────────
const PLANET_SPACING = 4;
const DEG = Math.PI / 180;

// Base yields per planet style (per day, before buildings)
const STYLE_YIELDS = {
  oceanic:      { energy: 2, minerals: 1, food: 4, research: 1, alloys: 0 },
  scattered:    { energy: 3, minerals: 4, food: 1, research: 1, alloys: 1 },
  continental:  { energy: 2, minerals: 2, food: 3, research: 2, alloys: 0 },
};

const PLANET_STYLES = ["oceanic", "scattered", "continental"];

// ── Seeded PRNG ─────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Simple hash for combining seed + coordinates
function hashCoords(seed, x, y, z) {
  let h = seed | 0;
  h = Math.imul(h ^ (x * 374761393), 1103515245) + 12345 | 0;
  h = Math.imul(h ^ (y * 668265263), 1103515245) + 12345 | 0;
  h = Math.imul(h ^ (z * 550564233), 1103515245) + 12345 | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ══════════════════════════════════════════════════════════════════════
// ██  PROCEDURAL STAR NAME GENERATOR
// ══════════════════════════════════════════════════════════════════════
const NAME_ONSETS = ["K","T","V","S","N","M","R","Z","L","D","B","G","F","P","Th","Sh","Kr","Tr","Sk","Fl"];
const NAME_VOWELS = ["a","e","i","o","u","ai","ei","au"];
const NAME_CODAS  = ["n","r","l","s","x","th","k","","","",""];
function generateStarName(seed) {
  const rng = mulberry32(seed ^ 0xBEEF);
  const syllables = 2 + Math.floor(rng() * 2); // 2-3
  let name = "";
  for (let s = 0; s < syllables; s++) {
    name += NAME_ONSETS[Math.floor(rng() * NAME_ONSETS.length)];
    name += NAME_VOWELS[Math.floor(rng() * NAME_VOWELS.length)];
    if (s < syllables - 1 || rng() < 0.5) {
      name += NAME_CODAS[Math.floor(rng() * NAME_CODAS.length)];
    }
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ══════════════════════════════════════════════════════════════════════
// ██  CONTINENT TEXTURE GENERATOR (3D Perlin noise)
// ══════════════════════════════════════════════════════════════════════
function generateContinentTexture(baseHex, continentHex, seed, style) {
  const W = 1024, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${(baseHex >> 16) & 255},${(baseHex >> 8) & 255},${baseHex & 255})`;
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(seed);

  const styles = {
    scattered:    { scale: 4.0, seaLevel: 0.02, edge: 0.06, warp: 0.9,  poleDrop: 0.25, tint: 0.4,  octaves: 5 },
    continental:  { scale: 3.0, seaLevel: 0.12, edge: 0.05, warp: 1.6,  poleDrop: 0.18, tint: 0.35, octaves: 5 },
    oceanic:      { scale: 1.5, seaLevel: 0.15, edge: 0.06, warp: 2.4,  poleDrop: 0.08, tint: 0.30, octaves: 3 },
  };
  const S = styles[style] || styles.scattered;

  const N = 256;
  const perm = new Uint8Array(N * 2);
  const g3 = [
    [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
    [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
    [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
  ];
  for (let i = 0; i < N; i++) perm[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];

  function noise3d(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const A  = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B  = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    function dot3(gi, dx, dy, dz) {
      const g = g3[perm[gi] % 12];
      return g[0] * dx + g[1] * dy + g[2] * dz;
    }
    const d000 = dot3(AA,     fx,     fy,     fz);
    const d100 = dot3(BA,     fx - 1, fy,     fz);
    const d010 = dot3(AB,     fx,     fy - 1, fz);
    const d110 = dot3(BB,     fx - 1, fy - 1, fz);
    const d001 = dot3(AA + 1, fx,     fy,     fz - 1);
    const d101 = dot3(BA + 1, fx - 1, fy,     fz - 1);
    const d011 = dot3(AB + 1, fx,     fy - 1, fz - 1);
    const d111 = dot3(BB + 1, fx - 1, fy - 1, fz - 1);
    const x00 = d000 + u * (d100 - d000);
    const x10 = d010 + u * (d110 - d010);
    const x01 = d001 + u * (d101 - d001);
    const x11 = d011 + u * (d111 - d011);
    const y0 = x00 + v * (x10 - x00);
    const y1 = x01 + v * (x11 - x01);
    return y0 + w * (y1 - y0);
  }

  const OCT = S.octaves || 5;
  function fbm3(x, y, z) {
    let val = 0, amp = 1, freq = 1, total = 0;
    for (let o = 0; o < OCT; o++) {
      val += noise3d(x * freq, y * freq, z * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2.0;
    }
    return val / total;
  }

  const field = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const lat = (py / H) * Math.PI;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    for (let px = 0; px < W; px++) {
      const lon = (px / W) * Math.PI * 2;
      const sx = sinLat * Math.cos(lon) * S.scale;
      const sy = sinLat * Math.sin(lon) * S.scale;
      const sz = cosLat * S.scale;
      const wx = sx + fbm3(sx + 3.1, sy + 7.5, sz + 1.3) * S.warp;
      const wy = sy + fbm3(sx + 11.7, sy + 4.2, sz + 8.6) * S.warp;
      const wz = sz + fbm3(sx + 6.9, sy + 0.8, sz + 5.4) * S.warp;
      field[py * W + px] = fbm3(wx, wy, wz);
    }
  }

  for (let py = 0; py < H; py++) {
    const lat01 = py / H;
    const poleFade = Math.min(lat01 * 5, (1 - lat01) * 5, 1);
    for (let px = 0; px < W; px++) {
      field[py * W + px] -= (1 - poleFade) * S.poleDrop;
    }
  }

  const bR = (baseHex >> 16) & 255;
  const bG = (baseHex >> 8) & 255;
  const bB = baseHex & 255;
  const cR = Math.round(bR + ((((continentHex >> 16) & 255) - bR) * S.tint));
  const cG = Math.round(bG + ((((continentHex >> 8) & 255) - bG) * S.tint));
  const cB = Math.round(bB + (((continentHex & 255) - bB) * S.tint));

  const imgData = ctx.getImageData(0, 0, W, H);
  const px = imgData.data;

  for (let py = 0; py < H; py++) {
    for (let pxi = 0; pxi < W; pxi++) {
      const val = field[py * W + pxi];
      if (val < S.seaLevel - S.edge) continue;
      let blend = Math.min(Math.max((val - S.seaLevel + S.edge) / S.edge, 0), 1);
      blend = blend * blend * (3 - 2 * blend);
      const i = (py * W + pxi) * 4;
      px[i]     = Math.round(bR + (cR - bR) * blend);
      px[i + 1] = Math.round(bG + (cG - bG) * blend);
      px[i + 2] = Math.round(bB + (cB - bB) * blend);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ══════════════════════════════════════════════════════════════════════
// ██  SUN TEXTURE GENERATOR
// ══════════════════════════════════════════════════════════════════════
function generateSunTexture(seed, baseR, baseG, baseB) {
  // Default to warm yellow
  baseR = baseR ?? 255;
  baseG = baseG ?? 200;
  baseB = baseB ?? 60;

  const W = 512, H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const rng = mulberry32(seed);
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const grain = (rng() - 0.5) * 20;
      d[i]     = Math.min(255, Math.max(0, Math.round(baseR + grain)));
      d[i + 1] = Math.min(255, Math.max(0, Math.round(baseG + grain)));
      d[i + 2] = Math.min(255, Math.max(0, Math.round(baseB + grain * 0.5)));
      d[i + 3] = 255;
    }
  }

  const numSpots = 3 + Math.floor(rng() * 3);
  for (let s = 0; s < numSpots; s++) {
    const cx = Math.floor(W * 0.15 + rng() * W * 0.7);
    const cy = Math.floor(H * 0.25 + rng() * H * 0.5);
    const r = 6 + rng() * 14;
    for (let dy = Math.ceil(-r); dy <= r; dy++) {
      for (let dx = Math.ceil(-r); dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;
        const py2 = Math.floor(cy + dy);
        const px2 = ((Math.floor(cx + dx) % W) + W) % W;
        if (py2 < 0 || py2 >= H) continue;
        const i = (py2 * W + px2) * 4;
        const f = 1 - dist / r;
        const dark = f * f * 0.7;
        d[i]     = Math.round(d[i] * (1 - dark));
        d[i + 1] = Math.round(d[i + 1] * (1 - dark * 0.9));
        d[i + 2] = Math.round(d[i + 2] * (1 - dark * 0.5));
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ══════════════════════════════════════════════════════════════════════
// ██  STAR SPECTRAL TYPES
// ══════════════════════════════════════════════════════════════════════
// Weighted distribution: M(red) 60%, K(orange) 15%, G(yellow) 12%, F(yellow-white) 7%, A(white) 4%, OB(blue) 2%
const SPECTRAL_TYPES = [
  { type: "M", color: 0xff6644, sunR: 255, sunG: 140, sunB: 80,  glowColor: 0xff4422, atmosColor: 0xff8844, sizeMultiplier: 0.7, lightColor: 0xffaa88, weight: 0.60 },
  { type: "K", color: 0xffaa55, sunR: 255, sunG: 180, sunB: 80,  glowColor: 0xff8833, atmosColor: 0xffbb55, sizeMultiplier: 0.85, lightColor: 0xffcc99, weight: 0.15 },
  { type: "G", color: 0xffdd77, sunR: 255, sunG: 210, sunB: 80,  glowColor: 0xff9922, atmosColor: 0xffcc44, sizeMultiplier: 1.0, lightColor: 0xffeedd, weight: 0.12 },
  { type: "F", color: 0xfff4cc, sunR: 255, sunG: 240, sunB: 180, glowColor: 0xffddaa, atmosColor: 0xffeebb, sizeMultiplier: 1.15, lightColor: 0xfff8ee, weight: 0.07 },
  { type: "A", color: 0xeeeeff, sunR: 230, sunG: 230, sunB: 255, glowColor: 0xccccff, atmosColor: 0xddddff, sizeMultiplier: 1.3, lightColor: 0xeeeeff, weight: 0.04 },
  { type: "OB", color: 0x99bbff, sunR: 180, sunG: 200, sunB: 255, glowColor: 0x6688ff, atmosColor: 0x88aaff, sizeMultiplier: 1.6, lightColor: 0xaaccff, weight: 0.02 },
];

function pickSpectralType(rng) {
  let r = rng();
  let cumulative = 0;
  for (const st of SPECTRAL_TYPES) {
    cumulative += st.weight;
    if (r <= cumulative) return st;
  }
  return SPECTRAL_TYPES[0];
}

// ══════════════════════════════════════════════════════════════════════
// ██  STAR SYSTEM BUILDER (from seed)
// ══════════════════════════════════════════════════════════════════════
// Shared geometries
const sphereGeo = new THREE.SphereGeometry(1, 64, 64);
const glowGeo = new THREE.SphereGeometry(1.18, 32, 32);
const atmosGeo = new THREE.SphereGeometry(1.06, 48, 48);

// Planet color palettes — each planet picks one based on RNG
const PLANET_PALETTES = [
  { surface: 0x1c2050, emissive: 0x101840, wire: 0x7088cc, glow: 0x4466dd, atmos: 0x5599ff },  // blue
  { surface: 0x3d1c22, emissive: 0x281010, wire: 0xbb7080, glow: 0xcc5566, atmos: 0xff7766 },  // red
  { surface: 0x1e3820, emissive: 0x102010, wire: 0x70bb80, glow: 0x55cc77, atmos: 0x66ff99 },  // green
  { surface: 0x2d2840, emissive: 0x181430, wire: 0x8877bb, glow: 0x7755cc, atmos: 0x9988ff },  // purple
  { surface: 0x3a3020, emissive: 0x201810, wire: 0xbb9955, glow: 0xcc8844, atmos: 0xffbb66 },  // amber
  { surface: 0x1a3038, emissive: 0x0e1820, wire: 0x55aabb, glow: 0x4499aa, atmos: 0x66ccdd },  // teal
];

// The current star system's data
let systemGroup = null;     // THREE.Group containing all system meshes
let systemSunLight = null;  // PointLight for the sun
let planets = [];           // Array of planet render objects (same structure as before)

function buildStarSystem(seed) {
  const rng = mulberry32(seed);
  const spectral = pickSpectralType(rng);

  // Determine planet count (2-5)
  const planetCount = 2 + Math.floor(rng() * 4);

  // Build planet configs from seed
  const configs = [];
  const usedPalettes = [];
  for (let i = 0; i < planetCount; i++) {
    // Pick a palette, avoid consecutive duplicates
    let paletteIdx;
    do {
      paletteIdx = Math.floor(rng() * PLANET_PALETTES.length);
    } while (usedPalettes.length > 0 && paletteIdx === usedPalettes[usedPalettes.length - 1]);
    usedPalettes.push(paletteIdx);
    const pal = PLANET_PALETTES[paletteIdx];

    const style = PLANET_STYLES[Math.floor(rng() * PLANET_STYLES.length)];
    const tiltX = (15 + rng() * 30) * DEG;
    const tiltZ = (rng() * 10 - 5) * DEG;
    const xPos = (i - (planetCount - 1) / 2) * PLANET_SPACING;

    configs.push({
      name: generateStarName(seed * 1000 + i + 1),
      x: xPos,
      surface: pal.surface,
      emissive: pal.emissive,
      emissiveIntensity: 0.6 + rng() * 0.3,
      roughness: 1.0,
      metalness: 0.0,
      wire: pal.wire,
      glow: pal.glow,
      atmos: pal.atmos,
      wireBase: 0.15,
      glowBase: 0.08,
      tiltX,
      tiltZ,
      style,
    });
  }

  // Create the system group
  const group = new THREE.Group();
  const newPlanets = [];

  // Build planet meshes
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    const pGroup = new THREE.Group();
    pGroup.position.set(cfg.x, 0, 0);

    const continentTex = generateContinentTexture(cfg.surface, cfg.wire, seed * 10000 + i * 77777 + 31, cfg.style);
    const surfaceMat = new THREE.MeshStandardMaterial({
      map: continentTex,
      emissive: cfg.emissive,
      emissiveIntensity: cfg.emissiveIntensity,
      roughness: cfg.roughness,
      metalness: cfg.metalness,
      transparent: true,
      opacity: 1,
    });
    const surface = new THREE.Mesh(sphereGeo, surfaceMat);
    pGroup.add(surface);

    const atmosMat = new THREE.MeshBasicMaterial({
      color: cfg.atmos, transparent: true, opacity: 0.018,
      side: THREE.FrontSide, depthWrite: false,
    });
    pGroup.add(new THREE.Mesh(atmosGeo, atmosMat));

    const glowMat = new THREE.MeshBasicMaterial({
      color: cfg.glow, transparent: true, opacity: cfg.glowBase,
      side: THREE.BackSide, depthWrite: false,
    });
    pGroup.add(new THREE.Mesh(glowGeo, glowMat));

    group.add(pGroup);

    const homeQuat = new THREE.Quaternion();
    const tiltQuatX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), cfg.tiltX);
    const tiltQuatZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), cfg.tiltZ);
    homeQuat.multiply(tiltQuatZ).multiply(tiltQuatX);

    newPlanets.push({
      name: cfg.name,
      style: cfg.style,
      group: pGroup,
      surface,
      surfaceMat,
      atmosMat,
      glowMat,
      wireBase: cfg.wireBase,
      glowBase: cfg.glowBase,
      homeQuat: homeQuat.clone(),
      spinAngle: 0,
      rotationQuat: homeQuat.clone(),
      x: cfg.x,
      fade: 1,
      fadeTarget: 1,
      displaced: false,
      returning: false,
      returnAlpha: 0,
      returnStartQuat: new THREE.Quaternion(),
      radius: 1,
    });
  }

  // Build sun
  const SUN_RADIUS = 2 * spectral.sizeMultiplier;
  const SUN_X = -PLANET_SPACING * 3;
  const sunGroup = new THREE.Group();
  sunGroup.position.set(SUN_X, 0, 0);

  const sunTex = generateSunTexture(seed + 98765, spectral.sunR, spectral.sunG, spectral.sunB);
  const sunSurfaceMat = new THREE.MeshBasicMaterial({
    map: sunTex, transparent: true, opacity: 1,
  });
  const sunSurface = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 64, 64), sunSurfaceMat
  );
  sunGroup.add(sunSurface);

  const sunAtmosMat = new THREE.MeshBasicMaterial({
    color: spectral.atmosColor, transparent: true, opacity: 0.012,
    side: THREE.FrontSide, depthWrite: false,
  });
  sunGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS + 0.12, 48, 48), sunAtmosMat
  ));

  const sunGlowMat = new THREE.MeshBasicMaterial({
    color: spectral.glowColor, transparent: true, opacity: 0.05,
    side: THREE.BackSide, depthWrite: false,
  });
  sunGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS + 0.36, 32, 32), sunGlowMat
  ));

  group.add(sunGroup);

  const sunLight = new THREE.PointLight(spectral.lightColor, 1.2, 60);
  sunLight.position.set(SUN_X, 0, 0);

  const sunHomeQuat = new THREE.Quaternion();
  newPlanets.push({
    name: "sun",
    group: sunGroup,
    surface: sunSurface,
    surfaceMat: sunSurfaceMat,
    atmosMat: sunAtmosMat,
    glowMat: sunGlowMat,
    wireBase: 0,
    glowBase: 0.05,
    homeQuat: sunHomeQuat.clone(),
    spinAngle: 0,
    rotationQuat: sunHomeQuat.clone(),
    x: SUN_X,
    fade: 1,
    fadeTarget: 1,
    displaced: false,
    returning: false,
    returnAlpha: 0,
    returnStartQuat: new THREE.Quaternion(),
    radius: SUN_RADIUS,
  });

  newPlanets.forEach(p => { if (!p.radius) p.radius = 1; });

  return { group, sunLight, planets: newPlanets, configs, spectral };
}

let focusedPlanet = null;

function teardownStarSystem() {
  if (systemGroup) {
    scene.remove(systemGroup);
    // Dispose all textures and materials
    systemGroup.traverse(child => {
      if (child.isMesh) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    systemGroup = null;
  }
  if (systemSunLight) {
    scene.remove(systemSunLight);
    systemSunLight = null;
  }
  planets = [];
  focusedPlanet = null;
}

function loadStarSystem(seed) {
  teardownStarSystem();
  const result = buildStarSystem(seed);
  systemGroup = result.group;
  systemSunLight = result.sunLight;
  planets = result.planets;
  scene.add(systemGroup);
  scene.add(systemSunLight);
  return result;
}

// ── Load initial star system (seed 0 = home) ───────────────────────
let currentSystemSeed = 0;
let currentStarPos = new THREE.Vector3(0, 0, 0);
let currentStarName = "Sol";
let currentSystemResult = loadStarSystem(0);

// ══════════════════════════════════════════════════════════════════════
// ██  TWINKLING STARFIELD (background, always visible)
// ══════════════════════════════════════════════════════════════════════
const STAR_COUNT = 3000;
const starPositions = new Float32Array(STAR_COUNT * 3);
const starColors = new Float32Array(STAR_COUNT * 3);
const starBaseAlphas = new Float32Array(STAR_COUNT);
const starSpeeds = new Float32Array(STAR_COUNT);
const starBaseSizes = new Float32Array(STAR_COUNT);

const starTints = [
  [1.0, 1.0, 1.0],
  [0.85, 0.9, 1.0],
  [1.0, 0.92, 0.8],
  [0.8, 0.85, 1.0],
  [1.0, 0.85, 0.85],
];

for (let i = 0; i < STAR_COUNT; i++) {
  const r = 30 + Math.random() * 60;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPositions[i * 3 + 2] = r * Math.cos(phi);

  const tint = starTints[Math.floor(Math.random() * starTints.length)];
  starColors[i * 3] = tint[0];
  starColors[i * 3 + 1] = tint[1];
  starColors[i * 3 + 2] = tint[2];

  starBaseAlphas[i] = 0.25 + Math.random() * 0.75;
  starSpeeds[i] = 0.2 + Math.random() * 2.0;
  starBaseSizes[i] = 0.03 + Math.random() * 0.07;
}

const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));

const starSizesAttr = new Float32Array(STAR_COUNT);
starGeo.setAttribute("size", new THREE.BufferAttribute(starSizesAttr, 1));

const starMat = new THREE.PointsMaterial({
  size: 0.06,
  sizeAttenuation: true,
  transparent: true,
  opacity: 1,
  vertexColors: true,
  depthWrite: false,
});
const backgroundStars = new THREE.Points(starGeo, starMat);
scene.add(backgroundStars);

// ══════════════════════════════════════════════════════════════════════
// ██  LOCAL CLUSTER VIEW — Procedural 3D star orbs
// ══════════════════════════════════════════════════════════════════════
const GALAXY_MASTER_SEED = 0x6A1A5E;
const GALAXY_CELL_SIZE = 10;
const GALAXY_VIEW_RADIUS = 160;
const STAR_PROBABILITY = 0.03;

// Cache: "ix,iy,iz" → star data object
const galaxyStarCache = new Map();
// Currently rendered star meshes in the cluster view
let clusterGroup = null;       // THREE.Group holding all star orbs
let clusterStarMeshes = [];    // Array of { mesh, glowMesh, star } for raycasting & hover
let hoveredStar = null;        // Currently hovered star data
let hoveredStarMesh = null;    // Currently hovered mesh (for highlight)
const mouseNDC = new THREE.Vector2(-9, -9); // Mouse normalized device coords
let lastMouseX = 0;
let lastMouseY = 0;

// Shared geometries for cluster stars
const clusterStarGeo = new THREE.SphereGeometry(1, 24, 24);
const clusterGlowGeo = new THREE.SphereGeometry(1, 16, 16);

// Hover highlight ring
let clusterHoverRing = null;
// Current-system marker ring
let clusterCurrentRing = null;
// Tooltip label
const $clusterTooltip = document.getElementById("cluster-tooltip");

// Last-visited star tracking
let lastVisitedStar = null;  // { seed, pos: Vector3, name, color }
let lastVisitedMesh = null;  // core mesh for the last-visited marker
let lastVisitedGlow = null;
let trailLine = null;        // THREE.Line between current and last-visited

// WASD + strafe/fly state
const wasdKeys = { w: false, a: false, s: false, d: false, q: false, e: false, c: false, space: false };

// Lens flare sprite texture (procedural radial gradient)
const flareCanvas = document.createElement("canvas");
flareCanvas.width = 64; flareCanvas.height = 64;
const flareCtx = flareCanvas.getContext("2d");
const flareGrad = flareCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
flareGrad.addColorStop(0, "rgba(255,255,255,1)");
flareGrad.addColorStop(0.15, "rgba(255,255,255,0.6)");
flareGrad.addColorStop(0.4, "rgba(255,255,255,0.1)");
flareGrad.addColorStop(1, "rgba(255,255,255,0)");
flareCtx.fillStyle = flareGrad;
flareCtx.fillRect(0, 0, 64, 64);
const flareTexture = new THREE.CanvasTexture(flareCanvas);

function generateGalaxyStars(centerPos) {
  const CS = GALAXY_CELL_SIZE;
  const halfR = Math.ceil(GALAXY_VIEW_RADIUS / CS);
  const centerCellX = Math.round(centerPos.x / CS);
  const centerCellY = Math.round(centerPos.y / CS);
  const centerCellZ = Math.round(centerPos.z / CS);

  for (let ix = centerCellX - halfR; ix <= centerCellX + halfR; ix++) {
    for (let iy = centerCellY - halfR; iy <= centerCellY + halfR; iy++) {
      for (let iz = centerCellZ - halfR; iz <= centerCellZ + halfR; iz++) {
        const key = `${ix},${iy},${iz}`;
        if (galaxyStarCache.has(key)) continue;

        const h = hashCoords(GALAXY_MASTER_SEED, ix, iy, iz);
        const prob = (h & 0xFFFF) / 0xFFFF;
        if (prob > STAR_PROBABILITY) continue;

        const cellRng = mulberry32(h);
        const jx = (cellRng() - 0.5) * CS * 0.8;
        const jy = (cellRng() - 0.5) * CS * 0.8;
        const jz = (cellRng() - 0.5) * CS * 0.8;
        const starSeed = (h ^ 0xA5A5A5A5) >>> 0;
        const spectral = pickSpectralType(cellRng);

        galaxyStarCache.set(key, {
          seed: starSeed,
          x: ix * CS + jx,
          y: iy * CS + jy,
          z: iz * CS + jz,
          color: spectral.color,
          spectral,
          name: generateStarName(starSeed),
          sizeMultiplier: spectral.sizeMultiplier,
        });
      }
    }
  }

  rebuildClusterMeshes(centerPos);
}

function rebuildClusterMeshes(centerPos) {
  // Remove old cluster group
  if (clusterGroup) {
    scene.remove(clusterGroup);
    clusterGroup.traverse(child => {
      if (child.isMesh) {
        child.material.dispose();
      }
    });
    clusterGroup = null;
  }
  if (clusterHoverRing) {
    scene.remove(clusterHoverRing);
    clusterHoverRing.geometry.dispose();
    clusterHoverRing.material.dispose();
    clusterHoverRing = null;
  }
  if (clusterCurrentRing) {
    scene.remove(clusterCurrentRing);
    clusterCurrentRing.geometry.dispose();
    clusterCurrentRing.material.dispose();
    clusterCurrentRing = null;
  }

  clusterStarMeshes = [];
  hoveredStar = null;
  hoveredStarMesh = null;

  clusterGroup = new THREE.Group();
  const rSq = GALAXY_VIEW_RADIUS * GALAXY_VIEW_RADIUS;

  for (const [, star] of galaxyStarCache) {
    const dx = star.x - centerPos.x;
    const dy = star.y - centerPos.y;
    const dz = star.z - centerPos.z;
    if (dx * dx + dy * dy + dz * dz > rSq) continue;

    const baseSize = 0.35 * star.sizeMultiplier;
    const color = new THREE.Color(star.color);
    // Brighter, more saturated core color
    const coreColor = color.clone().lerp(new THREE.Color(0xffffff), 0.3);

    // Core orb — bright emissive with warm tint
    const coreMat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 2.2,
      roughness: 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: 1.0,
    });
    const coreMesh = new THREE.Mesh(clusterStarGeo, coreMat);
    coreMesh.position.set(star.x, star.y, star.z);
    coreMesh.scale.setScalar(baseSize);
    clusterGroup.add(coreMesh);

    // Inner glow — saturated halo
    const glowMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.22,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(clusterGlowGeo, glowMat);
    glowMesh.position.set(star.x, star.y, star.z);
    glowMesh.scale.setScalar(baseSize * 3.2);
    clusterGroup.add(glowMesh);

    // Outer bloom halo — wider, softer
    const bloomMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.06,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const bloomMesh = new THREE.Mesh(clusterGlowGeo, bloomMat);
    bloomMesh.position.set(star.x, star.y, star.z);
    bloomMesh.scale.setScalar(baseSize * 6.0);
    clusterGroup.add(bloomMesh);

    // Lens flare sprite — additive billboard
    const flareMat = new THREE.SpriteMaterial({
      map: flareTexture,
      color: color,
      transparent: true,
      opacity: 0.35 * star.sizeMultiplier,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flareSprite = new THREE.Sprite(flareMat);
    flareSprite.position.set(star.x, star.y, star.z);
    flareSprite.scale.setScalar(baseSize * 8.0);
    clusterGroup.add(flareSprite);

    clusterStarMeshes.push({ mesh: coreMesh, glowMesh, bloomMesh, flareSprite, star, coreMat, glowMat, bloomMat, flareMat, baseSize });
  }

  clusterGroup.visible = false;
  scene.add(clusterGroup);

  // Hover highlight ring (reusable, moves to hovered star)
  const hoverRingGeo = new THREE.RingGeometry(0.8, 1.05, 48);
  const hoverRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  clusterHoverRing = new THREE.Mesh(hoverRingGeo, hoverRingMat);
  clusterHoverRing.visible = false;
  scene.add(clusterHoverRing);

  // Current-system marker ring (pulsing gold)
  const curRingGeo = new THREE.RingGeometry(0.6, 0.85, 48);
  const curRingMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  clusterCurrentRing = new THREE.Mesh(curRingGeo, curRingMat);
  clusterCurrentRing.position.copy(currentStarPos);
  clusterCurrentRing.visible = false;
  scene.add(clusterCurrentRing);

  // ── Last-visited star marker + trail line ──
  if (trailLine) { scene.remove(trailLine); trailLine.geometry.dispose(); trailLine.material.dispose(); trailLine = null; }
  if (lastVisitedMesh) { scene.remove(lastVisitedMesh); lastVisitedMesh.geometry.dispose(); lastVisitedMesh.material.dispose(); lastVisitedMesh = null; }
  if (lastVisitedGlow) { scene.remove(lastVisitedGlow); lastVisitedGlow.geometry.dispose(); lastVisitedGlow.material.dispose(); lastVisitedGlow = null; }

  if (lastVisitedStar) {
    // If player already rendered this star in the cluster, we don't duplicate
    const alreadyInCluster = clusterStarMeshes.some(e => e.star.seed === lastVisitedStar.seed);
    if (!alreadyInCluster) {
      // Create a standalone orb for the last-visited star (may be far away)
      const lvSize = 0.35;
      const lvColor = new THREE.Color(lastVisitedStar.color || 0xff6644);
      const lvCoreMat = new THREE.MeshStandardMaterial({
        color: lvColor.clone().lerp(new THREE.Color(0xffffff), 0.3),
        emissive: lvColor,
        emissiveIntensity: 2.0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.9,
      });
      lastVisitedMesh = new THREE.Mesh(clusterStarGeo, lvCoreMat);
      lastVisitedMesh.position.copy(lastVisitedStar.pos);
      lastVisitedMesh.scale.setScalar(lvSize);
      lastVisitedMesh.visible = false;
      scene.add(lastVisitedMesh);

      const lvGlowMat = new THREE.MeshBasicMaterial({
        color: lvColor, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false,
      });
      lastVisitedGlow = new THREE.Mesh(clusterGlowGeo, lvGlowMat);
      lastVisitedGlow.position.copy(lastVisitedStar.pos);
      lastVisitedGlow.scale.setScalar(lvSize * 3.0);
      lastVisitedGlow.visible = false;
      scene.add(lastVisitedGlow);

      // Add to clickable list so user can click it to go back
      clusterStarMeshes.push({
        mesh: lastVisitedMesh,
        glowMesh: lastVisitedGlow,
        bloomMesh: lastVisitedGlow, // reuse
        flareSprite: null,
        star: { seed: lastVisitedStar.seed, x: lastVisitedStar.pos.x, y: lastVisitedStar.pos.y, z: lastVisitedStar.pos.z, color: lastVisitedStar.color || 0xff6644, name: lastVisitedStar.name },
        coreMat: lvCoreMat,
        glowMat: lvGlowMat,
        bloomMat: lvGlowMat,
        flareMat: null,
        baseSize: lvSize,
      });
    }

    // Trail line from current star to last-visited star
    const trailGeo = new THREE.BufferGeometry().setFromPoints([
      currentStarPos.clone(),
      lastVisitedStar.pos.clone(),
    ]);
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xff3333,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.visible = false;
    scene.add(trailLine);
  }
}

// ── Cluster background: distant fixed starfield (no parallax) ─────
let clusterBgStars = null;
{
  const BG_COUNT = 6000;
  const BG_RADIUS = 1;  // unit sphere, scaled huge so no parallax
  const bgPos = new Float32Array(BG_COUNT * 3);
  const bgCol = new Float32Array(BG_COUNT * 3);
  const bgRng = mulberry32(0xBACF01D);
  for (let i = 0; i < BG_COUNT; i++) {
    // Uniform on unit sphere surface
    const u = bgRng(), v = bgRng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    bgPos[i * 3]     = Math.sin(phi) * Math.cos(theta);
    bgPos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
    bgPos[i * 3 + 2] = Math.cos(phi);
    // Warm/cool tints
    const tint = bgRng();
    if (tint < 0.35) {
      bgCol[i * 3] = 0.5 + bgRng() * 0.3; bgCol[i * 3 + 1] = 0.5 + bgRng() * 0.2; bgCol[i * 3 + 2] = 0.7 + bgRng() * 0.3;
    } else if (tint < 0.55) {
      bgCol[i * 3] = 0.8 + bgRng() * 0.2; bgCol[i * 3 + 1] = 0.7 + bgRng() * 0.2; bgCol[i * 3 + 2] = 0.4 + bgRng() * 0.2;
    } else {
      bgCol[i * 3] = 0.65 + bgRng() * 0.35; bgCol[i * 3 + 1] = 0.65 + bgRng() * 0.35; bgCol[i * 3 + 2] = 0.65 + bgRng() * 0.35;
    }
  }
  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.Float32BufferAttribute(bgPos, 3));
  bgGeo.setAttribute("color", new THREE.Float32BufferAttribute(bgCol, 3));
  const bgMat = new THREE.PointsMaterial({
    size: 1.5,
    sizeAttenuation: false,  // fixed screen-space size = no parallax
    transparent: true,
    opacity: 0.45,
    vertexColors: true,
    depthWrite: false,
    depthTest: false,
  });
  clusterBgStars = new THREE.Points(bgGeo, bgMat);
  clusterBgStars.renderOrder = -1; // render behind everything
  clusterBgStars.frustumCulled = false;
  clusterBgStars.visible = false;
  scene.add(clusterBgStars);
}

// Ensure the home star (seed 0) is always in the galaxy cache
galaxyStarCache.set("0,0,0_home", {
  seed: 0,
  x: 0, y: 0, z: 0,
  color: SPECTRAL_TYPES[2].color, // G-type for home star
  spectral: SPECTRAL_TYPES[2],
  name: "Sol",
  sizeMultiplier: 1.0,
});

// ══════════════════════════════════════════════════════════════════════
// ██  VIEW / CAMERA STATE
// ══════════════════════════════════════════════════════════════════════
let viewLevel = "system";  // "system" | "galaxy"

const CAM_ALL = { x: -2, y: 0.5, z: 18 };
const CAM_FOCUS_Z = 3.2;
const LERP_SPEED = 0.045;
const FADE_SPEED = 0.06;
const RETURN_SPEED = 0.0018;

const camTarget = new THREE.Vector3(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
const lookTarget = new THREE.Vector3(CAM_ALL.x, 0, 0);
const camCurrent = new THREE.Vector3(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
const lookCurrent = new THREE.Vector3(CAM_ALL.x, 0, 0);

camera.position.copy(camCurrent);

const showAllBtn = document.getElementById("show-all-btn");
const galaxyViewBtn = document.getElementById("galaxy-view-btn");

let focusOn = function(planet) {
  focusedPlanet = planet;
  const focusZ = CAM_FOCUS_Z * (planet.radius || 1);
  camTarget.set(planet.x, 0, focusZ);
  lookTarget.set(planet.x, 0, 0);
  showAllBtn.classList.add("visible");
  galaxyViewBtn.classList.remove("visible");

  for (const p of planets) {
    p.fadeTarget = p === planet ? 1 : 0;
  }
};

let showAll = function() {
  for (const p of planets) {
    if (p.displaced) {
      p.returning = true;
      p.returnAlpha = 0;
      p.returnStartQuat.copy(p.rotationQuat);
    }
  }

  focusedPlanet = null;
  camTarget.set(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
  lookTarget.set(CAM_ALL.x, 0, 0);
  showAllBtn.classList.remove("visible");

  // Show galaxy view button when in system overview (playing phase)
  if (gamePhase === "playing") {
    galaxyViewBtn.classList.add("visible");
  }

  for (const p of planets) {
    p.fadeTarget = 1;
    p.group.visible = true;
  }
};

showAllBtn.addEventListener("click", () => showAll());

// ── Galaxy orbit camera state ─────────────────────────────────────
const galaxyCam = {
  theta: 0.3,             // horizontal angle
  phi: Math.PI / 3,       // vertical angle (from top)
  radius: 40,             // distance from center
  center: new THREE.Vector3(0, 0, 0),
  minRadius: 10,
  maxRadius: 200,
  isDragging: false,
  prevX: 0,
  prevY: 0,
};

function getGalaxyCameraPosition() {
  const sinPhi = Math.sin(galaxyCam.phi);
  const cosPhi = Math.cos(galaxyCam.phi);
  const sinTheta = Math.sin(galaxyCam.theta);
  const cosTheta = Math.cos(galaxyCam.theta);
  return new THREE.Vector3(
    galaxyCam.center.x + galaxyCam.radius * sinPhi * cosTheta,
    galaxyCam.center.y + galaxyCam.radius * cosPhi,
    galaxyCam.center.z + galaxyCam.radius * sinPhi * sinTheta,
  );
}

// ── Enter / Exit Galaxy View ───────────────────────────────────────
function enterGalaxyView() {
  viewLevel = "galaxy";

  // Hide system objects
  if (systemGroup) systemGroup.visible = false;
  if (systemSunLight) systemSunLight.visible = false;
  backgroundStars.visible = false;

  // Hide system UI
  showAllBtn.classList.remove("visible");
  galaxyViewBtn.classList.remove("visible");
  $planetPanel.classList.add("hidden-panel");

  // Disable fog for cluster view
  scene.fog = null;

  // Show cluster background
  if (clusterBgStars) clusterBgStars.visible = true;

  // Position orbit camera centered on current star
  galaxyCam.center.copy(currentStarPos);
  galaxyCam.theta = 0.3;
  galaxyCam.phi = Math.PI / 3;
  galaxyCam.radius = 40;

  // Generate stars around current position
  generateGalaxyStars(currentStarPos);
  if (clusterGroup) clusterGroup.visible = true;
  if (clusterCurrentRing) {
    clusterCurrentRing.position.copy(currentStarPos);
    clusterCurrentRing.visible = true;
  }
  // Show last-visited marker + trail
  if (lastVisitedMesh) lastVisitedMesh.visible = true;
  if (lastVisitedGlow) lastVisitedGlow.visible = true;
  if (trailLine) trailLine.visible = true;

  // Show Center button
  const $centerBtn = document.getElementById("btn-cluster-center");
  if ($centerBtn) $centerBtn.style.display = "";
  const $clusterHints = document.getElementById("cluster-hints");
  if ($clusterHints) $clusterHints.style.display = "";

  // Show cluster UI
  const $galaxyLabel = document.getElementById("galaxy-label");
  if ($galaxyLabel) {
    $galaxyLabel.textContent = `Current: ${currentStarName}`;
    $galaxyLabel.style.display = "";
  }
  const $bookmarkBtn = document.getElementById("btn-bookmark");
  if ($bookmarkBtn) $bookmarkBtn.style.display = "";
  const $bookmarkSelect = document.getElementById("bookmark-select");
  if ($bookmarkSelect) $bookmarkSelect.style.display = "";
}

function exitGalaxyView(targetSeed, targetPos, targetName) {
  viewLevel = "system";

  // Hide cluster objects
  if (clusterGroup) clusterGroup.visible = false;
  if (clusterHoverRing) clusterHoverRing.visible = false;
  if (clusterCurrentRing) clusterCurrentRing.visible = false;
  hoveredStar = null;
  hoveredStarMesh = null;
  if ($clusterTooltip) $clusterTooltip.style.display = "none";
  if (lastVisitedMesh) lastVisitedMesh.visible = false;
  if (lastVisitedGlow) lastVisitedGlow.visible = false;
  if (trailLine) trailLine.visible = false;
  renderer.domElement.style.cursor = "";
  const $centerBtn = document.getElementById("btn-cluster-center");
  if ($centerBtn) $centerBtn.style.display = "none";
  const $clusterHints = document.getElementById("cluster-hints");
  if ($clusterHints) $clusterHints.style.display = "none";

  // Show game-specific HUD elements again (resources stay hidden globally)
  // (resources/pop/time are hidden globally for now)

  // Hide cluster background
  if (clusterBgStars) clusterBgStars.visible = false;

  // Re-enable fog
  scene.fog = new THREE.FogExp2(0x010108, 0.008);

  // Load new system if different
  if (targetSeed !== currentSystemSeed) {
    // Track last-visited star (the system we're leaving)
    lastVisitedStar = {
      seed: currentSystemSeed,
      pos: currentStarPos.clone(),
      name: currentStarName,
      color: currentSystemResult?.spectral?.color || 0xffeedd,
    };

    currentSystemSeed = targetSeed;
    currentStarPos.copy(targetPos);
    currentStarName = targetName || generateStarName(targetSeed);
    currentSystemResult = loadStarSystem(targetSeed);

    // Update game state planets for the new system
    if (gameState) {
      // If returning to home system, use existing planet data
      if (targetSeed === (gameState.homeSystemSeed ?? 0)) {
        // Home system — planets already saved
      } else {
        // New system — update currentSystemSeed in game state
        gameState.currentSystemSeed = targetSeed;
        gameState.currentStarPos = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
        gameState.currentStarName = currentStarName;
      }
    }
  }

  // Show system objects
  if (systemGroup) systemGroup.visible = true;
  if (systemSunLight) systemSunLight.visible = true;
  backgroundStars.visible = true;

  // Reset camera to system overview
  camTarget.set(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
  lookTarget.set(CAM_ALL.x, 0, 0);
  camCurrent.set(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
  lookCurrent.set(CAM_ALL.x, 0, 0);
  camera.position.copy(camCurrent);

  focusedPlanet = null;
  showAllBtn.classList.remove("visible");
  if (gamePhase === "playing") {
    galaxyViewBtn.classList.add("visible");
  }

  // Hide galaxy UI
  const $galaxyLabel = document.getElementById("galaxy-label");
  if ($galaxyLabel) $galaxyLabel.style.display = "none";
  const $bookmarkBtn = document.getElementById("btn-bookmark");
  if ($bookmarkBtn) $bookmarkBtn.style.display = "none";
  const $bookmarkSelect = document.getElementById("bookmark-select");
  if ($bookmarkSelect) $bookmarkSelect.style.display = "none";

  // Update system name label
  const $systemName = document.getElementById("system-name");
  if ($systemName) $systemName.textContent = currentStarName;
}

galaxyViewBtn.addEventListener("click", () => {
  if (viewLevel === "system" && gamePhase === "playing") {
    enterGalaxyView();
  }
});

// Center button — snap camera back to current star
const $centerBtn = document.getElementById("btn-cluster-center");
if ($centerBtn) {
  $centerBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  $centerBtn.addEventListener("click", () => {
    if (viewLevel === "galaxy") {
      galaxyCam.center.copy(currentStarPos);
      // Clear any movement keys that might be stuck
      for (const k in wasdKeys) wasdKeys[k] = false;
    }
  });
}

// ── Drag-to-rotate / Galaxy orbit ──────────────────────────────────
const dragState = {
  isDragging: false,
  startX: 0,
  startY: 0,
  prevX: 0,
  prevY: 0,
  velocityX: 0,
  velocityY: 0,
};

const DRAG_SENSITIVITY = 0.005;
const DRAG_DAMPING = 0.90;
const GALAXY_ORBIT_SENSITIVITY = 0.005;

const canvas = renderer.domElement;

canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return; // right-click handled by contextmenu

  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.prevX = e.clientX;
  dragState.prevY = e.clientY;

  if (viewLevel === "galaxy") {
    galaxyCam.isDragging = true;
    galaxyCam.prevX = e.clientX;
    galaxyCam.prevY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  if (focusedPlanet) {
    dragState.isDragging = true;
    focusedPlanet.displaced = true;
    focusedPlanet.returning = false;
    focusedPlanet.returnAlpha = 0;
    canvas.setPointerCapture(e.pointerId);
  }
});

window.addEventListener("pointermove", (e) => {
  // Always track mouse position for hover detection
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (viewLevel === "galaxy" && galaxyCam.isDragging) {
    const dx = e.clientX - galaxyCam.prevX;
    const dy = e.clientY - galaxyCam.prevY;
    galaxyCam.theta -= dx * GALAXY_ORBIT_SENSITIVITY;
    galaxyCam.phi -= dy * GALAXY_ORBIT_SENSITIVITY;
    // Clamp phi to avoid flipping
    galaxyCam.phi = Math.max(0.1, Math.min(Math.PI - 0.1, galaxyCam.phi));
    galaxyCam.prevX = e.clientX;
    galaxyCam.prevY = e.clientY;
    return;
  }

  if (!dragState.isDragging || !focusedPlanet) return;
  const dx = e.clientX - dragState.prevX;
  const dy = e.clientY - dragState.prevY;
  dragState.velocityX = dx * DRAG_SENSITIVITY;
  dragState.velocityY = dy * DRAG_SENSITIVITY;
  dragState.prevX = e.clientX;
  dragState.prevY = e.clientY;
});

window.addEventListener("pointerup", (e) => {
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  const wasClick = dx * dx + dy * dy <= 36;

  if (viewLevel === "galaxy") {
    galaxyCam.isDragging = false;
    if (!wasClick) return;

    // Click on a star orb
    if (hoveredStar) {
      exitGalaxyView(
        hoveredStar.seed,
        new THREE.Vector3(hoveredStar.x, hoveredStar.y, hoveredStar.z),
        hoveredStar.name
      );
    }
    return;
  }

  dragState.isDragging = false;

  if (!wasClick) return;

  const ptr = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ptr, camera);

  for (const p of planets) {
    if (!p.group.visible) continue;
    if (rc.intersectObject(p.surface).length > 0) {
      focusOn(p);
      return;
    }
  }
});

// Scroll wheel for galaxy zoom
canvas.addEventListener("wheel", (e) => {
  if (viewLevel !== "galaxy") return;
  e.preventDefault();
  galaxyCam.radius += e.deltaY * 0.05;
  galaxyCam.radius = Math.max(galaxyCam.minRadius, Math.min(galaxyCam.maxRadius, galaxyCam.radius));
}, { passive: false });

// ── Resize ──────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Escape / Right-click ────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (viewLevel === "galaxy") {
      exitGalaxyView(currentSystemSeed, currentStarPos, currentStarName);
    } else if (focusedPlanet) {
      showAll();
    }
  }
  // WASD/Q/E + Space/C for cluster flying
  const k = e.key.toLowerCase();
  if (k in wasdKeys) { wasdKeys[k] = true; e.preventDefault(); }
  if (e.key === " ") { wasdKeys.space = true; e.preventDefault(); }
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k in wasdKeys) wasdKeys[k] = false;
  if (e.key === " ") wasdKeys.space = false;
});

window.addEventListener("contextmenu", (e) => {
  if (viewLevel === "galaxy") {
    e.preventDefault();
    exitGalaxyView(currentSystemSeed, currentStarPos, currentStarName);
  } else if (focusedPlanet) {
    e.preventDefault();
    showAll();
  }
});

// ── Helpers ─────────────────────────────────────────────────────────
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const tempQuat = new THREE.Quaternion();
const spinQuat = new THREE.Quaternion();
const AUTO_ROTATE_SPEED = 0.00105;

// ══════════════════════════════════════════════════════════════════════
// ██  ANIMATION LOOP
// ══════════════════════════════════════════════════════════════════════
const clock = new THREE.Clock();
let lastFrameTime = 0;

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = t - lastFrameTime;
  lastFrameTime = t;

  if (viewLevel === "galaxy") {
    // ── WASD flying: move camera center along camera-relative axes ──
    const flySpeed = dt * galaxyCam.radius * 0.5; // scale with zoom
    const camPos0 = getGalaxyCameraPosition();
    const fwd = new THREE.Vector3().subVectors(galaxyCam.center, camPos0).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    if (wasdKeys.w) galaxyCam.center.addScaledVector(fwd, flySpeed);
    if (wasdKeys.s) galaxyCam.center.addScaledVector(fwd, -flySpeed);
    if (wasdKeys.a || wasdKeys.q) galaxyCam.center.addScaledVector(right, -flySpeed);
    if (wasdKeys.d || wasdKeys.e) galaxyCam.center.addScaledVector(right, flySpeed);
    if (wasdKeys.space) galaxyCam.center.y += flySpeed;
    if (wasdKeys.c) galaxyCam.center.y -= flySpeed;

    // ── Cluster view: orbit camera ──
    const camPos = getGalaxyCameraPosition();
    camera.position.copy(camPos);
    camera.lookAt(galaxyCam.center);

    // Keep background centered on camera position (not orbit center)
    if (clusterBgStars) clusterBgStars.position.copy(camPos);

    // Pulse the current-system ring
    if (clusterCurrentRing && clusterCurrentRing.visible) {
      clusterCurrentRing.lookAt(camera.position);
      clusterCurrentRing.material.opacity = 0.35 + 0.25 * Math.sin(t * 3);
    }

    // Animate hover ring
    if (clusterHoverRing && clusterHoverRing.visible) {
      clusterHoverRing.lookAt(camera.position);
      clusterHoverRing.material.opacity = 0.4 + 0.3 * Math.sin(t * 5);
      // Gentle scale pulse
      const pulse = 1.0 + 0.08 * Math.sin(t * 4);
      clusterHoverRing.scale.setScalar(pulse);
    }

    // Trail line pulsing
    if (trailLine && trailLine.visible) {
      trailLine.material.opacity = 0.15 + 0.1 * Math.sin(t * 2);
    }

    // Subtle star glow breathing + flare shimmer
    for (const entry of clusterStarMeshes) {
      const phase = entry.star.seed * 0.001;
      const breathe = 0.18 + 0.1 * Math.sin(t * 1.5 + phase);
      entry.glowMat.opacity = breathe;
      const bloomBreath = 0.04 + 0.03 * Math.sin(t * 0.8 + phase * 2);
      entry.bloomMat.opacity = bloomBreath;
      // Flare shimmer
      if (entry.flareMat) {
        entry.flareMat.opacity = (0.25 + 0.15 * Math.sin(t * 2.0 + phase * 3)) * (entry.star.sizeMultiplier || 1);
      }
    }

    // Hover detection via raycaster
    if (!galaxyCam.isDragging) {
      const coreMeshes = clusterStarMeshes.map(e => e.mesh);
      const hoverRC = new THREE.Raycaster();
      hoverRC.setFromCamera(mouseNDC, camera);
      const hits = hoverRC.intersectObjects(coreMeshes);
      if (hits.length > 0) {
        const hitMesh = hits[0].object;
        const entry = clusterStarMeshes.find(e => e.mesh === hitMesh);
        if (entry && entry.star !== hoveredStar) {
          // Unhighlight previous
          if (hoveredStarMesh) {
            hoveredStarMesh.coreMat.emissiveIntensity = 1.5;
            hoveredStarMesh.mesh.scale.setScalar(hoveredStarMesh.baseSize);
          }
          hoveredStar = entry.star;
          hoveredStarMesh = entry;
          // Highlight new
          entry.coreMat.emissiveIntensity = 3.0;
          entry.mesh.scale.setScalar(entry.baseSize * 1.4);
          // Position hover ring
          if (clusterHoverRing) {
            clusterHoverRing.position.set(entry.star.x, entry.star.y, entry.star.z);
            clusterHoverRing.visible = true;
            clusterHoverRing.material.color.set(entry.star.color);
          }
          // Tooltip
          if ($clusterTooltip) {
            $clusterTooltip.textContent = entry.star.name;
            $clusterTooltip.style.display = "";
          }
          renderer.domElement.style.cursor = "pointer";
        }
      } else {
        if (hoveredStar) {
          if (hoveredStarMesh) {
            hoveredStarMesh.coreMat.emissiveIntensity = 1.5;
            hoveredStarMesh.mesh.scale.setScalar(hoveredStarMesh.baseSize);
          }
          hoveredStar = null;
          hoveredStarMesh = null;
          if (clusterHoverRing) clusterHoverRing.visible = false;
          if ($clusterTooltip) $clusterTooltip.style.display = "none";
          renderer.domElement.style.cursor = "";
        }
      }
      // Position tooltip near mouse
      if ($clusterTooltip && hoveredStar) {
        $clusterTooltip.style.left = (lastMouseX + 16) + "px";
        $clusterTooltip.style.top = (lastMouseY - 10) + "px";
      }
    }

    renderer.render(scene, camera);
    return;
  }

  // ── System view: Per-planet update ──
  planets.forEach((p, i) => {
    // Fade
    p.fade += (p.fadeTarget - p.fade) * FADE_SPEED;
    if (p.fade < 0.001) { p.fade = 0; p.group.visible = false; }
    else { p.group.visible = true; }

    p.surfaceMat.opacity = p.fade;
    p.atmosMat.opacity = 0.018 * p.fade;
    p.glowMat.opacity = p.glowBase * p.fade;

    const speed = AUTO_ROTATE_SPEED * (1 + i * 0.25);
    const isBeingDragged = (p === focusedPlanet && dragState.isDragging);
    if (!isBeingDragged) {
      p.spinAngle += speed;
    }

    if (p.returning) {
      p.returnAlpha += RETURN_SPEED;
      if (p.returnAlpha >= 1) {
        p.returnAlpha = 1;
        p.returning = false;
        p.displaced = false;
      }
      spinQuat.setFromAxisAngle(axisY, p.spinAngle);
      tempQuat.copy(p.homeQuat).multiply(spinQuat);
      p.rotationQuat.slerpQuaternions(p.returnStartQuat, tempQuat, easeInOut(p.returnAlpha));
      if (p.returnAlpha >= 1) {
        p.rotationQuat.copy(tempQuat);
      }
    } else if (p === focusedPlanet && dragState.isDragging) {
      // Drag applying rotation — handled below
    } else if (p.displaced) {
      tempQuat.setFromAxisAngle(axisY, speed);
      p.rotationQuat.premultiply(tempQuat);
    } else {
      spinQuat.setFromAxisAngle(axisY, p.spinAngle);
      p.rotationQuat.copy(p.homeQuat).multiply(spinQuat);
    }
  });

  // ── Drag-to-rotate focused planet ──
  if (focusedPlanet && !focusedPlanet.returning) {
    if (dragState.isDragging) {
      tempQuat.setFromAxisAngle(axisY, dragState.velocityX);
      focusedPlanet.rotationQuat.premultiply(tempQuat);
      tempQuat.setFromAxisAngle(axisX, dragState.velocityY);
      focusedPlanet.rotationQuat.premultiply(tempQuat);
      dragState.velocityX = 0;
      dragState.velocityY = 0;
    } else if (Math.abs(dragState.velocityX) > 1e-5 || Math.abs(dragState.velocityY) > 1e-5) {
      tempQuat.setFromAxisAngle(axisY, dragState.velocityX);
      focusedPlanet.rotationQuat.premultiply(tempQuat);
      tempQuat.setFromAxisAngle(axisX, dragState.velocityY);
      focusedPlanet.rotationQuat.premultiply(tempQuat);
      dragState.velocityX *= DRAG_DAMPING;
      dragState.velocityY *= DRAG_DAMPING;
    }
  }

  // Apply quaternions
  planets.forEach((p) => p.group.quaternion.copy(p.rotationQuat));

  // ── Twinkle stars ──
  const sizeAttr = starGeo.getAttribute("size");
  for (let i = 0; i < STAR_COUNT; i++) {
    const flicker = starBaseAlphas[i] * (0.5 + 0.5 * Math.sin(t * starSpeeds[i] + i * 1.7));
    sizeAttr.array[i] = starBaseSizes[i] * (0.4 + flicker * 0.8);
  }
  sizeAttr.needsUpdate = true;

  // ── Camera ──
  camCurrent.lerp(camTarget, LERP_SPEED);
  lookCurrent.lerp(lookTarget, LERP_SPEED);
  camera.position.copy(camCurrent);
  camera.lookAt(lookCurrent);

  fillLight.position.y = -3 + Math.sin(t * 0.3) * 0.8;

  // ── Game Tick (inside render loop) ──
  if (gameState && gameState.speed > 0 && gamePhase === "playing") {
    tickAccum += dt * gameState.speed;
    while (tickAccum >= TICK_INTERVAL) {
      tickAccum -= TICK_INTERVAL;
      gameTick();
    }
    updateHUD();
    if (focusedPlanet) updatePlanetPanel(focusedPlanet);
  }

  renderer.render(scene, camera);
}

// Smooth ease-in-out for return slerp
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ══════════════════════════════════════════════════════════════════════
// ██  GAME ENGINE — Phase 1
// ══════════════════════════════════════════════════════════════════════

// ── Building Definitions ───────────────────────────────────────────
const BUILDING_DEFS = {
  solarArray:  { label: "Solar Array",  icon: "⚡", cost: { minerals: 30 },                buildDays: 10, yields: { energy: 4 } },
  mine:        { label: "Mine",         icon: "⛏",  cost: { energy: 20 },                  buildDays: 8,  yields: { minerals: 3 } },
  farmDome:    { label: "Farm Dome",    icon: "🌾", cost: { energy: 15, minerals: 10 },    buildDays: 6,  yields: { food: 4 } },
  researchLab: { label: "Research Lab", icon: "🔬", cost: { energy: 25, minerals: 20 },    buildDays: 14, yields: { research: 3 } },
  foundry:     { label: "Foundry",      icon: "⚙",  cost: { energy: 30, minerals: 40 },    buildDays: 18, yields: { alloys: 2, minerals: -1 } },
};

const MAX_SLOTS = 8;

// ── Game State ─────────────────────────────────────────────────────
let gameState = null;

function newGameState(homePlanetName) {
  // Build planet entries from the current loaded system's planet list (exclude sun)
  const planetEntries = planets
    .filter(p => p.name !== "sun")
    .map(p => ({
      name: p.name,
      style: p.style,
      colonized: p.name === homePlanetName,
      population: p.name === homePlanetName ? 100 : 0,
      buildings: [],
    }));

  return {
    started: true,
    day: 1,
    year: 1,
    speed: 1,       // 0=paused, 1=play
    resources: { energy: 0, minerals: 0, food: 0, research: 0, alloys: 0 },
    homeSystemSeed: currentSystemSeed,
    currentSystemSeed: currentSystemSeed,
    currentStarPos: { x: currentStarPos.x, y: currentStarPos.y, z: currentStarPos.z },
    currentStarName: currentStarName,
    bookmarks: [
      { seed: currentSystemSeed, name: currentStarName, x: currentStarPos.x, y: currentStarPos.y, z: currentStarPos.z },
    ],
    planets: planetEntries,
  };
}

// ── Save / Load ────────────────────────────────────────────────────
const SAVE_KEY = "endless-horizons-save";

function saveGame() {
  if (!gameState) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(gameState));
    const btn = document.getElementById("btn-save");
    btn.textContent = "✓ Saved";
    setTimeout(() => { btn.innerHTML = "💾 Save"; }, 800);
  } catch (_) { /* quota exceeded */ }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function hasSave() {
  return !!localStorage.getItem(SAVE_KEY);
}

// ── DOM References ─────────────────────────────────────────────────
const $hudTop       = document.getElementById("hud-top");
const $planetPanel  = document.getElementById("planet-panel");
const $btnSave      = document.getElementById("btn-save");
const $btnPause     = document.getElementById("btn-pause");
const $btnSpeed1    = document.getElementById("btn-speed1");
const $btnExport    = document.getElementById("btn-export");
const $btnImport    = document.getElementById("btn-import");

// ── Game Phases ────────────────────────────────────────────────────
let gamePhase = "playing";

function enterPlaying() {
  gamePhase = "playing";
  $hudTop.classList.remove("hidden-panel");

  // Hide resources/time/pop globally for now (keep save buttons)
  const $hudGameInfo = document.getElementById("hud-game-info");
  const $hudResources = document.getElementById("hud-resources");
  const $hudPopWrap = document.getElementById("hud-pop-wrap");
  if ($hudGameInfo) $hudGameInfo.style.display = "none";
  if ($hudResources) $hudResources.style.display = "none";
  if ($hudPopWrap) $hudPopWrap.style.display = "none";

  updateHUD();
  updateBookmarkDropdown();

  // Update system name label
  const $systemName = document.getElementById("system-name");
  if ($systemName) $systemName.textContent = currentStarName;

  showAll();
}

// ── Speed Controls ─────────────────────────────────────────────────
const speedBtns = [$btnPause, $btnSpeed1];
const speedVals = [0, 1];

function setSpeed(val) {
  if (!gameState) return;
  gameState.speed = val;
  const active = "text-emerald-400 border-emerald-400/30";
  speedBtns.forEach((btn, i) => {
    if (speedVals[i] === val) btn.className = btn.className.replace(/text-\S+/g, "") + " " + active;
    else btn.className = btn.className.replace(/text-emerald-400/g, "").replace(/border-emerald-400\/30/g, "");
  });
}

speedBtns.forEach((btn, i) => btn.addEventListener("click", () => setSpeed(speedVals[i])));

// ── Game Tick ──────────────────────────────────────────────────────
const TICK_INTERVAL = 1.0;
let tickAccum = 0;

function gameTick() {
  if (!gameState || gameState.speed === 0) return;

  const rates = { energy: 0, minerals: 0, food: 0, research: 0, alloys: 0 };

  for (const gp of gameState.planets) {
    if (!gp.colonized) continue;

    const base = STYLE_YIELDS[gp.style] || STYLE_YIELDS.scattered;
    for (const k in base) rates[k] += base[k];

    for (const b of gp.buildings) {
      if (!b.built) {
        b.progress++;
        if (b.progress >= BUILDING_DEFS[b.type].buildDays) {
          b.built = true;
        }
        continue;
      }
      const def = BUILDING_DEFS[b.type];
      if (def.yields) {
        for (const k in def.yields) rates[k] += def.yields[k];
      }
    }

    const foodSurplus = rates.food;
    if (foodSurplus > 0 && gp.population > 0) {
      gp.population += Math.floor(foodSurplus / 10) || 0;
      if (gameState.day % 5 === 0) gp.population += 1;
    }
  }

  for (const k in rates) {
    gameState.resources[k] = Math.max(0, Math.round((gameState.resources[k] + rates[k]) * 100) / 100);
  }

  gameState._rates = rates;

  gameState.day++;
  if (gameState.day > 360) {
    gameState.day = 1;
    gameState.year++;
  }

  if (gameState.day % 30 === 0) saveGame();
}

// ── HUD Update ─────────────────────────────────────────────────────
function updateHUD() {
  if (!gameState) return;

  document.getElementById("hud-day").textContent = gameState.day;
  document.getElementById("hud-year").textContent = gameState.year;

  const res = gameState.resources;
  const rates = gameState._rates || { energy: 0, minerals: 0, food: 0, research: 0, alloys: 0 };

  for (const k of ["energy", "minerals", "food", "research", "alloys"]) {
    document.getElementById("res-" + k).textContent = Math.floor(res[k]);
    const rateEl = document.getElementById("res-" + k + "-rate");
    const r = rates[k] || 0;
    rateEl.textContent = (r >= 0 ? "+" : "") + r;
    rateEl.className = r >= 0
      ? "text-emerald-400/70 text-[10px]"
      : "text-red-400/70 text-[10px]";
  }

  const totalPop = gameState.planets.reduce((s, p) => s + p.population, 0);
  document.getElementById("hud-pop").textContent = totalPop.toLocaleString();
}

// ── Planet Panel ───────────────────────────────────────────────────
function updatePlanetPanel(planet3d) {
  if (!gameState || gamePhase !== "playing") {
    $planetPanel.classList.add("hidden-panel");
    return;
  }

  const gp = gameState.planets.find(g => g.name === planet3d.name);
  if (!gp) {
    $planetPanel.classList.add("hidden-panel");
    return;
  }

  $planetPanel.classList.remove("hidden-panel");

  document.getElementById("pp-name").textContent = gp.name;
  document.getElementById("pp-style").textContent = gp.style;
  document.getElementById("pp-pop").textContent = gp.colonized ? gp.population.toLocaleString() : "—";

  const statusEl = document.getElementById("pp-status");
  if (gp.colonized) {
    statusEl.textContent = "Colonized";
    statusEl.className = "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400";
  } else {
    statusEl.textContent = "Uncolonized";
    statusEl.className = "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/10 text-white/40";
  }

  const yieldsEl = document.getElementById("pp-yields");
  const base = STYLE_YIELDS[gp.style] || {};
  yieldsEl.innerHTML = "";
  const yieldIcons = { energy: "⚡", minerals: "⛏", food: "🌾", research: "🔬", alloys: "⚙" };
  for (const k in base) {
    if (base[k] === 0) continue;
    yieldsEl.innerHTML += `<div>${yieldIcons[k]} ${k}</div><div class="text-right text-emerald-400/80">+${base[k]}</div>`;
  }

  const bldgsEl = document.getElementById("pp-buildings");
  const slotsUsed = document.getElementById("pp-slots-used");
  slotsUsed.textContent = gp.buildings.length;

  if (!gp.colonized) {
    bldgsEl.innerHTML = '<div class="text-white/30 italic text-[11px]">Not yet colonized</div>';
  } else if (gp.buildings.length === 0) {
    bldgsEl.innerHTML = '<div class="text-white/30 italic text-[11px]">No buildings yet</div>';
  } else {
    bldgsEl.innerHTML = gp.buildings.map(b => {
      const def = BUILDING_DEFS[b.type];
      if (b.built) {
        return `<div class="flex items-center gap-2 py-1 px-2 rounded bg-white/[0.04]">
          <span>${def.icon}</span><span class="text-white/70">${def.label}</span>
          <span class="ml-auto text-emerald-400/60 text-[10px]">Active</span>
        </div>`;
      } else {
        const pct = Math.round((b.progress / def.buildDays) * 100);
        return `<div class="flex items-center gap-2 py-1 px-2 rounded bg-white/[0.04]">
          <span>${def.icon}</span><span class="text-white/50">${def.label}</span>
          <span class="ml-auto text-yellow-400/60 text-[10px]">${pct}%</span>
        </div>`;
      }
    }).join("");
  }

  const buildBtnsEl = document.getElementById("pp-build-buttons");
  if (!gp.colonized || gp.buildings.length >= MAX_SLOTS) {
    buildBtnsEl.innerHTML = "";
    return;
  }

  buildBtnsEl.innerHTML = Object.entries(BUILDING_DEFS).map(([key, def]) => {
    const costStr = Object.entries(def.cost).map(([r, v]) => `${v} ${r}`).join(", ");
    const canAfford = Object.entries(def.cost).every(([r, v]) => gameState.resources[r] >= v);
    const cls = canAfford
      ? "btn-glass hover:bg-emerald-500/20 hover:border-emerald-500/30 text-white/70 cursor-pointer"
      : "btn-glass text-white/25 cursor-not-allowed";
    return `<button data-build="${key}" class="${cls} w-full text-left px-3 py-1.5 rounded text-xs flex items-center gap-2">
      <span>${def.icon}</span>
      <span class="flex-1">${def.label}</span>
      <span class="text-[10px] text-white/40">${costStr}</span>
    </button>`;
  }).join("");

  buildBtnsEl.querySelectorAll("[data-build]").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.build;
      const def = BUILDING_DEFS[type];
      const canAfford = Object.entries(def.cost).every(([r, v]) => gameState.resources[r] >= v);
      if (!canAfford || gp.buildings.length >= MAX_SLOTS) return;

      for (const [r, v] of Object.entries(def.cost)) {
        gameState.resources[r] -= v;
      }
      gp.buildings.push({ type, built: false, progress: 0 });
      updatePlanetPanel(planet3d);
      updateHUD();
    });
  });
}

// ── Hook into existing focusOn / showAll ───────────────────────────
const _origFocusOn = focusOn;
focusOn = function(planet) {
  if (gamePhase === "playing") {
    _origFocusOn(planet);
    updatePlanetPanel(planet);
    return;
  }
};

const _origShowAll = showAll;
showAll = function() {
  _origShowAll();
  $planetPanel.classList.add("hidden-panel");
};

// ══════════════════════════════════════════════════════════════════════
// ██  BOOKMARKS
// ══════════════════════════════════════════════════════════════════════
function addBookmark() {
  if (!gameState) return;
  if (!gameState.bookmarks) gameState.bookmarks = [];
  // Check if already bookmarked
  if (gameState.bookmarks.some(b => b.seed === currentSystemSeed)) return;
  gameState.bookmarks.push({
    seed: currentSystemSeed,
    name: currentStarName,
    x: currentStarPos.x,
    y: currentStarPos.y,
    z: currentStarPos.z,
  });
  saveGame();
  updateBookmarkDropdown();
}

function updateBookmarkDropdown() {
  const $select = document.getElementById("bookmark-select");
  if (!$select || !gameState) return;
  const bookmarks = gameState.bookmarks || [];
  $select.innerHTML = '<option value="" disabled selected>★ Bookmarks</option>';
  for (const bm of bookmarks) {
    const opt = document.createElement("option");
    opt.value = String(bm.seed);
    opt.textContent = bm.name + (bm.seed === (gameState.homeSystemSeed ?? 0) ? " (Home)" : "");
    $select.appendChild(opt);
  }
}

function navigateToBookmark(seed) {
  if (!gameState) return;
  const bookmarks = gameState.bookmarks || [];
  const bm = bookmarks.find(b => b.seed === Number(seed));
  if (!bm) return;

  // If already in galaxy view, just switch. Otherwise enter galaxy then exit to target.
  const targetPos = new THREE.Vector3(bm.x, bm.y, bm.z);
  exitGalaxyView(bm.seed, targetPos, bm.name);
}

const $bookmarkBtn = document.getElementById("btn-bookmark");
if ($bookmarkBtn) {
  $bookmarkBtn.addEventListener("click", addBookmark);
}

const $bookmarkSelect = document.getElementById("bookmark-select");
if ($bookmarkSelect) {
  $bookmarkSelect.addEventListener("change", (e) => {
    navigateToBookmark(e.target.value);
    e.target.selectedIndex = 0; // reset to label
  });
}

$btnSave.addEventListener("click", saveGame);

// ── Export / Import Save ───────────────────────────────────────────
function exportSave() {
  if (!gameState) return;
  const json = JSON.stringify(gameState);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  navigator.clipboard.writeText(b64).then(() => {
    $btnExport.textContent = "\u2713 Copied";
    setTimeout(() => { $btnExport.innerHTML = "\uD83D\uDCE4 Export"; }, 1200);
  }).catch(() => {
    prompt("Copy this save string:", b64);
  });
}

function importSave() {
  const b64 = prompt("Paste your save string:");
  if (!b64 || !b64.trim()) return;
  try {
    const json = decodeURIComponent(escape(atob(b64.trim())));
    const data = JSON.parse(json);
    if (!data.planets || !data.resources) throw new Error("Invalid");
    gameState = data;
    saveGame();
    enterPlaying();
  } catch (_) {
    alert("Invalid save data.");
  }
}

$btnExport.addEventListener("click", exportSave);
$btnImport.addEventListener("click", importSave);

// ── Boot ───────────────────────────────────────────────────────────
{
  const saved = loadGame();
  if (saved) {
    gameState = saved;
    // Patch missing fields from older saves
    if (!gameState.bookmarks) gameState.bookmarks = [];
    if (!gameState.currentStarName) gameState.currentStarName = "Sol";
    if (!gameState.currentStarPos) gameState.currentStarPos = { x: 0, y: 0, z: 0 };
    if (gameState.currentSystemSeed === undefined) gameState.currentSystemSeed = 0;
    if (gameState.homeSystemSeed === undefined) gameState.homeSystemSeed = 0;

    currentSystemSeed = gameState.currentSystemSeed;
    currentStarPos.set(
      gameState.currentStarPos.x || 0,
      gameState.currentStarPos.y || 0,
      gameState.currentStarPos.z || 0,
    );
    currentStarName = gameState.currentStarName;
    if (currentSystemSeed !== 0) {
      loadStarSystem(currentSystemSeed);
    }
  } else {
    // New game — random star system
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    currentSystemSeed = seed;
    currentStarPos.set(0, 0, 0);
    currentStarName = generateStarName(seed);
    currentSystemResult = loadStarSystem(seed);
    const homePlanet = planets.find(p => p.name !== "sun");
    if (homePlanet) {
      gameState = newGameState(homePlanet.name);
    }
  }
  enterPlaying();
}
animate();
