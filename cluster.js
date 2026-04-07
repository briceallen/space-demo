// ══════════════════════════════════════════════════════════════════════
// ██  LOCAL CLUSTER VIEW — Procedural 3D star orbs + navigation
// ══════════════════════════════════════════════════════════════════════
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { mulberry32, hashCoords, generateStarName } from "./utils.js";
import { SPECTRAL_TYPES, pickSpectralType } from "./spectral.js";

// ── References (set via init) ──
let _scene, _camera, _renderer;

// ── Constants ──
const GALAXY_MASTER_SEED = 0x6A1A5E;
const GALAXY_CELL_SIZE = 10;
const GALAXY_VIEW_RADIUS = 160;
const STAR_PROBABILITY = 0.03;

// ── Module State ──
const galaxyStarCache = new Map();
let clusterGroup = null;
let clusterStarMeshes = [];
let hoveredStar = null;
let hoveredStarMesh = null;
let clusterHoverRing = null;
let clusterCurrentRing = null;
let lastVisitedStar = null;
let lastVisitedMesh = null;
let lastVisitedGlow = null;
let trailLine = null;
let clusterBgStars = null;

// Shared geometries
const clusterStarGeo = new THREE.SphereGeometry(1, 24, 24);
const clusterGlowGeo = new THREE.SphereGeometry(1, 16, 16);

// Tooltip DOM ref
const $clusterTooltip = document.getElementById("cluster-tooltip");

// Lens flare sprite texture
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

// ── Init ──
export function initCluster(scene, camera, renderer) {
  _scene = scene;
  _camera = camera;
  _renderer = renderer;

  // Ensure home star is always in the cache
  galaxyStarCache.set("0,0,0_home", {
    seed: 0,
    x: 0, y: 0, z: 0,
    color: SPECTRAL_TYPES[2].color,
    spectral: SPECTRAL_TYPES[2],
    name: "Sol",
    sizeMultiplier: 1.0,
  });

  // Create cluster background stars (no parallax)
  const BG_COUNT = 6000;
  const bgPos = new Float32Array(BG_COUNT * 3);
  const bgCol = new Float32Array(BG_COUNT * 3);
  const bgRng = mulberry32(0xBACF01D);
  for (let i = 0; i < BG_COUNT; i++) {
    const u = bgRng(), v = bgRng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    bgPos[i * 3]     = Math.sin(phi) * Math.cos(theta);
    bgPos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
    bgPos[i * 3 + 2] = Math.cos(phi);
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
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.45,
    vertexColors: true,
    depthWrite: false,
    depthTest: false,
  });
  clusterBgStars = new THREE.Points(bgGeo, bgMat);
  clusterBgStars.renderOrder = -1;
  clusterBgStars.frustumCulled = false;
  clusterBgStars.visible = false;
  _scene.add(clusterBgStars);
}

// ── Star Generation ──
export function generateGalaxyStars(centerPos) {
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

// ── Rebuild Cluster Meshes ──
function rebuildClusterMeshes(centerPos) {
  if (clusterGroup) {
    _scene.remove(clusterGroup);
    clusterGroup.traverse(child => {
      if (child.isMesh) child.material.dispose();
    });
    clusterGroup = null;
  }
  if (clusterHoverRing) {
    _scene.remove(clusterHoverRing);
    clusterHoverRing.geometry.dispose();
    clusterHoverRing.material.dispose();
    clusterHoverRing = null;
  }
  if (clusterCurrentRing) {
    _scene.remove(clusterCurrentRing);
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
    const coreColor = color.clone().lerp(new THREE.Color(0xffffff), 0.3);

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

    const glowMat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.22,
      side: THREE.BackSide, depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(clusterGlowGeo, glowMat);
    glowMesh.position.set(star.x, star.y, star.z);
    glowMesh.scale.setScalar(baseSize * 3.2);
    clusterGroup.add(glowMesh);

    const bloomMat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.06,
      side: THREE.BackSide, depthWrite: false,
    });
    const bloomMesh = new THREE.Mesh(clusterGlowGeo, bloomMat);
    bloomMesh.position.set(star.x, star.y, star.z);
    bloomMesh.scale.setScalar(baseSize * 6.0);
    clusterGroup.add(bloomMesh);

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
  _scene.add(clusterGroup);

  // Hover highlight ring
  const hoverRingGeo = new THREE.RingGeometry(0.8, 1.05, 48);
  const hoverRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false,
  });
  clusterHoverRing = new THREE.Mesh(hoverRingGeo, hoverRingMat);
  clusterHoverRing.visible = false;
  _scene.add(clusterHoverRing);

  // Current-system marker ring
  const curRingGeo = new THREE.RingGeometry(0.6, 0.85, 48);
  const curRingMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.6,
    side: THREE.DoubleSide, depthWrite: false,
  });
  clusterCurrentRing = new THREE.Mesh(curRingGeo, curRingMat);
  clusterCurrentRing.position.copy(centerPos);
  clusterCurrentRing.visible = false;
  _scene.add(clusterCurrentRing);

  // Last-visited star marker + trail
  if (trailLine) { _scene.remove(trailLine); trailLine.geometry.dispose(); trailLine.material.dispose(); trailLine = null; }
  if (lastVisitedMesh) { _scene.remove(lastVisitedMesh); lastVisitedMesh.geometry.dispose(); lastVisitedMesh.material.dispose(); lastVisitedMesh = null; }
  if (lastVisitedGlow) { _scene.remove(lastVisitedGlow); lastVisitedGlow.geometry.dispose(); lastVisitedGlow.material.dispose(); lastVisitedGlow = null; }

  if (lastVisitedStar) {
    const alreadyInCluster = clusterStarMeshes.some(e => e.star.seed === lastVisitedStar.seed);
    if (!alreadyInCluster) {
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
      _scene.add(lastVisitedMesh);

      const lvGlowMat = new THREE.MeshBasicMaterial({
        color: lvColor, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false,
      });
      lastVisitedGlow = new THREE.Mesh(clusterGlowGeo, lvGlowMat);
      lastVisitedGlow.position.copy(lastVisitedStar.pos);
      lastVisitedGlow.scale.setScalar(lvSize * 3.0);
      lastVisitedGlow.visible = false;
      _scene.add(lastVisitedGlow);

      clusterStarMeshes.push({
        mesh: lastVisitedMesh,
        glowMesh: lastVisitedGlow,
        bloomMesh: lastVisitedGlow,
        flareSprite: null,
        star: { seed: lastVisitedStar.seed, x: lastVisitedStar.pos.x, y: lastVisitedStar.pos.y, z: lastVisitedStar.pos.z, color: lastVisitedStar.color || 0xff6644, name: lastVisitedStar.name },
        coreMat: lvCoreMat,
        glowMat: lvGlowMat,
        bloomMat: lvGlowMat,
        flareMat: null,
        baseSize: lvSize,
      });
    }

    // Trail line
    const trailGeo = new THREE.BufferGeometry().setFromPoints([
      centerPos.clone(),
      lastVisitedStar.pos.clone(),
    ]);
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xff3333, transparent: true, opacity: 0.25, depthWrite: false,
    });
    trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.visible = false;
    _scene.add(trailLine);
  }
}

// ── Show / Hide ──
export function showCluster(currentStarPos) {
  if (clusterBgStars) clusterBgStars.visible = true;
  if (clusterGroup) clusterGroup.visible = true;
  if (clusterCurrentRing) {
    clusterCurrentRing.position.copy(currentStarPos);
    clusterCurrentRing.visible = true;
  }
  if (lastVisitedMesh) lastVisitedMesh.visible = true;
  if (lastVisitedGlow) lastVisitedGlow.visible = true;
  if (trailLine) trailLine.visible = true;
}

export function hideCluster() {
  if (clusterGroup) clusterGroup.visible = false;
  if (clusterHoverRing) clusterHoverRing.visible = false;
  if (clusterCurrentRing) clusterCurrentRing.visible = false;
  hoveredStar = null;
  hoveredStarMesh = null;
  if ($clusterTooltip) $clusterTooltip.style.display = "none";
  if (lastVisitedMesh) lastVisitedMesh.visible = false;
  if (lastVisitedGlow) lastVisitedGlow.visible = false;
  if (trailLine) trailLine.visible = false;
  if (clusterBgStars) clusterBgStars.visible = false;
  if (_renderer) _renderer.domElement.style.cursor = "";
}

// ── Animation ──
export function animateClusterVisuals(t, dt, camPos) {
  // Keep BG centered on camera
  if (clusterBgStars) clusterBgStars.position.copy(camPos);

  // Pulse current-system ring
  if (clusterCurrentRing && clusterCurrentRing.visible) {
    clusterCurrentRing.lookAt(_camera.position);
    clusterCurrentRing.material.opacity = 0.35 + 0.25 * Math.sin(t * 3);
  }

  // Animate hover ring
  if (clusterHoverRing && clusterHoverRing.visible) {
    clusterHoverRing.lookAt(_camera.position);
    clusterHoverRing.material.opacity = 0.4 + 0.3 * Math.sin(t * 5);
    const pulse = 1.0 + 0.08 * Math.sin(t * 4);
    clusterHoverRing.scale.setScalar(pulse);
  }

  // Trail line pulsing
  if (trailLine && trailLine.visible) {
    trailLine.material.opacity = 0.15 + 0.1 * Math.sin(t * 2);
  }

  // Star glow breathing + flare shimmer
  for (const entry of clusterStarMeshes) {
    const phase = entry.star.seed * 0.001;
    const breathe = 0.18 + 0.1 * Math.sin(t * 1.5 + phase);
    entry.glowMat.opacity = breathe;
    const bloomBreath = 0.04 + 0.03 * Math.sin(t * 0.8 + phase * 2);
    entry.bloomMat.opacity = bloomBreath;
    if (entry.flareMat) {
      entry.flareMat.opacity = (0.25 + 0.15 * Math.sin(t * 2.0 + phase * 3)) * (entry.star.sizeMultiplier || 1);
    }
  }
}

// ── Hover Detection ──
export function updateClusterHover(mouseNDC, lastMouseX, lastMouseY, isDragging) {
  if (isDragging) return;

  const coreMeshes = clusterStarMeshes.map(e => e.mesh);
  const hoverRC = new THREE.Raycaster();
  hoverRC.setFromCamera(mouseNDC, _camera);
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
      if (clusterHoverRing) {
        clusterHoverRing.position.set(entry.star.x, entry.star.y, entry.star.z);
        clusterHoverRing.visible = true;
        clusterHoverRing.material.color.set(entry.star.color);
      }
      if ($clusterTooltip) {
        $clusterTooltip.textContent = entry.star.name;
        $clusterTooltip.style.display = "";
      }
      _renderer.domElement.style.cursor = "pointer";
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
      _renderer.domElement.style.cursor = "";
    }
  }

  // Position tooltip near mouse
  if ($clusterTooltip && hoveredStar) {
    $clusterTooltip.style.left = (lastMouseX + 16) + "px";
    $clusterTooltip.style.top = (lastMouseY - 10) + "px";
  }
}

// ── Getters / Setters ──
export function getHoveredStar() { return hoveredStar; }
export function getClusterBgStars() { return clusterBgStars; }
export function getClusterGroup() { return clusterGroup; }
export function getLastVisitedStar() { return lastVisitedStar; }

export function setLastVisitedStar(star) {
  lastVisitedStar = star;
}
