// ══════════════════════════════════════════════════════════════════════
// ██  GAME & VISUAL CONSTANTS — Spectral Types, Palettes, Yields
// ══════════════════════════════════════════════════════════════════════

export const PLANET_SPACING = 4;
export const DEG = Math.PI / 180;

export const STYLE_YIELDS = {
  oceanic:      { energy: 2, minerals: 1, food: 4, research: 1, alloys: 0 },
  scattered:    { energy: 3, minerals: 4, food: 1, research: 1, alloys: 1 },
  continental:  { energy: 2, minerals: 2, food: 3, research: 2, alloys: 0 },
};

export const PLANET_STYLES = ["oceanic", "scattered", "continental"];

export const SPECTRAL_TYPES = [
  { type: "M", color: 0xff6644, sunR: 255, sunG: 140, sunB: 80,  glowColor: 0xff4422, atmosColor: 0xff8844, sizeMultiplier: 0.7, lightColor: 0xffaa88, weight: 0.60 },
  { type: "K", color: 0xffaa55, sunR: 255, sunG: 180, sunB: 80,  glowColor: 0xff8833, atmosColor: 0xffbb55, sizeMultiplier: 0.85, lightColor: 0xffcc99, weight: 0.15 },
  { type: "G", color: 0xffdd77, sunR: 255, sunG: 210, sunB: 80,  glowColor: 0xff9922, atmosColor: 0xffcc44, sizeMultiplier: 1.0, lightColor: 0xffeedd, weight: 0.12 },
  { type: "F", color: 0xfff4cc, sunR: 255, sunG: 240, sunB: 180, glowColor: 0xffddaa, atmosColor: 0xffeebb, sizeMultiplier: 1.15, lightColor: 0xfff8ee, weight: 0.07 },
  { type: "A", color: 0xeeeeff, sunR: 230, sunG: 230, sunB: 255, glowColor: 0xccccff, atmosColor: 0xddddff, sizeMultiplier: 1.3, lightColor: 0xeeeeff, weight: 0.04 },
  { type: "OB", color: 0x99bbff, sunR: 180, sunG: 200, sunB: 255, glowColor: 0x6688ff, atmosColor: 0x88aaff, sizeMultiplier: 1.6, lightColor: 0xaaccff, weight: 0.02 },
];

export function pickSpectralType(rng) {
  let r = rng();
  let cumulative = 0;
  for (const st of SPECTRAL_TYPES) {
    cumulative += st.weight;
    if (r <= cumulative) return st;
  }
  return SPECTRAL_TYPES[0];
}

export const PLANET_PALETTES = [
  { surface: 0x1c2050, emissive: 0x101840, wire: 0x7088cc, glow: 0x4466dd, atmos: 0x5599ff },
  { surface: 0x3d1c22, emissive: 0x281010, wire: 0xbb7080, glow: 0xcc5566, atmos: 0xff7766 },
  { surface: 0x1e3820, emissive: 0x102010, wire: 0x70bb80, glow: 0x55cc77, atmos: 0x66ff99 },
  { surface: 0x2d2840, emissive: 0x181430, wire: 0x8877bb, glow: 0x7755cc, atmos: 0x9988ff },
  { surface: 0x3a3020, emissive: 0x201810, wire: 0xbb9955, glow: 0xcc8844, atmos: 0xffbb66 },
  { surface: 0x1a3038, emissive: 0x0e1820, wire: 0x55aabb, glow: 0x4499aa, atmos: 0x66ccdd },
];

export const BUILDING_DEFS = {
  solarArray:  { label: "Solar Array",  icon: "⚡", cost: { minerals: 30 },                buildDays: 10, yields: { energy: 4 } },
  mine:        { label: "Mine",         icon: "⛏",  cost: { energy: 20 },                  buildDays: 8,  yields: { minerals: 3 } },
  farmDome:    { label: "Farm Dome",    icon: "🌾", cost: { energy: 15, minerals: 10 },    buildDays: 6,  yields: { food: 4 } },
  researchLab: { label: "Research Lab", icon: "🔬", cost: { energy: 25, minerals: 20 },    buildDays: 14, yields: { research: 3 } },
  foundry:     { label: "Foundry",      icon: "⚙",  cost: { energy: 30, minerals: 40 },    buildDays: 18, yields: { alloys: 2, minerals: -1 } },
};

export const MAX_SLOTS = 8;
export const SAVE_KEY = "endless-horizons-save";
