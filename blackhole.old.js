// ══════════════════════════════════════════════════════════════════════
// ██  BLACK HOLE — Interstellar-style Gargantua
// ══════════════════════════════════════════════════════════════════════
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { mulberry32 } from "./utils.js";

let _scene, _camera, _renderer;
let bhGroup = null;
let bhBgStars = null;

// Meshes we animate
let accretionDisk = null;
let lensedHaloTop = null;
let lensedHaloBottom = null;
let photonSphere = null;
let innerGlow = null;
let infallParticles = null;
let infallPositions = null;
let dopplerDisk = null;
let warpedStarfield = null;
let warpedStarPositions = null;
let warpedStarOrigPositions = null;
let einsteinRing = null;
let diskLightA = null;
let diskLightB = null;

// ── Constants ──
const BH_RADIUS = 6;          // Event horizon radius — big and imposing
const PHOTON_SPHERE_R = BH_RADIUS * 1.5;
const ISCO_R = BH_RADIUS * 3;  // Innermost stable circular orbit
const DISK_INNER = ISCO_R;
const DISK_OUTER = BH_RADIUS * 18;
const LENSED_HALO_INNER = BH_RADIUS * 1.02;
const LENSED_HALO_OUTER = BH_RADIUS * 1.8;

// ── Init ──
export function initBlackHole(scene, camera, renderer) {
  _scene = scene;
  _camera = camera;
  _renderer = renderer;
  createBlackHole();
  createBHBackground();
  createWarpedStarfield();
}

// ── BH Orbit Camera State ──
export const bhCam = {
  theta: 0.8,
  phi: Math.PI / 2.5,
  radius: 80,
  center: new THREE.Vector3(0, 0, 0),
  minRadius: BH_RADIUS * 2.5,
  maxRadius: 400,
  isDragging: false,
  prevX: 0,
  prevY: 0,
};

export function getBHCameraPosition() {
  const sinPhi = Math.sin(bhCam.phi);
  const cosPhi = Math.cos(bhCam.phi);
  const sinTheta = Math.sin(bhCam.theta);
  const cosTheta = Math.cos(bhCam.theta);
  return new THREE.Vector3(
    bhCam.center.x + bhCam.radius * sinPhi * cosTheta,
    bhCam.center.y + bhCam.radius * cosPhi,
    bhCam.center.z + bhCam.radius * sinPhi * sinTheta,
  );
}

// ═══════════════════════════════════════════════════════════════════
// CREATE BLACK HOLE
// ═══════════════════════════════════════════════════════════════════
function createBlackHole() {
  bhGroup = new THREE.Group();

  // ────────────────────────────────────────────────────────────────
  // 1. EVENT HORIZON — Pure black sphere, absorbs everything
  // ────────────────────────────────────────────────────────────────
  const ehGeo = new THREE.SphereGeometry(BH_RADIUS, 128, 128);
  const ehMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const eventHorizon = new THREE.Mesh(ehGeo, ehMat);
  eventHorizon.renderOrder = 10;
  bhGroup.add(eventHorizon);

  // ────────────────────────────────────────────────────────────────
  // 2. PHOTON SPHERE — Eerie glow at 1.5× Schwarzschild radius
  //    Light orbits here, creating a ghostly luminous shell
  // ────────────────────────────────────────────────────────────────
  const psGeo = new THREE.SphereGeometry(PHOTON_SPHERE_R, 128, 128);
  const psMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      viewVector: { value: new THREE.Vector3() },
      glowColor: { value: new THREE.Color(0.9, 0.7, 0.4) },
    },
    vertexShader: `
      uniform vec3 viewVector;
      varying float vIntensity;
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 vNormal = normalize(normalMatrix * normal);
        vec3 vView = normalize(normalMatrix * viewVector);
        float rim = 1.0 - abs(dot(vNormal, vView));
        vIntensity = pow(rim, 5.0) * 1.2;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float uTime;
      varying float vIntensity;
      varying vec3 vWorldPos;
      void main() {
        float flicker = 0.9 + 0.1 * sin(uTime * 3.0 + vWorldPos.x * 2.0 + vWorldPos.z * 2.0);
        float alpha = vIntensity * flicker;
        gl_FragColor = vec4(glowColor * 1.5, alpha * 0.7);
      }
    `,
  });
  photonSphere = new THREE.Mesh(psGeo, psMat);
  bhGroup.add(photonSphere);

  // ────────────────────────────────────────────────────────────────
  // 3. INNER FRESNEL GLOW — Backside dark-blue glow hugging horizon
  // ────────────────────────────────────────────────────────────────
  const igGeo = new THREE.SphereGeometry(BH_RADIUS * 1.08, 128, 128);
  const igMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      viewVector: { value: new THREE.Vector3() },
    },
    vertexShader: `
      uniform vec3 viewVector;
      varying float vIntensity;
      void main() {
        vec3 vNormal = normalize(normalMatrix * normal);
        vec3 vView = normalize(normalMatrix * viewVector);
        vIntensity = pow(0.85 - dot(vNormal, vView), 4.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vIntensity;
      void main() {
        vec3 col = mix(vec3(0.02, 0.02, 0.06), vec3(0.15, 0.1, 0.3), vIntensity);
        gl_FragColor = vec4(col, vIntensity * 0.6);
      }
    `,
  });
  innerGlow = new THREE.Mesh(igGeo, igMat);
  bhGroup.add(innerGlow);

  // ────────────────────────────────────────────────────────────────
  // 4. MAIN ACCRETION DISK — Thin, hot, Doppler-shifted
  //    The iconic flat disk in the equatorial plane
  // ────────────────────────────────────────────────────────────────
  const diskTex = createAccretionDiskTexture(2048);
  const diskGeo = new THREE.RingGeometry(DISK_INNER, DISK_OUTER, 512, 4);
  const diskMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMap: { value: diskTex },
      uTime: { value: 0 },
      uInner: { value: DISK_INNER },
      uOuter: { value: DISK_OUTER },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uTime;
      uniform float uInner;
      uniform float uOuter;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vec4 base = texture2D(uMap, vUv);

        // Radial distance for Doppler shift
        float r = length(vWorldPos.xz);
        float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);

        // Doppler beaming — approaching side brighter/bluer, receding dimmer/redder
        float angle = atan(vWorldPos.z, vWorldPos.x);
        float doppler = 0.7 + 0.3 * sin(angle + uTime * 0.4);

        // Temperature gradient: inner white-blue-hot, outer deep red
        vec3 hotColor = mix(vec3(1.0, 0.95, 0.9), vec3(0.8, 0.25, 0.05), t);
        vec3 color = hotColor * base.rgb * doppler * (1.4 - t * 0.6);

        // Fade edges
        float innerFade = smoothstep(0.0, 0.08, t);
        float outerFade = smoothstep(1.0, 0.85, t);
        float alpha = base.a * innerFade * outerFade * 0.9;

        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  accretionDisk = new THREE.Mesh(diskGeo, diskMat);
  accretionDisk.rotation.x = -Math.PI / 2;
  bhGroup.add(accretionDisk);

  // ────────────────────────────────────────────────────────────────
  // 5. GRAVITATIONAL LENSING HALO — The Interstellar signature
  //    The accretion disk image bent OVER the top and UNDER the
  //    bottom, forming a bright vertical ring/band
  // ────────────────────────────────────────────────────────────────
  lensedHaloTop = createLensedHalo(1);
  lensedHaloBottom = createLensedHalo(-1);
  bhGroup.add(lensedHaloTop);
  bhGroup.add(lensedHaloBottom);

  // ────────────────────────────────────────────────────────────────
  // 6. EINSTEIN RING — Subtle bright ring at the photon sphere
  // ────────────────────────────────────────────────────────────────
  const erGeo = new THREE.TorusGeometry(PHOTON_SPHERE_R * 1.05, 0.08, 16, 512);
  const erMat = new THREE.MeshBasicMaterial({
    color: 0xffe8c0,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  einsteinRing = new THREE.Mesh(erGeo, erMat);
  einsteinRing.rotation.x = Math.PI / 2;
  bhGroup.add(einsteinRing);

  // ────────────────────────────────────────────────────────────────
  // 7. DOPPLER-ENHANCED INNER RING — Bright asymmetric thin ring
  //    near ISCO showing relativistic beaming
  // ────────────────────────────────────────────────────────────────
  const drGeo = new THREE.TorusGeometry(ISCO_R * 1.02, 0.12, 16, 512);
  const drMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vWorldPos;
      void main() {
        float angle = atan(vWorldPos.z, vWorldPos.x);
        float bright = 0.5 + 0.5 * sin(angle + uTime * 0.8);
        bright = pow(bright, 1.5);
        vec3 col = mix(vec3(1.0, 0.4, 0.1), vec3(1.0, 0.95, 0.8), bright);
        gl_FragColor = vec4(col * 1.2, bright * 0.5 + 0.15);
      }
    `,
  });
  dopplerDisk = new THREE.Mesh(drGeo, drMat);
  dopplerDisk.rotation.x = -Math.PI / 2;
  bhGroup.add(dopplerDisk);

  // ────────────────────────────────────────────────────────────────
  // 8. INFALLING MATTER — 1500 hot particles spiraling inward
  // ────────────────────────────────────────────────────────────────
  const INFALL_COUNT = 1500;
  infallPositions = new Float32Array(INFALL_COUNT * 3);
  const infallColors = new Float32Array(INFALL_COUNT * 3);
  const rng = mulberry32(0xB401E1);

  for (let i = 0; i < INFALL_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const r = DISK_INNER + rng() * (DISK_OUTER - DISK_INNER);
    infallPositions[i * 3] = Math.cos(angle) * r;
    infallPositions[i * 3 + 1] = (rng() - 0.5) * 0.8;
    infallPositions[i * 3 + 2] = Math.sin(angle) * r;

    // Hot gradient: white-yellow inner → deep orange-red outer
    const t = (r - DISK_INNER) / (DISK_OUTER - DISK_INNER);
    infallColors[i * 3] = 1.0;
    infallColors[i * 3 + 1] = 0.85 - t * 0.55;
    infallColors[i * 3 + 2] = 0.7 - t * 0.65;
  }
  const infallGeo = new THREE.BufferGeometry();
  infallGeo.setAttribute("position", new THREE.Float32BufferAttribute(infallPositions, 3));
  infallGeo.setAttribute("color", new THREE.Float32BufferAttribute(infallColors, 3));
  const infallMat = new THREE.PointsMaterial({
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  infallParticles = new THREE.Points(infallGeo, infallMat);
  bhGroup.add(infallParticles);

  // ────────────────────────────────────────────────────────────────
  // 9. AMBIENT GLOW SHELLS — Soft warm light around the system
  // ────────────────────────────────────────────────────────────────
  const glow1Geo = new THREE.SphereGeometry(BH_RADIUS * 4, 32, 32);
  const glow1Mat = new THREE.MeshBasicMaterial({
    color: 0xcc6622,
    transparent: true,
    opacity: 0.03,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  bhGroup.add(new THREE.Mesh(glow1Geo, glow1Mat));

  const glow2Geo = new THREE.SphereGeometry(BH_RADIUS * 12, 32, 32);
  const glow2Mat = new THREE.MeshBasicMaterial({
    color: 0x442211,
    transparent: true,
    opacity: 0.012,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  bhGroup.add(new THREE.Mesh(glow2Geo, glow2Mat));

  // ────────────────────────────────────────────────────────────────
  // 10. LIGHTING
  // ────────────────────────────────────────────────────────────────
  diskLightA = new THREE.PointLight(0xff8844, 3.0, BH_RADIUS * 20);
  diskLightA.position.set(0, BH_RADIUS * 0.5, 0);
  bhGroup.add(diskLightA);

  diskLightB = new THREE.PointLight(0xff6622, 2.0, BH_RADIUS * 15);
  diskLightB.position.set(0, -BH_RADIUS * 0.5, 0);
  bhGroup.add(diskLightB);

  bhGroup.visible = false;
  _scene.add(bhGroup);
}

// ═══════════════════════════════════════════════════════════════════
// LENSED HALO — The vertical band of light (disk image bent by gravity)
// This is what makes Interstellar's black hole so distinctive
// ═══════════════════════════════════════════════════════════════════
function createLensedHalo(side) {
  // A shell that wraps over (or under) the event horizon, simulating
  // the gravitationally lensed image of the accretion disk
  const segments = 256;
  const radialSegments = 32;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let j = 0; j <= radialSegments; j++) {
    const v = j / radialSegments;
    const sweepAngle = v * Math.PI; // 0 to PI — front to back

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const ringAngle = u * Math.PI * 2;

      // Radius varies — thicker at sides, thinner at front/back
      const thicknessMod = 0.6 + 0.4 * Math.abs(Math.sin(sweepAngle));
      const px = Math.cos(ringAngle) * (BH_RADIUS * 1.05 + thicknessMod * 1.5);
      const py = side * Math.sin(sweepAngle) * (BH_RADIUS * 1.5 + thicknessMod * 0.5);
      const pz = Math.sin(ringAngle) * (BH_RADIUS * 1.05 + thicknessMod * 1.5);

      positions.push(px, py, pz);
      uvs.push(u, v);
    }
  }

  for (let j = 0; j < radialSegments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + segments + 1;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSide: { value: side },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uSide;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        // Brightness peaks at the "equator" of the sweep (side of BH)
        float sweep = vUv.y;
        float edgeBright = sin(sweep * 3.14159);
        edgeBright = pow(edgeBright, 0.8);

        // Azimuthal variation for texture
        float angle = atan(vWorldPos.z, vWorldPos.x);
        float pattern = 0.6 + 0.4 * sin(angle * 8.0 + uTime * 0.5 + sweep * 4.0);

        // Color: golden-white core with red edges
        vec3 coreColor = vec3(1.0, 0.88, 0.6);
        vec3 edgeColor = vec3(0.9, 0.35, 0.08);
        float radialFade = 1.0 - abs(sweep - 0.5) * 1.5;
        radialFade = clamp(radialFade, 0.0, 1.0);
        vec3 col = mix(edgeColor, coreColor, radialFade * pattern);

        // Doppler asymmetry
        float doppler = 0.6 + 0.4 * sin(angle + uTime * 0.3);

        float alpha = edgeBright * radialFade * pattern * doppler * 0.35;
        alpha = clamp(alpha, 0.0, 0.5);

        gl_FragColor = vec4(col * 1.3, alpha);
      }
    `,
  });

  return new THREE.Mesh(geo, mat);
}

// ═══════════════════════════════════════════════════════════════════
// ACCRETION DISK TEXTURE — High-res procedural
// ═══════════════════════════════════════════════════════════════════
function createAccretionDiskTexture(size) {
  const W = size, H = size;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const cx = W / 2, cy = H / 2;
  const innerFrac = DISK_INNER / DISK_OUTER;

  // Base radial gradient — temperature profile
  const grad = ctx.createRadialGradient(cx, cy, cx * innerFrac * 0.9, cx, cy, cx);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(innerFrac * 0.95, "rgba(0,0,0,0)");
  grad.addColorStop(innerFrac, "rgba(255,255,245,1.0)");
  grad.addColorStop(innerFrac + 0.03, "rgba(255,240,200,0.95)");
  grad.addColorStop(innerFrac + 0.08, "rgba(255,200,120,0.85)");
  grad.addColorStop(0.3, "rgba(255,140,50,0.7)");
  grad.addColorStop(0.5, "rgba(220,70,15,0.45)");
  grad.addColorStop(0.7, "rgba(150,30,5,0.2)");
  grad.addColorStop(0.85, "rgba(80,12,2,0.08)");
  grad.addColorStop(1.0, "rgba(20,3,0,0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(0xD15C01);

  // Turbulent streaks — density variations
  for (let i = 0; i < 800; i++) {
    const angle = rng() * Math.PI * 2;
    const r = (innerFrac + rng() * (1 - innerFrac)) * cx;
    const arcLen = rng() * 0.5 + 0.05;
    const t = (r / cx - innerFrac) / (1 - innerFrac);
    const brightness = rng() * 0.2 * (1 - t);
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + arcLen);
    const rr = 255;
    const gg = Math.floor(180 - t * 100 + rng() * 40);
    const bb = Math.floor(100 - t * 80 + rng() * 30);
    ctx.strokeStyle = `rgba(${rr},${gg},${bb},${brightness})`;
    ctx.lineWidth = 0.5 + rng() * 4;
    ctx.stroke();
  }

  // 5 tight spiral arms
  for (let arm = 0; arm < 5; arm++) {
    const baseAngle = arm * (Math.PI * 2 / 5) + rng() * 0.8;
    for (let j = 0; j < 200; j++) {
      const frac = j / 200;
      const r = (innerFrac + frac * (0.92 - innerFrac)) * cx;
      const spiralAngle = baseAngle + frac * Math.PI * 4;
      const px = cx + Math.cos(spiralAngle) * r;
      const py = cy + Math.sin(spiralAngle) * r;
      const t = frac;
      const alpha = (1 - t) * 0.25 + 0.02;
      const sz = 2 + (1 - t) * 7;
      ctx.beginPath();
      ctx.arc(px, py, sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,${Math.floor(220 - t * 140)},${Math.floor(120 - t * 100)},${alpha})`;
      ctx.fill();
    }
  }

  // Hot bright inner edge
  for (let i = 0; i < 600; i++) {
    const angle = (i / 600) * Math.PI * 2;
    const r = innerFrac * cx + rng() * 6;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    ctx.beginPath();
    ctx.arc(px, py, 1 + rng() * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,${Math.floor(220 + rng() * 35)},${0.2 + rng() * 0.3})`;
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  return tex;
}

// ═══════════════════════════════════════════════════════════════════
// WARPED STARFIELD — Stars near the BH appear gravitationally lensed
// ═══════════════════════════════════════════════════════════════════
function createWarpedStarfield() {
  const COUNT = 3000;
  warpedStarOrigPositions = new Float32Array(COUNT * 3);
  warpedStarPositions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const rng = mulberry32(0xA9F1E1);

  for (let i = 0; i < COUNT; i++) {
    const u = rng(), v = rng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = BH_RADIUS * 6 + rng() * BH_RADIUS * 40;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    warpedStarOrigPositions[i * 3] = x;
    warpedStarOrigPositions[i * 3 + 1] = y;
    warpedStarOrigPositions[i * 3 + 2] = z;
    warpedStarPositions[i * 3] = x;
    warpedStarPositions[i * 3 + 1] = y;
    warpedStarPositions[i * 3 + 2] = z;

    const tint = rng();
    if (tint < 0.3) {
      colors[i * 3] = 0.7; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 1.0;
    } else if (tint < 0.5) {
      colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 0.7;
    } else {
      colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(warpedStarPositions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
    vertexColors: true,
    depthWrite: false,
  });
  warpedStarfield = new THREE.Points(geo, mat);
  warpedStarfield.visible = false;
  warpedStarfield.frustumCulled = false;
  _scene.add(warpedStarfield);
}

// ═══════════════════════════════════════════════════════════════════
// BACKGROUND STARFIELD — Distant fixed stars
// ═══════════════════════════════════════════════════════════════════
function createBHBackground() {
  const BG_COUNT = 8000;
  const bgPos = new Float32Array(BG_COUNT * 3);
  const bgCol = new Float32Array(BG_COUNT * 3);
  const bgRng = mulberry32(0xB48601);
  for (let i = 0; i < BG_COUNT; i++) {
    const u = bgRng(), v = bgRng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    bgPos[i * 3]     = Math.sin(phi) * Math.cos(theta);
    bgPos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
    bgPos[i * 3 + 2] = Math.cos(phi);
    const tint = bgRng();
    if (tint < 0.2) {
      bgCol[i * 3] = 0.5 + bgRng() * 0.3; bgCol[i * 3 + 1] = 0.5 + bgRng() * 0.3; bgCol[i * 3 + 2] = 0.8 + bgRng() * 0.2;
    } else if (tint < 0.4) {
      bgCol[i * 3] = 0.8 + bgRng() * 0.2; bgCol[i * 3 + 1] = 0.7 + bgRng() * 0.2; bgCol[i * 3 + 2] = 0.4 + bgRng() * 0.2;
    } else {
      bgCol[i * 3] = 0.6 + bgRng() * 0.4; bgCol[i * 3 + 1] = 0.6 + bgRng() * 0.4; bgCol[i * 3 + 2] = 0.6 + bgRng() * 0.4;
    }
  }
  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.Float32BufferAttribute(bgPos, 3));
  bgGeo.setAttribute("color", new THREE.Float32BufferAttribute(bgCol, 3));
  const bgMat = new THREE.PointsMaterial({
    size: 1.0,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.6,
    vertexColors: true,
    depthWrite: false,
    depthTest: false,
  });
  bhBgStars = new THREE.Points(bgGeo, bgMat);
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
  // Reset camera to a cinematic angle
  bhCam.center.set(0, 0, 0);
  bhCam.theta = 0.8;
  bhCam.phi = Math.PI / 2.5;
  bhCam.radius = 80;
}

export function hideBlackHole() {
  if (bhGroup) bhGroup.visible = false;
  if (bhBgStars) bhBgStars.visible = false;
  if (warpedStarfield) warpedStarfield.visible = false;
}

// ═══════════════════════════════════════════════════════════════════
// ANIMATION
// ═══════════════════════════════════════════════════════════════════
export function animateBlackHole(t, dt, wasdKeys) {
  if (!bhGroup || !bhGroup.visible) return;

  // ── WASD Flying ──
  const flySpeed = dt * bhCam.radius * 0.4;
  const camPos0 = getBHCameraPosition();
  const fwd = new THREE.Vector3().subVectors(bhCam.center, camPos0).setY(0).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  if (wasdKeys.w) bhCam.center.addScaledVector(fwd, flySpeed);
  if (wasdKeys.s) bhCam.center.addScaledVector(fwd, -flySpeed);
  if (wasdKeys.a || wasdKeys.q) bhCam.center.addScaledVector(right, -flySpeed);
  if (wasdKeys.d || wasdKeys.e) bhCam.center.addScaledVector(right, flySpeed);
  if (wasdKeys.space) bhCam.center.y += flySpeed;
  if (wasdKeys.c) bhCam.center.y -= flySpeed;

  // ── Camera ──
  const camPos = getBHCameraPosition();
  _camera.position.copy(camPos);
  _camera.lookAt(bhCam.center);

  // ── Keep bg centered on camera ──
  if (bhBgStars) bhBgStars.position.copy(camPos);

  // ── Update shader uniforms ──
  const viewDir = new THREE.Vector3().subVectors(_camera.position, bhGroup.position).normalize();

  if (photonSphere) {
    photonSphere.material.uniforms.viewVector.value.copy(viewDir);
    photonSphere.material.uniforms.uTime.value = t;
  }
  if (innerGlow) {
    innerGlow.material.uniforms.viewVector.value.copy(viewDir);
  }
  if (accretionDisk) {
    accretionDisk.rotation.z += dt * 0.12;
    accretionDisk.material.uniforms.uTime.value = t;
  }
  if (lensedHaloTop) {
    lensedHaloTop.material.uniforms.uTime.value = t;
    lensedHaloTop.rotation.y += dt * 0.08;
  }
  if (lensedHaloBottom) {
    lensedHaloBottom.material.uniforms.uTime.value = t;
    lensedHaloBottom.rotation.y += dt * 0.08;
  }
  if (dopplerDisk) {
    dopplerDisk.material.uniforms.uTime.value = t;
    dopplerDisk.rotation.z += dt * 0.25;
  }
  if (einsteinRing) {
    einsteinRing.material.opacity = 0.25 + 0.10 * Math.sin(t * 2.0);
    const s = 1.0 + 0.015 * Math.sin(t * 1.2);
    einsteinRing.scale.setScalar(s);
  }

  // ── Infalling particles — Keplerian orbital motion ──
  if (infallParticles && infallPositions) {
    const posAttr = infallParticles.geometry.getAttribute("position");
    for (let i = 0; i < infallPositions.length / 3; i++) {
      let x = posAttr.array[i * 3];
      let y = posAttr.array[i * 3 + 1];
      let z = posAttr.array[i * 3 + 2];
      const r = Math.sqrt(x * x + z * z);
      if (r < DISK_INNER * 0.7) {
        const angle = Math.random() * Math.PI * 2;
        const newR = DISK_OUTER * (0.6 + Math.random() * 0.4);
        x = Math.cos(angle) * newR;
        z = Math.sin(angle) * newR;
        y = (Math.random() - 0.5) * 0.8;
      } else {
        const angle = Math.atan2(z, x);
        const orbitalSpeed = (BH_RADIUS * 2.5 / Math.sqrt(r)) * dt;
        const spiralSpeed = 0.4 * dt;
        const newAngle = angle + orbitalSpeed;
        const newR = r - spiralSpeed;
        x = Math.cos(newAngle) * newR;
        z = Math.sin(newAngle) * newR;
        y *= 0.998;
      }
      posAttr.array[i * 3] = x;
      posAttr.array[i * 3 + 1] = y;
      posAttr.array[i * 3 + 2] = z;
    }
    posAttr.needsUpdate = true;
  }

  // ── Warped starfield — gravitational lensing of nearby stars ──
  if (warpedStarfield && warpedStarOrigPositions) {
    const posAttr = warpedStarfield.geometry.getAttribute("position");
    const bhPos = bhGroup.position;
    for (let i = 0; i < warpedStarOrigPositions.length / 3; i++) {
      const ox = warpedStarOrigPositions[i * 3];
      const oy = warpedStarOrigPositions[i * 3 + 1];
      const oz = warpedStarOrigPositions[i * 3 + 2];
      const dx = ox - bhPos.x;
      const dy = oy - bhPos.y;
      const dz = oz - bhPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const deflectionRadius = BH_RADIUS * 8;
      if (dist < deflectionRadius) {
        const strength = Math.pow(1 - dist / deflectionRadius, 2) * BH_RADIUS * 3;
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const tx = -nz, tz = nx;
        const tLen = Math.sqrt(tx * tx + tz * tz) || 1;
        posAttr.array[i * 3] = ox + (tx / tLen) * strength;
        posAttr.array[i * 3 + 1] = oy + ny * strength * 0.3;
        posAttr.array[i * 3 + 2] = oz + (tz / tLen) * strength;
      } else {
        posAttr.array[i * 3] = ox;
        posAttr.array[i * 3 + 1] = oy;
        posAttr.array[i * 3 + 2] = oz;
      }
    }
    posAttr.needsUpdate = true;
  }

  // ── Disk light flicker ──
  if (diskLightA) diskLightA.intensity = 3.0 + 0.3 * Math.sin(t * 2.5);
  if (diskLightB) diskLightB.intensity = 2.0 + 0.2 * Math.sin(t * 3.1 + 1);
}

// ── Legacy export for compat ──
export function getBHBgStars() { return bhBgStars; }
