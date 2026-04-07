// ══════════════════════════════════════════════════════════════════════
// ██  BLACK HOLE — Interstellar Gargantua — Physics-Inspired Rendering
// ══════════════════════════════════════════════════════════════════════
//
//  Key visual features modeled after Kip Thorne / Double Negative's Gargantua:
//   • Thin accretion disk in the equatorial plane with Doppler beaming
//   • Gravitationally-lensed secondary image of the disk arcing OVER and
//     UNDER the shadow — the iconic bright vertical band
//   • Photon sphere edge glow at 1.5 Rs
//   • Einstein ring
//   • Gravitational light-bending distortion of background stars
//   • No jets (Gargantua was a quiescent Kerr black hole)
//   • Bloom-compatible emissive values for UnrealBloomPass
//
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { mulberry32 } from "./utils.js";

// ── Module state ──
let _scene, _camera, _renderer;
let bhGroup = null;
let bhBgStars = null;

// Animated components
let accretionDisk = null;
let secondaryDiskTop = null;
let secondaryDiskBottom = null;
let photonSphereGlow = null;
let innerGlow = null;
let einsteinRing = null;
let dopplerRing = null;
let infallParticles = null;
let infallPositions = null;
let warpedStarfield = null;
let warpedStarOrigPositions = null;
let diskLightA = null;
let diskLightB = null;

// ── Physical constants (in scene units) ──
const RS = 6;                      // Schwarzschild radius (event horizon)
const PHOTON_R = RS * 1.5;        // Photon sphere
const ISCO_R = RS * 3;            // Innermost stable circular orbit
const DISK_INNER = ISCO_R;
const DISK_OUTER = RS * 20;       // Big, sweeping disk
const SHADOW_R = RS * 2.6;        // Visual shadow (√27 / 2 ≈ 2.6 Rs for Schwarzschild)

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
  center: new THREE.Vector3(0, 0, 0),
  minRadius: RS * 2.5,
  maxRadius: 500,
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
  // 1. EVENT HORIZON — perfectly black sphere
  // ──────────────────────────────────────────────────────────────
  const ehMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const eventHorizon = new THREE.Mesh(
    new THREE.SphereGeometry(RS, 128, 128), ehMat
  );
  eventHorizon.renderOrder = 10;
  bhGroup.add(eventHorizon);

  // Shadow catcher — slightly larger, pure black, to sharpen the silhouette
  const shadowSphere = new THREE.Mesh(
    new THREE.SphereGeometry(SHADOW_R, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 })
  );
  shadowSphere.renderOrder = 9;
  bhGroup.add(shadowSphere);

  // ──────────────────────────────────────────────────────────────
  // 2. PHOTON SPHERE GLOW — Rim-lit shell at 1.5 Rs
  //    The eerie thin bright edge you see in Interstellar
  // ──────────────────────────────────────────────────────────────
  const psGeo = new THREE.SphereGeometry(PHOTON_R, 128, 128);
  const psMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      viewVector: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      uniform vec3 viewVector;
      varying float vIntensity;
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 vNormal = normalize(normalMatrix * normal);
        vec3 vView = normalize(normalMatrix * viewVector);
        float rim = 1.0 - abs(dot(vNormal, vView));
        // Very sharp falloff — only the thin edge glows
        vIntensity = pow(rim, 6.0) * 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vIntensity;
      varying vec3 vWorldPos;
      void main() {
        // Warm golden-white glow with subtle flicker
        float flicker = 0.92 + 0.08 * sin(uTime * 4.0 + vWorldPos.x * 3.0 + vWorldPos.z * 3.0);
        vec3 col = vec3(1.0, 0.85, 0.55) * 2.0; // HDR emissive for bloom
        float alpha = vIntensity * flicker;
        alpha = clamp(alpha, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha * 0.8);
      }
    `,
  });
  photonSphereGlow = new THREE.Mesh(psGeo, psMat);
  bhGroup.add(photonSphereGlow);

  // ──────────────────────────────────────────────────────────────
  // 3. INNER FRESNEL — dark blue-violet hugging the horizon
  // ──────────────────────────────────────────────────────────────
  const igGeo = new THREE.SphereGeometry(RS * 1.06, 128, 128);
  const igMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: { viewVector: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      uniform vec3 viewVector;
      varying float vIntensity;
      void main() {
        vec3 vN = normalize(normalMatrix * normal);
        vec3 vV = normalize(normalMatrix * viewVector);
        vIntensity = pow(0.82 - dot(vN, vV), 4.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vIntensity;
      void main() {
        vec3 col = mix(vec3(0.01, 0.01, 0.04), vec3(0.12, 0.06, 0.25), vIntensity);
        gl_FragColor = vec4(col, vIntensity * 0.5);
      }
    `,
  });
  innerGlow = new THREE.Mesh(igGeo, igMat);
  bhGroup.add(innerGlow);

  // ──────────────────────────────────────────────────────────────
  // 4. MAIN ACCRETION DISK — equatorial plane
  //    Doppler beaming via custom ShaderMaterial
  // ──────────────────────────────────────────────────────────────
  const diskTex = createDiskTexture(2048);
  const diskGeo = new THREE.RingGeometry(DISK_INNER, DISK_OUTER, 512, 6);
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
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uTime;
      uniform float uInner;
      uniform float uOuter;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        vec4 base = texture2D(uMap, vUv);
        float r = length(vWorldPos.xz);
        float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);

        // Doppler beaming: approaching side boosted blueward, receding dimmed redward
        float angle = atan(vWorldPos.z, vWorldPos.x);
        float dopplerFactor = 0.55 + 0.45 * sin(angle + uTime * 0.35);
        float dopplerBoost = pow(dopplerFactor, 3.0); // Relativistic I ∝ δ³

        // Temperature gradient (blackbody-inspired)
        vec3 innerColor = vec3(1.0, 0.98, 0.92);   // White-hot
        vec3 midColor   = vec3(1.0, 0.65, 0.25);    // Golden
        vec3 outerColor = vec3(0.6, 0.15, 0.03);    // Deep red
        vec3 tempColor;
        if (t < 0.3) {
          tempColor = mix(innerColor, midColor, t / 0.3);
        } else {
          tempColor = mix(midColor, outerColor, (t - 0.3) / 0.7);
        }

        vec3 color = tempColor * base.rgb * dopplerBoost * 2.0; // HDR

        float innerFade = smoothstep(0.0, 0.06, t);
        float outerFade = smoothstep(1.0, 0.82, t);
        float alpha = base.a * innerFade * outerFade * 0.92;

        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  accretionDisk = new THREE.Mesh(diskGeo, diskMat);
  accretionDisk.rotation.x = -Math.PI / 2;
  bhGroup.add(accretionDisk);

  // ──────────────────────────────────────────────────────────────
  // 5. GRAVITATIONAL LENSING — Secondary disk images
  //    The signature Interstellar look: the disk's image bent over
  //    the top and under the bottom of the black hole shadow
  // ──────────────────────────────────────────────────────────────
  secondaryDiskTop = buildSecondaryDisk(1);
  secondaryDiskBottom = buildSecondaryDisk(-1);
  bhGroup.add(secondaryDiskTop);
  bhGroup.add(secondaryDiskBottom);

  // ──────────────────────────────────────────────────────────────
  // 6. EINSTEIN RING — thin bright ring at the photon sphere
  // ──────────────────────────────────────────────────────────────
  const erGeo = new THREE.TorusGeometry(PHOTON_R * 1.04, 0.06, 16, 512);
  const erMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.0, 1.7, 1.2), // HDR for bloom
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  einsteinRing = new THREE.Mesh(erGeo, erMat);
  einsteinRing.rotation.x = Math.PI / 2;
  bhGroup.add(einsteinRing);

  // ──────────────────────────────────────────────────────────────
  // 7. DOPPLER INNER RING — Bright asymmetric ring near ISCO
  // ──────────────────────────────────────────────────────────────
  const drGeo = new THREE.TorusGeometry(ISCO_R * 1.01, 0.15, 16, 512);
  const drMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorldPos;
      void main() {
        float angle = atan(vWorldPos.z, vWorldPos.x);
        float bright = 0.5 + 0.5 * sin(angle + uTime * 0.7);
        bright = pow(bright, 2.0);
        vec3 col = mix(vec3(1.5, 0.5, 0.1), vec3(2.0, 1.8, 1.4), bright); // HDR
        gl_FragColor = vec4(col, bright * 0.55 + 0.1);
      }
    `,
  });
  dopplerRing = new THREE.Mesh(drGeo, drMat);
  dopplerRing.rotation.x = -Math.PI / 2;
  bhGroup.add(dopplerRing);

  // ──────────────────────────────────────────────────────────────
  // 8. INFALLING PARTICLES — 2000 spiraling into the disk
  // ──────────────────────────────────────────────────────────────
  const INFALL_N = 2000;
  infallPositions = new Float32Array(INFALL_N * 3);
  const infallColors = new Float32Array(INFALL_N * 3);
  const rng = mulberry32(0xB401E1);
  for (let i = 0; i < INFALL_N; i++) {
    const a = rng() * Math.PI * 2;
    const r = DISK_INNER + rng() * (DISK_OUTER - DISK_INNER);
    infallPositions[i * 3] = Math.cos(a) * r;
    infallPositions[i * 3 + 1] = (rng() - 0.5) * 1.0;
    infallPositions[i * 3 + 2] = Math.sin(a) * r;
    const t = (r - DISK_INNER) / (DISK_OUTER - DISK_INNER);
    infallColors[i * 3] = 1.0;
    infallColors[i * 3 + 1] = 0.9 - t * 0.6;
    infallColors[i * 3 + 2] = 0.75 - t * 0.7;
  }
  const infGeo = new THREE.BufferGeometry();
  infGeo.setAttribute("position", new THREE.Float32BufferAttribute(infallPositions, 3));
  infGeo.setAttribute("color", new THREE.Float32BufferAttribute(infallColors, 3));
  const infMat = new THREE.PointsMaterial({
    size: 0.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  infallParticles = new THREE.Points(infGeo, infMat);
  bhGroup.add(infallParticles);

  // ──────────────────────────────────────────────────────────────
  // 9. GLOW SHELLS
  // ──────────────────────────────────────────────────────────────
  // Close hot halo
  bhGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(RS * 5, 32, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.5, 0.6, 0.2), // HDR
      transparent: true, opacity: 0.025,
      side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  ));
  // Wide ambient
  bhGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(RS * 14, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0x331508,
      transparent: true, opacity: 0.01,
      side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  ));

  // ──────────────────────────────────────────────────────────────
  // 10. LIGHTING
  // ──────────────────────────────────────────────────────────────
  diskLightA = new THREE.PointLight(0xff9944, 4.0, RS * 25);
  diskLightA.position.set(0, RS * 0.5, 0);
  bhGroup.add(diskLightA);
  diskLightB = new THREE.PointLight(0xff6622, 2.5, RS * 18);
  diskLightB.position.set(0, -RS * 0.5, 0);
  bhGroup.add(diskLightB);

  bhGroup.visible = false;
  _scene.add(bhGroup);
}

// ═══════════════════════════════════════════════════════════════════
// SECONDARY DISK (Lensed halo) — the Interstellar signature
//
// Builds a curved ribbon mesh that represents the gravitationally
// lensed secondary image of the accretion disk wrapping over/under
// the black hole shadow. Each point on this ribbon is positioned
// at radius ≈ SHADOW_R, sweeping from the front of the hole (phi=0)
// over the pole to the back (phi=PI).
// ═══════════════════════════════════════════════════════════════════
function buildSecondaryDisk(side) {
  const PHI_SEGS = 64;   // how many steps from front → back
  const THETA_SEGS = 256; // around the ring

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let j = 0; j <= PHI_SEGS; j++) {
    const phi = (j / PHI_SEGS) * Math.PI; // 0 → PI
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    // Ring radius varies: thicker at the "sides" (phi ≈ PI/2)
    // thinner at front/back — mimicking the caustic
    const thicknessProfile = 0.5 + 0.5 * sinPhi;
    const halfWidth = RS * 0.3 + thicknessProfile * RS * 1.2;

    for (let i = 0; i <= THETA_SEGS; i++) {
      const theta = (i / THETA_SEGS) * Math.PI * 2;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);

      // Base ring in xz-plane at radius ≈ SHADOW_R
      const bx = cosT * (SHADOW_R + halfWidth * 0.15);
      const bz = sinT * (SHADOW_R + halfWidth * 0.15);

      // Lift by phi around the hole (above + below for side)
      const py = side * sinPhi * (RS * 1.6 + thicknessProfile * RS * 0.3);
      // Pull inward at top of arc
      const squeeze = 1 - 0.12 * sinPhi;
      const px = bx * squeeze;
      const pz = bz * squeeze;

      positions.push(px, py, pz);
      uvs.push(i / THETA_SEGS, j / PHI_SEGS);
    }
  }

  for (let j = 0; j < PHI_SEGS; j++) {
    for (let i = 0; i < THETA_SEGS; i++) {
      const a = j * (THETA_SEGS + 1) + i;
      const b = a + THETA_SEGS + 1;
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
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSide;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        float sweep = vUv.y; // 0=front, 1=back
        // Peaked brightness at phi ≈ PI/2 (top of arc)
        float arcBright = sin(sweep * 3.14159);
        arcBright = pow(arcBright, 0.6);

        // Azimuthal structure (streaks in the disk image)
        float angle = atan(vWorldPos.z, vWorldPos.x);
        float streaks = 0.55 + 0.45 * sin(angle * 12.0 + uTime * 0.4 + sweep * 5.0);
        float fine = 0.85 + 0.15 * sin(angle * 40.0 + sweep * 20.0);
        float pattern = streaks * fine;

        // Color: very in Interstellar, the secondary image was golden-orange
        vec3 coreColor = vec3(2.0, 1.6, 1.0);     // HDR bright gold
        vec3 edgeColor = vec3(1.5, 0.45, 0.08);    // Deep orange

        float radialFade = 1.0 - abs(sweep - 0.5) * 1.6;
        radialFade = clamp(radialFade, 0.0, 1.0);

        vec3 col = mix(edgeColor, coreColor, radialFade * pattern);

        // Doppler asymmetry
        float doppler = 0.5 + 0.5 * sin(angle + uTime * 0.25);
        doppler = pow(doppler, 1.5);

        // Slight noise variation
        float n = random(vUv * 50.0 + uTime * 0.1);

        float alpha = arcBright * radialFade * (pattern * 0.7 + 0.3)
                     * (doppler * 0.6 + 0.4)
                     * (0.9 + n * 0.1)
                     * 0.40;
        alpha = clamp(alpha, 0.0, 0.6);

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  return new THREE.Mesh(geo, mat);
}

// ═══════════════════════════════════════════════════════════════════
// DISK TEXTURE — 2048px procedural accretion disk
// ═══════════════════════════════════════════════════════════════════
function createDiskTexture(size) {
  const W = size, H = size;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const cx = W / 2, cy = H / 2;
  const innerFrac = DISK_INNER / DISK_OUTER;

  // Base radial gradient — blackbody temperature profile T ∝ r^(-3/4)
  const grad = ctx.createRadialGradient(cx, cy, cx * innerFrac * 0.85, cx, cy, cx);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(innerFrac * 0.92, "rgba(0,0,0,0)");
  grad.addColorStop(innerFrac, "rgba(255,255,248,1.0)");
  grad.addColorStop(innerFrac + 0.02, "rgba(255,245,210,0.97)");
  grad.addColorStop(innerFrac + 0.06, "rgba(255,210,130,0.9)");
  grad.addColorStop(0.25, "rgba(255,155,55,0.75)");
  grad.addColorStop(0.40, "rgba(240,90,20,0.55)");
  grad.addColorStop(0.55, "rgba(180,50,10,0.35)");
  grad.addColorStop(0.70, "rgba(120,25,5,0.15)");
  grad.addColorStop(0.85, "rgba(60,10,2,0.06)");
  grad.addColorStop(1.0, "rgba(15,3,0,0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(0xD15C01);

  // Turbulent rings — MHD-inspired density fluctuations
  for (let i = 0; i < 1200; i++) {
    const angle = rng() * Math.PI * 2;
    const rFrac = innerFrac + rng() * (1 - innerFrac);
    const r = rFrac * cx;
    const arcLen = rng() * 0.4 + 0.03;
    const t = (rFrac - innerFrac) / (1 - innerFrac);
    const brightness = rng() * 0.22 * (1 - t * 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + arcLen);
    const rr = 255;
    const gg = Math.floor(190 - t * 110 + rng() * 30);
    const bb = Math.floor(110 - t * 90 + rng() * 25);
    ctx.strokeStyle = `rgba(${rr},${gg},${bb},${brightness})`;
    ctx.lineWidth = 0.3 + rng() * 5;
    ctx.stroke();
  }

  // 6 logarithmic spiral arms
  for (let arm = 0; arm < 6; arm++) {
    const baseAngle = arm * (Math.PI * 2 / 6) + rng() * 1.0;
    for (let j = 0; j < 250; j++) {
      const f = j / 250;
      const r = (innerFrac + f * (0.93 - innerFrac)) * cx;
      const spiralAngle = baseAngle + f * Math.PI * 5; // tighter spirals
      const px = cx + Math.cos(spiralAngle) * r;
      const py = cy + Math.sin(spiralAngle) * r;
      const t = f;
      const alpha = (1 - t) * 0.28 + 0.01;
      const sz = 1.5 + (1 - t) * 8;
      ctx.beginPath();
      ctx.arc(px, py, sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,${Math.floor(230 - t * 160)},${Math.floor(130 - t * 110)},${alpha})`;
      ctx.fill();
    }
  }

  // Bright ISCO edge — sharp white-hot ring
  for (let i = 0; i < 800; i++) {
    const angle = (i / 800) * Math.PI * 2;
    const jitter = rng() * 8;
    const r = innerFrac * cx + jitter;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    ctx.beginPath();
    ctx.arc(px, py, 0.8 + rng() * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,${Math.floor(230 + rng() * 25)},${0.25 + rng() * 0.35})`;
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(16, _renderer.capabilities.getMaxAnisotropy());
  return tex;
}

// ═══════════════════════════════════════════════════════════════════
// WARPED STARFIELD — gravitational lensing of nearby stars
// ═══════════════════════════════════════════════════════════════════
function buildWarpedStarfield() {
  const N = 4000;
  warpedStarOrigPositions = new Float32Array(N * 3);
  const warpedStarPositions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const rng = mulberry32(0xA9F1E1);

  for (let i = 0; i < N; i++) {
    const u = rng(), v = rng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = RS * 5 + rng() * RS * 50;
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
    if (tint < 0.25) {
      colors[i * 3] = 0.65; colors[i * 3 + 1] = 0.75; colors[i * 3 + 2] = 1.0;
    } else if (tint < 0.45) {
      colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.88; colors[i * 3 + 2] = 0.65;
    } else {
      colors[i * 3] = 0.95; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 0.95;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(warpedStarPositions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  warpedStarfield = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.45,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    vertexColors: true,
    depthWrite: false,
  }));
  warpedStarfield.visible = false;
  warpedStarfield.frustumCulled = false;
  _scene.add(warpedStarfield);
}

// ═══════════════════════════════════════════════════════════════════
// BACKGROUND STARS — distant fixed field
// ═══════════════════════════════════════════════════════════════════
function buildBackground() {
  const N = 10000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const rng = mulberry32(0xB48601);
  for (let i = 0; i < N; i++) {
    const u = rng(), v = rng();
    const th = u * Math.PI * 2;
    const ph = Math.acos(2 * v - 1);
    pos[i * 3]     = Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = Math.cos(ph);
    const t = rng();
    if (t < 0.2) {
      col[i*3]=0.5+rng()*0.3; col[i*3+1]=0.5+rng()*0.3; col[i*3+2]=0.8+rng()*0.2;
    } else if (t < 0.4) {
      col[i*3]=0.8+rng()*0.2; col[i*3+1]=0.7+rng()*0.2; col[i*3+2]=0.4+rng()*0.2;
    } else {
      col[i*3]=0.6+rng()*0.4; col[i*3+1]=0.6+rng()*0.4; col[i*3+2]=0.6+rng()*0.4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  bhBgStars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.9,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.65,
    vertexColors: true,
    depthWrite: false,
    depthTest: false,
  }));
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
  bhCam.radius = 90;
}

export function hideBlackHole() {
  if (bhGroup) bhGroup.visible = false;
  if (bhBgStars) bhBgStars.visible = false;
  if (warpedStarfield) warpedStarfield.visible = false;
}

// ═══════════════════════════════════════════════════════════════════
// ANIMATION  (called every frame from main.js)
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

  // ── Camera ──
  const camPos = getBHCameraPosition();
  _camera.position.copy(camPos);
  _camera.lookAt(bhCam.center);

  // Background tracks camera
  if (bhBgStars) bhBgStars.position.copy(camPos);

  // ── Shader uniforms ──
  const viewDir = new THREE.Vector3().subVectors(_camera.position, bhGroup.position).normalize();

  if (photonSphereGlow) {
    photonSphereGlow.material.uniforms.viewVector.value.copy(viewDir);
    photonSphereGlow.material.uniforms.uTime.value = t;
  }
  if (innerGlow) {
    innerGlow.material.uniforms.viewVector.value.copy(viewDir);
  }
  if (accretionDisk) {
    accretionDisk.rotation.z += dt * 0.10;
    accretionDisk.material.uniforms.uTime.value = t;
  }
  if (secondaryDiskTop) {
    secondaryDiskTop.material.uniforms.uTime.value = t;
    secondaryDiskTop.rotation.y += dt * 0.06;
  }
  if (secondaryDiskBottom) {
    secondaryDiskBottom.material.uniforms.uTime.value = t;
    secondaryDiskBottom.rotation.y += dt * 0.06;
  }
  if (dopplerRing) {
    dopplerRing.material.uniforms.uTime.value = t;
    dopplerRing.rotation.z += dt * 0.22;
  }
  if (einsteinRing) {
    einsteinRing.material.opacity = 0.30 + 0.15 * Math.sin(t * 1.8);
    einsteinRing.scale.setScalar(1.0 + 0.012 * Math.sin(t * 1.0));
  }

  // ── Infalling particles — Keplerian orbits ──
  if (infallParticles && infallPositions) {
    const pa = infallParticles.geometry.getAttribute("position");
    const n = infallPositions.length / 3;
    for (let i = 0; i < n; i++) {
      let x = pa.array[i*3], y = pa.array[i*3+1], z = pa.array[i*3+2];
      const r = Math.sqrt(x*x + z*z);
      if (r < DISK_INNER * 0.65) {
        const a = Math.random() * Math.PI * 2;
        const nr = DISK_OUTER * (0.5 + Math.random() * 0.5);
        x = Math.cos(a) * nr;
        z = Math.sin(a) * nr;
        y = (Math.random() - 0.5) * 1.0;
      } else {
        const angle = Math.atan2(z, x);
        const orbital = (RS * 2.8 / Math.sqrt(r)) * dt;
        const spiral = 0.35 * dt;
        const na = angle + orbital;
        const nr = r - spiral;
        x = Math.cos(na) * nr;
        z = Math.sin(na) * nr;
        y *= 0.997;
      }
      pa.array[i*3] = x;
      pa.array[i*3+1] = y;
      pa.array[i*3+2] = z;
    }
    pa.needsUpdate = true;
  }

  // ── Warped starfield — gravitational deflection ──
  if (warpedStarfield && warpedStarOrigPositions) {
    const pa = warpedStarfield.geometry.getAttribute("position");
    const bx = bhGroup.position.x, by = bhGroup.position.y, bz = bhGroup.position.z;
    const deflR = RS * 10;
    const n = warpedStarOrigPositions.length / 3;
    for (let i = 0; i < n; i++) {
      const ox = warpedStarOrigPositions[i*3];
      const oy = warpedStarOrigPositions[i*3+1];
      const oz = warpedStarOrigPositions[i*3+2];
      const dx = ox - bx, dy = oy - by, dz = oz - bz;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < deflR && dist > 0.1) {
        // Deflection ∝ (1 - d/R)² — approximate Schwarzschild deflection
        const strength = Math.pow(1 - dist / deflR, 2) * RS * 4;
        const nx = dx/dist, nz = dz/dist;
        // Tangent in xz plane (cross with up)
        const tx = -nz, tz = nx;
        const tLen = Math.sqrt(tx*tx + tz*tz) || 1;
        pa.array[i*3]   = ox + (tx/tLen) * strength;
        pa.array[i*3+1] = oy + (dy/dist) * strength * 0.3;
        pa.array[i*3+2] = oz + (tz/tLen) * strength;
      } else {
        pa.array[i*3] = ox;
        pa.array[i*3+1] = oy;
        pa.array[i*3+2] = oz;
      }
    }
    pa.needsUpdate = true;
  }

  // ── Light flicker ──
  if (diskLightA) diskLightA.intensity = 4.0 + 0.4 * Math.sin(t * 2.3);
  if (diskLightB) diskLightB.intensity = 2.5 + 0.25 * Math.sin(t * 3.0 + 1);
}

// ── Legacy export ──
export function getBHBgStars() { return bhBgStars; }
