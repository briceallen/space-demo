// ══════════════════════════════════════════════════════════════════════
// ██  MAIN — Scene, Camera, Events, Animation Loop, Boot
// ══════════════════════════════════════════════════════════════════════
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { EffectComposer } from "https://unpkg.com/three@0.164.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://unpkg.com/three@0.164.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://unpkg.com/three@0.164.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "https://unpkg.com/three@0.164.0/examples/jsm/postprocessing/ShaderPass.js";
import { mulberry32, generateStarName, easeInOut } from "./utils.js";
import { buildStarSystem } from "./starSystem.js";
import {
  initCluster, generateGalaxyStars, showCluster, hideCluster,
  animateClusterVisuals, updateClusterHover, getHoveredStar,
  setLastVisitedStar, getLastVisitedStar,
} from "./cluster.js";
import {
  initBlackHole, showBlackHole, hideBlackHole, animateBlackHole,
  bhCam, getBHCameraPosition,
  RS, SHADOW_R, DISK_INNER, DISK_OUTER,
} from "./blackhole.js";
import {
  getGameState, setGameState, newGameState, saveGame, loadGame,
  gameTick, updateHUD, updatePlanetPanel, initSpeedControls,
  addBookmark, updateBookmarkDropdown, exportSave, importSave,
  TICK_INTERVAL,
} from "./game.js";

// ── Scene, Camera, Renderer ────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010108);
scene.fog = new THREE.FogExp2(0x010108, 0.008);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);

// ── Post-processing (used for Black Hole view) ─────────────────────
const bhRT = new THREE.WebGLRenderTarget(
  window.innerWidth * renderer.getPixelRatio(),
  window.innerHeight * renderer.getPixelRatio(),
  { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat }
);
const bhComposer = new EffectComposer(renderer, bhRT);
bhComposer.addPass(new RenderPass(scene, camera, null, new THREE.Color(0x000000), 1.0));

// ── Ray-Marched Gravitational Lensing — Gargantua Accretion Disk ───
// Fullscreen shader that traces rays through Schwarzschild spacetime.
// The accretion disk is a flat plane at y=0; the "wrapping" over the
// top and bottom of the shadow is a purely optical effect from light
// following curved geodesics around the black hole.
const bhLensShader = {
  uniforms: {
    tDiffuse:       { value: null },                      // scene (stars/particles)
    uTime:          { value: 0 },
    uRS:            { value: RS },
    uShadowR:       { value: SHADOW_R },
    uDiskInner:     { value: DISK_INNER },
    uDiskOuter:     { value: DISK_OUTER },
    uCamPos:        { value: new THREE.Vector3() },
    uCamTarget:     { value: new THREE.Vector3() },
    uFov:           { value: 60.0 },
    uAspect:        { value: window.innerWidth / window.innerHeight },
    uInvProjMatrix: { value: new THREE.Matrix4() },
    uCamMatrix:     { value: new THREE.Matrix4() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uRS;
    uniform float uShadowR;
    uniform float uDiskInner;
    uniform float uDiskOuter;
    uniform vec3  uCamPos;
    uniform float uFov;
    uniform float uAspect;
    uniform mat4  uInvProjMatrix;
    uniform mat4  uCamMatrix;
    varying vec2 vUv;

    // ── Noise — value noise + FBM for organic disk texture ──
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n = i.x + i.y * 57.0;
      return mix(
        mix(hash(n), hash(n + 1.0), f.x),
        mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p * 2.1;
        a *= 0.5;
      }
      return v;
    }

    // ── Disk color — Gargantua cinematic warm palette ──
    // Hot white-yellow inner, rich golden mid, deep amber outer
    vec3 diskColor(float t) {
      vec3 inner  = vec3(1.0, 0.95, 0.85);   // hot near-white
      vec3 mid1   = vec3(1.0, 0.88, 0.62);   // bright gold
      vec3 mid2   = vec3(0.98, 0.72, 0.42);  // rich amber
      vec3 outer  = vec3(0.78, 0.50, 0.28);  // deep warm brown
      if (t < 0.15) return mix(inner, mid1, smoothstep(0.0, 0.15, t));
      if (t < 0.45) return mix(mid1, mid2, smoothstep(0.15, 0.45, t));
      return mix(mid2, outer, smoothstep(0.45, 1.0, t));
    }

    // ── Disk shading — Gargantua-style smooth flowing accretion ──
    vec4 sampleDisk(vec3 hitPos, float order) {
      float r = length(hitPos.xz);
      if (r < uDiskInner || r > uDiskOuter) return vec4(0.0);

      float t = (r - uDiskInner) / (uDiskOuter - uDiskInner);
      float angle = atan(hitPos.z, hitPos.x);

      vec3 col = diskColor(t);

      // ── Radial brightness — uniform for most of disk, gentle dim at outer edge ──
      float radialGlow = t < 0.65
        ? 0.90 + 0.10 * (1.0 - t / 0.65)
        : 0.90 * pow(1.0 - (t - 0.65) / 0.35, 0.5);

      // ── Keplerian shear flow ──
      float orbSpeed = 1.0 / (sqrt(r) + 0.5);
      float drift = uTime * orbSpeed * 0.55;

      // ── Smooth turbulence — continuous noise, no thresholds/rings ──
      float sa = sin(angle + drift);
      float ca = cos(angle + drift);

      // Layered noise at different scales, all continuous (no smoothstep)
      float n1 = fbm(vec2(sa * 3.5 + ca * 2.5, r * 0.22 + 3.0));
      float n2 = fbm(vec2(sa * 6.0 - ca * 4.0 + 7.0, r * 0.35 + 10.0));
      float n3 = fbm(vec2(sa * 10.0 + ca * 7.0 + 14.0, r * 0.50 + 18.0));

      // Pure continuous blend — weighted noise layers
      float turb = n1 * 0.50 + n2 * 0.30 + n3 * 0.20;
      // Visible dark features everywhere, stronger toward outer edge
      float variation = 0.20 + t * 0.40;
      float diskDensity = 1.0 - (1.0 - turb) * variation;

      // ── Azimuthal filaments — hair-like flow-aligned structure ──
      float azimTurb = fbm(vec2(
        angle * 4.0 + sin(r * 0.3) * 2.0,
        r * 0.6 + drift * 0.15
      ));
      // ── Radial dust lanes — soft organic dark lanes ──
      float radialTurb = fbm(vec2(
        r * 1.2 + sin(angle * 3.0) * 0.5,
        angle * 2.0 + drift * 0.2
      ));
      // Combine: smooth azimuthal flow + softer radial lanes
      float filaments = mix(
        0.78 + 0.22 * azimTurb,
        0.65 + 0.35 * radialTurb * radialTurb,
        0.25
      );

      float pattern = diskDensity * filaments;

      // ── Doppler — very subtle, nearly uniform brightness ──
      float doppler = 0.93 + 0.07 * sin(angle + uTime * 0.12);

      // Both direct and lensed arcs at equal brightness
      float orderFade = (order < 2.5) ? 1.0 : 0.7;

      // ── Final color — cinematic, detail from organic patterns ──
      vec3 color = col * radialGlow * doppler * pattern * 0.90 * orderFade;

      // ── Two-stage outer edge: structure preserved + soft feather to space ──
      float innerFade = smoothstep(0.0, 0.08, t);
      float outerEdge = smoothstep(1.0, 0.92, t);     // sharp definition
      float outerFeather = smoothstep(1.0, 0.55, t);   // soft glow
      float outerFade = mix(outerEdge, outerFeather, 0.6);
      // Slight boost in mid-outer zone (0.5–0.85) for richer disk
      float midBoost = 1.0 + 0.12 * smoothstep(0.45, 0.70, t) * smoothstep(0.90, 0.70, t);
      float alpha = clamp(innerFade * outerFade * midBoost * 1.3, 0.0, 1.0) * orderFade;

      return vec4(color, alpha);
    }

    // ── High-quality procedural deep-space background ──
    // Cinematic Milky Way + rich nebulae + sharp individual stars
    // All in spherical coordinates so gravitational lensing works

    // Better hash for sharp stars — returns [0,1]
    float hash2(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
      p3 += dot(p3, p3.yzx + 19.19);
      return fract((p3.x + p3.y) * p3.z);
    }
    vec2 hash22(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
      p3 += dot(p3, p3.yzx + 19.19);
      return fract(vec2((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y));
    }

    // Voronoi-based sharp stars — each cell has one possible star
    float starLayer(vec2 uv, float density, float brightness) {
      vec2 id = floor(uv);
      vec2 f = fract(uv);
      float star = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 cell = id + neighbor;
          vec2 starPos = hash22(cell);
          float starPresence = hash2(cell + 100.0);
          if (starPresence > density) continue;
          vec2 diff = neighbor + starPos - f;
          float d = length(diff);
          float size = 0.015 + hash2(cell + 200.0) * 0.025;
          float glow = exp(-d * d / (size * size));
          // Subtle diffraction spikes — only rare brightest stars
          float spikes = 0.0;
          if (starPresence < density * 0.04) {
            float ax = exp(-abs(diff.x) * 120.0) * exp(-abs(diff.y) * 6.0);
            float ay = exp(-abs(diff.y) * 120.0) * exp(-abs(diff.x) * 6.0);
            spikes = (ax + ay) * 0.12;
          }
          star += (glow + spikes) * brightness;
        }
      }
      return star;
    }

    // Star color based on temperature hash
    vec3 starColor(vec2 cell) {
      float temp = hash2(cell + 300.0);
      if (temp < 0.15) return vec3(0.6, 0.7, 1.0);   // hot blue
      if (temp < 0.35) return vec3(0.75, 0.85, 1.0);  // blue-white
      if (temp < 0.65) return vec3(1.0, 0.98, 0.95);  // white
      if (temp < 0.85) return vec3(1.0, 0.92, 0.78);  // warm yellow
      return vec3(1.0, 0.75, 0.55);                    // orange giant
    }

    // Colored star layer — returns color contribution
    vec3 coloredStarLayer(vec2 uv, float density, float brightness) {
      vec2 id = floor(uv);
      vec2 f = fract(uv);
      vec3 col = vec3(0.0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 cell = id + neighbor;
          vec2 starPos = hash22(cell);
          float starPresence = hash2(cell + 100.0);
          if (starPresence > density) continue;
          vec2 diff = neighbor + starPos - f;
          float d = length(diff);
          float varSize = 0.012 + hash2(cell + 200.0) * 0.03;
          float glow = exp(-d * d / (varSize * varSize));
          // Subtle diffraction spikes — only rare brightest stars
          float spikeStr = 0.0;
          if (starPresence < density * 0.03) {
            float ax = exp(-abs(diff.x) * 140.0) * exp(-abs(diff.y) * 8.0);
            float ay = exp(-abs(diff.y) * 140.0) * exp(-abs(diff.x) * 8.0);
            spikeStr = (ax + ay) * 0.10;
          }
          vec3 sc = starColor(cell);
          col += sc * (glow + spikeStr) * brightness;
        }
      }
      return col;
    }

    vec3 galaxyBackground(vec3 dir) {
      vec3 d = normalize(dir);

      // Spherical coordinates — seamless
      float phi = atan(d.z, d.x);          // [-pi, pi]
      float theta = asin(clamp(d.y, -1.0, 1.0));  // [-pi/2, pi/2]

      // sin/cos for seamless noise sampling (no atan discontinuity)
      float sp = sin(phi), cp = cos(phi);

      // ── Deep black sky base — true space black ──
      vec3 sky = vec3(0.001, 0.001, 0.003);

      // ── Milky Way galactic band ──
      // Tilted ~15° for visual interest
      float tiltedTheta = theta + sp * 0.12;
      float bandCore = exp(-tiltedTheta * tiltedTheta * 14.0);
      float bandWide = exp(-tiltedTheta * tiltedTheta * 3.0);

      // Large-scale galactic structure
      float gn1 = fbm(vec2(sp * 2.5 + cp * 1.5, tiltedTheta * 3.0 + 0.5));
      float gn2 = fbm(vec2(sp * 5.0 - cp * 3.5 + 4.0, tiltedTheta * 6.0 + 2.0));
      float gn3 = fbm(vec2(sp * 10.0 + cp * 7.0 + 8.0, tiltedTheta * 12.0 - 1.0));

      // Dark lanes / dust absorption in the galactic plane
      float dustLanes = fbm(vec2(sp * 8.0 + cp * 5.0 + 20.0, tiltedTheta * 10.0 + 7.0));
      float absorption = smoothstep(0.35, 0.65, dustLanes) * bandCore * 0.7;

      // Unresolved stellar glow of the Milky Way
      float milkyGlow = bandCore * (0.4 + gn1 * 0.35 + gn2 * 0.2) * (1.0 - absorption);
      // Wider diffuse glow
      float milkyDiffuse = bandWide * (0.15 + gn3 * 0.1) * (1.0 - absorption * 0.5);

      // Milky Way color: warm white core, neutral edges
      vec3 milkyCore = vec3(0.18, 0.16, 0.13);
      vec3 milkyEdge = vec3(0.05, 0.05, 0.06);
      vec3 milkyCol = mix(milkyEdge, milkyCore, bandCore);
      sky += milkyCol * (milkyGlow + milkyDiffuse) * 0.20;

      // ── Galactic center — bright warm glow ──
      float coreAngle = phi * 0.5;
      float galacticCore = exp(-coreAngle * coreAngle * 3.0 - tiltedTheta * tiltedTheta * 20.0);
      sky += vec3(0.35, 0.25, 0.12) * galacticCore * 0.12;
      sky += vec3(0.20, 0.15, 0.05) * galacticCore * galacticCore * 0.15;

      // ── Emission nebulae — colorful patches ──
      float neb1 = fbm(vec2(sp * 4.0 + cp * 3.0 + 30.0, theta * 5.0 + 10.0));
      float neb2 = fbm(vec2(sp * 7.0 - cp * 5.0 + 40.0, theta * 9.0 + 15.0));
      float neb3 = fbm(vec2(sp * 3.0 + cp * 2.0 + 50.0, theta * 4.0 + 20.0));

      // H-alpha red/pink emission — very subtle
      float haRegion = pow(max(neb1 - 0.50, 0.0), 2.0) * bandWide;
      sky += vec3(0.30, 0.06, 0.08) * haRegion * 0.10;

      // Blue reflection nebulae — toned way down
      float blueNeb = pow(max(neb2 - 0.55, 0.0), 2.0) * bandWide;
      sky += vec3(0.05, 0.06, 0.15) * blueNeb * 0.08;

      // Purple/magenta nebula patches — subtle
      float purpleNeb = pow(max(neb3 - 0.55, 0.0), 2.0) * bandWide;
      sky += vec3(0.12, 0.04, 0.15) * purpleNeb * 0.06;

      // ── Dark nebula silhouettes ──
      float darkNeb = fbm(vec2(sp * 6.0 + cp * 4.0 + 60.0, theta * 7.0 + 25.0));
      float darkPatch = smoothstep(0.55, 0.7, darkNeb) * bandCore;
      sky *= (1.0 - darkPatch * 0.6);

      // ── Multi-layer star field ──
      // Use seamless polar coordinates for star placement
      // Scale appropriately to avoid bunching at poles
      float cosTheta = cos(theta);
      vec2 starUV1 = vec2(phi * 8.0, theta * 16.0);
      vec2 starUV2 = vec2(phi * 20.0, theta * 40.0);
      vec2 starUV3 = vec2(phi * 50.0, theta * 100.0);
      vec2 starUV4 = vec2(phi * 120.0, theta * 240.0);

      // Bright foreground stars with color + diffraction
      vec3 brightStars = coloredStarLayer(starUV1, 0.05, 1.2);
      // Medium stars
      vec3 medStars = coloredStarLayer(starUV2, 0.10, 0.6);
      // Dim numerous stars
      vec3 dimStars = coloredStarLayer(starUV3, 0.20, 0.22);
      // Background dust of unresolved stars
      float microStars = starLayer(starUV4, 0.35, 0.08);

      // Stars are denser in the Milky Way band
      float starDensityBoost = 1.0 + bandWide * 2.5;

      sky += brightStars;
      sky += medStars * starDensityBoost;
      sky += dimStars * starDensityBoost;
      sky += vec3(0.9, 0.92, 1.0) * microStars * starDensityBoost;

      return sky;
    }

    void main() {
      vec4 sceneCol = texture2D(tDiffuse, vUv);

      // ── Reconstruct ray direction from screen UV ──
      vec2 ndc = vUv * 2.0 - 1.0;
      vec4 clipPos = vec4(ndc, -1.0, 1.0);
      vec4 viewPos = uInvProjMatrix * clipPos;
      viewPos = vec4(viewPos.xy, -1.0, 0.0);
      vec3 rayDir = normalize((uCamMatrix * viewPos).xyz);
      vec3 rayPos = uCamPos;

      // ── Ray march through Schwarzschild spacetime ──
      vec3 bhCenter = vec3(0.0);
      vec4 diskAccum = vec4(0.0);
      bool hitHorizon = false;
      float order = 0.0;
      float photonGlow = 0.0;

      float totalDist = 0.0;
      const int MAX_STEPS = 400;
      const float MAX_DIST = 2000.0;

      float prevY = rayPos.y;

      for (int i = 0; i < MAX_STEPS; i++) {
        vec3 toBH = bhCenter - rayPos;
        float dist = length(toBH);

        // Event horizon — slightly larger to ensure deep black center
        if (dist < uRS * 0.98) {
          hitHorizon = true;
          break;
        }

        if (totalDist > MAX_DIST) break;

        // ── Adaptive step — very fine near photon sphere ──
        float stepSize = max(0.04, dist * 0.02);
        stepSize = min(stepSize, 3.0);

        // ── Schwarzschild geodesic with GR correction ──
        // The (1 + 3RS/r) term is critical: it dramatically increases
        // bending near the photon sphere, producing BOTH the over-arc
        // and under-arc visible simultaneously from any viewing angle.
        vec3 dirToBH = toBH / dist;
        float deflBase = 1.5 * uRS / (dist * dist);
        float grCorrection = 1.0 + 2.2 * uRS / dist;
        float deflStrength = deflBase * grCorrection;
        rayDir = normalize(rayDir + dirToBH * deflStrength * stepSize);

        rayPos += rayDir * stepSize;
        totalDist += stepSize;

        float curY = rayPos.y;

        // ── Disk plane crossings (y = 0) ──
        if (totalDist > 1.0 && prevY * curY < 0.0) {
          float frac = abs(prevY) / (abs(prevY) + abs(curY));
          vec3 hitPos = rayPos - rayDir * stepSize * (1.0 - frac);

          order += 1.0;
          vec4 diskSample = sampleDisk(hitPos, order);
          // Slight attenuation on 2nd+ crossing to prevent double-bright overlap
          float atten = 1.0 - diskAccum.a * 0.25;
          diskAccum.rgb += diskSample.rgb * diskSample.a * atten;
          diskAccum.a = min(diskAccum.a + diskSample.a, 1.0);
        }

        prevY = curY;

        // ── Photon ring with black gap — Gargantua signature ──
        // The black gap between disk inner edge and photon ring is the
        // region between ISCO and the photon sphere where no stable
        // orbits exist — light bends but no material emits.
        if (dist < uShadowR * 1.15 && dist > uShadowR * 0.85) {
          float ringCenter = uShadowR * 1.0;
          float ringDist = abs(dist - ringCenter);
          // Ultra-sharp photon ring — the thin bright line
          float ringSharp = exp(-ringDist * ringDist * 25.0);
          // Slightly wider warm glow around it
          float ringGlow = exp(-ringDist * ringDist * 4.0);
          photonGlow += (ringSharp * 0.035 + ringGlow * 0.006) * stepSize;
        }
      }

      // ── Final composite ──
      vec3 finalCol;
      if (hitHorizon && diskAccum.a < 0.005) {
        // Pure shadow — absolutely black
        finalCol = vec3(0.0);
      } else if (hitHorizon) {
        // Disk in front of shadow — pure disk color, no background bleed
        finalCol = diskAccum.rgb;
      } else {
        // Check if ray passed very close to shadow — darken to enforce clean edge
        vec3 viewDir = normalize((inverse(uCamMatrix) * vec4(rayDir, 0.0)).xyz);

        float halfFov = radians(uFov) * 0.5;
        float tanHF = tan(halfFov);
        vec2 bentNDC = vec2(
          viewDir.x / (-viewDir.z * uAspect * tanHF),
          viewDir.y / (-viewDir.z * tanHF)
        );
        vec2 bentUV = bentNDC * 0.5 + 0.5;

        vec3 bgCol = galaxyBackground(rayDir);
        if (bentUV.x > 0.001 && bentUV.x < 0.999 && bentUV.y > 0.001 && bentUV.y < 0.999
            && viewDir.z < 0.0) {
          bgCol += texture2D(tDiffuse, bentUV).rgb;
        }

        finalCol = bgCol * (1.0 - diskAccum.a) + diskAccum.rgb;
      }

      // Photon ring: bright thin ring with warm tint — the Gargantua signature
      if (!(hitHorizon && diskAccum.a < 0.005)) {
        photonGlow = min(photonGlow, 3.0);
        // Warm peach-white like the reference
        vec3 photonCol = vec3(1.0, 0.92, 0.82) * photonGlow;
        finalCol += photonCol;
      }

      gl_FragColor = vec4(finalCol, 1.0);
    }
  `,
};
const bhLensPass = new ShaderPass(bhLensShader);
bhComposer.addPass(bhLensPass);

// Bloom — moderate glow that extends the brightness outward
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55,  // strength — cinematic glow
  0.70,  // radius — wide soft spread
  0.35   // threshold — catches mid-tones for rich glow
);
bhComposer.addPass(bloomPass);

// Cinematic post-processing — chromatic aberration + vignette + film grain + color grading
const cinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.0025 },
    uVignetteStrength: { value: 0.65 },
    uTime: { value: 0 },
    uGrainStrength: { value: 0.04 },
    uLiftShadows: { value: new THREE.Vector3(0.01, 0.01, 0.02) },   // very subtle cool shadows
    uGammaGain: { value: new THREE.Vector3(1.0, 0.98, 0.95) },      // slight warm midtones
    uHighlightTint: { value: new THREE.Vector3(1.0, 0.97, 0.92) },   // warm highlights
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uVignetteStrength;
    uniform float uTime;
    uniform float uGrainStrength;
    uniform vec3 uLiftShadows;
    uniform vec3 uGammaGain;
    uniform vec3 uHighlightTint;
    varying vec2 vUv;

    // Film grain noise
    float grainNoise(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);

      // ── Chromatic aberration — radial, stronger at edges ──
      float aberr = uIntensity * (1.0 + dist * 2.0);
      vec2 offset = center * dist * aberr;
      float r = texture2D(tDiffuse, vUv + offset * 1.2).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset * 1.0).b;
      vec3 col = vec3(r, g, b);

      // ── Color grading: lift/gamma/gain ──
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // Shadow lift — add subtle blue into dark areas
      float shadowMask = 1.0 - smoothstep(0.0, 0.15, lum);
      col += uLiftShadows * shadowMask;

      // Gamma — warm push to midtones
      col *= uGammaGain;

      // Highlight tint — warm the bright areas
      float highlightMask = smoothstep(0.4, 1.0, lum);
      col = mix(col, col * uHighlightTint, highlightMask);

      // ── Subtle S-curve contrast ──
      col = col / (col + 0.18) * 1.18;

      // ── Film grain — animated, subtle ──
      float grain = grainNoise(vUv * 800.0 + uTime * 100.0) - 0.5;
      col += grain * uGrainStrength * (1.0 - lum * 0.5);

      // ── Vignette — cinematic elliptical, heavier at corners ──
      float vigDist = length(center * vec2(1.1, 1.0));
      float vig = 1.0 - smoothstep(0.30, 0.90, vigDist);
      col *= mix(1.0, vig, uVignetteStrength);

      // ── Edge darkening — extra darkness in extreme corners ──
      float cornerDark = 1.0 - smoothstep(0.6, 1.2, vigDist) * 0.3;
      col *= cornerDark;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
const cinematicPass = new ShaderPass(cinematicShader);
bhComposer.addPass(cinematicPass);

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

// ── System State ────────────────────────────────────────────────────
let systemGroup = null;
let systemSunLight = null;
let planets = [];
let focusedPlanet = null;

function teardownStarSystem() {
  if (systemGroup) {
    scene.remove(systemGroup);
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

let currentSystemSeed = 0;
let currentStarPos = new THREE.Vector3(0, 0, 0);
let currentStarName = "Sol";
let currentSystemResult = loadStarSystem(0);

// ── Twinkling Starfield ─────────────────────────────────────────────
const STAR_COUNT = 3000;
const starPositions = new Float32Array(STAR_COUNT * 3);
const starColors = new Float32Array(STAR_COUNT * 3);
const starBaseAlphas = new Float32Array(STAR_COUNT);
const starSpeeds = new Float32Array(STAR_COUNT);
const starBaseSizes = new Float32Array(STAR_COUNT);

const starTints = [
  [1.0, 1.0, 1.0], [0.85, 0.9, 1.0], [1.0, 0.92, 0.8],
  [0.8, 0.85, 1.0], [1.0, 0.85, 0.85],
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
  size: 0.06, sizeAttenuation: true, transparent: true, opacity: 1,
  vertexColors: true, depthWrite: false,
});
const backgroundStars = new THREE.Points(starGeo, starMat);
scene.add(backgroundStars);

// ── Init Modules ────────────────────────────────────────────────────
initCluster(scene, camera, renderer);
initBlackHole(scene, camera, renderer);

// ── View / Camera State ─────────────────────────────────────────────
let viewLevel = "system"; // "system" | "galaxy" | "blackhole"
let gamePhase = "playing";

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

// ── DOM Refs ────────────────────────────────────────────────────────
const showAllBtn = document.getElementById("show-all-btn");
const $planetPanel = document.getElementById("planet-panel");
const $hudTop = document.getElementById("hud-top");

// Navigation buttons
const $navSolarSystem = document.getElementById("nav-solar-system");
const $navLocalCluster = document.getElementById("nav-local-cluster");
const $navBlackHole = document.getElementById("nav-black-hole");

// ── Focus / ShowAll ─────────────────────────────────────────────────
let focusOn = function(planet) {
  focusedPlanet = planet;
  const focusZ = CAM_FOCUS_Z * (planet.radius || 1);
  camTarget.set(planet.x, 0, focusZ);
  lookTarget.set(planet.x, 0, 0);
  showAllBtn.classList.add("visible");
  updateNavButtons();

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
  updateNavButtons();

  for (const p of planets) {
    p.fadeTarget = 1;
    p.group.visible = true;
  }
};

showAllBtn?.addEventListener("click", () => showAll());

// ── Navigation Buttons ──────────────────────────────────────────────
function updateNavButtons() {
  if (!$navSolarSystem || !$navLocalCluster || !$navBlackHole) return;

  // Hide all first
  $navSolarSystem.style.display = "none";
  $navLocalCluster.style.display = "none";
  $navBlackHole.style.display = "none";

  if (gamePhase !== "playing") return;
  if (focusedPlanet) return; // hide nav when focused on a planet

  if (viewLevel === "system") {
    $navLocalCluster.style.display = "";
    $navBlackHole.style.display = "";
  } else if (viewLevel === "galaxy") {
    $navSolarSystem.style.display = "";
    $navBlackHole.style.display = "";
  } else if (viewLevel === "blackhole") {
    $navSolarSystem.style.display = "";
    $navLocalCluster.style.display = "";
  }
}

$navSolarSystem?.addEventListener("click", () => {
  if (viewLevel === "galaxy") {
    exitGalaxyView(currentSystemSeed, currentStarPos, currentStarName);
  } else if (viewLevel === "blackhole") {
    exitBlackHoleView();
  }
});

$navLocalCluster?.addEventListener("click", () => {
  if (viewLevel === "system" && gamePhase === "playing") {
    enterGalaxyView();
  } else if (viewLevel === "blackhole") {
    exitBlackHoleView();
    enterGalaxyView();
  }
});

$navBlackHole?.addEventListener("click", () => {
  if (viewLevel === "system" && gamePhase === "playing") {
    enterBlackHoleView();
  } else if (viewLevel === "galaxy") {
    exitGalaxyView(currentSystemSeed, currentStarPos, currentStarName);
    enterBlackHoleView();
  }
});

// ── Galaxy Orbit Camera ─────────────────────────────────────────────
const galaxyCam = {
  theta: 0.3,
  phi: Math.PI / 3,
  radius: 40,
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

// ── WASD Keys ───────────────────────────────────────────────────────
const wasdKeys = { w: false, a: false, s: false, d: false, q: false, e: false, c: false, r: false, f: false, space: false };

// ── Enter / Exit Views ──────────────────────────────────────────────
function enterGalaxyView() {
  viewLevel = "galaxy";

  if (systemGroup) systemGroup.visible = false;
  if (systemSunLight) systemSunLight.visible = false;
  backgroundStars.visible = false;

  showAllBtn.classList.remove("visible");
  $planetPanel.classList.add("hidden-panel");
  scene.fog = null;

  galaxyCam.center.copy(currentStarPos);
  galaxyCam.theta = 0.3;
  galaxyCam.phi = Math.PI / 3;
  galaxyCam.radius = 40;

  generateGalaxyStars(currentStarPos);
  showCluster(currentStarPos);

  // Show cluster UI
  const $centerBtn = document.getElementById("btn-cluster-center");
  if ($centerBtn) $centerBtn.style.display = "";
  const $clusterHints = document.getElementById("cluster-hints");
  if ($clusterHints) $clusterHints.style.display = "";
  const $galaxyLabel = document.getElementById("galaxy-label");
  if ($galaxyLabel) {
    $galaxyLabel.textContent = `Current: ${currentStarName}`;
    $galaxyLabel.style.display = "";
  }
  const $bookmarkBtn = document.getElementById("btn-bookmark");
  if ($bookmarkBtn) $bookmarkBtn.style.display = "";
  const $bookmarkSelect = document.getElementById("bookmark-select");
  if ($bookmarkSelect) $bookmarkSelect.style.display = "";

  updateNavButtons();
}

function exitGalaxyView(targetSeed, targetPos, targetName) {
  viewLevel = "system";

  hideCluster();
  renderer.domElement.style.cursor = "";
  const $centerBtn = document.getElementById("btn-cluster-center");
  if ($centerBtn) $centerBtn.style.display = "none";
  const $clusterHints = document.getElementById("cluster-hints");
  if ($clusterHints) $clusterHints.style.display = "none";

  scene.fog = new THREE.FogExp2(0x010108, 0.008);

  if (targetSeed !== currentSystemSeed) {
    setLastVisitedStar({
      seed: currentSystemSeed,
      pos: currentStarPos.clone(),
      name: currentStarName,
      color: currentSystemResult?.spectral?.color || 0xffeedd,
    });

    currentSystemSeed = targetSeed;
    currentStarPos.copy(targetPos);
    currentStarName = targetName || generateStarName(targetSeed);
    currentSystemResult = loadStarSystem(targetSeed);

    const gameState = getGameState();
    if (gameState) {
      if (targetSeed !== (gameState.homeSystemSeed ?? 0)) {
        gameState.currentSystemSeed = targetSeed;
        gameState.currentStarPos = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
        gameState.currentStarName = currentStarName;
      }
    }
  }

  if (systemGroup) systemGroup.visible = true;
  if (systemSunLight) systemSunLight.visible = true;
  backgroundStars.visible = true;

  camTarget.set(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
  lookTarget.set(CAM_ALL.x, 0, 0);
  camCurrent.set(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
  lookCurrent.set(CAM_ALL.x, 0, 0);
  camera.position.copy(camCurrent);

  focusedPlanet = null;
  showAllBtn.classList.remove("visible");

  // Hide galaxy UI
  const $galaxyLabel = document.getElementById("galaxy-label");
  if ($galaxyLabel) $galaxyLabel.style.display = "none";
  const $bookmarkBtn = document.getElementById("btn-bookmark");
  if ($bookmarkBtn) $bookmarkBtn.style.display = "none";
  const $bookmarkSelect = document.getElementById("bookmark-select");
  if ($bookmarkSelect) $bookmarkSelect.style.display = "none";

  const $systemName = document.getElementById("system-name");
  if ($systemName) $systemName.textContent = currentStarName;

  updateNavButtons();
}

function enterBlackHoleView() {
  viewLevel = "blackhole";

  if (systemGroup) systemGroup.visible = false;
  if (systemSunLight) systemSunLight.visible = false;
  backgroundStars.visible = false;

  showAllBtn.classList.remove("visible");
  $planetPanel.classList.add("hidden-panel");
  scene.fog = null;

  showBlackHole();

  // Show BH hints
  const $bhHints = document.getElementById("bh-hints");
  if ($bhHints) $bhHints.style.display = "";

  updateNavButtons();
}

function exitBlackHoleView() {
  viewLevel = "system";

  hideBlackHole();

  // Hide BH hints
  const $bhHints = document.getElementById("bh-hints");
  if ($bhHints) $bhHints.style.display = "none";

  scene.fog = new THREE.FogExp2(0x010108, 0.008);

  if (systemGroup) systemGroup.visible = true;
  if (systemSunLight) systemSunLight.visible = true;
  backgroundStars.visible = true;

  camTarget.set(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
  lookTarget.set(CAM_ALL.x, 0, 0);
  camCurrent.set(CAM_ALL.x, CAM_ALL.y, CAM_ALL.z);
  lookCurrent.set(CAM_ALL.x, 0, 0);
  camera.position.copy(camCurrent);

  focusedPlanet = null;
  showAllBtn.classList.remove("visible");

  const $systemName = document.getElementById("system-name");
  if ($systemName) $systemName.textContent = currentStarName;

  updateNavButtons();
}

// ── Center Button ───────────────────────────────────────────────────
const $centerBtn = document.getElementById("btn-cluster-center");
if ($centerBtn) {
  $centerBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  $centerBtn.addEventListener("click", () => {
    if (viewLevel === "galaxy") {
      galaxyCam.center.copy(currentStarPos);
      for (const k in wasdKeys) wasdKeys[k] = false;
    }
  });
}

// ── Drag State ──────────────────────────────────────────────────────
const dragState = {
  isDragging: false,
  startX: 0, startY: 0,
  prevX: 0, prevY: 0,
  velocityX: 0, velocityY: 0,
};

const DRAG_SENSITIVITY = 0.005;
const DRAG_DAMPING = 0.90;
const GALAXY_ORBIT_SENSITIVITY = 0.005;

const canvas = renderer.domElement;
let lastMouseX = 0;
let lastMouseY = 0;
const mouseNDC = new THREE.Vector2(-9, -9);

// ── Pointer Events ──────────────────────────────────────────────────
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return;

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

  if (viewLevel === "blackhole") {
    bhCam.isDragging = true;
    bhCam.prevX = e.clientX;
    bhCam.prevY = e.clientY;
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
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (viewLevel === "galaxy" && galaxyCam.isDragging) {
    const dx = e.clientX - galaxyCam.prevX;
    const dy = e.clientY - galaxyCam.prevY;
    galaxyCam.theta -= dx * GALAXY_ORBIT_SENSITIVITY;
    galaxyCam.phi -= dy * GALAXY_ORBIT_SENSITIVITY;
    galaxyCam.phi = Math.max(0.1, Math.min(Math.PI - 0.1, galaxyCam.phi));
    galaxyCam.prevX = e.clientX;
    galaxyCam.prevY = e.clientY;
    return;
  }

  if (viewLevel === "blackhole" && bhCam.isDragging) {
    const dx = e.clientX - bhCam.prevX;
    const dy = e.clientY - bhCam.prevY;
    bhCam.theta -= dx * GALAXY_ORBIT_SENSITIVITY;
    bhCam.phi -= dy * GALAXY_ORBIT_SENSITIVITY;
    bhCam.phi = Math.max(0.1, Math.min(Math.PI - 0.1, bhCam.phi));
    bhCam.prevX = e.clientX;
    bhCam.prevY = e.clientY;
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

    const star = getHoveredStar();
    if (star) {
      exitGalaxyView(star.seed, new THREE.Vector3(star.x, star.y, star.z), star.name);
    }
    return;
  }

  if (viewLevel === "blackhole") {
    bhCam.isDragging = false;
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

// Scroll wheel
canvas.addEventListener("wheel", (e) => {
  if (viewLevel === "galaxy") {
    e.preventDefault();
    galaxyCam.radius += e.deltaY * 0.05;
    galaxyCam.radius = Math.max(galaxyCam.minRadius, Math.min(galaxyCam.maxRadius, galaxyCam.radius));
  } else if (viewLevel === "blackhole") {
    e.preventDefault();
    bhCam.radius += e.deltaY * 0.05;
    bhCam.radius = Math.max(bhCam.minRadius, Math.min(bhCam.maxRadius, bhCam.radius));
  }
}, { passive: false });

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  bhComposer.setSize(window.innerWidth, window.innerHeight);
  bhLensPass.uniforms.uAspect.value = camera.aspect;
});

// Keyboard
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (viewLevel === "galaxy") {
      exitGalaxyView(currentSystemSeed, currentStarPos, currentStarName);
    } else if (viewLevel === "blackhole") {
      exitBlackHoleView();
    } else if (focusedPlanet) {
      showAll();
    }
  }
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
  } else if (viewLevel === "blackhole") {
    e.preventDefault();
    exitBlackHoleView();
  } else if (focusedPlanet) {
    e.preventDefault();
    showAll();
  }
});

// ── Animation Helpers ───────────────────────────────────────────────
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const tempQuat = new THREE.Quaternion();
const spinQuat = new THREE.Quaternion();
const AUTO_ROTATE_SPEED = 0.00105;

// ── Animation Loop ──────────────────────────────────────────────────
const clock = new THREE.Clock();
let lastFrameTime = 0;
let tickAccum = 0;

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = t - lastFrameTime;
  lastFrameTime = t;

  // ── GALAXY VIEW ──
  if (viewLevel === "galaxy") {
    const flySpeed = dt * galaxyCam.radius * 0.5;
    const camPos0 = getGalaxyCameraPosition();
    const fwd = new THREE.Vector3().subVectors(galaxyCam.center, camPos0).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    if (wasdKeys.w) galaxyCam.center.addScaledVector(fwd, flySpeed);
    if (wasdKeys.s) galaxyCam.center.addScaledVector(fwd, -flySpeed);
    if (wasdKeys.a || wasdKeys.q) galaxyCam.center.addScaledVector(right, -flySpeed);
    if (wasdKeys.d || wasdKeys.e) galaxyCam.center.addScaledVector(right, flySpeed);
    if (wasdKeys.space) galaxyCam.center.y += flySpeed;
    if (wasdKeys.c) galaxyCam.center.y -= flySpeed;

    const camPos = getGalaxyCameraPosition();
    camera.position.copy(camPos);
    camera.lookAt(galaxyCam.center);

    animateClusterVisuals(t, dt, camPos);
    if (!galaxyCam.isDragging) {
      updateClusterHover(mouseNDC, lastMouseX, lastMouseY, galaxyCam.isDragging);
    }

    renderer.render(scene, camera);
    return;
  }

  // ── BLACK HOLE VIEW ──
  if (viewLevel === "blackhole") {
    animateBlackHole(t, dt, wasdKeys);

    // Update ray-march shader uniforms
    const lensU = bhLensPass.uniforms;
    lensU.uTime.value = t;
    lensU.uCamPos.value.copy(camera.position);
    lensU.uAspect.value = camera.aspect;
    lensU.uFov.value = camera.fov;
    lensU.uInvProjMatrix.value.copy(camera.projectionMatrixInverse);
    lensU.uCamMatrix.value.copy(camera.matrixWorld);

    // Update cinematic post-processing time for animated grain
    cinematicPass.uniforms.uTime.value = t;

    scene.fog = null;
    scene.background = new THREE.Color(0x000000);
    renderer.setClearColor(0x000000, 1);
    bhComposer.render();
    scene.fog = new THREE.FogExp2(0x010108, 0.008);
    scene.background = new THREE.Color(0x010108);
    return;
  }

  // ── SYSTEM VIEW ──
  planets.forEach((p, i) => {
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
      // handled below
    } else if (p.displaced) {
      tempQuat.setFromAxisAngle(axisY, speed);
      p.rotationQuat.premultiply(tempQuat);
    } else {
      spinQuat.setFromAxisAngle(axisY, p.spinAngle);
      p.rotationQuat.copy(p.homeQuat).multiply(spinQuat);
    }
  });

  // Drag-to-rotate focused planet
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

  planets.forEach((p) => p.group.quaternion.copy(p.rotationQuat));

  // Twinkle stars
  const sizeAttr = starGeo.getAttribute("size");
  for (let i = 0; i < STAR_COUNT; i++) {
    const flicker = starBaseAlphas[i] * (0.5 + 0.5 * Math.sin(t * starSpeeds[i] + i * 1.7));
    sizeAttr.array[i] = starBaseSizes[i] * (0.4 + flicker * 0.8);
  }
  sizeAttr.needsUpdate = true;

  // Camera
  camCurrent.lerp(camTarget, LERP_SPEED);
  lookCurrent.lerp(lookTarget, LERP_SPEED);
  camera.position.copy(camCurrent);
  camera.lookAt(lookCurrent);

  fillLight.position.y = -3 + Math.sin(t * 0.3) * 0.8;

  // Game Tick
  const gameState = getGameState();
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

// ── Game Phase ──────────────────────────────────────────────────────

function enterPlaying() {
  gamePhase = "playing";
  $hudTop.classList.remove("hidden-panel");

  const $hudGameInfo = document.getElementById("hud-game-info");
  const $hudResources = document.getElementById("hud-resources");
  const $hudPopWrap = document.getElementById("hud-pop-wrap");
  if ($hudGameInfo) $hudGameInfo.style.display = "none";
  if ($hudResources) $hudResources.style.display = "none";
  if ($hudPopWrap) $hudPopWrap.style.display = "none";

  updateHUD();
  updateBookmarkDropdown();

  const $systemName = document.getElementById("system-name");
  if ($systemName) $systemName.textContent = currentStarName;

  showAll();
  updateNavButtons();

  // Default to black hole view on startup
  enterBlackHoleView();
}

// ── Hook focusOn / showAll for game ─────────────────────────────────
const _origFocusOn = focusOn;
focusOn = function(planet) {
  if (gamePhase === "playing") {
    _origFocusOn(planet);
    updatePlanetPanel(planet);
  }
};

const _origShowAll = showAll;
showAll = function() {
  _origShowAll();
  $planetPanel.classList.add("hidden-panel");
};

// ── Bookmark Handlers ───────────────────────────────────────────────
const $bookmarkBtn = document.getElementById("btn-bookmark");
if ($bookmarkBtn) {
  $bookmarkBtn.addEventListener("click", () => addBookmark(currentSystemSeed, currentStarName, currentStarPos));
}

const $bookmarkSelect = document.getElementById("bookmark-select");
if ($bookmarkSelect) {
  $bookmarkSelect.addEventListener("change", (e) => {
    const gameState = getGameState();
    if (!gameState) return;
    const bookmarks = gameState.bookmarks || [];
    const bm = bookmarks.find(b => b.seed === Number(e.target.value));
    if (!bm) return;
    const targetPos = new THREE.Vector3(bm.x, bm.y, bm.z);
    exitGalaxyView(bm.seed, targetPos, bm.name);
    e.target.selectedIndex = 0;
  });
}

// ── Save / Export / Import Handlers ─────────────────────────────────
document.getElementById("btn-save")?.addEventListener("click", saveGame);
document.getElementById("btn-export")?.addEventListener("click", exportSave);
document.getElementById("btn-import")?.addEventListener("click", () => importSave(enterPlaying));

// ── Init Speed Controls ─────────────────────────────────────────────
initSpeedControls();

// ── Boot ────────────────────────────────────────────────────────────
{
  const saved = loadGame();
  if (saved) {
    setGameState(saved);
    const gs = saved;
    if (!gs.bookmarks) gs.bookmarks = [];
    if (!gs.currentStarName) gs.currentStarName = "Sol";
    if (!gs.currentStarPos) gs.currentStarPos = { x: 0, y: 0, z: 0 };
    if (gs.currentSystemSeed === undefined) gs.currentSystemSeed = 0;
    if (gs.homeSystemSeed === undefined) gs.homeSystemSeed = 0;

    currentSystemSeed = gs.currentSystemSeed;
    currentStarPos.set(
      gs.currentStarPos.x || 0,
      gs.currentStarPos.y || 0,
      gs.currentStarPos.z || 0,
    );
    currentStarName = gs.currentStarName;
    if (currentSystemSeed !== 0) {
      currentSystemResult = loadStarSystem(currentSystemSeed);
    }
  } else {
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    currentSystemSeed = seed;
    currentStarPos.set(0, 0, 0);
    currentStarName = generateStarName(seed);
    currentSystemResult = loadStarSystem(seed);
    const homePlanet = planets.find(p => p.name !== "sun");
    if (homePlanet) {
      setGameState(newGameState(planets, currentSystemSeed, currentStarPos, currentStarName));
    }
  }
  enterPlaying();
}
animate();
