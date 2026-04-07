// ══════════════════════════════════════════════════════════════════════
// ██  BLACK HOLE — Interstellar Gargantua — Ultra Quality
// ══════════════════════════════════════════════════════════════════════
//
//  Visual reference: Double Negative / Kip Thorne's Gargantua
//   • Full bright accretion disk in equatorial plane
//   • Thin gravitationally-lensed band arcing over/under the shadow
//   • Photon ring — razor-thin bright edge at the shadow boundary
//   • Subtle Doppler beaming (approaching side ~40 % brighter)
//   • High-quality round star sprites (not squares)
//   • Gravitational deflection of nearby stars
//   • Bloom-compatible HDR emissive values
//   • No visible "shell" artifacts — all effects are edge/rim only
//
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { mulberry32 } from "./utils.js";

// ── module state ──
let _scene, _camera, _renderer;
let bhGroup = null;
let bhBgStars = null;

// animated refs
let infallParticles = null;
let warpedStarfield = null;
let warpedStarOrigPos = null;

// ── Physical constants (exported for ray-march shader) ──
export const RS = 6;
export const PHOTON_R = RS * 1.5;
export const ISCO_R = RS * 3;
export const DISK_INNER = ISCO_R;
export const DISK_OUTER = RS * 30;
export const SHADOW_R = RS * 2.6;          // apparent shadow ≈ (3√3/2)M

// ─── Circular point sprite texture ───────────────────────────────
// Shared by all particle systems for perfectly round stars
let _circleSprite = null;
function getCircleSprite() {
  if (_circleSprite) return _circleSprite;
  const sz = 64;
  const c = document.createElement("canvas");
  c.width = sz; c.height = sz;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  g.addColorStop(0,   "rgba(255,255,255,1.0)");
  g.addColorStop(0.15,"rgba(255,255,255,0.95)");
  g.addColorStop(0.5, "rgba(255,255,255,0.35)");
  g.addColorStop(0.8, "rgba(255,255,255,0.06)");
  g.addColorStop(1,   "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  _circleSprite = new THREE.CanvasTexture(c);
  return _circleSprite;
}

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
export function initBlackHole(scene, camera, renderer) {
  _scene = scene;
  _camera = camera;
  _renderer = renderer;
  buildBlackHole();
  buildBackground();
  buildWarpedStarfield();
}

// ═══════════════════════════════════════════════════════════════════
// ORBIT CAMERA
// ═══════════════════════════════════════════════════════════════════
export const bhCam = {
  theta: 1.2,
  phi: Math.PI / 2.8,
  radius: 90,
  roll: 0,
  center: new THREE.Vector3(0, 0, 0),
  minRadius: RS * 2.5,
  maxRadius: 5000,
  isDragging: false,
  prevX: 0,
  prevY: 0,
};

export function getBHCameraPosition() {
  const sp = Math.sin(bhCam.phi), cp = Math.cos(bhCam.phi);
  const st = Math.sin(bhCam.theta), ct = Math.cos(bhCam.theta);
  return new THREE.Vector3(
    bhCam.center.x + bhCam.radius * sp * ct,
    bhCam.center.y + bhCam.radius * cp,
    bhCam.center.z + bhCam.radius * sp * st,
  );
}

// ═══════════════════════════════════════════════════════════════════
// BUILD BLACK HOLE
// ═══════════════════════════════════════════════════════════════════
function buildBlackHole() {
  bhGroup = new THREE.Group();

  // ──────────────────────────────────────────────────────────────
  // EVENT HORIZON — black sphere at the apparent shadow size.
  // Depth-writes so it occludes infalling particles behind it.
  // The accretion disk is now rendered as a fullscreen ray-march
  // ShaderPass in main.js — no geometry here.
  // ──────────────────────────────────────────────────────────────
  const eventHorizon = new THREE.Mesh(
    new THREE.SphereGeometry(SHADOW_R, 128, 128),
    new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: true })
  );
  eventHorizon.renderOrder = 10;
  bhGroup.add(eventHorizon);

  // ──────────────────────────────────────────────────────────────
  // INFALLING PARTICLES — orbital tracers in the disk plane
  bhGroup.visible = false;
  _scene.add(bhGroup);
}

// ═══════════════════════════════════════════════════════════════════
// INFALL PARTICLES — orbital tracers in the disk plane
// Uses custom ShaderMaterial for round, glowing particles
// ═══════════════════════════════════════════════════════════════════
function buildInfallParticles() {
  const N = 2500;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const rng = mulberry32(0xB401E1);

  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2;
    const r = DISK_INNER + rng() * (DISK_OUTER - DISK_INNER);
    pos[i*3]   = Math.cos(a) * r;
    pos[i*3+1] = (rng() - 0.5) * 0.6;
    pos[i*3+2] = Math.sin(a) * r;

    const t = (r - DISK_INNER) / (DISK_OUTER - DISK_INNER);
    col[i*3]   = 1.0;
    col[i*3+1] = 0.88 - t * 0.5;
    col[i*3+2] = 0.65 - t * 0.55;

    sizes[i] = 0.15 + rng() * 0.25;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: _renderer.getPixelRatio() },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio * (200.0 / -mv.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 40.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float soft = 1.0 - d * d;  // quadratic falloff
        soft = pow(soft, 1.5);
        gl_FragColor = vec4(vColor * 1.5, soft * 0.55);
      }
    `,
  });

  infallParticles = new THREE.Points(geo, mat);
  bhGroup.add(infallParticles);
}

// ═══════════════════════════════════════════════════════════════════
// WARPED STARFIELD — gravitational deflection of nearby stars.
// Custom ShaderMaterial for perfectly round, soft-glow sprites.
// ═══════════════════════════════════════════════════════════════════
function buildWarpedStarfield() {
  const N = 10000;
  warpedStarOrigPos = new Float32Array(N * 3);
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const rng = mulberry32(0xA9F1E1);

  for (let i = 0; i < N; i++) {
    const u = rng(), v = rng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = RS * 4 + rng() * RS * 60;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    warpedStarOrigPos[i*3] = x;
    warpedStarOrigPos[i*3+1] = y;
    warpedStarOrigPos[i*3+2] = z;
    pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;

    const tint = rng();
    const brightness = 0.7 + rng() * 0.3;
    if (tint < 0.15) {
      col[i*3]=0.55*brightness; col[i*3+1]=0.70*brightness; col[i*3+2]=1.0*brightness;
    } else if (tint < 0.35) {
      col[i*3]=1.0*brightness; col[i*3+1]=0.88*brightness; col[i*3+2]=0.58*brightness;
    } else {
      col[i*3]=0.92*brightness; col[i*3+1]=0.92*brightness; col[i*3+2]=0.95*brightness;
    }
    const sizeRng = rng();
    if (sizeRng < 0.03) {
      sizes[i] = 1.2 + rng() * 1.0;
    } else {
      sizes[i] = 0.4 + rng() * 0.8;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: _renderer.getPixelRatio() },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio * (120.0 / -mv.z);
        gl_PointSize = clamp(gl_PointSize, 1.5, 32.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float bright = 1.0 - d * d;
        bright = pow(bright, 2.0);
        gl_FragColor = vec4(vColor, bright * 0.8);
      }
    `,
  });

  warpedStarfield = new THREE.Points(geo, mat);
  warpedStarfield.visible = false;
  warpedStarfield.frustumCulled = false;
  _scene.add(warpedStarfield);
}

// ═══════════════════════════════════════════════════════════════════
// BACKGROUND STARS — distant fixed sky sphere, round soft sprites
// ═══════════════════════════════════════════════════════════════════
function buildBackground() {
  const N = 25000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const rng = mulberry32(0xB48601);

  for (let i = 0; i < N; i++) {
    const u = rng(), v = rng();
    const th = u * Math.PI * 2;
    const ph = Math.acos(2 * v - 1);
    pos[i*3]   = Math.sin(ph) * Math.cos(th);
    pos[i*3+1] = Math.sin(ph) * Math.sin(th);
    pos[i*3+2] = Math.cos(ph);

    // Spectral class color distribution
    const t = rng();
    const brightness = 0.6 + rng() * 0.4;
    if (t < 0.08) {
      // Hot blue-white O/B stars
      col[i*3]=0.6*brightness; col[i*3+1]=0.7*brightness; col[i*3+2]=1.0*brightness;
    } else if (t < 0.20) {
      // Blue-white A stars
      col[i*3]=0.75*brightness; col[i*3+1]=0.82*brightness; col[i*3+2]=1.0*brightness;
    } else if (t < 0.45) {
      // White F/G stars (Sun-like)
      col[i*3]=1.0*brightness; col[i*3+1]=0.97*brightness; col[i*3+2]=0.90*brightness;
    } else if (t < 0.65) {
      // Yellow K stars
      col[i*3]=1.0*brightness; col[i*3+1]=0.85*brightness; col[i*3+2]=0.55*brightness;
    } else if (t < 0.80) {
      // Orange/red M stars
      col[i*3]=1.0*brightness; col[i*3+1]=0.65*brightness; col[i*3+2]=0.35*brightness;
    } else {
      // Pure white
      col[i*3]=0.90*brightness; col[i*3+1]=0.90*brightness; col[i*3+2]=0.92*brightness;
    }

    // More variation in star sizes — rarer bright ones
    const sizeRng = rng();
    if (sizeRng < 0.02) {
      sizes[i] = 2.5 + rng() * 2.0; // rare bright stars
    } else if (sizeRng < 0.10) {
      sizes[i] = 1.5 + rng() * 1.5;
    } else {
      sizes[i] = 0.5 + rng() * 1.2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));

  // Custom shader for round sprites even though sizeAttenuation is off
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    vertexColors: true,
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        gl_PointSize = aSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float bright = 1.0 - d * d;
        bright = pow(bright, 1.8);
        gl_FragColor = vec4(vColor, bright * 0.72);
      }
    `,
  });

  bhBgStars = new THREE.Points(geo, mat);
  bhBgStars.renderOrder = -1;
  bhBgStars.frustumCulled = false;
  bhBgStars.visible = false;
  _scene.add(bhBgStars);
}

// ═══════════════════════════════════════════════════════════════════
// SHOW / HIDE
// ═══════════════════════════════════════════════════════════════════
export function showBlackHole() {
  if (bhGroup) bhGroup.visible = true;
  if (bhBgStars) bhBgStars.visible = true;
  if (warpedStarfield) warpedStarfield.visible = true;
  bhCam.center.set(0, 0, 0);
  bhCam.theta = 1.2;
  bhCam.phi = Math.PI / 2.8;
  bhCam.radius = 160;
  bhCam.roll = 0;
}

export function hideBlackHole() {
  if (bhGroup) bhGroup.visible = false;
  if (bhBgStars) bhBgStars.visible = false;
  if (warpedStarfield) warpedStarfield.visible = false;
}

// ═══════════════════════════════════════════════════════════════════
// ANIMATE — called every frame from main.js
// ═══════════════════════════════════════════════════════════════════
export function animateBlackHole(t, dt, wasdKeys) {
  if (!bhGroup || !bhGroup.visible) return;

  // ── WASD flying ──
  const flySpeed = dt * bhCam.radius * 0.4;
  const camPos0 = getBHCameraPosition();
  const fwd = new THREE.Vector3().subVectors(bhCam.center, camPos0).setY(0).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize();
  if (wasdKeys.w) bhCam.center.addScaledVector(fwd, flySpeed);
  if (wasdKeys.s) bhCam.center.addScaledVector(fwd, -flySpeed);
  if (wasdKeys.a || wasdKeys.q) bhCam.center.addScaledVector(right, -flySpeed);
  if (wasdKeys.d || wasdKeys.e) bhCam.center.addScaledVector(right, flySpeed);
  if (wasdKeys.space) bhCam.center.y += flySpeed;
  if (wasdKeys.c) bhCam.center.y -= flySpeed;

  // ── R/F — roll camera around view axis ──
  const rollSpeed = dt * 1.5;
  if (wasdKeys.r) bhCam.roll -= rollSpeed;
  if (wasdKeys.f) bhCam.roll += rollSpeed;

  // ── Camera — smooth equator crossing ──
  const camPos = getBHCameraPosition();
  _camera.position.copy(camPos);
  // Apply roll: rotate the default up vector around the forward axis
  const fwdCam = new THREE.Vector3().subVectors(bhCam.center, camPos).normalize();
  const baseUp = new THREE.Vector3(0, 1, 0);
  baseUp.applyAxisAngle(fwdCam, bhCam.roll);
  _camera.up.copy(baseUp);
  _camera.lookAt(bhCam.center);

  // BG tracks camera
  if (bhBgStars) bhBgStars.position.copy(camPos);

  // ── Shader time updates ──
  // (Disk geometry removed — ray-march ShaderPass in main.js handles it)



  // ── Warped starfield — gravitational deflection ──
  if (warpedStarfield && warpedStarOrigPos) {
    const pa = warpedStarfield.geometry.getAttribute("position");
    const bx = bhGroup.position.x, by = bhGroup.position.y, bz = bhGroup.position.z;
    const deflR = RS * 12;
    const n = warpedStarOrigPos.length / 3;
    for (let i = 0; i < n; i++) {
      const ox = warpedStarOrigPos[i*3];
      const oy = warpedStarOrigPos[i*3+1];
      const oz = warpedStarOrigPos[i*3+2];
      const dx = ox - bx, dy = oy - by, dz = oz - bz;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < deflR && dist > 0.1) {
        const strength = Math.pow(1 - dist / deflR, 2) * RS * 5;
        const nx = dx/dist, nz = dz/dist;
        const tx = -nz, tz = nx;
        const tLen = Math.sqrt(tx*tx + tz*tz) || 1;
        pa.array[i*3]   = ox + (tx/tLen) * strength;
        pa.array[i*3+1] = oy + (dy/dist) * strength * 0.3;
        pa.array[i*3+2] = oz + (tz/tLen) * strength;
      } else {
        pa.array[i*3]   = ox;
        pa.array[i*3+1] = oy;
        pa.array[i*3+2] = oz;
      }
    }
    pa.needsUpdate = true;
  }
}

// Legacy
export function getBHBgStars() { return bhBgStars; }
