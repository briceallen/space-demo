// ══════════════════════════════════════════════════════════════════════
// ██  GAME ENGINE — State, Buildings, Resources, Save/Load, HUD
// ══════════════════════════════════════════════════════════════════════
import { STYLE_YIELDS, BUILDING_DEFS, MAX_SLOTS, SAVE_KEY } from "./spectral.js";

// ── Game State ──
let gameState = null;

export function getGameState() { return gameState; }
export function setGameState(gs) { gameState = gs; }

export function newGameState(planets, currentSystemSeed, currentStarPos, currentStarName) {
  const planetEntries = planets
    .filter(p => p.name !== "sun")
    .map(p => ({
      name: p.name,
      style: p.style,
      colonized: p.name === planets.find(pp => pp.name !== "sun")?.name,
      population: p.name === planets.find(pp => pp.name !== "sun")?.name ? 100 : 0,
      buildings: [],
    }));

  // Only first planet is colonized
  if (planetEntries.length > 0) {
    planetEntries.forEach((pe, i) => {
      pe.colonized = i === 0;
      pe.population = i === 0 ? 100 : 0;
    });
  }

  return {
    started: true,
    day: 1,
    year: 1,
    speed: 1,
    resources: { energy: 0, minerals: 0, food: 0, research: 0, alloys: 0 },
    homeSystemSeed: currentSystemSeed,
    currentSystemSeed: currentSystemSeed,
    currentStarPos: { x: currentStarPos.x, y: currentStarPos.y, z: currentStarPos.z },
    currentStarName: currentStarName,
    bookmarks: [
      { seed: currentSystemSeed, name: currentStarName, x: currentStarPos.x, y: currentStarPos.y, z: currentStarPos.z },
    ],
    planets: planetEntries,
  };
}

// ── Save / Load ──
export function saveGame() {
  if (!gameState) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(gameState));
    const btn = document.getElementById("btn-save");
    if (btn) {
      btn.textContent = "✓ Saved";
      setTimeout(() => { btn.innerHTML = "💾 Save"; }, 800);
    }
  } catch (_) { /* quota exceeded */ }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

export function hasSave() {
  return !!localStorage.getItem(SAVE_KEY);
}

// ── Speed Controls ──
export function initSpeedControls() {
  const $btnPause = document.getElementById("btn-pause");
  const $btnSpeed1 = document.getElementById("btn-speed1");
  const speedBtns = [$btnPause, $btnSpeed1];
  const speedVals = [0, 1];

  function setSpeed(val) {
    if (!gameState) return;
    gameState.speed = val;
    const active = "text-emerald-400 border-emerald-400/30";
    speedBtns.forEach((btn, i) => {
      if (speedVals[i] === val) btn.className = btn.className.replace(/text-\S+/g, "") + " " + active;
      else btn.className = btn.className.replace(/text-emerald-400/g, "").replace(/border-emerald-400\/30/g, "");
    });
  }

  speedBtns.forEach((btn, i) => btn.addEventListener("click", () => setSpeed(speedVals[i])));
}

// ── Game Tick ──
export const TICK_INTERVAL = 1.0;

export function gameTick() {
  if (!gameState || gameState.speed === 0) return;

  const rates = { energy: 0, minerals: 0, food: 0, research: 0, alloys: 0 };

  for (const gp of gameState.planets) {
    if (!gp.colonized) continue;

    const base = STYLE_YIELDS[gp.style] || STYLE_YIELDS.scattered;
    for (const k in base) rates[k] += base[k];

    for (const b of gp.buildings) {
      if (!b.built) {
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

    const foodSurplus = rates.food;
    if (foodSurplus > 0 && gp.population > 0) {
      gp.population += Math.floor(foodSurplus / 10) || 0;
      if (gameState.day % 5 === 0) gp.population += 1;
    }
  }

  for (const k in rates) {
    gameState.resources[k] = Math.max(0, Math.round((gameState.resources[k] + rates[k]) * 100) / 100);
  }

  gameState._rates = rates;

  gameState.day++;
  if (gameState.day > 360) {
    gameState.day = 1;
    gameState.year++;
  }

  if (gameState.day % 30 === 0) saveGame();
}

// ── HUD Update ──
export function updateHUD() {
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

  const totalPop = gameState.planets.reduce((s, p) => s + p.population, 0);
  document.getElementById("hud-pop").textContent = totalPop.toLocaleString();
}

// ── Planet Panel ──
export function updatePlanetPanel(planet3d) {
  const $planetPanel = document.getElementById("planet-panel");
  if (!gameState) {
    $planetPanel.classList.add("hidden-panel");
    return;
  }

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

  const yieldsEl = document.getElementById("pp-yields");
  const base = STYLE_YIELDS[gp.style] || {};
  yieldsEl.innerHTML = "";
  const yieldIcons = { energy: "⚡", minerals: "⛏", food: "🌾", research: "🔬", alloys: "⚙" };
  for (const k in base) {
    if (base[k] === 0) continue;
    yieldsEl.innerHTML += `<div>${yieldIcons[k]} ${k}</div><div class="text-right text-emerald-400/80">+${base[k]}</div>`;
  }

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

  buildBtnsEl.querySelectorAll("[data-build]").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.build;
      const def = BUILDING_DEFS[type];
      const canAfford = Object.entries(def.cost).every(([r, v]) => gameState.resources[r] >= v);
      if (!canAfford || gp.buildings.length >= MAX_SLOTS) return;

      for (const [r, v] of Object.entries(def.cost)) {
        gameState.resources[r] -= v;
      }
      gp.buildings.push({ type, built: false, progress: 0 });
      updatePlanetPanel(planet3d);
      updateHUD();
    });
  });
}

// ── Bookmarks ──
export function addBookmark(currentSystemSeed, currentStarName, currentStarPos) {
  if (!gameState) return;
  if (!gameState.bookmarks) gameState.bookmarks = [];
  if (gameState.bookmarks.some(b => b.seed === currentSystemSeed)) return;
  gameState.bookmarks.push({
    seed: currentSystemSeed,
    name: currentStarName,
    x: currentStarPos.x,
    y: currentStarPos.y,
    z: currentStarPos.z,
  });
  saveGame();
  updateBookmarkDropdown();
}

export function updateBookmarkDropdown() {
  const $select = document.getElementById("bookmark-select");
  if (!$select || !gameState) return;
  const bookmarks = gameState.bookmarks || [];
  $select.innerHTML = '<option value="" disabled selected>★ Bookmarks</option>';
  for (const bm of bookmarks) {
    const opt = document.createElement("option");
    opt.value = String(bm.seed);
    opt.textContent = bm.name + (bm.seed === (gameState.homeSystemSeed ?? 0) ? " (Home)" : "");
    $select.appendChild(opt);
  }
}

// ── Export / Import ──
export function exportSave() {
  if (!gameState) return;
  const json = JSON.stringify(gameState);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  const $btnExport = document.getElementById("btn-export");
  navigator.clipboard.writeText(b64).then(() => {
    if ($btnExport) {
      $btnExport.textContent = "\u2713 Copied";
      setTimeout(() => { $btnExport.innerHTML = "\uD83D\uDCE4 Export"; }, 1200);
    }
  }).catch(() => {
    prompt("Copy this save string:", b64);
  });
}

export function importSave(enterPlayingFn) {
  const b64 = prompt("Paste your save string:");
  if (!b64 || !b64.trim()) return;
  try {
    const json = decodeURIComponent(escape(atob(b64.trim())));
    const data = JSON.parse(json);
    if (!data.planets || !data.resources) throw new Error("Invalid");
    gameState = data;
    saveGame();
    if (enterPlayingFn) enterPlayingFn();
  } catch (_) {
    alert("Invalid save data.");
  }
}
