/* ============================================================
   BQT Markets — Colonel Blotto
   ------------------------------------------------------------
   CONFIG: paste your deployed Google Apps Script Web App URL
   below to switch from local mode to the shared leaderboard.
   Leave it as "" to run fully local (with a few bot strategies).
   ============================================================ */
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyYzG1IdB6PAGm6H_3o_XxO1zh8vcnT4iTG_dsGLDU86G_map5yWe4svV9dqNztNjMdeA/exec",
  SLOTS: 10,
  TROOPS: 100,
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
   DATA LAYER  (pluggable: live Apps Script  OR  localStorage)
   ============================================================ */
const isLive = () => !!CONFIG.APPS_SCRIPT_URL;

const Data = {
  /* Return array of { username, strategy:[...] } for all players. */
  async all() {
    if (isLive()) {
      const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=all&t=${Date.now()}`);
      if (!res.ok) throw new Error(`read failed (${res.status})`);
      const data = await res.json();
      return (data.players || []).map(normalizePlayer).filter(Boolean);
    }
    const store = readLocal();
    const players = Object.entries(store).map(([username, strategy]) => ({ username, strategy }));
    return [...BOTS.map((b) => ({ ...b })), ...players];
  },

  /* Return this user's saved strategy or null. */
  async get(username) {
    const players = await this.all();
    const hit = players.find((p) => sameName(p.username, username));
    return hit ? hit.strategy : null;
  },

  /* Upsert this user's strategy. */
  async submit(username, strategy) {
    if (isLive()) {
      // text/plain avoids a CORS preflight against Apps Script.
      const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "submit", username, strategy }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const out = await res.json();
      if (out && out.error) throw new Error(out.error);
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
   BLOTTO SCORING  (round-robin)
   ============================================================ */
/* One matchup: fields where a>b score 1 for a, ties split 0.5. */
function matchup(a, b) {
  let fa = 0;
  for (let i = 0; i < CONFIG.SLOTS; i++) {
    if (a[i] > b[i]) fa += 1;
    else if (a[i] === b[i]) fa += 0.5;
  }
  return fa; // opponent's field points = SLOTS - fa
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
      const fb = CONFIG.SLOTS - fa;
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

function renderStack(i) {
  const el = $(`stack-${i}`);
  if (!el) return;
  const n = state.alloc[i];
  el.innerHTML = new Array(n).fill('<span class="dot"></span>').join("");
  el.dataset.count = n;
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
$("btnEdit").addEventListener("click", () => { renderFields(); show("game"); });
$("btnRefresh").addEventListener("click", async () => { await renderResults(); });

async function renderResults() {
  const note = $("resultsNote");
  note.textContent = "Loading standings…";
  let players;
  try { players = await Data.all(); }
  catch (err) { note.textContent = `Couldn't load standings: ${err.message}`; return; }

  const standings = computeStandings(players);
  const you = standings.find((r) => sameName(r.username, state.username));

  // your card
  const yc = $("yourcard");
  if (you) {
    const max = Math.max(...you.strategy, 1);
    const bars = you.strategy
      .map((v) => `<div class="yourcard__bar" style="height:${Math.max(6, (v / max) * 46)}px" title="${v}"></div>`)
      .join("");
    yc.innerHTML = `
      <div class="yourcard__rank">#${you.rank}<small> / ${standings.length}</small></div>
      <div class="yourcard__meta">
        <span class="yourcard__name">${escapeHtml(you.username)}</span>
        <span class="yourcard__sub">score ${you.score} · avg ${you.avg}/10 · ${you.wins}W-${you.losses}L-${you.draws}D</span>
      </div>
      <div class="yourcard__alloc">${bars}</div>`;
  } else { yc.innerHTML = ""; }

  // table
  const rowsHtml = standings.map((r) => `
    <tr class="${sameName(r.username, state.username) ? "is-you" : ""}">
      <td class="board__rank">${r.rank}</td>
      <td class="board__name">${escapeHtml(r.username)}</td>
      <td class="num">${r.score}</td>
      <td class="num">${r.avg}</td>
      <td class="num">${r.wins}-${r.losses}-${r.draws}</td>
    </tr>`).join("");
  $("board").innerHTML = `
    <thead><tr>
      <th class="num">#</th><th>Player</th>
      <th class="num">Score</th><th class="num">Avg/10</th><th class="num">W-L-D</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>`;

  const nBots = isLive() ? 0 : BOTS.length;
  note.textContent = isLive()
    ? `${standings.length} strategies · round-robin · updates as more players submit.`
    : `Local mode: ${standings.length - nBots} of you + ${nBots} bots. Configure APPS_SCRIPT_URL for a shared board.`;
}

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
