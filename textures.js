// ══════════════════════════════════════════════════════════════════════
// ██  PROCEDURAL TEXTURE GENERATORS
// ══════════════════════════════════════════════════════════════════════
import * as THREE from "https://unpkg.com/three@0.164.0/build/three.module.js";
import { mulberry32 } from "./utils.js";

export function generateContinentTexture(baseHex, continentHex, seed, style) {
  const W = 1024, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${(baseHex >> 16) & 255},${(baseHex >> 8) & 255},${baseHex & 255})`;
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(seed);

  const styles = {
    scattered:    { scale: 4.0, seaLevel: 0.02, edge: 0.06, warp: 0.9,  poleDrop: 0.25, tint: 0.4,  octaves: 5 },
    continental:  { scale: 3.0, seaLevel: 0.12, edge: 0.05, warp: 1.6,  poleDrop: 0.18, tint: 0.35, octaves: 5 },
    oceanic:      { scale: 1.5, seaLevel: 0.15, edge: 0.06, warp: 2.4,  poleDrop: 0.08, tint: 0.30, octaves: 3 },
  };
  const S = styles[style] || styles.scattered;

  const N = 256;
  const perm = new Uint8Array(N * 2);
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
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
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
    const d000 = dot3(AA,     fx,     fy,     fz);
    const d100 = dot3(BA,     fx - 1, fy,     fz);
    const d010 = dot3(AB,     fx,     fy - 1, fz);
    const d110 = dot3(BB,     fx - 1, fy - 1, fz);
    const d001 = dot3(AA + 1, fx,     fy,     fz - 1);
    const d101 = dot3(BA + 1, fx - 1, fy,     fz - 1);
    const d011 = dot3(AB + 1, fx,     fy - 1, fz - 1);
    const d111 = dot3(BB + 1, fx - 1, fy - 1, fz - 1);
    const x00 = d000 + u * (d100 - d000);
    const x10 = d010 + u * (d110 - d010);
    const x01 = d001 + u * (d101 - d001);
    const x11 = d011 + u * (d111 - d011);
    const y0 = x00 + v * (x10 - x00);
    const y1 = x01 + v * (x11 - x01);
    return y0 + w * (y1 - y0);
  }

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
      const wx = sx + fbm3(sx + 3.1, sy + 7.5, sz + 1.3) * S.warp;
      const wy = sy + fbm3(sx + 11.7, sy + 4.2, sz + 8.6) * S.warp;
      const wz = sz + fbm3(sx + 6.9, sy + 0.8, sz + 5.4) * S.warp;
      field[py * W + px] = fbm3(wx, wy, wz);
    }
  }

  for (let py = 0; py < H; py++) {
    const lat01 = py / H;
    const poleFade = Math.min(lat01 * 5, (1 - lat01) * 5, 1);
    for (let px = 0; px < W; px++) {
      field[py * W + px] -= (1 - poleFade) * S.poleDrop;
    }
  }

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

export function generateSunTexture(seed, baseR, baseG, baseB) {
  baseR = baseR ?? 255;
  baseG = baseG ?? 200;
  baseB = baseB ?? 60;

  const W = 512, H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const rng = mulberry32(seed);
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const grain = (rng() - 0.5) * 20;
      d[i]     = Math.min(255, Math.max(0, Math.round(baseR + grain)));
      d[i + 1] = Math.min(255, Math.max(0, Math.round(baseG + grain)));
      d[i + 2] = Math.min(255, Math.max(0, Math.round(baseB + grain * 0.5)));
      d[i + 3] = 255;
    }
  }

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
