/* ============================================================
   BQT Markets — Weighted Blotto
   ------------------------------------------------------------
   Supabase credentials live in assets/js/config.js (from .env.local).
   Leave config empty to run fully local (with a few bot strategies).
   ============================================================ */
const CONFIG = {
  SLOTS: 10,
  TROOPS: 100,
  TROOPS_PER_BEAR: 10,
  BEAR_IMG: "assets/img/bear.png",
};

/* ---------- constants ---------- */
const LS_KEY = "bqt_blotto_local_v1";
const LS_USER = "bqt_blotto_user";

/* Bot strategies used only in local mode so ranking is meaningful. */
const BOTS = [
  { username: "bot·uniform",   strategy: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] },
  { username: "bot·frontload", strategy: [20, 18, 16, 14, 12, 8, 6, 3, 2, 1] },
  { username: "bot·backload",  strategy: [1, 2, 3, 6, 8, 12, 14, 16, 18, 20] },
  { username: "bot·spikes",    strategy: [0, 25, 0, 25, 0, 0, 25, 0, 0, 25] },
  { username: "bot·center",    strategy: [4, 6, 10, 15, 15, 15, 15, 10, 6, 4] },
  { username: "bot·edges",     strategy: [20, 15, 8, 4, 3, 3, 4, 8, 15, 20] },
];

/* ============================================================
   DATA LAYER  (Supabase when configured, else localStorage)
   ============================================================ */
const supabaseCfg = () => (typeof window !== "undefined" && window.SUPABASE_CONFIG) || null;
const isLive = () => !!(supabaseCfg()?.url && supabaseCfg()?.key);

let _db = null;
function db() {
  if (_db) return _db;
  const cfg = supabaseCfg();
  if (!cfg?.url || !cfg?.key) return null;
  const lib = window.supabase;
  if (!lib?.createClient) throw new Error("Supabase client failed to load");
  _db = lib.createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _db;
}

const Data = {
  /* Return array of { username, strategy:[...] } for all players. */
  async all() {
    if (isLive()) {
      const { data, error } = await db().from("players").select("username, strategy");
      if (error) throw new Error(error.message);
      return (data || []).map(normalizePlayer).filter(Boolean);
    }
    const store = readLocal();
    const players = Object.entries(store).map(([username, strategy]) => ({ username, strategy }));
    return [...BOTS.map((b) => ({ ...b })), ...players];
  },

  /* Return this user's strategy or null. */
  async get(username) {
    if (isLive()) {
      const { data, error } = await db()
        .from("players")
        .select("username, strategy")
        .ilike("username", username.trim())
        .maybeSingle();
      if (error) throw new Error(error.message);
      const hit = normalizePlayer(data);
      return hit ? hit.strategy : null;
    }
    const players = await this.all();
    const hit = players.find((p) => sameName(p.username, username));
    return hit ? hit.strategy : null;
  },

  /* Upsert this user's strategy. */
  async submit(username, strategy) {
    if (isLive()) {
      const name = String(username).trim();
      if (!name) throw new Error("username required");
      if (name.length > 24) throw new Error("username too long");
      if (!parseStrategy(strategy)) throw new Error("invalid strategy");
      const { error } = await db().from("players").upsert(
        { username: name, strategy: strategy.join(",") },
        { onConflict: "username" }
      );
      if (error) throw new Error(error.message);
      return;
    }
    const store = readLocal();
    store[username] = strategy;
    writeLocal(store);
  },
};

function normalizePlayer(p) {
  if (!p || !p.username) return null;
  const strat = parseStrategy(p.strategy);
  return strat ? { username: String(p.username), strategy: strat } : null;
}
function parseStrategy(s) {
  let arr = Array.isArray(s) ? s : String(s || "").split(/[,\s]+/);
  arr = arr.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
  if (arr.length !== CONFIG.SLOTS) return null;
  if (arr.some((n) => n < 0)) return null;
  return arr;
}
function sameName(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
function readLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function writeLocal(o) { localStorage.setItem(LS_KEY, JSON.stringify(o)); }

/* ============================================================
   BLOTTO SCORING  (round-robin, field k worth k points)
   ============================================================ */
function fieldWeight(i) { return i + 1; }
function maxMatchPoints() { return (CONFIG.SLOTS * (CONFIG.SLOTS + 1)) / 2; }

/* One matchup: field i is worth (i+1) pts; ties split the weight. */
function matchup(a, b) {
  let fa = 0;
  for (let i = 0; i < CONFIG.SLOTS; i++) {
    const w = fieldWeight(i);
    if (a[i] > b[i]) fa += w;
    else if (a[i] === b[i]) fa += w * 0.5;
  }
  return fa;
}

/* Full standings for a list of players. */
function computeStandings(players) {
  const rows = players.map((p) => ({
    username: p.username, strategy: p.strategy,
    score: 0, wins: 0, losses: 0, draws: 0, opponents: 0,
  }));
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const fa = matchup(rows[i].strategy, rows[j].strategy);
      const fb = maxMatchPoints() - fa;
      rows[i].score += fa;
      rows[i].opponents += 1;
      if (fa > fb) rows[i].wins += 1;
      else if (fa < fb) rows[i].losses += 1;
      else rows[i].draws += 1;
    }
  }
  rows.forEach((r) => {
    r.avg = r.opponents ? r.score / r.opponents : 0;
    r.score = Math.round(r.score * 10) / 10;
    r.avg = Math.round(r.avg * 100) / 100;
  });
  rows.sort((a, b) => b.score - a.score || b.wins - a.wins || a.username.localeCompare(b.username));
  rows.forEach((r, idx) => (r.rank = idx + 1));
  return rows;
}

/* ============================================================
   STATE + DOM
   ============================================================ */
const state = { username: "", alloc: new Array(CONFIG.SLOTS).fill(0) };
const $ = (id) => document.getElementById(id);
const screens = { entry: $("screenEntry"), game: $("screenGame"), results: $("screenResults") };

function show(name) {
  Object.values(screens).forEach((s) => s.classList.add("is-hidden"));
  screens[name].classList.remove("is-hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- entry ---------- */
$("entryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("usernameInput").value.trim();
  if (!name) return;
  const btn = $("enterBtn");
  btn.disabled = true; btn.textContent = "Loading…";
  try {
    state.username = name;
    localStorage.setItem(LS_USER, name);
    const prev = await Data.get(name);
    state.alloc = prev ? prev.slice() : new Array(CONFIG.SLOTS).fill(0);
    $("whoami").textContent = name;
    renderFields();
    show("game");
    setMsg(prev ? "Loaded your saved deployment. Adjust and resubmit anytime." : "");
  } catch (err) {
    $("entryHint").textContent = `Couldn't reach the leaderboard: ${err.message}`;
  } finally {
    btn.disabled = false; btn.textContent = "Enter";
  }
});

/* ---------- fields ---------- */
function renderFields() {
  const wrap = $("fields");
  wrap.innerHTML = "";
  for (let i = 0; i < CONFIG.SLOTS; i++) {
    const col = document.createElement("div");
    col.className = "field";
    col.innerHTML = `
      <div class="field__stack" id="stack-${i}" aria-hidden="true"></div>
      <div class="field__index">${i + 1}</div>
      <div class="field__stepper">
        <button class="step" type="button" data-i="${i}" data-d="1" aria-label="Add a troop to field ${i + 1}">+</button>
        <input class="field__num" type="number" min="0" max="100" value="${state.alloc[i]}" data-i="${i}" aria-label="Field ${i + 1} troops" />
        <button class="step" type="button" data-i="${i}" data-d="-1" aria-label="Remove a troop from field ${i + 1}">&minus;</button>
      </div>`;
    wrap.appendChild(col);
    renderStack(i);
  }
  wrap.querySelectorAll(".step").forEach((btn) => {
    btn.addEventListener("click", () => bump(+btn.dataset.i, +btn.dataset.d));
  });
  wrap.querySelectorAll(".field__num").forEach((el) => {
    el.addEventListener("input", (e) => {
      const i = +e.target.dataset.i;
      let v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v)) v = 0;
      const cap = state.alloc[i] + remainingTroops(); // never let total exceed 100
      v = Math.max(0, Math.min(cap, v));
      state.alloc[i] = v;
      renderStack(i);
      updateCounter();
    });
    el.addEventListener("blur", (e) => { e.target.value = state.alloc[+e.target.dataset.i]; });
  });
  updateCounter();
}

function bump(i, d) {
  if (d > 0 && remainingTroops() <= 0) return;
  const next = Math.max(0, Math.min(100, state.alloc[i] + d));
  state.alloc[i] = next;
  syncField(i);
  updateCounter();
}

function renderTroopBears(n) {
  if (n <= 0) return "";
  const per = CONFIG.TROOPS_PER_BEAR;
  const full = Math.floor(n / per);
  const rem = n % per;
  const parts = [];
  for (let i = 0; i < full; i++) {
    parts.push(`<div class="bear bear--full"><img src="${CONFIG.BEAR_IMG}" alt="" draggable="false" /></div>`);
  }
  if (rem > 0) {
    const frac = rem / per;
    parts.push(`<div class="bear bear--partial" style="--bear-frac:${frac}"><img src="${CONFIG.BEAR_IMG}" alt="" draggable="false" /></div>`);
  }
  return parts.join("");
}

function renderStack(i) {
  const el = $(`stack-${i}`);
  if (!el) return;
  el.innerHTML = renderTroopBears(state.alloc[i]);
  el.dataset.count = state.alloc[i];
}

function syncField(i) {
  const input = document.querySelector(`.field__num[data-i="${i}"]`);
  if (input) input.value = state.alloc[i];
  renderStack(i);
}
function sum() { return state.alloc.reduce((a, b) => a + b, 0); }
function remainingTroops() { return CONFIG.TROOPS - sum(); }

function updateCounter() {
  const remaining = remainingTroops();
  const c = $("counter");
  $("remaining").textContent = remaining;
  c.classList.toggle("is-over", remaining < 0);
  c.classList.toggle("is-zero", remaining === 0);
  $("btnSubmit").disabled = remaining !== 0;
  // disable + when nothing left, − when field is empty
  document.querySelectorAll(".step").forEach((btn) => {
    const i = +btn.dataset.i, d = +btn.dataset.d;
    btn.disabled = d > 0 ? remaining <= 0 : state.alloc[i] <= 0;
  });
  if (remaining < 0) setMsg(`Over by ${-remaining} — pull some troops back.`, "error");
  else if (remaining > 0) setMsg(`${remaining} troops still in reserve.`);
  else setMsg("All 100 deployed. Ready to submit.", "ok");
}
function setMsg(text, kind) {
  const el = $("gameMsg");
  el.textContent = text || "";
  el.className = "game__msg" + (kind ? ` is-${kind}` : "");
}

/* ---------- tools ---------- */
$("btnEven").addEventListener("click", () => {
  const base = Math.floor(CONFIG.TROOPS / CONFIG.SLOTS);
  state.alloc = new Array(CONFIG.SLOTS).fill(base);
  let rem = CONFIG.TROOPS - base * CONFIG.SLOTS;
  for (let i = 0; rem > 0; i++, rem--) state.alloc[i] += 1;
  refreshAll();
});
$("btnClear").addEventListener("click", () => { state.alloc = new Array(CONFIG.SLOTS).fill(0); refreshAll(); });
$("btnRandom").addEventListener("click", () => {
  const w = Array.from({ length: CONFIG.SLOTS }, () => Math.random());
  const t = w.reduce((a, b) => a + b, 0);
  const a = w.map((x) => Math.floor((x / t) * CONFIG.TROOPS));
  let rem = CONFIG.TROOPS - a.reduce((s, n) => s + n, 0);
  for (let i = 0; rem > 0; i = (i + 1) % CONFIG.SLOTS, rem--) a[i] += 1;
  state.alloc = a; refreshAll();
});
function refreshAll() { state.alloc.forEach((_, i) => syncField(i)); updateCounter(); }

/* ---------- submit ---------- */
$("btnSubmit").addEventListener("click", async () => {
  if (sum() !== CONFIG.TROOPS) return;
  const btn = $("btnSubmit");
  btn.disabled = true; btn.textContent = "Submitting…";
  try {
    await Data.submit(state.username, state.alloc.slice());
    await renderResults();
    show("results");
  } catch (err) {
    setMsg(`Submit failed: ${err.message}`, "error");
  } finally {
    btn.textContent = "Submit deployment"; updateCounter();
  }
});

/* ---------- results ---------- */
$("btnViewBoard").addEventListener("click", async () => {
  const btn = $("btnViewBoard");
  btn.disabled = true; const label = btn.innerHTML; btn.textContent = "Loading…";
  await renderResults();
  show("results");
  btn.disabled = false; btn.innerHTML = label;
});
$("btnEdit").addEventListener("click", () => {
  if (!state.username) { show("entry"); return; }
  renderFields(); show("game");
});
$("btnRefresh").addEventListener("click", async () => { await renderResults(); });

let lastStandings = [];

async function renderResults() {
  const note = $("resultsNote");
  note.textContent = "Loading standings…";
  let players;
  try { players = await Data.all(); }
  catch (err) { note.textContent = `Couldn't load standings: ${err.message}`; return; }

  const standings = computeStandings(players);
  lastStandings = standings;
  const you = state.username ? standings.find((r) => sameName(r.username, state.username)) : null;
  $("btnEdit").textContent = state.username ? "Edit strategy" : "Enter to play";

  // your deployment (always visible in results, no edit needed)
  const yc = $("yourcard");
  if (you) {
    yc.innerHTML = `
      <div class="yourcard__top">
        <div class="yourcard__rank">#${you.rank}<small> / ${standings.length}</small></div>
        <div class="yourcard__meta">
          <span class="yourcard__name">${escapeHtml(you.username)} <span class="yourcard__tagme">you</span></span>
          <span class="yourcard__sub">score ${you.score} · avg ${you.avg}/${maxMatchPoints()} · ${you.wins}W-${you.losses}L-${you.draws}D</span>
        </div>
        <button class="btn btn--ghost btn--sm yourcard__edit" type="button" id="btnEditInline">Edit deployment</button>
      </div>
      <div class="breakdown">${breakdownBars(you.strategy)}</div>`;
    $("btnEditInline").addEventListener("click", () => { renderFields(); show("game"); });
  } else { yc.innerHTML = ""; }

  // table (rows clickable for a breakdown)
  const rowsHtml = standings.map((r) => `
    <tr class="board__row ${sameName(r.username, state.username) ? "is-you" : ""}" data-user="${escapeHtml(r.username)}" tabindex="0" role="button" aria-label="View ${escapeHtml(r.username)}'s strategy">
      <td class="board__rank">${r.rank}</td>
      <td class="board__name">${escapeHtml(r.username)}</td>
      <td class="num">${r.score}</td>
      <td class="num">${r.avg}</td>
      <td class="num">${r.wins}-${r.losses}-${r.draws}</td>
    </tr>`).join("");
  $("board").innerHTML = `
    <thead><tr>
      <th class="num">#</th><th>Player</th>
      <th class="num">Score</th><th class="num">Avg/${maxMatchPoints()}</th><th class="num">W-L-D</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>`;
  $("board").querySelectorAll(".board__row").forEach((tr) => {
    const open = () => openDetail(tr.dataset.user);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });

  const nBots = isLive() ? 0 : BOTS.length;
  note.textContent = (isLive()
    ? `${standings.length} strategies · round-robin`
    : `Local mode: ${standings.length - nBots} of you + ${nBots} bots`) + " · tap any player to see their deployment.";
}

/* Read-only field bars with troop numbers (used in your-card and modal). */
function breakdownBars(strategy) {
  const max = Math.max(...strategy, 1);
  return strategy.map((v, i) => `
    <div class="bd">
      <div class="bd__track"><div class="bd__fill" style="height:${Math.max(3, (v / max) * 100)}%"></div></div>
      <div class="bd__val">${v}</div>
      <div class="bd__idx">${i + 1}</div>
    </div>`).join("");
}

/* ---------- player detail modal ---------- */
function openDetail(username) {
  const r = lastStandings.find((s) => sameName(s.username, username));
  if (!r) return;
  const isYou = sameName(username, state.username);
  const me = lastStandings.find((s) => sameName(s.username, state.username));

  // head-to-head vs you
  let h2h = "";
  if (me && !isYou) {
    const yourFP = matchup(me.strategy, r.strategy);
    const theirFP = maxMatchPoints() - yourFP;
    const verdict = yourFP > theirFP ? "you win" : yourFP < theirFP ? "you lose" : "draw";
    h2h = `
      <div class="detail__h2h">
        <span class="detail__h2hlabel">Head-to-head vs you</span>
        <span class="detail__h2hscore">${yourFP} &ndash; ${theirFP} <em>(${verdict})</em></span>
      </div>`;
  }

  $("detailBody").innerHTML = `
    <button class="modal__close" data-close aria-label="Close">&times;</button>
    <div class="detail__head">
      <div class="detail__rank">#${r.rank}</div>
      <div>
        <div class="detail__name">${escapeHtml(r.username)}${isYou ? ' <span class="yourcard__tagme">you</span>' : ""}</div>
        <div class="detail__sub">score ${r.score} · avg ${r.avg}/${maxMatchPoints()} · ${r.wins}W-${r.losses}L-${r.draws}D</div>
      </div>
    </div>
    ${h2h}
    <div class="detail__grid">${breakdownBars(r.strategy)}</div>
    <p class="detail__foot">Troops per field (1&ndash;10) &middot; total ${r.strategy.reduce((a, b) => a + b, 0)}</p>`;
  $("detailBody").querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeDetail));
  $("detail").classList.remove("is-hidden");
}
function closeDetail() { $("detail").classList.add("is-hidden"); }
$("detail").querySelector(".modal__backdrop").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- boot ---------- */
(function init() {
  const badge = $("modeBadge");
  if (isLive()) { badge.textContent = "live"; badge.classList.add("is-live"); }
  else { badge.textContent = "local"; }
  const last = localStorage.getItem(LS_USER);
  if (last) $("usernameInput").value = last;
})();
