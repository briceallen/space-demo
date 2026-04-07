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
  200
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

// ── Planet Config ───────────────────────────────────────────────────
const PLANET_SPACING = 4;
const DEG = Math.PI / 180;

// Base yields per planet style (per day, before buildings)
const STYLE_YIELDS = {
  oceanic:      { energy: 2, minerals: 1, food: 4, research: 1, alloys: 0 },
  scattered:    { energy: 3, minerals: 4, food: 1, research: 1, alloys: 1 },
  continental:  { energy: 2, minerals: 2, food: 3, research: 2, alloys: 0 },
};

const planetConfigs = [
  {
    name: "blue",
    x: -PLANET_SPACING,
    surface: 0x1c2050,
    emissive: 0x101840,
    emissiveIntensity: 0.8,
    roughness: 1.0,
    metalness: 0.0,
    wire: 0x7088cc,
    glow: 0x4466dd,
    atmos: 0x5599ff,
    wireBase: 0.15,
    glowBase: 0.08,
    tiltX: 23.4 * DEG,
    tiltZ: 2 * DEG,
    style: "oceanic",
  },
  {
    name: "red",
    x: 0,
    surface: 0x3d1c22,
    emissive: 0x281010,
    emissiveIntensity: 0.7,
    roughness: 1.0,
    metalness: 0.0,
    wire: 0xbb7080,
    glow: 0xcc5566,
    atmos: 0xff7766,
    wireBase: 0.15,
    glowBase: 0.08,
    tiltX: 25.2 * DEG,
    tiltZ: -3 * DEG,
    style: "scattered",
  },
  {
    name: "green",
    x: PLANET_SPACING,
    surface: 0x1e3820,
    emissive: 0x102010,
    emissiveIntensity: 0.7,
    roughness: 1.0,
    metalness: 0.0,
    wire: 0x70bb80,
    glow: 0x55cc77,
    atmos: 0x66ff99,
    wireBase: 0.15,
    glowBase: 0.08,
    tiltX: 17.8 * DEG,
    tiltZ: 4 * DEG,
    style: "continental",
  },
];

// ── Seeded PRNG ─────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Continent Texture Generator (3D Perlin noise) ───────────────────
// Uses true 3D gradient noise sampled on the sphere surface.
// A 3D cubic grid can never align with a curved sphere, so no grid
// artifacts are visible. Domain warping adds organic irregularity.
function generateContinentTexture(baseHex, continentHex, seed, style) {
  const W = 1024, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${(baseHex >> 16) & 255},${(baseHex >> 8) & 255},${baseHex & 255})`;
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(seed);

  // Style presets: tune noise params per planet type
  const styles = {
    scattered:    { scale: 4.0, seaLevel: 0.02, edge: 0.06, warp: 0.9,  poleDrop: 0.25, tint: 0.4,  octaves: 5 },
    continental:  { scale: 3.0, seaLevel: 0.12, edge: 0.05, warp: 1.6,  poleDrop: 0.18, tint: 0.35, octaves: 5 },
    oceanic:      { scale: 1.5, seaLevel: 0.15, edge: 0.06, warp: 2.4,  poleDrop: 0.08, tint: 0.30, octaves: 3 },
  };
  const S = styles[style] || styles.scattered;

  // ── Seeded 3D gradient noise (Perlin-style) ──
  const N = 256;
  const perm = new Uint8Array(N * 2);
  // 12 evenly-distributed 3D gradient directions (cube edges)
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
    // Integer lattice coords
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    // Fractional part
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);
    // Quintic fade
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

    // Hash the 8 cube corners to gradient indices
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

    // Dot products at all 8 corners
    const d000 = dot3(AA,     fx,     fy,     fz);
    const d100 = dot3(BA,     fx - 1, fy,     fz);
    const d010 = dot3(AB,     fx,     fy - 1, fz);
    const d110 = dot3(BB,     fx - 1, fy - 1, fz);
    const d001 = dot3(AA + 1, fx,     fy,     fz - 1);
    const d101 = dot3(BA + 1, fx - 1, fy,     fz - 1);
    const d011 = dot3(AB + 1, fx,     fy - 1, fz - 1);
    const d111 = dot3(BB + 1, fx - 1, fy - 1, fz - 1);

    // Trilinear interpolation
    const x00 = d000 + u * (d100 - d000);
    const x10 = d010 + u * (d110 - d010);
    const x01 = d001 + u * (d101 - d001);
    const x11 = d011 + u * (d111 - d011);
    const y0 = x00 + v * (x10 - x00);
    const y1 = x01 + v * (x11 - x01);
    return y0 + w * (y1 - y0);
  }

  // ── fBm (configurable octaves of 3D noise) ──
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

  // ── Build height field on sphere with domain warping ──
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

      // Domain warp: displace sample point by noise for organic shapes
      const wx = sx + fbm3(sx + 3.1, sy + 7.5, sz + 1.3) * S.warp;
      const wy = sy + fbm3(sx + 11.7, sy + 4.2, sz + 8.6) * S.warp;
      const wz = sz + fbm3(sx + 6.9, sy + 0.8, sz + 5.4) * S.warp;

      field[py * W + px] = fbm3(wx, wy, wz);
    }
  }

  // Attenuate near poles
  for (let py = 0; py < H; py++) {
    const lat01 = py / H;
    const poleFade = Math.min(lat01 * 5, (1 - lat01) * 5, 1);
    for (let px = 0; px < W; px++) {
      field[py * W + px] -= (1 - poleFade) * S.poleDrop;
    }
  }

  // ── Paint ──
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

// ── Build Planets ───────────────────────────────────────────────────
const sphereGeo = new THREE.SphereGeometry(1, 64, 64);
const glowGeo = new THREE.SphereGeometry(1.18, 32, 32);
const atmosGeo = new THREE.SphereGeometry(1.06, 48, 48);

const planets = planetConfigs.map((cfg) => {
  const group = new THREE.Group();
  group.position.set(cfg.x, 0, 0);

  // ── Surface with baked continent texture ──
  const continentTex = generateContinentTexture(cfg.surface, cfg.wire, cfg.x * 77777 + 31, cfg.style);
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
  group.add(surface);

  // ── Atmosphere haze (additive feel) ──
  const atmosMat = new THREE.MeshBasicMaterial({
    color: cfg.atmos,
    transparent: true,
    opacity: 0.018,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
  group.add(atmosMesh);

  // ── Outer glow shell ──
  const glowMat = new THREE.MeshBasicMaterial({
    color: cfg.glow,
    transparent: true,
    opacity: cfg.glowBase,
    side: THREE.BackSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(glowGeo, glowMat));

  scene.add(group);

  // Build "home" quaternion from axial tilt
  const homeQuat = new THREE.Quaternion();
  const tiltQuatX = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    cfg.tiltX
  );
  const tiltQuatZ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    cfg.tiltZ
  );
  homeQuat.multiply(tiltQuatZ).multiply(tiltQuatX);

  return {
    name: cfg.name,
    group,
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
  };
});

// ── Sun / Star ──────────────────────────────────────────────────────
function generateSunTexture(seed) {
  const W = 512, H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const rng = mulberry32(seed);
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;

  // Warm granular base
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const grain = (rng() - 0.5) * 20;
      d[i]     = Math.min(255, Math.max(0, Math.round(255 + grain)));
      d[i + 1] = Math.min(255, Math.max(0, Math.round(200 + grain)));
      d[i + 2] = Math.min(255, Math.max(0, Math.round(60 + grain * 0.5)));
      d[i + 3] = 255;
    }
  }

  // Sunspots (3–5 seeded dark patches, umbra only)
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

const SUN_RADIUS = 2;
const SUN_X = -PLANET_SPACING * 3;
{
  const group = new THREE.Group();
  group.position.set(SUN_X, 0, 0);

  const sunTex = generateSunTexture(98765);
  const surfaceMat = new THREE.MeshBasicMaterial({
    map: sunTex, transparent: true, opacity: 1,
  });
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 64, 64), surfaceMat
  );
  group.add(surface);

  // Atmosphere (double planet atmos gap: 0.06 × 2 = 0.12)
  const atmosMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.012,
    side: THREE.FrontSide, depthWrite: false,
  });
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS + 0.12, 48, 48), atmosMat
  ));

  // Glow (double planet glow gap: 0.18 × 2 = 0.36)
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff9922, transparent: true, opacity: 0.05,
    side: THREE.BackSide, depthWrite: false,
  });
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS + 0.36, 32, 32), glowMat
  ));

  const sunLight = new THREE.PointLight(0xffeedd, 1.2, 60);
  sunLight.position.copy(group.position);
  scene.add(sunLight);
  scene.add(group);

  const homeQuat = new THREE.Quaternion();
  planets.push({
    name: "sun", group, surface, surfaceMat, atmosMat, glowMat,
    wireBase: 0, glowBase: 0.08,
    homeQuat: homeQuat.clone(), spinAngle: 0,
    rotationQuat: homeQuat.clone(), x: SUN_X,
    fade: 1, fadeTarget: 1, displaced: false,
    returning: false, returnAlpha: 0,
    returnStartQuat: new THREE.Quaternion(),
    radius: SUN_RADIUS,
  });
}
planets.forEach(p => { if (!p.radius) p.radius = 1; });

// ── Twinkling Starfield (multi-layer) ───────────────────────────────
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
scene.add(new THREE.Points(starGeo, starMat));

// ── View / Camera State ─────────────────────────────────────────────
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

let focusedPlanet = null;

const showAllBtn = document.getElementById("show-all-btn");

let focusOn = function(planet) {
  focusedPlanet = planet;
  const focusZ = CAM_FOCUS_Z * (planet.radius || 1);
  camTarget.set(planet.x, 0, focusZ);
  lookTarget.set(planet.x, 0, 0);
  showAllBtn.classList.add("visible");

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

  for (const p of planets) {
    p.fadeTarget = 1;
    p.group.visible = true;
  }
};

showAllBtn.addEventListener("click", () => showAll());

// ── Drag-to-rotate (focused planet) ────────────────────────────────
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

const canvas = renderer.domElement;

canvas.addEventListener("pointerdown", (e) => {
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.prevX = e.clientX;
  dragState.prevY = e.clientY;

  if (focusedPlanet) {
    dragState.isDragging = true;
    focusedPlanet.displaced = true;
    focusedPlanet.returning = false;
    focusedPlanet.returnAlpha = 0;
    canvas.setPointerCapture(e.pointerId);
  }
});

window.addEventListener("pointermove", (e) => {
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

// ── Resize ──────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Escape / Right-click to zoom out ────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && focusedPlanet) showAll();
});

window.addEventListener("contextmenu", (e) => {
  if (focusedPlanet) { e.preventDefault(); showAll(); }
});

// ── Helpers ─────────────────────────────────────────────────────────
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const tempQuat = new THREE.Quaternion();
const spinQuat = new THREE.Quaternion();
const AUTO_ROTATE_SPEED = 0.00105;

// ── Animation Loop ──────────────────────────────────────────────────
const clock = new THREE.Clock();
let lastFrameTime = 0;

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = t - lastFrameTime;
  lastFrameTime = t;

  // ── Per-planet update ──
  planets.forEach((p, i) => {
    // Fade
    p.fade += (p.fadeTarget - p.fade) * FADE_SPEED;
    if (p.fade < 0.001) { p.fade = 0; p.group.visible = false; }
    else { p.group.visible = true; }

    p.surfaceMat.opacity = p.fade;
    p.atmosMat.opacity = 0.018 * p.fade;
    p.glowMat.opacity = p.glowBase * p.fade;

    // Continuous Y-spin (skip if this planet is being dragged)
    const speed = AUTO_ROTATE_SPEED * (1 + i * 0.25);
    const isBeingDragged = (p === focusedPlanet && dragState.isDragging);
    if (!isBeingDragged) {
      p.spinAngle += speed;
    }

    // If returning to home orientation (triggered by showAll)
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
      // Drag is applying rotation – handled below
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
      // Consume velocity so planet stops if mouse stops moving
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
  return {
    started: true,
    day: 1,
    year: 1,
    speed: 1,       // 0=paused, 1=play
    resources: { energy: 100, minerals: 50, food: 50, research: 0, alloys: 0 },
    planets: planetConfigs.map(cfg => ({
      name: cfg.name,
      style: cfg.style,
      colonized: cfg.name === homePlanetName,
      population: cfg.name === homePlanetName ? 100 : 0,
      buildings: [],  // { type: string, built: bool, progress: number }
    })),
  };
}

// ── Save / Load ────────────────────────────────────────────────────
const SAVE_KEY = "endless-horizons-save";

function saveGame() {
  if (!gameState) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(gameState));
    // Brief flash on save button
    const btn = document.getElementById("btn-save");
    btn.textContent = "✓ Saved";
    setTimeout(() => { btn.innerHTML = "💾 Save"; }, 800);
  } catch (_) { /* quota exceeded — silently fail */ }
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
const $startScreen  = document.getElementById("start-screen");
const $selectPrompt = document.getElementById("select-prompt");
const $hudTop       = document.getElementById("hud-top");
const $planetPanel  = document.getElementById("planet-panel");
const $btnNewGame   = document.getElementById("btn-new-game");
const $btnLoadGame  = document.getElementById("btn-load-game");
const $btnSave      = document.getElementById("btn-save");
const $btnPause     = document.getElementById("btn-pause");
const $btnSpeed1    = document.getElementById("btn-speed1");
const $btnExport    = document.getElementById("btn-export");
const $btnImport    = document.getElementById("btn-import");

// ── Game Phases ────────────────────────────────────────────────────
let gamePhase = "title";  // "title" | "selecting" | "playing"

function enterTitle() {
  gamePhase = "title";
  $startScreen.classList.remove("hidden");
  $selectPrompt.classList.add("hidden-panel");
  $hudTop.classList.add("hidden-panel");
  $planetPanel.classList.add("hidden-panel");
  showAllBtn.classList.remove("visible");

  // Show continue button if save exists
  if (hasSave()) {
    $btnLoadGame.classList.remove("hidden");
  }
}

function enterSelecting() {
  gamePhase = "selecting";
  $startScreen.classList.add("hidden");
  $selectPrompt.classList.remove("hidden-panel");
  $hudTop.classList.add("hidden-panel");
  $planetPanel.classList.add("hidden-panel");
  showAllBtn.classList.remove("visible");

  // Reset to system view
  showAll();
}

function enterPlaying() {
  gamePhase = "playing";
  $startScreen.classList.add("hidden");
  $selectPrompt.classList.add("hidden-panel");
  $hudTop.classList.remove("hidden-panel");
  updateHUD();

  // Start at system view
  showAll();
}

// ── Speed Controls ─────────────────────────────────────────────────
const speedBtns = [$btnPause, $btnSpeed1];
const speedVals = [0, 1];

function setSpeed(val) {
  if (!gameState) return;
  gameState.speed = val;
  // Highlight active button
  const active = "text-emerald-400 border-emerald-400/30";
  speedBtns.forEach((btn, i) => {
    if (speedVals[i] === val) btn.className = btn.className.replace(/text-\S+/g, "") + " " + active;
    else btn.className = btn.className.replace(/text-emerald-400/g, "").replace(/border-emerald-400\/30/g, "");
  });
}

speedBtns.forEach((btn, i) => btn.addEventListener("click", () => setSpeed(speedVals[i])));

// ── Game Tick ──────────────────────────────────────────────────────
const TICK_INTERVAL = 1.0; // Seconds per game-day at 1x speed
let tickAccum = 0;

function gameTick() {
  if (!gameState || gameState.speed === 0) return;

  // Compute total yields across all colonized planets
  const rates = { energy: 0, minerals: 0, food: 0, research: 0, alloys: 0 };

  for (const gp of gameState.planets) {
    if (!gp.colonized) continue;

    // Base yields from style
    const base = STYLE_YIELDS[gp.style] || STYLE_YIELDS.scattered;
    for (const k in base) rates[k] += base[k];

    // Building yields (only completed buildings)
    for (const b of gp.buildings) {
      if (!b.built) {
        // Advance construction
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

    // Population growth: +1 per 10 food surplus per day (simple)
    const foodSurplus = rates.food; // snapshot
    if (foodSurplus > 0 && gp.population > 0) {
      gp.population += Math.floor(foodSurplus / 10) || 0;
      // Slow natural growth too
      if (gameState.day % 5 === 0) gp.population += 1;
    }
  }

  // Apply yields to stockpiles
  for (const k in rates) {
    gameState.resources[k] = Math.max(0, Math.round((gameState.resources[k] + rates[k]) * 100) / 100);
  }

  // Store rates for HUD display
  gameState._rates = rates;

  // Advance calendar
  gameState.day++;
  if (gameState.day > 360) {
    gameState.day = 1;
    gameState.year++;
  }

  // Auto-save every 30 days
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

  // Total population
  const totalPop = gameState.planets.reduce((s, p) => s + p.population, 0);
  document.getElementById("hud-pop").textContent = totalPop.toLocaleString();
}

// ── Planet Panel ───────────────────────────────────────────────────
function updatePlanetPanel(planet3d) {
  if (!gameState || gamePhase !== "playing") {
    $planetPanel.classList.add("hidden-panel");
    return;
  }

  // Find matching game-state planet (skip sun)
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

  // Yields
  const yieldsEl = document.getElementById("pp-yields");
  const base = STYLE_YIELDS[gp.style] || {};
  yieldsEl.innerHTML = "";
  const yieldIcons = { energy: "⚡", minerals: "⛏", food: "🌾", research: "🔬", alloys: "⚙" };
  for (const k in base) {
    if (base[k] === 0) continue;
    yieldsEl.innerHTML += `<div>${yieldIcons[k]} ${k}</div><div class="text-right text-emerald-400/80">+${base[k]}</div>`;
  }

  // Buildings
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

  // Build buttons
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

  // Wire build button clicks
  buildBtnsEl.querySelectorAll("[data-build]").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.build;
      const def = BUILDING_DEFS[type];
      const canAfford = Object.entries(def.cost).every(([r, v]) => gameState.resources[r] >= v);
      if (!canAfford || gp.buildings.length >= MAX_SLOTS) return;

      // Deduct cost
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
  // During planet selection phase, clicking a planet (not sun) starts the game
  if (gamePhase === "selecting" && planet.name !== "sun") {
    gameState = newGameState(planet.name);
    enterPlaying();
    _origFocusOn(planet);
    updatePlanetPanel(planet);
    return;
  }

  if (gamePhase === "playing") {
    _origFocusOn(planet);
    updatePlanetPanel(planet);
    return;
  }

  // In title phase, ignore clicks
};

const _origShowAll = showAll;
showAll = function() {
  _origShowAll();
  $planetPanel.classList.add("hidden-panel");
};

// Rebind is handled by the arrow wrapper on the original listener

// ── Start Screen Buttons ───────────────────────────────────────────
$btnNewGame.addEventListener("click", () => enterSelecting());

$btnLoadGame.addEventListener("click", () => {
  const saved = loadGame();
  if (saved) {
    gameState = saved;
    enterPlaying();
  }
});

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

// ── Integrate game tick into animation loop ────────────────────────
// (Injected directly into the animate() function above)

// ── Boot ───────────────────────────────────────────────────────────
enterTitle();
animate();
