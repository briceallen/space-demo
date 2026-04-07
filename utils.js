// ══════════════════════════════════════════════════════════════════════
// ██  PURE UTILITIES — PRNG, Hashing, Star Names, Math
// ══════════════════════════════════════════════════════════════════════

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hashCoords(seed, x, y, z) {
  let h = seed | 0;
  h = Math.imul(h ^ (x * 374761393), 1103515245) + 12345 | 0;
  h = Math.imul(h ^ (y * 668265263), 1103515245) + 12345 | 0;
  h = Math.imul(h ^ (z * 550564233), 1103515245) + 12345 | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const NAME_ONSETS = ["K","T","V","S","N","M","R","Z","L","D","B","G","F","P","Th","Sh","Kr","Tr","Sk","Fl"];
const NAME_VOWELS = ["a","e","i","o","u","ai","ei","au"];
const NAME_CODAS  = ["n","r","l","s","x","th","k","","","",""];

export function generateStarName(seed) {
  const rng = mulberry32(seed ^ 0xBEEF);
  const syllables = 2 + Math.floor(rng() * 2);
  let name = "";
  for (let s = 0; s < syllables; s++) {
    name += NAME_ONSETS[Math.floor(rng() * NAME_ONSETS.length)];
    name += NAME_VOWELS[Math.floor(rng() * NAME_VOWELS.length)];
    if (s < syllables - 1 || rng() < 0.5) {
      name += NAME_CODAS[Math.floor(rng() * NAME_CODAS.length)];
    }
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
