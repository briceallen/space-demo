// ══════════════════════════════════════════════════════════════════════
// ██  STAR SYSTEM BUILDER — Procedural star system from seed
// ══════════════════════════════════════════════════════════════════════
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { mulberry32, generateStarName } from "./utils.js";
import { generateContinentTexture, generateSunTexture } from "./textures.js";
import { PLANET_SPACING, DEG, PLANET_STYLES, PLANET_PALETTES, pickSpectralType } from "./spectral.js";

// Shared geometries
const sphereGeo = new THREE.SphereGeometry(1, 64, 64);
const glowGeo = new THREE.SphereGeometry(1.18, 32, 32);
const atmosGeo = new THREE.SphereGeometry(1.06, 48, 48);

export function buildStarSystem(seed) {
  const rng = mulberry32(seed);
  const spectral = pickSpectralType(rng);

  const planetCount = 2 + Math.floor(rng() * 4);

  const configs = [];
  const usedPalettes = [];
  for (let i = 0; i < planetCount; i++) {
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

  const group = new THREE.Group();
  const newPlanets = [];

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
