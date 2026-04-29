// ══════════════════════════════════════════════════════════════════════
// ██  VISUAL CONSTANTS — Spectral Types, Planet Palettes, Layout
// ══════════════════════════════════════════════════════════════════════

export const PLANET_SPACING = 4;
export const DEG = Math.PI / 180;

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

// Map a HYG `spect` string (e.g. "G2V", "M3.5", "B0Iab") to one of our 6 SPECTRAL_TYPES.
// O and B both fold into the OB entry; brown dwarfs and unknowns fall back to M.
export function spectralTypeFromHyg(spect) {
  if (!spect) return SPECTRAL_TYPES[0];
  const m = String(spect).trim().match(/^([OBAFGKM])/i);
  if (!m) return SPECTRAL_TYPES[0];
  const letter = m[1].toUpperCase();
  if (letter === "O" || letter === "B") return SPECTRAL_TYPES[5];
  const idx = { M: 0, K: 1, G: 2, F: 3, A: 4 }[letter];
  return SPECTRAL_TYPES[idx ?? 0];
}

export const PLANET_PALETTES = [
  { surface: 0x1c2050, emissive: 0x101840, wire: 0x7088cc, glow: 0x4466dd, atmos: 0x5599ff },
  { surface: 0x3d1c22, emissive: 0x281010, wire: 0xbb7080, glow: 0xcc5566, atmos: 0xff7766 },
  { surface: 0x1e3820, emissive: 0x102010, wire: 0x70bb80, glow: 0x55cc77, atmos: 0x66ff99 },
  { surface: 0x2d2840, emissive: 0x181430, wire: 0x8877bb, glow: 0x7755cc, atmos: 0x9988ff },
  { surface: 0x3a3020, emissive: 0x201810, wire: 0xbb9955, glow: 0xcc8844, atmos: 0xffbb66 },
  { surface: 0x1a3038, emissive: 0x0e1820, wire: 0x55aabb, glow: 0x4499aa, atmos: 0x66ccdd },
];
