// ══════════════════════════════════════════════════════════════════════
// ██  MILKYWAY VIEW — 1000 nearest stars from the HYG v4.2 catalog
// ══════════════════════════════════════════════════════════════════════
//
//  Loads the HYG v4.2 catalog (https://www.astronexus.com/projects/hyg)
//  and renders Sol + the 1000 nearest stars at their real cartesian
//  positions in parsecs.
//
//  Stars are drawn as a single GPU points cloud with a custom shader:
//  bright core, soft chromatic halo, four-point diffraction spikes,
//  and per-star scintillation. Hover does screen-space projection.
//
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { SPECTRAL_TYPES, spectralTypeFromHyg } from "./spectral.js";

// ── Scene refs (set via init) ──
let _scene, _camera, _renderer;

// ── Constants ──
const PARSEC_TO_UNITS = 12;       // scene units per parsec
const NEAREST_COUNT = 1000;       // stars to display besides Sol
const SOL_NAME = "Sol";
const HOVER_NDC_THRESHOLD = 0.025; // ~2.5% of viewport for hover hit

// ── Module state ──
let mwPoints = null;             // single Points mesh holding every star
let mwBgStars = null;
let mwHoverRing = null;
let stars = [];                  // resolved star records (mirrors point indices)
let hoveredStar = null;
let starsLoaded = false;
let loadStarted = false;
let cachedStars = null;
let pointMaterial = null;

// Tooltip DOM ref
const $mwTooltip = document.getElementById("mw-tooltip");

// ── Constellation full names (IAU 88) ──
const CONSTELLATIONS = {
  And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aqr: "Aquarius", Aql: "Aquila",
  Ara: "Ara", Ari: "Aries", Aur: "Auriga", Boo: "Boötes", Cae: "Caelum",
  Cam: "Camelopardalis", Cnc: "Cancer", CVn: "Canes Venatici", CMa: "Canis Major",
  CMi: "Canis Minor", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia",
  Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon", Cir: "Circinus",
  Col: "Columba", Com: "Coma Berenices", CrA: "Corona Australis", CrB: "Corona Borealis",
  Crv: "Corvus", Crt: "Crater", Cru: "Crux", Cyg: "Cygnus", Del: "Delphinus",
  Dor: "Dorado", Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax",
  Gem: "Gemini", Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra",
  Hyi: "Hydrus", Ind: "Indus", Lac: "Lacerta", Leo: "Leo", LMi: "Leo Minor",
  Lep: "Lepus", Lib: "Libra", Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra",
  Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma",
  Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion", Pav: "Pavo", Peg: "Pegasus",
  Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", Psc: "Pisces", PsA: "Piscis Austrinus",
  Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Sge: "Sagitta", Sgr: "Sagittarius",
  Sco: "Scorpius", Scl: "Sculptor", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans",
  Tau: "Taurus", Tel: "Telescopium", TrA: "Triangulum Australe", Tri: "Triangulum",
  Tuc: "Tucana", UMa: "Ursa Major", UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo",
  Vol: "Volans", Vul: "Vulpecula",
};

function constellationName(code) {
  if (!code) return "—";
  return CONSTELLATIONS[code] || code;
}

// ── Init ──
export function initMilkyWay(scene, camera, renderer) {
  _scene = scene;
  _camera = camera;
  _renderer = renderer;

  // Static background sphere of distant stars (parallax-locked to camera)
  const BG_COUNT = 6000;
  const bgPos = new Float32Array(BG_COUNT * 3);
  const bgCol = new Float32Array(BG_COUNT * 3);
  for (let i = 0; i < BG_COUNT; i++) {
    const u = Math.random(), v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    bgPos[i * 3]     = Math.sin(phi) * Math.cos(theta);
    bgPos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
    bgPos[i * 3 + 2] = Math.cos(phi);
    const tint = Math.random();
    if (tint < 0.35) {
      bgCol[i * 3] = 0.5 + Math.random() * 0.3; bgCol[i * 3 + 1] = 0.5 + Math.random() * 0.2; bgCol[i * 3 + 2] = 0.7 + Math.random() * 0.3;
    } else if (tint < 0.55) {
      bgCol[i * 3] = 0.8 + Math.random() * 0.2; bgCol[i * 3 + 1] = 0.7 + Math.random() * 0.2; bgCol[i * 3 + 2] = 0.4 + Math.random() * 0.2;
    } else {
      bgCol[i * 3] = 0.65 + Math.random() * 0.35; bgCol[i * 3 + 1] = 0.65 + Math.random() * 0.35; bgCol[i * 3 + 2] = 0.65 + Math.random() * 0.35;
    }
  }
  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.Float32BufferAttribute(bgPos, 3));
  bgGeo.setAttribute("color", new THREE.Float32BufferAttribute(bgCol, 3));
  const bgMat = new THREE.PointsMaterial({
    size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.45,
    vertexColors: true, depthWrite: false, depthTest: false,
  });
  mwBgStars = new THREE.Points(bgGeo, bgMat);
  mwBgStars.renderOrder = -1;
  mwBgStars.frustumCulled = false;
  mwBgStars.visible = false;
  _scene.add(mwBgStars);

  // Hover ring (one shared mesh, repositioned on hover)
  const hoverRingGeo = new THREE.RingGeometry(0.85, 1.0, 64);
  const hoverRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false,
  });
  mwHoverRing = new THREE.Mesh(hoverRingGeo, hoverRingMat);
  mwHoverRing.visible = false;
  _scene.add(mwHoverRing);
}

// ── CSV parsing ──
// Single-pass parser for one HYG CSV row. Quoted fields preserve commas.
function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') inQ = false;
      else cur += c;
    } else if (c === ',') {
      out.push(cur); cur = "";
    } else if (c === '"') {
      inQ = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ── Load HYG and keep only the 1000 nearest stars (plus Sol) ──
async function loadHygNearest() {
  if (cachedStars) return cachedStars;
  const res = await fetch("./hyg_v42.csv");
  if (!res.ok) throw new Error("Failed to fetch hyg_v42.csv");
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const header = parseCSVLine(lines[0]);
  const col = (k) => header.indexOf(k);
  const idx = {
    id: col("id"), hip: col("hip"), proper: col("proper"),
    bayer: col("bayer"), flam: col("flam"), gl: col("gl"),
    dist: col("dist"), x: col("x"), y: col("y"), z: col("z"),
    spect: col("spect"), absmag: col("absmag"), mag: col("mag"),
    con: col("con"), lum: col("lum"), ci: col("ci"),
    ra: col("ra"), dec: col("dec"),
  };

  const all = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = parseCSVLine(line);
    const dist = parseFloat(f[idx.dist]);
    if (!isFinite(dist) || dist >= 100000) continue;
    all.push({
      id: f[idx.id],
      hip: f[idx.hip],
      gl: f[idx.gl],
      bayer: f[idx.bayer],
      flam: f[idx.flam],
      proper: (f[idx.proper] || "").trim(),
      dist,
      x: parseFloat(f[idx.x]),
      y: parseFloat(f[idx.y]),
      z: parseFloat(f[idx.z]),
      spect: f[idx.spect],
      absmag: parseFloat(f[idx.absmag]),
      mag: parseFloat(f[idx.mag]),
      lum: parseFloat(f[idx.lum]),
      ci: parseFloat(f[idx.ci]),
      ra: parseFloat(f[idx.ra]),
      dec: parseFloat(f[idx.dec]),
      con: f[idx.con],
    });
  }
  all.sort((a, b) => a.dist - b.dist);
  cachedStars = all.slice(0, NEAREST_COUNT + 1);
  return cachedStars;
}

// Best display name we can muster from the catalog
function displayName(s) {
  if (s.proper) return s.proper;
  if (s.bayer && s.con) return `${s.bayer} ${s.con}`;
  if (s.flam && s.con) return `${s.flam} ${s.con}`;
  if (s.gl) return `Gliese ${s.gl}`;
  if (s.hip) return `HIP ${s.hip}`;
  return `Star ${s.id}`;
}

// Logical visual size — base × spectral × log(luminosity) boost.
// This is the "intrinsic" pixel-size driver; the shader handles distance falloff.
function visualSize(spectral, lum) {
  const safeLum = isFinite(lum) && lum > 0 ? lum : 1;
  const lumBoost = Math.max(0.55, Math.min(2.4, 1.0 + 0.30 * Math.log10(safeLum)));
  return 28.0 * (spectral.sizeMultiplier || 1) * lumBoost;
}

// ── Shaders ───────────────────────────────────────────────────────────
// Each star is a single GL_POINT. The fragment shader paints a gorgeous
// star: tight near-white core, chromatic halo, four-point diffraction
// spikes (anamorphic flare). The vertex shader handles per-star twinkle
// and perspective size attenuation.
const VERT_SHADER = /* glsl */ `
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aPhase;
  attribute float aSpeed;

  uniform float uTime;
  uniform float uPixelScale;

  varying vec3  vColor;
  varying float vTwinkle;

  void main() {
    vColor = aColor;
    vTwinkle = 0.78 + 0.22 * sin(uTime * aSpeed + aPhase)
                    + 0.06 * sin(uTime * aSpeed * 2.7 + aPhase * 1.7);

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // Perspective size: aSize is roughly "pixels at unit depth".
    // Clamp so distant stars stay visible and very close ones don't blow up.
    float ps = aSize * uPixelScale / max(0.5, -mvPos.z);
    ps *= (0.85 + vTwinkle * 0.30);
    gl_PointSize = clamp(ps, 1.5, 240.0);
  }
`;

const FRAG_SHADER = /* glsl */ `
  precision highp float;
  varying vec3  vColor;
  varying float vTwinkle;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;

    // Tight bright core — sub-pixel pinpoint
    float core   = exp(-r2 * 240.0);
    // Chromatic-tinged inner halo
    float halo   = exp(-r2 * 24.0);
    // Wide soft glow that fades to nothing at the edge
    float bloom  = exp(-r2 * 5.0) * (1.0 - smoothstep(0.20, 0.50, sqrt(r2)));

    // Four-point diffraction spikes — long along axes, narrow across
    float ax = abs(d.x), ay = abs(d.y);
    float spikeH = exp(-ax * 4.0)  * exp(-ay * 90.0);
    float spikeV = exp(-ay * 4.0)  * exp(-ax * 90.0);
    float spikes = (spikeH + spikeV) * 0.55;

    float bright = (core * 1.6 + halo * 0.45 + bloom * 0.18 + spikes * 0.85) * vTwinkle;

    // Bleach the very center toward white, keep the halo tinted by stellar color.
    vec3 col = mix(vColor, vec3(1.0), pow(core, 0.55));
    // Subtle chromatic shift outward — cooler at the rim
    col -= vec3(0.0, 0.0, -0.02) * smoothstep(0.10, 0.25, sqrt(r2));

    gl_FragColor = vec4(col * bright, bright);
  }
`;

// ── Build the Points cloud ──
function buildPoints(records) {
  // Tear down any previous build (re-render after reload)
  if (mwPoints) {
    _scene.remove(mwPoints);
    mwPoints.geometry.dispose();
    if (pointMaterial) pointMaterial.dispose();
    mwPoints = null;
  }
  stars.length = 0;

  const N = records.length;
  const positions = new Float32Array(N * 3);
  const colors    = new Float32Array(N * 3);
  const sizes     = new Float32Array(N);
  const phases    = new Float32Array(N);
  const speeds    = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const s = records[i];
    const isSol = s.dist === 0 || s.proper === SOL_NAME;
    const spectral = isSol ? SPECTRAL_TYPES[2] : spectralTypeFromHyg(s.spect);

    const px = s.x * PARSEC_TO_UNITS;
    const py = s.y * PARSEC_TO_UNITS;
    const pz = s.z * PARSEC_TO_UNITS;

    positions[i * 3]     = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    const c = new THREE.Color(spectral.color);
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i]  = visualSize(spectral, s.lum) * (isSol ? 1.4 : 1.0);
    phases[i] = Math.random() * Math.PI * 2;
    // Distant/dim stars twinkle a bit faster — looks more "alive"
    speeds[i] = 0.6 + Math.random() * 1.6;

    stars.push({
      ...s,
      isSol,
      spectralLetter: spectral.type,
      px, py, pz,
      baseSize: sizes[i],
      tintColor: spectral.color,
    });
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("aColor",   new THREE.BufferAttribute(colors, 3));
  geom.setAttribute("aSize",    new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute("aPhase",   new THREE.BufferAttribute(phases, 1));
  geom.setAttribute("aSpeed",   new THREE.BufferAttribute(speeds, 1));

  pointMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uPixelScale: { value: pixelScaleForCamera() },
    },
    vertexShader:   VERT_SHADER,
    fragmentShader: FRAG_SHADER,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  mwPoints = new THREE.Points(geom, pointMaterial);
  mwPoints.frustumCulled = false;
  mwPoints.visible = false;
  _scene.add(mwPoints);
}

// Convert vertical FOV → "pixels per unit at depth=1" — keeps point sizes
// stable across viewport / FOV changes.
function pixelScaleForCamera() {
  if (!_camera) return 800;
  const halfFov = (_camera.fov * 0.5) * Math.PI / 180;
  return window.innerHeight / (2 * Math.tan(halfFov));
}

// ── Show / Hide ──
export async function showMilkyWay() {
  if (mwBgStars) mwBgStars.visible = true;
  const $loading = document.getElementById("mw-loading");
  if (!starsLoaded) {
    if (!loadStarted) {
      loadStarted = true;
      if ($loading) $loading.style.display = "";
      try {
        const records = await loadHygNearest();
        buildPoints(records);
        starsLoaded = true;
      } catch (err) {
        console.error("Milkyway load failed:", err);
        if ($loading) {
          $loading.querySelector("div").textContent = "Failed to load hyg_v42.csv";
        }
        return;
      }
      if ($loading) $loading.style.display = "none";
    } else {
      while (!starsLoaded) await new Promise(r => setTimeout(r, 100));
    }
  }
  if (mwPoints) mwPoints.visible = true;
}

export function hideMilkyWay() {
  if (mwPoints) mwPoints.visible = false;
  if (mwBgStars) mwBgStars.visible = false;
  if (mwHoverRing) mwHoverRing.visible = false;
  hoveredStar = null;
  if ($mwTooltip) $mwTooltip.style.display = "none";
  if (_renderer) _renderer.domElement.style.cursor = "";
}

// ── Animation ──
export function animateMilkyWay(t, dt, camPos) {
  if (mwBgStars) mwBgStars.position.copy(camPos);

  if (pointMaterial) {
    pointMaterial.uniforms.uTime.value = t;
    pointMaterial.uniforms.uPixelScale.value = pixelScaleForCamera();
  }

  if (mwHoverRing && mwHoverRing.visible && hoveredStar) {
    mwHoverRing.lookAt(_camera.position);
    mwHoverRing.material.opacity = 0.55 + 0.30 * Math.sin(t * 4);
    const camDist = _camera.position.distanceTo(mwHoverRing.position);
    const scale = camDist * 0.045 * (1.0 + 0.06 * Math.sin(t * 5));
    mwHoverRing.scale.setScalar(scale);
  }
}

// ── Hover via screen-space projection — fast and pixel-accurate ──
const _projVec = new THREE.Vector3();

export function updateMilkyWayHover(mouseNDC, lastMouseX, lastMouseY, isDragging) {
  if (isDragging || !mwPoints || !starsLoaded) return;

  let bestStar = null;
  let bestD2 = HOVER_NDC_THRESHOLD * HOVER_NDC_THRESHOLD;
  let bestZ = Infinity;

  for (const s of stars) {
    _projVec.set(s.px, s.py, s.pz).project(_camera);
    if (_projVec.z < -1 || _projVec.z > 1) continue;
    const dx = _projVec.x - mouseNDC.x;
    const dy = _projVec.y - mouseNDC.y;
    const d2 = dx * dx + dy * dy;
    // Within hit radius — among ties, prefer the closest (smaller projected z).
    if (d2 < bestD2 && (d2 < bestD2 * 0.6 || _projVec.z < bestZ)) {
      bestD2 = d2;
      bestZ  = _projVec.z;
      bestStar = s;
    }
  }

  if (bestStar !== hoveredStar) {
    hoveredStar = bestStar;
    if (hoveredStar) {
      mwHoverRing.position.set(hoveredStar.px, hoveredStar.py, hoveredStar.pz);
      mwHoverRing.material.color.set(hoveredStar.isSol ? 0xffffff : hoveredStar.tintColor);
      mwHoverRing.visible = true;
      if ($mwTooltip) {
        $mwTooltip.innerHTML = renderTooltip(hoveredStar);
        $mwTooltip.style.display = "";
      }
      _renderer.domElement.style.cursor = "pointer";
    } else {
      mwHoverRing.visible = false;
      if ($mwTooltip) $mwTooltip.style.display = "none";
      _renderer.domElement.style.cursor = "";
    }
  }

  if ($mwTooltip && hoveredStar) {
    $mwTooltip.style.left = (lastMouseX + 16) + "px";
    $mwTooltip.style.top  = (lastMouseY - 10) + "px";
  }
}

// ── Tooltip rendering ──
function fmt(n, digits = 2) {
  return isFinite(n) ? n.toFixed(digits) : "—";
}

function renderTooltip(s) {
  const ly = s.dist * 3.26156;
  const name = s.isSol ? SOL_NAME : displayName(s);
  const spect = s.isSol ? "G2V" : (s.spect || s.spectralLetter || "—");
  const con = constellationName(s.con);
  const lum = isFinite(s.lum) ? `${fmt(s.lum, s.lum < 1 ? 4 : 2)} L☉` : "—";
  const mag = fmt(s.mag, 2);
  const absmag = fmt(s.absmag, 2);
  return `
    <div class="text-white/95 text-sm font-medium">${escapeHtml(name)}</div>
    <div class="mt-1 text-[11px] text-white/55 leading-relaxed">
      <div><span class="text-white/40">Spectral</span> · ${escapeHtml(spect)}</div>
      <div><span class="text-white/40">Distance</span> · ${fmt(ly, 2)} ly · ${fmt(s.dist, 2)} pc</div>
      <div><span class="text-white/40">App. mag</span> · ${mag} &nbsp; <span class="text-white/40">Abs. mag</span> · ${absmag}</div>
      <div><span class="text-white/40">Constellation</span> · ${escapeHtml(con)}</div>
      <div><span class="text-white/40">Luminosity</span> · ${lum}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function getHoveredMWStar() { return hoveredStar; }
export const PARSECS_PER_UNIT = 1 / PARSEC_TO_UNITS;
