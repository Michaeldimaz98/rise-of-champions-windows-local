/* Rise of Champions — browser client (vanilla JS, no build step) */
'use strict';

const CID_KEY = 'roc_career_id';
const TOKEN_KEY = 'roc_token';
let CID = localStorage.getItem(CID_KEY);
let TOKEN = localStorage.getItem(TOKEN_KEY);
let S = null; // state view
let TAB = 'home';
let SUB = null; // more-subscreen

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Phase 70: shared empty-state component. Contextual, no fake data.
const emptyState = (icon, title, hint) =>
  `<div class="empty-state"><span class="eico">${icon}</span><h4>${esc(title)}</h4><p>${esc(hint)}</p></div>`;
const fmtCash = (n) => (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('en-US');
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };

// ---------- API ----------
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    TOKEN = null; localStorage.removeItem(TOKEN_KEY);
    renderAuth();
    throw new Error(data.error || 'Sesi berakhir. Silakan masuk lagi.');
  }
  if (!res.ok) throw friendlyHttpError(res.status, data.error);
  return data;
}

// Phase 64: friendly Indonesian feedback for duplicate submissions.
// The server emits two distinct 429s: debounceAction (the same action
// re-fired inside its window — the duplicate-submission case) and the
// global rate limiter. They must not be confused with each other, and no
// other error message is altered.
const DEBOUNCE_MESSAGE = 'too fast — please wait a moment';
function friendlyHttpError(status, serverMessage) {
  const err = new Error(serverMessage || `HTTP ${status}`);
  err.statusCode = status;
  if (status === 429) {
    err.message = serverMessage === DEBOUNCE_MESSAGE
      ? 'Aksi masih diproses — tunggu sebentar ya.'
      : 'Terlalu banyak permintaan — tunggu sebentar.';
  }
  return err;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const C = (p, b) => api('POST', `/api/career/${CID}${p}`, b);
const CG = (p) => api('GET', `/api/career/${CID}${p}`);
const CP = (p, b) => api('PUT', `/api/career/${CID}${p}`, b);

async function refresh() {
  S = await CG('');
  $('#tb-club').textContent = S.club.name;
  $('#tb-cash').textContent = '💰 ' + fmtCash(S.club.cash);
  $('#tb-season').textContent = `S${S.season} · MD ${S.matchday}/${S.totalMatchdays}`;
  // Phase 32: inbox unread badge
  try {
    const ib = await GET('/api/inbox').catch(() => null);
    const pill = $('#tb-inbox');
    if (ib && ib.unreadCount > 0) { pill.textContent = `📥 ${ib.unreadCount}`; pill.classList.add('accent'); }
    else if (pill) { pill.textContent = '📥'; pill.classList.remove('accent'); }
  } catch { /* non-fatal */ }
}

// ---------- toast & modal ----------
function toast(msg, ms = 3500) {
  const t = el(`<div class="toast">${msg}</div>`);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const bg = el('<div class="modal-bg"></div>');
  const m = el(`<div class="modal">${html}</div>`);
  bg.onclick = closeModal;
  root.appendChild(bg); root.appendChild(m);
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// Phase 61: reusable destructive-action confirmation. Reuses openModal/closeModal
// and the existing button conventions (.btn secondary = safe Cancel,
// .btn danger = destructive Confirm). Cancel never mutates; Confirm runs the
// provided async operation exactly once (pending guard blocks double-clicks).
// On error the dialog stays open so the user can retry or cancel; the server
// remains the authority for validation.
function confirmDestructive({ title, detail, confirmLabel, onConfirm }) {
  openModal(`
    <h2>${title}</h2>
    <div class="pmeta">${detail}</div>
    <div class="bar-row" style="margin-top:12px">
      <button class="btn secondary" id="cf-cancel">Batal</button>
      <button class="btn danger" id="cf-confirm">${confirmLabel}</button>
    </div>`);
  let pending = false;
  const cleanup = () => {
    if (document.removeEventListener && escHandler) document.removeEventListener('keydown', escHandler);
  };
  const escHandler = (e) => {
    if (e.key === 'Escape' && !pending) { cleanup(); closeModal(); }
  };
  if (document.addEventListener) document.addEventListener('keydown', escHandler);
  const cancelBtn = $('#cf-cancel');
  if (cancelBtn && cancelBtn.focus) cancelBtn.focus(); // safe action focused
  cancelBtn.onclick = () => { if (pending) return; cleanup(); closeModal(); };
  const confirmBtn = $('#cf-confirm');
  confirmBtn.onclick = async () => {
    if (pending) return; // duplicate clicks cannot cause duplicate mutations
    pending = true;
    confirmBtn.disabled = true;
    try {
      await onConfirm();
      cleanup();
      closeModal();
    } catch (e) {
      pending = false;
      confirmBtn.disabled = false;
      toast(e.message);
    }
  };
}

// ---------- navigation ----------
function nav(tab, sub = null) {
  // Phase 62: dirty lineup-editor guard. Intercepts navigation that would
  // discard unsaved edits. "Stay" preserves the draft; "Leave" discards it
  // locally (no mutation) and continues. Clean editors navigate normally.
  if (!lineupNavBypass && TAB === 'match' && SUB === 'lineup'
      && !(tab === 'match' && sub === 'lineup') && lineupDirty()) {
    if (lineupLeaveOpen) return; // one dialog at a time
    lineupLeaveOpen = true;
    openModal(`
      <h2>Perubahan susunan belum disimpan</h2>
      <div class="pmeta">Ada perubahan yang belum disimpan. Keluar sekarang akan membuangnya.</div>
      <div class="bar-row" style="margin-top:12px">
        <button class="btn secondary" id="lu-stay">Tetap &amp; ubah</button>
        <button class="btn danger" id="lu-leave">Keluar tanpa menyimpan</button>
      </div>`);
    const close = () => { lineupLeaveOpen = false; closeModal(); };
    const unbindEsc = () => { if (document.removeEventListener) document.removeEventListener('keydown', escH); };
    const escH = (e) => { if (e.key === 'Escape') { unbindEsc(); close(); } };
    if (document.addEventListener) document.addEventListener('keydown', escH);
    const stayBtn = $('#lu-stay');
    if (stayBtn && stayBtn.focus) stayBtn.focus();
    stayBtn.onclick = () => { unbindEsc(); close(); };
    $('#lu-leave').onclick = () => {
      unbindEsc();
      lineupLeaveOpen = false;
      closeModal();
      lineupSel = null; lineupBaseline = null; // discard draft locally; no request
      updateLineupUnloadGuard();
      lineupNavBypass = true;
      try { nav(tab, sub); } finally { lineupNavBypass = false; }
    };
    return;
  }
  TAB = tab; SUB = sub;
  document.querySelectorAll('#bottomnav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  render();
}
document.querySelectorAll('#bottomnav button').forEach((b) =>
  b.addEventListener('click', () => nav(b.dataset.tab)));

function render() {
  const sc = $('#screen');
  // Phase 68: view key for responsive layout scoping (desktop grids).
  sc.dataset.view = SUB ? `${TAB}-${SUB}` : TAB;
  if (TAB === 'home') return renderHome(sc);
  if (TAB === 'squad') return renderSquad(sc);
  if (TAB === 'match') return renderMatch(sc);
  if (TAB === 'club') return renderClub(sc);
  return renderMore(sc);
}
function backTo(tab) {
  return `<button class="backbtn" onclick="nav('${tab}')">← Kembali</button>`;
}
window.nav = nav;

// ---------- start ----------
// ---------- auth ----------
async function renderAuth() {
  $('#topbar').classList.add('hidden');
  $('#bottomnav').classList.add('hidden');
  S = null; CID = null;
  let mode = 'login';
  $('#screen').innerHTML = `
    <div class="start-wrap">
      <div class="logo-big">🏆</div>
      <h1>Rise of Champions</h1>
      <p class="dim">Masuk untuk mengelola klubmu — dan tantang manajer lain dalam laga persahabatan PvP.</p>
      <div class="card" style="text-align:left">
        <div class="seg">
          <button class="btn" id="tab-login">Masuk</button>
          <button class="btn secondary" id="tab-register">Daftar</button>
        </div>
        <label>Username</label>
        <input id="auth-user" placeholder="3–20 karakter: huruf, angka, _" maxlength="20" autocomplete="username">
        <label>Kata Sandi</label>
        <input id="auth-pass" type="password" placeholder="min 6 karakter" autocomplete="current-password">
        <button class="btn" id="auth-go">Masuk</button>
        <div class="dim" id="auth-err" style="color:#e05c5c;min-height:18px"></div>
      </div>
    </div>`;
  const paint = () => {
    $('#tab-login').className = 'btn' + (mode === 'login' ? '' : ' secondary');
    $('#tab-register').className = 'btn' + (mode === 'register' ? '' : ' secondary');
    $('#auth-go').textContent = mode === 'login' ? 'Masuk' : 'Buat akun';
  };
  $('#tab-login').onclick = () => { mode = 'login'; paint(); };
  $('#tab-register').onclick = () => { mode = 'register'; paint(); };
  const submit = async () => {
    const username = $('#auth-user').value.trim();
    const password = $('#auth-pass').value;
    $('#auth-err').textContent = '';
    try {
      const r = await POST('/api/auth/' + mode, { username, password });
      TOKEN = r.token; localStorage.setItem(TOKEN_KEY, TOKEN);
      toast(mode === 'login' ? 'Selamat datang kembali, gaffer!' : 'Akun dibuat. Semoga beruntung, gaffer!');
      renderStart();
    } catch (e) { $('#auth-err').textContent = e.message; }
  };
  $('#auth-go').onclick = submit;
  $('#auth-pass').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

async function logout() {
  try { await POST('/api/auth/logout', {}); } catch { /* best-effort */ }
  TOKEN = null; localStorage.removeItem(TOKEN_KEY);
  lineupSel = null; lineupBaseline = null; // Phase 62: drop stale editor draft
  renderAuth();
}

async function renderStart() {
  $('#topbar').classList.add('hidden');
  $('#bottomnav').classList.add('hidden');
  let saves = [];
  try { saves = (await GET('/api/career')).saves ?? []; } catch { /* no saves yet */ }
  $('#screen').innerHTML = `
    <div class="start-wrap">
      <div class="logo-big">🏆</div>
      <h1>Rise of Champions</h1>
      <p class="dim">Football manager simulator. Build your club, master tactics, lift trophies.</p>
      ${saves.length ? `<div class="card" style="text-align:left"><h3>Lanjutkan</h3>
        ${saves.map((s) => `<div class="row"><span><b>${esc(s.clubName)}</b><div class="pmeta">Musim ${s.season} · MD ${s.matchday} · 💰 ${fmtCash(s.cash)}</div></span>
        <button class="btn small" onclick="continueCareer('${s.id}')">Main</button></div>`).join('')}
      </div>` : ''}
      <div class="card" style="text-align:left">
        <label>Nama Klub</label>
        <input id="clubname" placeholder="cth. Dimas FC" maxlength="30">
        <button class="btn" id="startbtn">Mulai ${saves.length ? 'Baru ' : ''}Karier</button>
      </div>
      <button class="btn secondary" id="logoutbtn">Keluar</button>
    </div>`;
  $('#logoutbtn').onclick = logout;
  $('#startbtn').onclick = async () => {
    const name = $('#clubname').value.trim();
    if (!name) return toast('Beri nama klub dulu.');
    try {
      const { id } = await POST('/api/career', { clubName: name });
      enterCareer(id);
      toast('Karier dimulai. Semoga beruntung, gaffer!');
    } catch (e) { toast(e.message); }
  };
}
window.continueCareer = (id) => enterCareer(id);
function enterCareer(id) {
  CID = id; localStorage.setItem(CID_KEY, id);
  lineupSel = null; lineupBaseline = null; // Phase 62: drop stale editor draft
  $('#topbar').classList.remove('hidden');
  $('#bottomnav').classList.remove('hidden');
  refresh().then(() => nav('home')).catch(() => { localStorage.removeItem(CID_KEY); CID = null; renderStart(); });
}

// ---------- home ----------
function renderHome(sc) {
  const fx = S.nextFixture;
  const top5 = S.table.slice(0, 5);
  const myPos = S.table.findIndex((r) => r.clubId === S.club.id) + 1;
  sc.innerHTML = `
    <div id="daily-banner"></div>
    <section class="stadium-hero">
      <div class="hero-club">
        <div class="hero-crest">🏆</div>
        <div>
          <div class="eyebrow">Rise of Champions</div>
          <h2>${esc(S.club.name)}</h2>
          <div class="dim">Liga Nusantara · Musim ${S.season}</div>
        </div>
      </div>
      <div class="hero-next">
        <div class="eyebrow">Laga berikut · Matchday ${fx ? fx.matchday : '-'}</div>
        <div class="vs">${fx ? esc(fx.home) + ' <span class="dim">vs</span> ' + esc(fx.away) : 'Musim selesai'}</div>
        ${fx ? `<button class="btn" id="playbtn">▶ Mainkan Matchday ${fx.matchday}</button>` : ''}
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><div class="v">${myPos}<span class="dim">/${S.table.length}</span></div><div class="k">Posisi liga</div></div>
        <div class="hero-stat"><div class="v ${S.board.confidence < 30 ? 'bad' : 'accent'}">${S.board.confidence}%</div><div class="k">${esc(boardStatusLabel(S.board.status))}</div></div>
        <div class="hero-stat"><div class="v">${fmtCash(S.club.cash)}</div><div class="k">Kas klub</div></div>
      </div>
    </section>
    <div class="quick-actions">
      <button class="quick-action" onclick="nav('match','lineup')"><span class="ico">📋</span>Susunan</button>
      <button class="quick-action" onclick="nav('match','tactics')"><span class="ico">♟️</span>Taktik</button>
      <button class="quick-action" onclick="nav('more','training')"><span class="ico">🏋️</span>Latihan</button>
      <button class="quick-action" onclick="nav('more','transfers')"><span class="ico">💸</span>Transfer</button>
    </div>
    <div class="card"><h3>Top 5 <span class="sub">Liga Nusantara</span></h3>
      <table>${top5.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.played}</td><td class="num"><b>${r.points}</b></td></tr>`).join('')}</table>
      <button class="btn secondary" onclick="nav('more','league')">Klasemen Penuh</button>
    </div>
    <div class="card"><h3>🏆 Piala</h3><div id="home-cup" class="dim">Memuat…</div>
      <button class="btn secondary" onclick="nav('more','cup')">Lihat Piala</button>
    </div>
    <div class="card"><h3>🌍 Continental</h3><div id="home-cont" class="dim">Memuat…</div>
      <button class="btn secondary" onclick="nav('more','continental')">Lihat Continental</button>
    </div>
    <div class="card"><h3>Notifikasi</h3>
      ${S.notifications.length ? S.notifications.map((n) => `<div class="row"><span>${esc(n.text)}</span></div>`).join('') : '<div class="dim">Tidak ada yang baru.</div>'}
    </div>`;
  const pb = $('#playbtn');
  if (pb) pb.onclick = playMatchday;
  // Phase 36: home cup card (async, non-blocking)
  CG('/cup').then((cup) => {
    const el = $('#home-cup');
    if (!el) return;
    el.innerHTML = cup.status === 'complete'
      ? `<b>🏆 ${esc(cup.champion ?? '?')}</b> <span class="dim">champions</span>`
      : cup.playerFixture
        ? `<b>${esc(roundLabel(cup.playerFixture.round))}</b><div class="pmeta">${esc(cup.playerFixture.home)} vs ${esc(cup.playerFixture.away)}</div>`
        : `<span class="dim">Tersingkir · laju: ${esc(roundLabel(cup.playerRun) ?? '—')}</span>`;
  }).catch(() => { const el = $('#home-cup'); if (el) el.textContent = '—'; });
  // Phase 37: home continental card (async, non-blocking)
  CG('/continental').then((cc) => {
    const el = $('#home-cont');
    if (!el) return;
    el.innerHTML = !cc.qualified
      ? '<span class="dim">Finis 4 besar untuk lolos</span>'
      : !cc.playerQualified
        ? '<span class="dim">Tidak lolos</span>'
        : cc.status === 'complete'
          ? `<b>🏆 ${esc(cc.champion ?? '?')}</b> <span class="dim">juara</span>`
          : cc.playerFixture
            ? `<b>${esc(roundLabel(cc.playerFixture.round))}</b><div class="pmeta">${esc(cc.playerFixture.home)} vs ${esc(cc.playerFixture.away)}</div>`
            : `<span class="dim">Fase grup · laju: ${esc(roundLabel(cc.playerRun) ?? '—')}</span>`;
  }).catch(() => { const el = $('#home-cont'); if (el) el.textContent = '—'; });
  // daily reward banner (async, non-blocking)
  GET('/api/rewards/daily').then((d) => {
    const elx = $('#daily-banner');
    if (!elx || !d.canClaim) return;
    const today = d.calendar.find((c) => c.state === 'today');
    elx.innerHTML = `<div class="card" style="border:1px solid #c9a227"><div class="row"><span>🎁 <b>Hadiah harian tersedia</b><div class="pmeta">Hari ${d.nextStreak}: +${fmtCash(today.cash)}${d.nextStreak % 7 === 0 ? ' + bonus mingguan!' : ''}</div></span><button class="btn small" id="daily-claim">Klaim</button></div></div>`;
    $('#daily-claim').onclick = async () => {
      try {
        const r = await POST('/api/rewards/daily/claim', {});
        toast(r.alreadyClaimed ? 'Already claimed today.' : `🎁 +${fmtCash(r.reward.cash + r.bonus)} claimed! Streak: ${r.streak} day(s)`);
        await refresh();
        render();
      } catch (e) { toast(e.message); }
    };
  }).catch(() => {});
}

let playBusy = false; // Phase 64: no double matchday sim
async function playMatchday() {
  if (playBusy) return;
  playBusy = true;
  try {
    toast('Mensimulasikan matchday…');
    const out = await C('/play');
    S = out.state;
    await refresh();
    if (out.playerResult) showMatchResult(out.playerResult, out.seasonEnd, out.playerReport);
    else { toast('Pekan tanpa pertandingan.'); render(); }
    for (const a of out.unlockedAchievements ?? []) {
      toast(`🏆 Pencapaian: ${a.name} (+${fmtCash(a.cash)})`, 5000);
    }
  } catch (e) { toast(e.message); }
  finally { playBusy = false; }
}

// ---------- live match (Phase 38) ----------
let LIVE = null;
let liveSubSel = { out: '', in: '' };

async function loadLive() {
  const out = await CG('/live');
  LIVE = out.live;
  return LIVE;
}

function livePhaseLabel(phase) {
  const map = {
    ready: 'Kick-off', live: 'Live', halftime: 'Half Time',
    et_break: 'Extra Time Break', shootout: 'Penalties', fulltime: 'Full Time',
  };
  return map[phase] ?? phase;
}

function liveEventIcon(type) {
  const map = {
    kickoff: '🏁', goal: '⚽', save: '🧤', block: '🛡️', miss: '❌',
    corner: '🚩', freekick: '🎯', 'penalty-miss': '❌', yellow: '🟨',
    red: '🟥', sub: '🔄', injury: '🚑', halftime: '⏸️',
    extratime: '⏱️', shootout: '🎯', fulltime: '🏁', offside: '🚩',
    timewasting: '⏳', counter: '⚡',
  };
  return map[type] ?? '•';
}

function renderLiveMatch(sc) {
  if (!LIVE) { loadLive().then(() => render()); sc.innerHTML = '<div class="card"><div class="dim">Memuat pertandingan live…</div></div>'; return; }
  if (!LIVE.active) {
    sc.innerHTML = backTo('match') + `
      <div class="card"><h3>🔴 Pertandingan Live</h3>
        <div class="dim" style="margin-bottom:12px">Kelola timmu secara real-time — taktik, pergantian, dan keputusan selagi pertandingan berjalan.</div>
        <div class="bar-row">
          <button class="btn" onclick="startLiveMatch('league')">🔴 Liga Live</button>
        </div>
        <div class="bar-row" style="margin-top:8px">
          <button class="btn secondary" onclick="startLiveMatch('cup')">🏆 Piala Live</button>
          <button class="btn secondary" onclick="startLiveMatch('continental')">🌍 Continental Live</button>
        </div>
        <div class="dim" style="margin-top:12px">Atau pakai simulasi instan: <button class="btn secondary" onclick="playMatchday()">▶ Mainkan</button></div>
        <div class="dim" style="margin-top:8px">Ranked memakai duel taktik tersegel — siapkan & kunci dari tab PvP.</div>
      </div>`;
    return;
  }
  const L = LIVE;
  const mySide = L.playerSide === 'home' ? L.home : L.away;
  const oppSide = L.playerSide === 'home' ? L.away : L.home;
  const isDone = L.phase === 'fulltime';
  const events = [...L.events].reverse();
  sc.innerHTML = backTo('match') + `
    <section class="live-hero">
      <div class="live-comp">🔴 ${esc(L.competition.toUpperCase())} · ${livePhaseLabel(L.phase)}</div>
      <div class="live-teams">
        <div class="live-team home">${esc(L.home.name)}</div>
        <div class="live-score">${L.score.home}<span class="dash">–</span>${L.score.away}</div>
        <div class="live-team away">${esc(L.away.name)}</div>
      </div>
      <div><span class="live-minute">${L.minute}'${L.phase === 'halftime' ? ' · HT' : ''}</span></div>
      ${!isDone ? `<button class="btn" id="live-continue" style="margin-top:12px;font-size:16px;padding:12px">▶ Lanjutkan ${L.phase === 'ready' ? '(Kick-off)' : L.phase === 'halftime' ? '(Babak 2)' : L.phase === 'shootout' ? '(Penalti)' : ''}</button>` : ''}
      ${isDone ? `<button class="btn" id="live-finish" style="margin-top:12px">✓ Selesaikan</button>` : ''}
      ${!isDone && L.phase !== 'ready' ? `<button class="btn secondary" id="live-abandon" style="margin-top:8px">⏩ Simulasi Sampai Akhir</button>` : ''}
    </section>
    <div class="card"><h3>📻 Kejadian Live</h3>
      <div style="max-height:260px;overflow-y:auto">
      ${events.length ? events.map((e) => `<div class="row${['goal', 'red'].includes(e.type) ? ' keyev' : ''}"><span>${liveEventIcon(e.type)} <b>${e.minute}'</b> ${esc(e.detail || e.type)}</span></div>`).join('') : '<div class="dim">Belum ada kejadian.</div>'}
      </div>
    </div>
    ${L.phase === 'halftime' ? `
    <div class="card"><h3>⏸️ Ringkasan Babak Pertama</h3>
      <div class="row"><span>Skor</span><b>${esc(L.home.name)} ${L.score.home} — ${L.score.away} ${esc(L.away.name)}</b></div>
      <div class="row"><span>Penguasaan bola</span><span>${L.stats.home.possession}% – ${L.stats.away.possession}%</span></div>
      <div class="row"><span>Tembakan (tepat sasaran)</span><span>${L.stats.home.shots} (${L.stats.home.onTarget}) – ${L.stats.away.shots} (${L.stats.away.onTarget})</span></div>
      ${L.events.filter((e) => ['goal', 'red', 'yellow'].includes(e.type)).map((e) => `<div class="row"><span>${liveEventIcon(e.type)} <b>${e.minute}'</b> ${esc(e.detail || e.type)}</span></div>`).join('') || '<div class="dim">Belum ada gol atau kartu di babak pertama.</div>'}
    </div>` : ''}
    ${!isDone ? `
    <div class="card"><h3>🎛️ Taktik <span class="sub">live</span></h3>
      <div class="bar-row">
        <label>Mentalitas</label>
        <select id="lt-mentality">${['VeryDefensive','Defensive','Balanced','Positive','Attacking','VeryAttacking'].map((v) => `<option ${mySide.tactics.mentality === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="bar-row">
        <label>Tekanan</label>
        <select id="lt-pressing">${['Low','Medium','High','VeryHigh'].map((v) => `<option ${mySide.tactics.pressing === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="bar-row">
        <label>Tempo</label>
        <select id="lt-tempo">${['Slow','Normal','Fast'].map((v) => `<option ${mySide.tactics.tempo === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label>Umpan</label>
        <select id="lt-passing">${['Short','Mixed','Direct','Long'].map((v) => `<option ${mySide.tactics.passing === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="bar-row">
        <label>Formasi</label>
        <select id="lt-formation">${['4-4-2','4-3-3','4-2-3-1','3-5-2','3-4-3','5-3-2','5-4-1','4-1-4-1'].map((v) => `<option ${mySide.tactics.formation === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <button class="btn secondary" id="lt-apply">Terapkan Taktik</button>
    </div>
    <div class="card"><h3>📋 Status Taktik <span class="sub">terkonfigurasi</span></h3>
      <div class="pmeta">Umpan <b>${esc(mySide.tactics.passing ?? 'Mixed')}</b> · Serangan Balik <b>${mySide.tactics.counterAttack === true ? 'Aktif' : 'Mati'}</b> · Buang Waktu <b>${mySide.tactics.timeWasting === true ? 'Aktif' : 'Mati'}</b></div>
      <div class="dim">Hanya konfigurasi — "Aktif" bukan berarti sedang berjalan. Perilaku live tampil di umpan kejadian.</div>
    </div>
    <div class="card"><h3>🔄 Pergantian <span class="sub">${L.subsUsed}/${L.maxSubs} terpakai</span></h3>
      <div class="bar-row">
        <label>Keluar</label>
        <select id="ls-out">${mySide.lineup.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.position})</option>`).join('')}</select>
      </div>
      <div class="bar-row">
        <label>Masuk</label>
        <select id="ls-in">${mySide.bench.length ? mySide.bench.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.position})</option>`).join('') : '<option value="">Tidak ada cadangan</option>'}</select>
      </div>
      <button class="btn secondary" id="ls-confirm" ${!mySide.bench.length || L.subsRemaining <= 0 ? 'disabled' : ''}>Konfirmasi Pergantian</button>
    </div>
    <div class="card"><h3>🎯 Instruksi Pemain <span class="sub">live</span></h3>
      <div class="dim">Instruksi per pemain dari server otoritatif. Tidak ada angka gameplay yang ditampilkan; instruksi adalah input, bukan hasil.</div>
      ${mySide.lineup.map((p) => {
        const instr = (mySide.tactics.playerInstructions || {})[p.id] || '';
        return `<div class="row"><span>${p.position} ${esc(p.name)}${p.injured ? ' 🤕' : ''}</span>
          <select class="li-sel" data-player="${p.id}" aria-label="Instruction for ${esc(p.name)}">
            <option value=""${instr === '' ? ' selected' : ''}>—</option>
            <option value="red"${instr === 'red' ? ' selected' : ''}>🔴 Attacking</option>
            <option value="blue"${instr === 'blue' ? ' selected' : ''}>🔵 Defensive</option>
          </select></div>`;
      }).join('')}
    </div>` : ''}
    <div class="card"><h3>📋 Susunan Pemain</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><b>${esc(L.home.name)}</b>${L.playerSide === 'home' ? ' (you)' : ''}
          ${L.home.lineup.map((p) => `<div class="row"><span>${p.position} ${esc(p.name)}${p.yellow ? ' 🟨' : ''}</span><span class="dim">${p.rating}</span></div>`).join('')}
        </div>
        <div><b>${esc(L.away.name)}</b>${L.playerSide === 'away' ? ' (you)' : ''}
          ${L.away.lineup.map((p) => `<div class="row"><span>${p.position} ${esc(p.name)}${p.yellow ? ' 🟨' : ''}</span><span class="dim">${p.rating}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="card"><h3>📊 Statistik</h3>
      <div class="row"><span>Penguasaan bola</span><span>${L.stats.home.possession}% – ${L.stats.away.possession}%</span></div>
      <div class="row"><span>Tembakan (tepat sasaran)</span><span>${L.stats.home.shots} (${L.stats.home.onTarget}) – ${L.stats.away.shots} (${L.stats.away.onTarget})</span></div>
      <div class="row"><span>Tendangan sudut</span><span>${L.stats.home.corners} – ${L.stats.away.corners}</span></div>
      <div class="row"><span>Pelanggaran / Kartu</span><span>${L.stats.home.fouls} / ${L.stats.home.yellow}🟨${L.stats.home.red}🟥 – ${L.stats.away.fouls} / ${L.stats.away.yellow}🟨${L.stats.away.red}🟥</span></div>
    </div>`;
  // wire buttons
  const bc = $('#live-continue');
  if (bc) bc.onclick = liveContinue;
  const bf = $('#live-finish');
  if (bf) bf.onclick = liveFinish;
  const ba = $('#live-abandon');
  if (ba) ba.onclick = liveAbandon;
  const ta = $('#lt-apply');
  if (ta) ta.onclick = liveApplyTactics;
  const sc2 = $('#ls-confirm');
  if (sc2) sc2.onclick = liveConfirmSub;
  document.querySelectorAll('.li-sel').forEach((sel) => {
    sel.onchange = () => liveSetInstruction(sel.dataset.player, sel.value || null);
  });
}

async function liveSetInstruction(playerId, arrow) {
  try {
    const out = await C('/live/instruction', { playerId, arrow });
    LIVE = out.live;
    const side = LIVE.playerSide === 'home' ? LIVE.home : LIVE.away;
    const p = side.lineup.find((x) => x.id === playerId);
    const name = p ? p.name : 'player';
    const instr = arrow === 'red' ? '🔴 Attacking' : arrow === 'blue' ? '🔵 Defensive' : null;
    toast(instr ? `${instr} instruction applied for ${name}.` : `Instruction cleared for ${name}.`);
    render();
  } catch (e) {
    toast(`Instruksi ditolak: ${e.message}`);
    render(); // reconcile with authoritative server state
  }
}

window.startLiveMatch = async (competition) => {
  try {
    toast('Memulai pertandingan live…');
    const out = await C('/live/start', { competition });
    LIVE = out.live;
    nav('match', 'live');
  } catch (e) { toast(e.message); }
};

async function liveContinue() {
  try {
    const out = await C('/live/continue');
    LIVE = out.live;
    if (out.newEvents && out.newEvents.length) {
      const last = out.newEvents[out.newEvents.length - 1];
      if (last.type === 'goal') toast(`⚽ GOAL! ${last.detail}`);
    }
    render();
    if (out.finished) toast('Peluit panjang! Selesaikan pertandingan untuk menerapkan hasil.');
  } catch (e) { toast(e.message); }
}

async function liveFinish() {
  try {
    toast('Menyelesaikan pertandingan…');
    const out = await C('/live/finish');
    LIVE = null;
    await refresh();
    // Phase 51: show the authoritative server-side report when available.
    if (out.playerReport && out.competition === 'league' && out.playerResult?.events) {
      showMatchResult(out.playerResult, out.seasonEnd, out.playerReport);
    } else if (out.playerResult?.report) {
      showCompetitionResult(
        out.competition === 'cup' ? 'Cup' : 'Continental',
        { ...out.playerResult },
        () => { nav('match'); render(); }
      );
    } else {
      nav('match');
      toast('Pertandingan selesai!');
      render();
    }
  } catch (e) { toast(e.message); }
}

async function liveAbandon() {
  if (!confirm('Simulate the rest of the match instantly?')) return;
  try {
    const out = await C('/live/abandon');
    LIVE = out.live;
    render();
    if (out.finished) toast('Peluit panjang! Selesaikan pertandingan untuk menerapkan hasil.');
  } catch (e) { toast(e.message); }
}

async function liveApplyTactics() {
  try {
    const patch = {
      mentality: $('#lt-mentality').value,
      pressing: $('#lt-pressing').value,
      tempo: $('#lt-tempo').value,
      passing: $('#lt-passing').value,
    };
    const formation = $('#lt-formation').value;
    const t = await C('/live/tactics', { patch });
    let f = null;
    if (formation) f = await C('/live/formation', { formation });
    LIVE = (await CG('/live')).live;
    // Phase 52: echo the server-confirmed changes (factual, no causality).
    const bits = Object.entries(t.applied ?? {}).map(([k, v]) => `${k} → ${v}`);
    if (f?.formation) bits.push(`Formasi → ${f.formation}`);
    toast(bits.length ? `Taktik diterapkan: ${bits.join(', ')}.` : 'Taktik diterapkan.');
    render();
  } catch (e) { toast(e.message); }
}

async function liveConfirmSub() {
  try {
    const out = await C('/live/sub', { playerOut: $('#ls-out').value, playerIn: $('#ls-in').value });
    LIVE = out.live;
    // Phase 52: render the authoritative server sub event (player names).
    const subEv = (out.newEvents ?? []).find((e) => e.type === 'sub');
    toast(subEv ? `🔄 ${subEv.detail} (${subEv.minute}').` : 'Substitution made.');
    render();
  } catch (e) { toast(e.message); }
}

// ---------- squad ----------
let squadFilter = { group: '', sort: 'overall' };
function posGroup(pos) {
  if (pos === 'GK') return 'GK';
  if (['DL', 'DC', 'DR'].includes(pos)) return 'D';
  if (['ML', 'MC', 'MR'].includes(pos)) return 'M';
  return 'F';
}
window.setSquadFilter = (g) => { squadFilter.group = g; render(); };
function renderSquad(sc) {
  let players = [...S.squad.players];
  if (squadFilter.group) players = players.filter((p) => posGroup(p.position) === squadFilter.group);
  players.sort((a, b) => (b[squadFilter.sort] ?? 0) - (a[squadFilter.sort] ?? 0));
  const xi = new Set(S.squad.lineup);
  const bench = new Set(S.squad.bench);
  const avgOvr = players.length ? Math.round(players.reduce((s, p) => s + p.overall, 0) / players.length) : 0;
  const dist = ['GK', 'D', 'M', 'F'].map((g) => `${g} ${S.squad.players.filter((p) => posGroup(p.position) === g).length}`).join(' \u00b7 ');
  const injured = S.squad.players.filter((p) => p.injury).length;
  sc.innerHTML = `
    <div class="tm-hero"><div class="teyebrow">Tim Utama</div><h2>Squad</h2>
      <div class="tm-stats">
        <div class="tm-stat"><div class="v">${S.squad.players.length}</div><div class="l">Pemain</div></div>
        <div class="tm-stat"><div class="v">${avgOvr}</div><div class="l">Rating rata-rata</div></div>
        <div class="tm-stat"><div class="v">${S.squad.lineup.length}</div><div class="l">Starting XI</div></div>
        <div class="tm-stat"><div class="v">${injured}</div><div class="l">Cedera</div></div>
      </div>
      <div class="pmeta" style="margin-top:8px">Komposisi: ${dist}</div>
    </div>
    <div class="card">
      <div class="chips">
        ${['', 'GK', 'D', 'M', 'F'].map((g) => `<span class="chip ${squadFilter.group === g ? 'on' : ''}" onclick="setSquadFilter('${g}')">${g || 'Semua'}</span>`).join('')}
      </div>
      <div class="pcard-list" id="plist">
      ${players.map((p) => `
        <div class="pcard${p.injury ? ' injured' : ''}" onclick="showPlayer('${p.id}')">
          <div class="posbadge">${p.position}</div>
          <div class="pinfo"><div class="pname">${esc(p.name)}<span class="pflags">${xi.has(p.id) ? '<span class="badge info">XI</span>' : ''}${bench.has(p.id) ? '<span class="badge neutral">Cad.</span>' : ''}</span></div>
          <div class="pmeta">Usia ${p.age} \u00b7 Kebugaran ${p.fitness} \u00b7 Semangat ${p.morale}${p.injury ? ` \u00b7 \U0001F6A8 ${esc(p.injury.type)}` : ''}</div></div>
          <div class="ovr">${p.overall}</div>
        </div>`).join('')}
      </div>
      <button class="btn secondary" onclick="nav('match','lineup')">Atur Susunan & Taktik</button>
    </div>`;
}
/* ---- part 2: player modal, tactics/lineup, match flow ---- */

// ---------- player profile ----------
const ATTR_GROUPS = {
  Technical: ['Passing', 'Shooting', 'Dribbling', 'Finishing', 'Crossing', 'BallControl', 'Heading', 'Tackling', 'SetPieces'],
  Mental: ['Vision', 'DecisionMaking', 'Composure', 'Concentration', 'WorkRate', 'Aggression', 'Leadership', 'Positioning'],
  Physical: ['Speed', 'Acceleration', 'Stamina', 'Strength', 'Agility'],
  Goalkeeping: ['Diving', 'Handling', 'Kicking', 'Reflexes', 'OneOnOne', 'GKPositioning', 'AerialAbility'],
};
const ATTR_GROUP_ID = { Technical: 'Teknikal', Mental: 'Mental', Physical: 'Fisik', Goalkeeping: 'Kiper' };
window.showPlayer = (pid) => {
  const p = S.squad.players.find((x) => x.id === pid) || S.academy.find((x) => x.id === pid);
  if (!p) return;
  const inSquad = S.squad.players.some((x) => x.id === pid);
  const groups = Object.entries(ATTR_GROUPS)
    .map(([g, attrs]) => {
      const rows = attrs.filter((a) => p.attributes[a] !== undefined)
        .map((a) => `<div class="attr"><span class="an">${a}</span><span class="bar"><i style="width:${p.attributes[a]}%"></i></span><span class="av">${p.attributes[a]}</span></div>`).join('');
      return rows ? `<div class="pd-group"><h4>${ATTR_GROUP_ID[g] || g}</h4>${rows}</div>` : '';
    }).join('');
  const cond = [
    p.injury ? `<span class="badge bad">\uD83D\uDE91 ${esc(p.injury.type)} (${p.injury.daysLeft} hari)</span>` : '<span class="badge info">Fit</span>',
    `<span class="badge neutral">Kebugaran ${p.fitness}</span>`,
    `<span class="badge neutral">Semangat ${p.morale}</span>`,
    `<span class="badge neutral">Form ${p.form}</span>`,
  ].join('');
  openModal(`
    <div class="pd-hero"><div class="ovr-big">${p.overall}</div>
      <div><h2 style="margin:0">${esc(p.name)}</h2>
      <div class="pmeta">${p.position} \u00b7 Usia ${p.age}</div><div class="pot">Potensi ${p.potential}</div></div>
    </div>
    <div class="pd-cond">${cond}</div>
    <div class="pmeta">Gaji ${fmtCash(p.wage)}/minggu \u00b7 Kontrak: ${p.contract.yearsLeft} tahun \u00b7 ${esc(p.contract.role)}${p.contract.releaseClause ? ` \u00b7 Klausul ${fmtCash(p.contract.releaseClause)}` : ''}</div>
    <div class="pd-attrs">${groups}</div>
    ${inSquad ? `
    <h3>Aksi</h3>
    <div class="bar-row">
      <button class="btn secondary" onclick="listForSaleUI('${p.id}')">Jual</button>
      <button class="btn secondary" onclick="contractUI('${p.id}')">Kontrak Baru</button>
    </div>` : ''}
    <button class="btn secondary" onclick="closeModal()">Tutup</button>`);
};
window.listForSaleUI = (pid) => {
  const price = prompt('Harga jual:', '5000000');
  if (!price) return;
  C('/market/list', { playerId: pid, askingPrice: parseInt(price, 10) })
    .then(async () => { closeModal(); await refresh(); render(); toast('Pemain masuk daftar jual.'); })
    .catch((e) => toast(e.message));
};
window.contractUI = (pid) => {
  const p = S.squad.players.find((x) => x.id === pid);
  openModal(`
    <h2>Kontrak: ${esc(p.name)}</h2>
    <div class="pmeta">Gaji saat ini ${fmtCash(p.wage)}/minggu · sisa ${p.contract.yearsLeft} tahun</div>
    <label>Tahun (1–5)</label><input id="ct-years" type="number" value="3" min="1" max="5">
    <label>Gaji mingguan</label><input id="ct-salary" type="number" value="${p.wage}">
    <label>Bonus penandatanganan</label><input id="ct-bonus" type="number" value="0">
    <label>Klausul rilis (0 = tidak ada)</label><input id="ct-clause" type="number" value="${p.contract.releaseClause || 0}">
    <div id="ct-result"></div>
    <button class="btn" id="ct-offer">Tawar</button>
    <button class="btn secondary" onclick="closeModal()">Batal</button>`);
  $('#ct-offer').onclick = async () => {
    const terms = {
      years: parseInt($('#ct-years').value, 10),
      salary: parseInt($('#ct-salary').value, 10),
      signingBonus: parseInt($('#ct-bonus').value, 10),
      releaseClause: parseInt($('#ct-clause').value, 10) || null,
      role: p.contract.role,
    };
    try {
      const r = await C('/contracts/offer', { playerId: pid, terms });
      const box = $('#ct-result');
      if (r.evaluation === 'accepted') {
        await C('/contracts/sign', { playerId: pid, terms });
        closeModal(); await refresh(); render(); toast('Kontrak ditandatangani!');
      } else if (r.evaluation === 'counter') {
        box.innerHTML = `<div class="card"><div>Agen menawar balik: <b>${fmtCash(r.counter.salary)}/wk</b></div>
          <button class="btn" id="ct-accept">Terima Tawaran Balik</button></div>`;
        $('#ct-accept').onclick = async () => {
          await C('/contracts/sign', { playerId: pid, terms: r.counter });
          closeModal(); await refresh(); render(); toast('Kontrak ditandatangani!');
        };
      } else {
        box.innerHTML = `<div class="card bad">Ditolak. Agen meminta jauh lebih besar.</div>`;
      }
    } catch (e) { toast(e.message); }
  };
};

// ---------- lineup & tactics (inside Match tab) ----------
const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2', '5-4-1'];
const TACTIC_OPTS = {
  mentality: ['VeryDefensive', 'Defensive', 'Balanced', 'Positive', 'Attacking', 'VeryAttacking'],
  passing: ['Short', 'Mixed', 'Direct', 'Long'], // Phase 60: expose Long (UX-01)
  tempo: ['Slow', 'Normal', 'Fast'],
  pressing: ['Low', 'Medium', 'High', 'VeryHigh'],
  defensiveLine: ['Deep', 'Normal', 'High'],
  width: ['Narrow', 'Normal', 'Wide'],
  tackling: ['Easy', 'Normal', 'Hard'],
};
// Phase 60: boolean tactic flags exposed as checkboxes (UX-02). The server
// already validates these via setTactic; the client only submits choices.
const TACTIC_FLAGS = ['counterAttack', 'offsideTrap', 'timeWasting'];
const flagLabel = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
// Phase 63: Indonesian display labels for tactic controls. Keys and option
// values are API contract and stay English; only the labels are translated.
const TACTIC_ID_LABELS = {
  mentality: 'Mentalitas', passing: 'Umpan', tempo: 'Tempo', pressing: 'Tekanan',
  defensiveLine: 'Garis Pertahanan', width: 'Lebar', tackling: 'Tekel',
  counterAttack: 'Serangan Balik', offsideTrap: 'Jebakan Offside', timeWasting: 'Buang Waktu',
};
const tacticLabel = (k) => TACTIC_ID_LABELS[k] ?? flagLabel(k);
// Phase 67: Indonesian display labels for server enums. The enum values are
// API contract and stay English; only what the player sees is translated.
const BOARD_STATUS_LABELS = { safe: 'Aman', warning: 'Peringatan', sacked: 'Dipecat' };
const boardStatusLabel = (s) => BOARD_STATUS_LABELS[s] ?? s;
const ROUND_LABELS = {
  'Quarter-final': 'Perempat final', 'Semi-final': 'Semifinal',
  'Final': 'Final', 'Champions': 'Juara',
};
const roundLabel = (r) => ROUND_LABELS[r] ?? r;
const HEALTH_LABELS = { healthy: 'Sehat', tight: 'Ketat', critical: 'Kritis' };
const healthLabel = (h) => HEALTH_LABELS[h] ?? h;
const FACILITY_LABELS = { MedicalCenter: 'Pusat Medis', Stadium: 'Stadion', TrainingGround: 'Lapangan Latihan', YouthAcademy: 'Akademi Muda' };
const facilityLabel = (t) => FACILITY_LABELS[t] ?? String(t).replace(/([A-Z])/g, ' $1').trim();
let lineupSel = null; // { starters: Set, bench: Set, captain: id, setPieces: {} }
// Phase 62: dirty-state guard for the lineup editor.
let lineupBaseline = null; // canonical snapshot of the last-saved lineup
let lineupSaving = false; // save request in flight
let lineupLeaveOpen = false; // leave-dialog re-entrancy guard
let lineupNavBypass = false; // programmatic nav setelah "Keluar tanpa menyimpan"

// Canonical snapshot of the authoritative lineup (from S).
function snapshotLineup() {
  const sq = S.squad;
  return {
    starters: [...sq.lineup].sort(),
    bench: [...sq.bench].sort(),
    captain: sq.captainId ?? null,
    setPieces: { ...(sq.setPieces ?? {}) },
  };
}

// Current draft: selection cache + live select values. Falls back to the
// baseline for any control not currently rendered (never false-dirty).
function currentLineupDraft() {
  if (!lineupSel || !lineupBaseline) return null;
  const val = (id, fb) => { const elx = $(id); return elx ? elx.value : fb; };
  return {
    starters: [...lineupSel.starters].sort(),
    bench: [...lineupSel.bench].sort(),
    captain: val('#cap-sel', lineupBaseline.captain) || null,
    setPieces: {
      penalty: val('#sp-penalty', lineupBaseline.setPieces.penalty),
      freeKick: val('#sp-freeKick', lineupBaseline.setPieces.freeKick),
      corner: val('#sp-corner', lineupBaseline.setPieces.corner),
    },
  };
}

// Canonical comparison: reverting to the saved lineup reads as clean.
function lineupDirty() {
  if (!lineupSel || !lineupBaseline) return false;
  return JSON.stringify(currentLineupDraft()) !== JSON.stringify(lineupBaseline);
}

// Reload/tab-close is the one navigation the in-app dialog cannot cover.
function updateLineupUnloadGuard() {
  if (typeof window === 'undefined' || !('onbeforeunload' in window)) return;
  window.onbeforeunload = (TAB === 'match' && SUB === 'lineup' && lineupDirty())
    ? (e) => { e.preventDefault(); }
    : null;
}

function renderMatch(sc) {
  if (SUB === 'lineup') return renderLineup(sc);
  if (SUB === 'tactics') return renderTactics(sc);
  if (SUB === 'live') return renderLiveMatch(sc);
  const fx = S.nextFixture;
  sc.innerHTML = `
    <div class="card scorehead">
      <div class="teams">${fx ? esc(fx.home) + ' vs ' + esc(fx.away) : 'Tidak ada jadwal'}</div>
      <div class="dim">Matchday ${fx ? fx.matchday : '-'} · ${fx ? (fx.isHome ? 'Kandang' : 'Tandang') : ''}</div>
      <div class="bar-row">
        <button class="btn secondary" onclick="nav('match','lineup')">Susunan</button>
        <button class="btn secondary" onclick="nav('match','tactics')">Taktik</button>
        <button class="btn secondary" onclick="nav('match','live')">🔴 Live</button>
      </div>
      ${fx ? `<button class="btn" id="playbtn2">▶ Mainkan</button>` : ''}
      ${fx ? `<button class="btn secondary" id="livebtn2" style="margin-top:8px">🔴 Main Live</button>` : ''}
    </div>
    <div class="card"><h3>Formasi <span class="sub">${esc(S.tactics.formation)} · ${esc(S.tactics.mentality)}</span></h3>
      <div class="dim">XI set: ${S.squad.lineup.length}/11 · Bench: ${S.squad.bench.length}/7</div>
    </div>
    <div class="card"><h3>Hasil Terakhir</h3>
      ${S.recentResults.length ? S.recentResults.map((r) => `<div class="row"><span>${esc(r.homeName)} ${r.homeGoals}–${r.awayGoals} ${esc(r.awayName)}</span><span class="dim">MD${r.matchday}</span></div>`).join('') : '<div class="dim">Belum ada pertandingan.</div>'}
    </div>`;
  const pb = $('#playbtn2');
  if (pb) pb.onclick = playMatchday;
  const lb = $('#livebtn2');
  if (lb) lb.onclick = () => startLiveMatch('league');
}

// Phase 68: formation string '4-4-2' -> dot coordinates for the pitch view.
function pitchDots(formation, players) {
  const lines = String(formation || '4-4-2').split('-').map((n) => parseInt(n, 10) || 0);
  const slots = [];
  const yFor = (idx, total) => 88 - ((idx + 1) * (68 / (total + 1)));
  lines.forEach((count, li) => {
    for (let i = 0; i < count; i++) {
      slots.push({ x: 12 + (i * (76 / Math.max(count - 1, 1))), y: yFor(li, lines.length) });
    }
  });
  // GK goes to the back slot; outfield players fill line slots back-to-front.
  const gk = players.find((p) => p.position === 'GK');
  const outfield = players.filter((p) => p.position !== 'GK')
    .sort((a, b) => posRank(a.position) - posRank(b.position));
  const dots = outfield.slice(0, slots.length).map((pl, i) =>
    `<div class="pdot" style="left:${slots[i].x}%;top:${slots[i].y}%" title="${esc(pl.name)}">${esc(pl.position)}</div>`);
  if (gk) dots.push(`<div class="pdot" style="left:50%;top:94%" title="${esc(gk.name)}">GK</div>`);
  return dots;
}
function posRank(pos) {
  const p = String(pos || '');
  if (p === 'GK') return 0;
  if (/^D/.test(p)) return 1;
  if (/^M/.test(p)) return 2;
  return 3;
}
function pitchHtml(formation, players) {
  if (!players.length) return '';
  return `<div class="pitch"><div class="pline"></div>${pitchDots(formation, players).join('')}</div>`;
}
function renderLineup(sc) {
  if (!lineupSel) {
    lineupSel = {
      starters: new Set(S.squad.lineup),
      bench: new Set(S.squad.bench),
      captain: S.squad.captainId,
      setPieces: { ...S.squad.setPieces },
    };
    lineupBaseline = snapshotLineup(); // Phase 62: authoritative baseline
  }
  const avail = (p) => !p.injury && p.fitness > 0;
  sc.innerHTML = backTo('match') + `
    <div class="card"><h3>Starting XI <span class="sub">${lineupSel.starters.size}/11</span></h3>
    ${pitchHtml(S.tactics.formation, [...lineupSel.starters].map((id) => S.squad.players.find((p) => p.id === id)).filter(Boolean))}
    <div class="dim" style="margin-bottom:8px">Ketuk pemain untuk rotasi inti → cadangan → keluar. Lalu pilih kapten & pengambil bola mati.</div>
    ${S.squad.players.map((p) => {
      const st = lineupSel.starters.has(p.id) ? '⭐' : lineupSel.bench.has(p.id) ? '🔄' : '';
      return `<div class="prow" onclick="toggleLineup('${p.id}')">
        <div class="posbadge">${p.position}</div>
        <div><div><b>${esc(p.name)}</b> ${st}${lineupSel.captain === p.id ? ' ©' : ''}</div>
        <div class="pmeta">${p.overall} · Kebugaran ${p.fitness}${p.injury ? ' · 🚑' : ''}</div></div>
        <div class="ovr" style="font-size:14px">${st}</div></div>`;
    }).join('')}
    </div>
    <div class="card"><h3>Kapten & Bola Mati</h3>
      <label>Kapten</label><select id="cap-sel">${S.squad.players.filter((p) => lineupSel.starters.has(p.id)).map((p) => `<option value="${p.id}" ${lineupSel.captain === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      ${['penalty', 'freeKick', 'corner'].map((k) => `<label>${k}</label><select id="sp-${k}">${S.squad.players.filter((p) => lineupSel.starters.has(p.id)).map((p) => `<option value="${p.id}" ${lineupSel.setPieces[k] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`).join('')}
      <button class="btn" id="savesquad">Simpan Susunan</button>
    </div>`;
  $('#savesquad').onclick = async () => {
    if (lineupSaving) return; // Phase 62: no duplicate saves
    lineupSaving = true;
    const btn = $('#savesquad');
    if (btn) btn.disabled = true;
    for (const id of ['#cap-sel', '#sp-penalty', '#sp-freeKick', '#sp-corner']) {
      const s = $(id);
      if (s) s.disabled = true; // no edits mid-flight (req 10)
    }
    try {
      await CP('/lineup', {
        lineup: [...lineupSel.starters],
        bench: [...lineupSel.bench],
        captainId: $('#cap-sel').value || null,
        setPieces: { penalty: $('#sp-penalty').value, freeKick: $('#sp-freeKick').value, corner: $('#sp-corner').value },
      });
      await refresh();
      lineupBaseline = snapshotLineup(); // Phase 62: new authoritative baseline
      lineupSel = null;
      lineupSaving = false;
      updateLineupUnloadGuard();
      nav('match'); toast('Susunan tersimpan.');
    } catch (e) {
      lineupSaving = false;
      toast(e.message);
      render(); // re-render enabled controls; edits preserved, still dirty
    }
  };
  // Phase 62: select changes feed the dirty check + unload guard.
  for (const id of ['#cap-sel', '#sp-penalty', '#sp-freeKick', '#sp-corner']) {
    const s = $(id);
    if (s) s.onchange = () => updateLineupUnloadGuard();
  }
  updateLineupUnloadGuard();
}
window.toggleLineup = (pid) => {
  if (lineupSaving) return; // Phase 62: no edits while a save is in flight
  const s = lineupSel;
  if (s.starters.has(pid)) { s.starters.delete(pid); s.bench.add(pid); }
  else if (s.bench.has(pid)) { s.bench.delete(pid); }
  else if (s.starters.size < 11) { s.starters.add(pid); }
  else if (s.bench.size < 7) { s.bench.add(pid); }
  else toast('Tim inti dan cadangan penuh.');
  renderMatch($('#screen'));
  updateLineupUnloadGuard(); // Phase 62
};

function renderTactics(sc) {
  const t = S.tactics;
  const instr = t.playerInstructions ?? {};
  const xiIds = S.squad.lineup.length ? S.squad.lineup : S.squad.players.slice(0, 11).map((p) => p.id);
  const xiPlayers = xiIds.map((id) => S.squad.players.find((p) => p.id === id)).filter(Boolean);
  const activeMeta = Object.keys(TACTIC_OPTS).map((k) => `${tacticLabel(k)}: ${t[k]}`).join(' · ');
  sc.innerHTML = backTo('match') + `
    <div class="tac-active"><div class="teyebrow">Ruang Taktik</div>
      <div class="tformation">${t.formation}</div>
      <div class="tmeta">${activeMeta}</div>
    </div>
    <div class="card"><h3>Taktik Tim</h3>
      <div class="tac-group"><h4>Formasi</h4>
        <label>Formasi</label><select id="tac-formation">${FORMATIONS.map((f) => `<option ${t.formation === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
      </div>
      <div class="tac-group"><h4>Gaya Bermain</h4>
      ${Object.entries(TACTIC_OPTS).map(([k, opts]) => `
        <label>${tacticLabel(k)}</label>
        <select id="tac-${k}">${opts.map((o) => `<option ${t[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`).join('')}
      </div>
      <div class="tac-group"><h4>Instruksi Khusus</h4>
      ${TACTIC_FLAGS.map((k) => `
        <label class="check"><input type="checkbox" id="tac-${k}" ${t[k] === true ? 'checked' : ''}> ${tacticLabel(k)}</label>`).join('')}
      </div>
      <button class="btn" id="savetac">Simpan Taktik</button>
    </div>
    <div class="card"><h3>Instruksi Pemain</h3>
      <div class="dim" style="margin-bottom:8px">🔴 menyerang · 🔵 bertahan · ketuk lagi untuk menghapus. Hanya memengaruhi kecenderungan pemain ini.</div>
      ${xiPlayers.map((p) => {
        const cur = instr[p.id] ?? null;
        const stateTxt = cur === 'red' ? 'Menyerang 🔴' : cur === 'blue' ? 'Bertahan 🔵' : 'Netral';
        return `<div class="instr-row"><span>${esc(p.name)} <span class="dim">${esc(p.position)}</span><span class="instr-state">${stateTxt}</span></span>
          <span class="instr-btns">
            <button class="btn small ${cur === 'red' ? '' : 'secondary'}" data-instr="${p.id}" data-arrow="red">🔴</button>
            <button class="btn small ${cur === 'blue' ? '' : 'secondary'}" data-instr="${p.id}" data-arrow="blue">🔵</button>
          </span></div>`;
      }).join('')}
    </div>`;
  $('#savetac').onclick = async () => {
    const tactics = { formation: $('#tac-formation').value };
    for (const k of Object.keys(TACTIC_OPTS)) tactics[k] = $(`#tac-${k}`).value;
    // Phase 60: send explicit flag choices (server validates; always sending
    // avoids the old silent reset-to-defaults when flags were unset in UI).
    for (const k of TACTIC_FLAGS) tactics[k] = $(`#tac-${k}`).checked;
    try { await CP('/tactics', { tactics }); await refresh(); nav('match'); toast('Taktik tersimpan.'); }
    catch (e) { toast(e.message); }
  };
  sc.querySelectorAll('[data-instr]').forEach((btn) => {
    btn.onclick = async () => {
      const playerId = btn.dataset.instr;
      const cur = (S.tactics.playerInstructions ?? {})[playerId] ?? null;
      const arrow = btn.dataset.arrow === cur ? null : btn.dataset.arrow;
      try {
        await C('/tactics/instruction', { playerId, arrow });
        await refresh();
        renderTactics(sc);
        toast(arrow ? `Instruksi: ${arrow === 'red' ? 'menyerang 🔴' : 'bertahan 🔵'}` : 'Instruksi dihapus.');
      } catch (e) { toast(e.message); }
    };
  });
}

// ---------- match live & result ----------
// Phase 50: renders a server-provided deterministic match report projection.
// The client only renders; it never computes authoritative match facts.
function renderReportCards(rep, homeName, awayName) {
  if (!rep) return '';
  const t = rep.tactical ?? {};
  const tacLine = (side) => {
    const s = t[side] ?? {};
    const bits = [];
    if (s.passing) bits.push(`Umpan: ${esc(s.passing)}`);
    bits.push(`⚡ ${s.counterAttacks ?? 0} serangan balik`);
    bits.push(`⏳ ${s.timeWasting ?? 0} buang waktu`);
    return bits.join(' · ');
  };
  const tpIcon = (type) => type === 'goal' ? '⚽' : type === 'red' ? '🟥' : '•';
  return `
    <div class="card"><h3>📋 Ringkasan Taktik</h3>
      <div class="row"><span>${esc(homeName)}</span><span class="dim">${tacLine('home')}</span></div>
      <div class="row"><span>${esc(awayName)}</span><span class="dim">${tacLine('away')}</span></div>
    </div>
    ${(rep.turningPoints ?? []).length ? `<div class="card"><h3>🔀 Momen Penentu</h3>
      ${(rep.turningPoints ?? []).map((p) => `<div class="row"><span>${tpIcon(p.type)} <b>${p.minute}'</b> ${esc(p.label)}</span></div>`).join('')}
    </div>` : ''}
    ${(rep.narrative ?? []).length ? `<div class="card"><h3>📝 Narasi Pertandingan</h3>
      ${(rep.narrative ?? []).map((n) => `<div class="pmeta" style="margin-bottom:4px">${esc(n)}</div>`).join('')}
    </div>` : ''}`;
}
function showMatchResult(result, seasonEnd, report) {
  TAB = 'match'; SUB = 'live';
  document.querySelectorAll('#bottomnav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === 'match'));
  const sc = $('#screen');
  const events = result.events;
  let i = 0;
  sc.innerHTML = `
    <div class="card scorehead">
      <div class="teams">${esc(result.home)} vs ${esc(result.away)}</div>
      <div class="score" id="live-score">0 – 0</div>
      <div class="dim" id="live-min">Kickoff…</div>
    </div>
    <div class="feed" id="live-feed"></div>
    <button class="btn secondary" id="skipbtn">Lewati ⏩</button>`;
  const feed = $('#live-feed');
  let hs = 0, as = 0, timer;
  const icons = { goal: '⚽', yellow: '🟨', red: '🟥', injury: '🚑', sub: '🔄', save: '🧤', 'penalty-miss': '❌', kickoff: '📯', halftime: '⏸️', fulltime: '🏁', extratime: '⏱️', shootout: '🎯', timewasting: '⏳', counter: '⚡' };
  function step() {
    if (i >= events.length) { finish(); return; }
    const e = events[i++];
    const liveMin = $('#live-min');
    if (!liveMin) { clearTimeout(timer); return; } // Phase 32: user navigated away mid-simulation
    if (e.type === 'goal') { if (e.team === 'home') hs++; else as++; $('#live-score').textContent = `${hs} – ${as}`; }
    liveMin.textContent = e.minute + '′';
    if (!['kickoff', 'halftime'].includes(e.type) || true) {
      const d = el(`<div class="event ${e.type}"><span class="min">${e.minute}′</span><span>${icons[e.type] || '•'} ${esc(e.detail || e.type)}</span></div>`);
      feed.prepend(d);
    }
    timer = setTimeout(step, 450);
  }
  function finish() {
    clearTimeout(timer);
    if (!$('#live-feed')) return; // Phase 32: user navigated away; don't clobber the new screen
    renderResultScreen(sc, result, seasonEnd, report);
  }
  $('#skipbtn').onclick = finish;
  step();
}

function renderResultScreen(sc, result, seasonEnd, report) {
  SUB = null;
  const st = result.stats;
  const statRows = [
    ['Penguasaan %', st.home.possession, st.away.possession],
    ['Tembakan', st.home.shots, st.away.shots],
    ['Tepat sasaran', st.home.onTarget, st.away.onTarget],
    ['Tendangan sudut', st.home.corners, st.away.corners],
    ['Pelanggaran', st.home.fouls, st.away.fouls],
    ['Penyelamatan', st.home.saves, st.away.saves],
  ];
  const ratings = Object.values(result.playerRatings).sort((a, b) => b.rating - a.rating).slice(0, 8);
  sc.innerHTML = `
    <div class="card scorehead">
      <div class="teams">${esc(result.home)} vs ${esc(result.away)}</div>
      <div class="score">${result.score.home} – ${result.score.away}</div>
      <div class="dim">Peluit panjang ${result.penalties ? `(pens ${result.penalties.scored.home}–${result.penalties.scored.away})` : ''}</div>
    </div>
    ${seasonEnd ? `<div class="card"><h3>Musim ${S.season - 1} selesai</h3><div>Finis <b>${seasonEnd.position}${ordinal(seasonEnd.position)}</b> · Hadiah ${fmtCash(seasonEnd.prize)}</div><div class="dim">Direksi: ${seasonEnd.review.confidence}% (${esc(boardStatusLabel(seasonEnd.review.status))})</div></div>` : ''}
    <div class="card"><h3>Statistik Pertandingan</h3>
      <table>${statRows.map(([n, h, a]) => `<tr><td class="num">${h}</td><td style="text-align:center" class="dim">${n}</td><td class="num">${a}</td></tr>`).join('')}</table>
    </div>
    ${renderReportCards(report, result.home, result.away)}
    <div class="card"><h3>Rating Tertinggi</h3>
      ${ratings.map((r) => `<div class="row"><span>${esc(r.name)} ${r.goals ? `⚽${r.goals}` : ''}</span><b class="accent">${r.rating}</b></div>`).join('')}
    </div>
    <button class="btn" onclick="nav('home')">Lanjutkan</button>`;
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }

// ---------- club ----------
function renderClub(sc) {
  const c = S.club;
  sc.innerHTML = `
    <section class="stadium-hero">
      <div class="hero-club">
        <div class="hero-crest">🏟️</div>
        <div>
          <div class="eyebrow">Profil Klub</div>
          <h2>${esc(c.name)}</h2>
          <div class="dim">Reputasi ${c.reputation} · Level ${c.level}</div>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><div class="v accent">💰 ${fmtCash(c.cash)}</div><div class="k">Kas</div></div>
        <div class="hero-stat"><div class="v ${S.board.confidence < 30 ? 'bad' : ''}">${S.board.confidence}%</div><div class="k">Direksi</div></div>
        <div class="hero-stat"><div class="v">${esc(boardStatusLabel(S.board.status))}</div><div class="k">Status</div></div>
      </div>
    </section>
    <div id="club-profile"></div>
    <div class="card"><h3>Fasilitas</h3>
      ${Object.entries(S.facilities).map(([type, f]) => `
        <div class="row"><span>${esc(facilityLabel(type))} <span class="dim">Lv ${f.level}</span></span>
        <button class="btn small secondary" onclick="upgradeFac('${type}')">Tingkatkan</button></div>`).join('')}
    </div>
    <div class="card"><h3>Staf <span class="sub">${S.staff.length}/5</span></h3>
      ${S.staff.length ? S.staff.map((m) => `<div class="row"><span>${esc(m.name)} <span class="dim">${m.role} Lv${m.level}</span></span><button class="btn small danger" onclick="fireStaff('${m.id}')">Pecat</button></div>`).join('') : '<div class="dim">Belum ada staf direkrut.</div>'}
      <div class="bar-row">
        <select id="staff-role">${['HeadCoach', 'AssistantCoach', 'GoalkeepingCoach', 'FitnessCoach', 'Physio'].map((r) => `<option>${r}</option>`).join('')}</select>
        <select id="staff-level">${[1, 2, 3, 4, 5].map((l) => `<option value="${l}">Lv ${l}</option>`).join('')}</select>
      </div>
      <div class="bar-row"><input id="staff-name" placeholder="Nama staf"><button class="btn small" onclick="hireStaff()">Rekrut</button></div>
    </div>`;
  fillClubProfile(); // async: populates #club-profile
}
window.upgradeFac = async (type) => {
  try { const r = await C('/facilities/upgrade', { type }); await refresh(); render(); toast(`${type} ditingkatkan seharga ${fmtCash(r.cost)}.`); }
  catch (e) { toast(e.message); }
};
// ---------- Phase 34: club profile (legacy: prestige, trophies, records, milestones, identity) ----------
const TIER_ICONS = { Local: '🌱', Regional: '🗺️', Established: '🏟️', Elite: '⭐', Legendary: '👑' };
const RIVALRY_ICONS = { new: '🤝', developing: '📈', heated: '🔥', fierce: '⚔️', historic: '🏛️' };
function recLine(r) { return r ? `${r.gf}–${r.ga} vs ${esc(r.opponent || '?')}` : '—'; }
function legacyProfileHtml(l, rv) {
  const icon = TIER_ICONS[l.prestigeTier] || '🏳️';
  const tr = l.trophies.length
    ? l.trophies.map((t) => `<div class="row"><span>🏆 <b>${esc(t.competition)}</b> <span class="dim">${t.season != null ? 'S' + t.season : ''} · ${esc(t.type)}</span></span><b class="accent">${esc(t.result)}</b></div>`).join('')
    : '<div class="dim">Belum ada trofi — menangkan liga atau finis 3 besar di musim ranked.</div>';
  const ms = l.milestones.map((m) => `<div class="row"><span><b>${m.unlocked ? '✅' : '🔒'} ${esc(m.title)}</b><div class="pmeta">${esc(m.desc)}</div></span><b class="accent">+${fmtCash(m.cash)}</b></div>`).join('');
  const cs = l.career;
  return `
  <div class="card"><h3>${icon} ${esc(l.clubName)} <span class="sub">${esc(l.prestigeTier)} · ${l.prestige} prestige</span></h3>
    ${l.identity.motto ? `<div class="row"><span class="dim" style="font-style:italic">“${esc(l.identity.motto)}”</span></div>` : ''}
    ${l.identity.stadiumName ? `<div class="row"><span class="dim">Stadion</span><b>${esc(l.identity.stadiumName)}</b></div>` : ''}
    <div class="row"><span class="dim">Reputasi</span><b>${l.reputation}</b></div>
    <div class="row"><span class="dim">Rekor karier</span><b>${cs.wins}W ${cs.draws}D ${cs.losses}L <span class="dim">(${cs.played} played)</span></b></div>
  </div>
  <div class="card"><h3>🏆 Lemari trofi <span class="sub">${l.trophies.length}</span></h3>${tr}</div>
  <div class="card"><h3>📊 Rekor Klub</h3>
    <div class="row"><span class="dim">Kemenangan terbesar</span><b>${recLine(l.records.biggestWin)}</b></div>
    <div class="row"><span class="dim">Kekalahan terbesar</span><b>${recLine(l.records.biggestDefeat)}</b></div>
    <div class="row"><span class="dim">Gol terbanyak satu laga</span><b>${recLine(l.records.mostGoalsInMatch)}</b></div>
    <div class="row"><span class="dim">Tak terkalahkan terpanjang</span><b>${l.records.longestUnbeaten}</b></div>
    <div class="row"><span class="dim">Rangkaian menang terbaik</span><b>${cs.bestWinStreak}</b></div>
    <div class="row"><span class="dim">Gol dicetak</span><b>${cs.goalsFor}</b></div>
  </div>
  <div class="card"><h3>🎖️ Pencapaian</h3>${ms}</div>
  ${rivalsHtml(rv)}
  <div class="card"><h3>✏️ Identitas Klub</h3>
    <div class="bar-row"><input id="id-motto" maxlength="80" placeholder="Motto klub" value="${esc(l.identity.motto || '')}"></div>
    <div class="bar-row"><input id="id-stadium" maxlength="40" placeholder="Nama stadion" value="${esc(l.identity.stadiumName || '')}"></div>
    <div class="bar-row"><button class="btn small" onclick="saveIdentity()">Simpan Identitas</button></div>
  </div>`;
}
async function fillClubProfile() {
  const slot = $('#club-profile');
  if (!slot) return;
  try {
    const [l, rv] = await Promise.all([
      GET(`/api/legacy/${CID}`),
      GET(`/api/career/${CID}/rivals`).catch(() => null),
    ]);
    if ($('#club-profile') === slot) slot.innerHTML = legacyProfileHtml(l, rv);
  } catch { /* profile unavailable; management cards still render */ }
}
window.saveIdentity = async () => {
  try {
    await CP('/identity', { motto: $('#id-motto').value, stadiumName: $('#id-stadium').value });
    toast('Identitas klub tersimpan.');
    await fillClubProfile();
  } catch (e) { toast(e.message); }
};
// ---------- Phase 35: rivals UI ----------
function rivalsHtml(rv) {
  if (!rv) return '';
  const list = rv.rivals.length
    ? rv.rivals.map((r) => `<div class="row"><span><b>${RIVALRY_ICONS[r.tierId] || '⚔️'} ${esc(r.opponentName)}</b>
        <div class="pmeta">${esc(r.tier)} · ${r.meetings} meetings · ${r.wins}W ${r.draws}D ${r.losses}L · last: ${esc(r.lastScore)} (${r.lastResult})</div></span>
        <button class="btn small secondary" onclick="openRival('${esc(r.key)}')">Detail</button></div>`).join('')
    : '<div class="dim">Belum ada rival — mainkan laga liga atau ranked.</div>';
  const act = rv.activity.length
    ? rv.activity.map((a) => `<div class="row"><span>${esc(a.text)}</span></div>`).join('')
    : '<div class="dim">Belum ada aktivitas klub.</div>';
  const ms = rv.milestones.map((m) => `<div class="row"><span><b>${m.unlockedCount > 0 ? '✅' : '🔒'} ${esc(m.title)}</b><div class="pmeta">${esc(m.desc)}</div></span><span style="text-align:right"><b class="accent">+${fmtCash(m.cash)}</b><br><span class="dim">${m.unlockedCount > 0 ? `×${m.unlockedCount}` : ''}</span></span></div>`).join('');
  return `
  <div class="card"><h3>⚔️ Rivals <span class="sub">${rv.rivals.length}</span></h3>${list}</div>
  <div class="card"><h3>🎖️ Pencapaian Rivalitas</h3>${ms}</div>
  <div class="card"><h3>📣 Aktivitas Klub</h3>${act}</div>`;
}
window.openRival = async (key) => {
  const slot = $('#club-profile');
  if (!slot) return;
  slot.innerHTML = '<div class="card dim">Loading rivalry…</div>';
  try {
    const d = await GET(`/api/career/${CID}/rivals/${encodeURIComponent(key)}`);
    slot.innerHTML = rivalDetailHtml(d);
    slot.scrollIntoView();
  } catch (e) { slot.innerHTML = `<div class="card bad">${esc(e.message)}</div>`; }
};
window.backRivals = () => fillClubProfile();
function rivalDetailHtml(d) {
  const r = d.rivalry;
  const icon = RIVALRY_ICONS[r.tierId] || '⚔️';
  const last5 = d.last5?.length
    ? d.last5.map((m) => `<div class="row"><span><b class="${m.result === 'W' ? 'accent' : ''}">${m.result}</b> ${m.gf}–${m.ga} <span class="dim">${esc(m.competition)}</span></span></div>`).join('')
    : '<div class="dim">Belum ada pertemuan.</div>';
  const o = d.opponent || {};
  const cmp = d.comparison || {};
  const cmpRow = (label, a, b) => `<div class="row"><span class="dim">${label}</span><span><b>${a ?? '—'}</b> <span class="dim">vs</span> <b>${b ?? '—'}</b></span></div>`;
  const act = d.activity.length
    ? d.activity.map((a) => `<div class="row"><span>${esc(a.text)}</span></div>`).join('')
    : '<div class="dim">No activity with this rival yet.</div>';
  return `
  <button class="btn small secondary" onclick="backRivals()">← Semua Rival</button>
  <div class="card"><h3>${icon} ${esc(r.opponentName)} <span class="sub">${esc(r.tier)} rivalry</span></h3>
    <div class="row"><span class="dim">Pertemuan</span><b>${r.meetings}</b></div>
    <div class="row"><span class="dim">W / D / L</span><b>${r.wins} / ${r.draws} / ${r.losses}</b></div>
    <div class="row"><span class="dim">Gol</span><b>${r.goalsFor}–${r.goalsAgainst}</b></div>
    <div class="row"><span class="dim">Rekor tak terkalahkan</span><b>${r.streak}</b></div>
    <div class="row"><span class="dim">Intensitas</span><b>${r.intensity}</b></div>
    ${o.manager ? `<div class="row"><span class="dim">Manajer</span><b>${esc(o.manager)} <span class="dim">Lv ${o.managerLevel ?? '?'}</span></b></div>` : ''}
    ${o.motto ? `<div class="row"><span class="dim" style="font-style:italic">“${esc(o.motto)}”</span></div>` : ''}
    ${o.stadiumName ? `<div class="row"><span class="dim">Stadion</span><b>${esc(o.stadiumName)}</b></div>` : ''}
    ${o.reputation != null ? `<div class="row"><span class="dim">Reputasi</span><b>${o.reputation}</b></div>` : ''}
  </div>
  <div class="card"><h3>📊 Perbandingan Klub</h3>
    ${cmpRow('Tingkat Prestige', cmp.me?.prestigeTier, cmp.rival?.prestigeTier)}
    ${cmpRow('Reputasi', cmp.me?.reputation, cmp.rival?.reputation)}
    ${cmpRow('Trofi', cmp.me?.trophies, cmp.rival?.trophies)}
    ${cmpRow('Gelar liga', cmp.me?.leagueTitles, cmp.rival?.leagueTitles)}
    ${cmpRow('Rasio menang', cmp.me ? cmp.me.winRate + '%' : null, cmp.rival?.winRate != null ? cmp.rival.winRate + '%' : null)}
  </div>
  <div class="card"><h3>🕘 Pertemuan Terakhir</h3>${last5}</div>
  <div class="card"><h3>📣 Aktivitas Rivalitas</h3>${act}</div>`;
}
window.hireStaff = async () => {
  const name = $('#staff-name').value.trim() || 'Coach';
  try { await C('/staff/hire', { name, role: $('#staff-role').value, level: parseInt($('#staff-level').value, 10) }); await refresh(); render(); toast('Staf direkrut.'); }
  catch (e) { toast(e.message); }
};
window.fireStaff = async (staffId) => {
  const m = (S.staff ?? []).find((x) => x.id === staffId);
  // Phase 61: explicit confirmation before the destructive fire request.
  confirmDestructive({
    title: 'Pecat staf?',
    detail: m
      ? `<b>${esc(m.name)}</b> <span class="dim">${esc(m.role)} · Lv${m.level}</span><br>Ini tidak bisa dibatalkan.`
      : 'Ini tidak bisa dibatalkan.',
    confirmLabel: 'Pecat',
    onConfirm: async () => {
      await C('/staff/fire', { staffId });
      await refresh();
      render();
    },
  });
};

// ---------- more ----------
const MORE_ITEMS = [
  ['training', '🏋️', 'Latihan'],
  ['transfers', '💸', 'Transfer'],
  ['scout', '🔭', 'Pemandu Bakat'],
  ['league', '📊', 'Liga'],
  ['cup', '🏆', 'Piala'],
  ['continental', '🌍', 'Continental'],
  ['pvp', '⚔️', 'PvP'],
  ['leaderboard', '🏅', 'Papan Peringkat'],
  ['oleague', '🌐', 'Liga Online'],
  ['youth', '🌱', 'Akademi'],
  ['finance', '💰', 'Keuangan'],
  ['rewards', '🎁', 'Hadiah'],
  ['objectives', '🎯', 'Tujuan'],
  ['manager', '⭐', 'Manajer'],
  ['inbox', '📥', 'Kotak Masuk'],
  ['events', '🎪', 'Acara'],
  ['shop', '🛒', 'Toko'],
  ['analytics', '📈', 'Analitik'],
  ['settings', '⚙️', 'Pengaturan'],
];
function renderMore(sc) {
  if (SUB === 'training') return renderTraining(sc);
  if (SUB === 'transfers') return renderTransfers(sc);
  if (SUB === 'scout') return renderScout(sc);
  if (SUB === 'league') return renderLeague(sc);
  if (SUB === 'cup') return renderCup(sc);
  if (SUB === 'continental') return renderContinental(sc);
  if (SUB === 'pvp') return renderPvp(sc);
  if (SUB === 'leaderboard') return renderLeaderboard(sc);
  if (SUB === 'oleague') return renderOleague(sc);
  if (SUB === 'youth') return renderYouth(sc);
  if (SUB === 'finance') return renderFinance(sc);
  if (SUB === 'rewards') return renderRewards(sc);
  if (SUB === 'objectives') return renderObjectives(sc);
  if (SUB === 'manager') return renderManager(sc);
  if (SUB === 'inbox') return renderInbox(sc);
  if (SUB === 'events') return renderEvents(sc);
  if (SUB === 'shop') return renderShop(sc);
  if (SUB === 'analytics') return renderAnalytics(sc);
  if (SUB === 'settings') return renderSettings(sc);
  sc.innerHTML = `<div class="menu-grid">${MORE_ITEMS.map(([k, ico, name]) =>
    `<div class="menu-item" onclick="nav('more','${k}')"><span class="ico">${ico}</span>${name}</div>`).join('')}</div>
    <div class="card"><h3>Kontrak kedaluwarsa <span class="sub">≤1 tahun</span></h3>
    ${S.expiringContracts.length ? S.expiringContracts.map((pid) => { const p = S.squad.players.find((x) => x.id === pid); return p ? `<div class="row"><span>${esc(p.name)} <span class="dim">${p.position} · ${p.overall}</span></span><button class="btn small secondary" onclick="showPlayer('${pid}')">Perpanjang</button></div>` : ''; }).join('') : '<div class="dim">Tidak ada. Skuad aman.</div>'}
    </div>`;
}

const DRILLS = [
  ['finishing', 'Finishing Drill', 'Shooting'], ['long-shots', 'Long Shots', 'Shooting'],
  ['short-passing', 'Short Passing', 'Passing'], ['crossing', 'Crossing Practice', 'Passing'],
  ['tackling', 'Tackling Technique', 'Defending'], ['defensive-shape', 'Defensive Shape', 'Defending'],
  ['endurance', 'Endurance Run', 'Fitness'], ['sprints', 'Sprint Intervals', 'Fitness'],
  ['positional-play', 'Positional Play', 'Tactics'], ['setpiece-routine', 'Set Piece Routine', 'Tactics'],
  ['shot-stopping', 'Shot Stopping', 'Goalkeeping'], ['distribution', 'Distribution', 'Goalkeeping'],
  ['freekicks', 'Free Kick Practice', 'SetPieces'], ['corners', 'Corner Delivery', 'SetPieces'],
];
function renderTraining(sc) {
  sc.innerHTML = backTo('more') + `<div class="card"><h3>Latihan</h3>
    <div class="dim">Satu sesi melatih seluruh skuad. Perhatikan kebugaran & cedera.</div>
    ${DRILLS.map(([id, name, cat]) => `<div class="row"><span>${esc(name)} <span class="dim">${cat}</span></span><button class="btn small" onclick="doTrain('${id}')">Latih</button></div>`).join('')}
  </div>`;
}
let trainBusy = false; // Phase 64: no double training submit
window.doTrain = async (drillId) => {
  if (trainBusy) return;
  trainBusy = true;
  try {
    const r = await C('/train', { drillId });
    const injured = r.results.filter((x) => x.injury).length;
    const xp = r.results.reduce((s, x) => s + x.xpGained, 0);
    await refresh(); render();
    toast(`Sesi selesai: ${fmtCash(xp)} total XP${injured ? `, 🚑 ${injured} cedera` : ''}.`);
  } catch (e) { toast(e.message); }
  finally { trainBusy = false; }
};

let transferTab = 'buy';
async function renderTransfers(sc) {
  sc.innerHTML = backTo('more') + `<div class="eco-hero"><div class="eeyebrow">Rekrutmen</div><h2>Bursa Transfer</h2></div>
    <div class="card">
    <div class="chips"><span class="chip ${transferTab === 'buy' ? 'on' : ''}" onclick="setTransferTab('buy')">Beli</span>
    <span class="chip ${transferTab === 'sell' ? 'on' : ''}" onclick="setTransferTab('sell')">Jual</span></div>
    <div id="tx-body"><div class="dim">Memuat…</div></div></div>`;
  try {
    const { listings } = await CG('/market');
    const mine = listings.filter((l) => l.mine);
    const others = listings.filter((l) => !l.mine);
    $('#tx-body').innerHTML = transferTab === 'buy'
      ? (others.length ? others.map((l) => `
        <div class="listing-card"><div class="posbadge">${l.player.position}</div>
        <div class="pinfo"><div class="pname">${esc(l.player.name)}</div><div class="pmeta">Rating ${l.player.overall} · Usia ${l.player.age} · ${esc(l.sellerName)}</div>
        <div class="price">Harga ${fmtCash(l.askingPrice)}</div></div>
        <div><button class="btn small" onclick="bidUI('${l.id}',${l.askingPrice})">Tawar</button></div></div>`).join('')
        : emptyState('🔍', 'Tidak ada pemain dijual', 'Belum ada listing dari klub lain.'))
      : `<div class="dim" style="margin-bottom:8px">Pemain yang kamu daftarkan:</div>
        ${mine.length ? mine.map((l) => `<div class="ledger-row"><span><span class="ldesc">${esc(l.player.name)}</span></span><span class="lamt in">${fmtCash(l.askingPrice)}</span></div>`).join('') : '<div class="dim">Belum ada yang didaftarkan. Daftarkan pemain dari profilnya (tab Skuad).</div>'}`;
  } catch (e) { $('#tx-body').innerHTML = `<div class="bad">${esc(e.message)}</div>`; }
}
window.setTransferTab = (t) => { transferTab = t; render(); };
window.bidUI = (listingId, asking) => {
  openModal(`<h2>Buat Penawaran</h2>
    <div class="pmeta">Harga yang diminta ${fmtCash(asking)}. Penjual bisa menerima, menawar balik, atau menolak.</div>
    <label>Biaya transfer</label><input id="bid-fee" type="number" value="${asking}">
    <label>Gaji mingguan</label><input id="bid-wage" type="number" value="30000">
    <label>Tahun (1–5)</label><input id="bid-years" type="number" value="3" min="1" max="5">
    <div id="bid-result"></div>
    <button class="btn" id="bid-go">Kirim Tawaran</button>
    <button class="btn secondary" onclick="closeModal()">Batal</button>`);
  $('#bid-go').onclick = async () => {
    try {
      const r = await C('/market/offer', {
        listingId, fee: parseInt($('#bid-fee').value, 10),
        wageOffer: parseInt($('#bid-wage').value, 10), years: parseInt($('#bid-years').value, 10),
      });
      if (r.decision === 'accepted') {
        closeModal(); await refresh(); render(); toast(`Berhasil merekrut ${r.record.playerName}!`);
      } else if (r.decision === 'counter') {
        $('#bid-result').innerHTML = `<div class="card"><div>Penjual menawar balik: <b>${fmtCash(r.counter.fee)}</b></div>
          <button class="btn" id="bid-accept">Terima Tawaran Balik</button></div>`;
        $('#bid-accept').onclick = async () => {
          const r2 = await C('/market/counter', { counterId: r.counter.id, accept: true });
          closeModal(); await refresh(); render(); toast(`Berhasil merekrut ${r2.record.playerName}!`);
        };
      } else {
        $('#bid-result').innerHTML = `<div class="card bad">Ditolak. Coba tawaran lebih tinggi.</div>`;
      }
    } catch (e) { toast(e.message); }
  };
};

function renderScout(sc) {
  sc.innerHTML = backTo('more') + `
    <div class="eco-hero"><div class="eeyebrow">Rekrutmen</div><h2>Pemandu Bakat</h2>
      <div class="emeta">${S.scouts.length} pemandu bakat aktif</div></div>
    <div class="card"><h3>Tim Scouting</h3>
      ${S.scouts.length ? S.scouts.map((s) => `<div class="scout-card"><span class="sname">${esc(s.name)}</span><div class="smeta">Level ${s.level} · ${esc(s.region)}</div><div style="margin-top:8px"><button class="btn small" onclick="assignScout('${s.id}')">Tugaskan</button></div></div>`).join('') : emptyState('🔭', 'Belum ada pemandu bakat', 'Rekrut pemandu bakat untuk membuka laporan pemain baru.')}
      <div class="bar-row"><input id="scout-name" placeholder="Nama pemandu bakat">
      <select id="scout-level">${[1, 2, 3, 4, 5].map((l) => `<option value="${l}">Lv ${l}</option>`).join('')}</select>
      <button class="btn small" onclick="hireScoutUI()">Rekrut</button></div>
    </div>
    <div class="card"><h3>Cara Kerja</h3><div class="dim">Pemandu bakat level lebih tinggi lebih mahal, tetapi laporannya (rentang overall, bintang potensi, estimasi nilai) jauh lebih akurat.</div></div>`;
}
window.hireScoutUI = async () => {
  try { await C('/scout/hire', { name: $('#scout-name').value.trim() || 'Scout', level: parseInt($('#scout-level').value, 10) }); await refresh(); render(); toast('Pemandu bakat direkrut.'); }
  catch (e) { toast(e.message); }
};
window.assignScout = (scoutId) => {
  openModal(`<h2>Tugas Pemandu Bakat</h2>
    <label>Fokus Posisi</label><select id="sc-pos"><option value="">Semua</option>${['GK', 'DL', 'DC', 'DR', 'ML', 'MC', 'MR', 'ST'].map((p) => `<option>${p}</option>`).join('')}</select>
    <label>Laporan (1–5)</label><input id="sc-count" type="number" value="3" min="1" max="5">
    <div id="sc-result"></div>
    <button class="btn" id="sc-go">Kirim Pemandu</button>
    <button class="btn secondary" onclick="closeModal()">Batal</button>`);
  $('#sc-go').onclick = async () => {
    try {
      const r = await C('/scout/assign', { scoutId, criteria: { position: $('#sc-pos').value || undefined, count: parseInt($('#sc-count').value, 10) } });
      await refresh();
      $('#sc-result').innerHTML = `<div class="dim">Biaya ${fmtCash(r.cost)}.</div>` + r.reports.map((rep) =>
        `<div class="report-card"><div><b>???</b> <span class="dim">dilaporkan ${esc(rep.scoutName)}</span></div>
        <div><span class="range">${rep.reported.overallLow}–${rep.reported.overallHigh}</span> · Potensi ${'⭐'.repeat(rep.reported.potentialStars)}</div>
        <div class="pmeta">Kekuatan: ${rep.reported.strengths.join(', ')}</div>
        <div class="pmeta">Estimasi nilai: ${fmtCash(rep.reported.valueLow)}–${fmtCash(rep.reported.valueHigh)}</div></div>`).join('');
    } catch (e) { toast(e.message); }
  };
};

async function renderLeague(sc) {
  sc.innerHTML = backTo('more') + `
  <div class="comp-hero">
    <div class="ceyebrow">Liga Domestik</div>
    <h2>🏆 Liga Nusantara</h2>
    <div class="csub">Musim ${S.season} · ${S.table.length} klub · 4 besar lolos Continental</div>
    <div class="cstats">
      <div class="cstat"><div class="v" id="lg-pos">–</div><div class="l">Posisimu</div></div>
      <div class="cstat"><div class="v" id="lg-pts">–</div><div class="l">Poin</div></div>
      <div class="cstat"><div class="v" id="lg-rec">–</div><div class="l">M–S–K</div></div>
      <div class="cstat"><div class="v" id="lg-prog">–</div><div class="l">Progres</div></div>
    </div>
  </div>
  <div class="card"><h3>Klasemen</h3>
    <div class="table-wrap"><table><tr><th>#</th><th>Klub</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GD</th><th class="num">Pts</th></tr>
    ${S.table.map((r, i) => `<tr class="${i < 4 ? 'zone-q' : ''}${r.clubId === S.club.id ? ' me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="num"><b>${r.points}</b></td></tr>`).join('')}</table></div>
    <div class="pmeta"><span class="badge info">Zona Continental</span> 4 besar lolos ke Continental Champions</div></div>
  <div class="card"><h3>🏆 Piala <span class="sub">Musim ${S.season}</span></h3><div id="cupcard" class="dim">Memuat…</div>
    <div class="bar-row"><button class="btn small secondary" onclick="nav('more','cup')">Buka Piala →</button></div></div>
    <div class="card"><h3>📊 Progres Musim</h3><div id="seasoncard" class="dim">Memuat…</div></div>
    <div class="card"><h3>Top Skor</h3><div id="scorers" class="dim">Memuat…</div></div>`;
  try {
    const { scorers } = await CG('/scorers');
    $('#scorers').innerHTML = scorers.length
      ? scorers.map((s, i) => `<div class="row"><span>${i + 1}. ${esc(s.name)} <span class="dim">${esc(s.clubName)}</span></span><b>⚽ ${s.goals}</b></div>`).join('')
      : 'Belum ada gol.';
  } catch (e) { $('#scorers').textContent = e.message; }
  // Phase 32: season presentation
  try {
    const sn = await CG('/season');
    const set = (id, html) => { const el = $('#' + id); if (el) el.innerHTML = html; };
    set('lg-pos', `${sn.position}<span class="dim">/${S.table.length}</span>`);
    set('lg-pts', `${sn.points}`);
    set('lg-rec', `${sn.won}–${sn.drawn}–${sn.lost}`);
    set('lg-prog', `${sn.progressPct}%`);
    const el = $('#seasoncard');
    if (!el) return;
    const myPos = sn.position;
    el.innerHTML = `
      <div class="grid2">
        <div class="card"><div class="dim">Posisi</div><div class="big">${myPos}<span class="dim">/${S.table.length}</span></div></div>
        <div class="card"><div class="dim">Progres</div><div class="big">${sn.progressPct}%</div><div class="pmeta">Matchday ${sn.matchday}/${sn.totalMatchdays}</div></div>
        <div class="card"><div class="dim">Rekor</div><div class="big">${sn.won}W <span class="dim">${sn.drawn}D ${sn.lost}L</span></div><div class="pmeta">${sn.points} poin · ${sn.goalsFor}:${sn.goalsAgainst}</div></div>
        <div class="card"><div class="dim">Musim</div><div class="big">S${sn.season}</div></div>
      </div>
      <div class="bar"><div class="barfill" style="width:${sn.progressPct}%"></div></div>
      ${sn.history.length ? `<h3>Musim Lalu</h3>${sn.history.map((h) => `<div class="row"><span><b>S${h.season}</b> · finis #${h.position}</span><span class="dim">${h.won}M ${h.drawn}S ${h.lost}K · ${h.points} poin · +${fmtCash(h.prize)}</span></div>`).join('')}` : '<div class="dim">Belum ada musim yang selesai.</div>'}`;
  } catch (e) { const el = $('#seasoncard'); if (el) el.textContent = e.message; }
  // Phase 36: cup summary card
  try {
    const cup = await CG('/cup');
    const el = $('#cupcard');
    if (el) {
      el.innerHTML = cup.status === 'complete'
        ? `<b>🏆 ${esc(cup.champion ?? '?')}</b> <span class="dim">juara · lajumu: ${esc(roundLabel(cup.playerRun) ?? '—')}</span>`
        : cup.playerFixture
          ? `<b>${esc(roundLabel(cup.playerFixture.round))}</b><div class="pmeta">${esc(cup.playerFixture.home)} vs ${esc(cup.playerFixture.away)}</div>`
          : `<span class="dim">Tersingkir · lajumu: ${esc(roundLabel(cup.playerRun) ?? '—')}</span>`;
    }
  } catch (e) { const el = $('#cupcard'); if (el) el.textContent = e.message; }
}

async function renderCup(sc) {
  sc.innerHTML = backTo('more') + `<div class="comp-hero">
      <div class="ceyebrow">Turnamen Knockout</div>
      <h2>🏆 Piala</h2>
      <div class="csub" id="cup-title">Memuat…</div>
      <div class="cstats"><div class="cstat"><div class="v" id="cup-mystatus">–</div><div class="l">Statusmu</div></div></div>
    </div>
    <div id="cup-body" class="dim">Memuat…</div>`;
  try {
    const cup = await CG('/cup');
    const body = $('#cup-body');
    if (!body) return;
    $('#cup-title').textContent = `Musim ${cup.season}`;
    const setStatus = (html) => { const el = $('#cup-mystatus'); if (el) el.innerHTML = html; };
    if (cup.status === 'complete') setStatus(`🏆 ${esc(roundLabel(cup.playerRun) ?? '—')}`);
    else if (cup.playerFixture) setStatus(esc(roundLabel(cup.playerFixture.round)));
    else setStatus('Tersingkir');
    const rounds = `<div class="bracket">${cup.rounds.map((r) => `
      <div class="bround"><h4>${esc(roundLabel(r.name) ?? r.name)}</h4>
      ${r.fixtures.map((f) => `
        <div class="bfixture${f.involvesPlayer ? ' me' : ''}">
          <div class="bt${f.status === 'played' && f.winner === f.home ? ' winner' : ''}"><span>${esc(f.home)}</span><span class="s">${f.status === 'played' ? f.homeScore : ''}</span></div>
          <div class="bt${f.status === 'played' && f.winner === f.away ? ' winner' : ''}"><span>${esc(f.away)}</span><span class="s">${f.status === 'played' ? f.awayScore : ''}</span></div>
          <div class="bmeta">
            ${f.status === 'played' ? `<span class="meta">Pemenang: ${esc(f.winner)}</span>` : '<span class="meta">Mendatang</span>'}
            ${f.involvesPlayer ? '<span class="badge win">Lagamu</span>' : ''}
          </div>
        </div>`).join('')}</div>`).join('')}</div>`;
    const hist = cup.history.length
      ? `<div class="card"><h3>Musim Lalu</h3>${cup.history.map((h) => `<div class="row"><span><b>S${h.season}</b> · 🏆 ${esc(h.championName ?? '?')}</span><span class="dim">lajumu: ${esc(roundLabel(h.playerRun) ?? '—')}</span></div>`).join('')}</div>`
      : '';
    body.innerHTML = `
      ${cup.status === 'complete'
        ? `<div class="card"><div class="big">🏆 ${esc(cup.champion ?? '?')}</div><div class="dim">Musim ${cup.season} · juara · lajumu: ${esc(roundLabel(cup.playerRun) ?? '—')}</div></div>`
        : cup.playerFixture
          ? `<div class="card"><div class="bar-row"><button class="btn" onclick="playCup()">▶ Mainkan ${esc(roundLabel(cup.playerFixture.round))}: ${esc(cup.playerFixture.home)} vs ${esc(cup.playerFixture.away)}</button><button class="btn secondary" onclick="startLiveMatch('cup')">🔴 Live</button></div></div>`
          : `<div class="card"><div class="dim">Kamu tersingkir dari piala musim ini. Lajumu: ${esc(roundLabel(cup.playerRun) ?? '—')}. Kamu masih bisa mensimulasikan ronde tersisa.</div>
             <div class="bar-row"><button class="btn secondary" onclick="playCup()">Simulasi Ronde</button></div></div>`}
      <div class="card"><h3>Bracket Turnamen</h3>${rounds}</div>
      ${hist}`;
  } catch (e) {
    const body = $('#cup-body');
    if (body) body.innerHTML = `<div class="card bad">${esc(e.message)}</div>`;
  }
}
// Phase 51: shared competition result screen (cup/continental/live).
// Renders the server-provided report via renderReportCards; never fabricates.
function showCompetitionResult(title, pr, onContinue) {
  const rep = pr.report;
  const sc = $('#screen');
  TAB = 'more';
  sc.innerHTML = `
    <div class="card scorehead">
      <div class="teams">${esc(title)}${pr.round ? ` — ${esc(roundLabel(pr.round))}` : ''}</div>
      <div class="score">${pr.homeScore} – ${pr.awayScore}</div>
      <div class="dim">${pr.won ? 'Menang' : pr.won === false ? 'Selesai' : ''}</div>
    </div>
    ${renderReportCards(rep, rep?.summary?.home ?? '', rep?.summary?.away ?? '')}
    <button class="btn" id="compr-continue">Lanjutkan</button>`;
  $('#compr-continue').onclick = onContinue;
}
window.playCup = async () => {
  try {
    const r = await C('/cup/play', {});
    await refresh();
    if (r.final) {
      toast(r.final.isPlayer ? `🏆 CUP CHAMPIONS! +${fmtCash(r.final.prize)}` : `Cup complete: ${r.final.champion} champions.`, 5000);
    }
    if (r.playerResult?.report) {
      showCompetitionResult('Cup', r.playerResult, () => nav('more', 'cup'));
    } else {
      if (r.playerResult) {
        toast(r.playerResult.won ? `Cup win ${r.playerResult.homeScore}–${r.playerResult.awayScore}!` : `Cup: ${r.playerResult.homeScore}–${r.playerResult.awayScore}.`);
      } else toast('Ronde disimulasikan.');
      nav('more', 'cup');
    }
  } catch (e) { toast(e.message); }
};

// Phase 37: continental champions UI
async function renderContinental(sc) {
  sc.innerHTML = backTo('more') + `<div class="comp-hero">
      <div class="ceyebrow">Kompetisi Benua</div>
      <h2>🌍 Continental Champions</h2>
      <div class="csub" id="cont-title">Memuat…</div>
      <div class="cstats"><div class="cstat"><div class="v" id="cc-status">–</div><div class="l">Statusmu</div></div></div>
    </div>
    <div id="cont-body" class="dim">Memuat…</div>`;
  try {
    const cc = await CG('/continental');
    const body = $('#cont-body');
    if (!body) return;
    const setCc = (html) => { const el = $('#cc-status'); if (el) el.innerHTML = html; };
    if (!cc.qualified) {
      $('#cont-title').textContent = `Musim ${cc.season}`;
      setCc('Tidak lolos');
      body.innerHTML = `<div class="dim">${esc(cc.message)}</div>
        ${cc.history.length ? `<h3>Musim Lalu</h3>${cc.history.map((h) => `<div class="row"><span><b>S${h.season}</b> · 🏆 ${esc(h.championName ?? '?')}</span><span class="dim">lajumu: ${esc(roundLabel(h.playerRun) ?? '—')}</span></div>`).join('')}` : ''}`;
      return;
    }
    $('#cont-title').textContent = `Musim ${cc.season} · ${esc(cc.group.name)}`;
    setCc(cc.status === 'complete' ? 'Selesai' : cc.playerFixture ? esc(roundLabel(cc.playerFixture.round)) : 'Lolos grup');
    const table = `<div class="table-wrap"><table><tr><th>#</th><th>Klub</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GF</th><th class="num">GA</th><th class="num">GD</th><th class="num">Pts</th></tr>
      ${cc.group.table.map((r, i) => `<tr class="${i < 2 ? 'zone-q' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td><td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="num"><b>${r.pts}</b></td></tr>`).join('')}</table></div>
      <div class="pmeta"><span class="badge info">2 besar</span> melaju ke final</div>`;
    const fixtures = cc.group.fixtures.map((f) => `
      <div class="row" ${f.involvesPlayer ? 'style="background:var(--card2)"' : ''}>
        <span><b>${esc(f.home)}</b> ${f.status === 'played' ? `${f.homeScore}–${f.awayScore}` : 'vs'} <b>${esc(f.away)}</b>
        <div class="pmeta dim">Matchday ${f.matchday}</div></span>
        ${f.involvesPlayer && f.status === 'pending' ? '<span class="badge win">Lagamu</span>' : ''}
      </div>`).join('');
    const knockout = cc.knockout.length ? `<h3>Final</h3>${cc.knockout.map((f) => `
      <div class="row" ${f.involvesPlayer ? 'style="background:var(--card2)"' : ''}>
        <span><b>${esc(f.home)}</b> ${f.status === 'played' ? `${f.homeScore}–${f.awayScore}` : 'vs'} <b>${esc(f.away)}</b>
        ${f.status === 'played' ? `<div class="meta">Pemenang: ${esc(f.winner)}</div>` : '<div class="meta">Mendatang</div>'}</span>
        ${f.involvesPlayer && f.status === 'pending' ? '<span class="badge win">Lagamu</span>' : ''}
      </div>`).join('')}` : '';
    const hist = cc.history.length
      ? `<h3>Musim Lalu</h3>${cc.history.map((h) => `<div class="row"><span><b>S${h.season}</b> · 🏆 ${esc(h.championName ?? '?')}</span><span class="dim">lajumu: ${esc(roundLabel(h.playerRun) ?? '—')}</span></div>`).join('')}`
      : '';
    body.innerHTML = `
      ${cc.status === 'complete'
        ? `<div class="card"><div class="big">🏆 ${esc(cc.champion ?? '?')}</div><div class="dim">Musim ${cc.season} juara · lajumu: ${esc(roundLabel(cc.playerRun) ?? '—')}</div></div>`
        : cc.playerFixture
          ? `<div class="bar-row"><button class="btn" onclick="playContinental()">▶ Mainkan ${esc(roundLabel(cc.playerFixture.round))}: ${esc(cc.playerFixture.home)} vs ${esc(cc.playerFixture.away)}</button><button class="btn secondary" onclick="startLiveMatch('continental')">🔴 Live</button></div>`
          : !cc.playerQualified
            ? `<div class="dim">Kamu tidak lolos musim ini — finis 4 besar di liga.</div>`
            : `<div class="dim">Menunggu ronde berikutnya. Lajumu: ${esc(roundLabel(cc.playerRun) ?? '—')}.</div>
               <div class="bar-row"><button class="btn secondary" onclick="playContinental()">Simulasi Ronde</button></div>`}
      <div class="card"><h3>Klasemen Grup</h3>
      ${table}</div>
      <div class="card"><h3>Jadwal</h3>
      ${fixtures}</div>
      ${knockout}
      ${hist}`;
  } catch (e) {
    const body = $('#cont-body');
    if (body) body.innerHTML = `<div class="card bad">${esc(e.message)}</div>`;
  }
}
window.playContinental = async () => {
  try {
    const r = await C('/continental/play', {});
    await refresh();
    if (r.final) {
      toast(r.final.isPlayer ? `🏆 CONTINENTAL CHAMPIONS! +${fmtCash(r.final.prize)}` : `Continental complete: ${r.final.champion} champions.`, 5000);
    }
    if (r.playerResult?.report) {
      showCompetitionResult('Continental', r.playerResult, () => nav('more', 'continental'));
    } else {
      if (r.playerResult) {
        toast(r.playerResult.won ? `Continental win ${r.playerResult.homeScore}–${r.playerResult.awayScore}!` : `Continental: ${r.playerResult.homeScore}–${r.playerResult.awayScore}.`);
      } else toast('Ronde disimulasikan.');
      nav('more', 'continental');
    }
  } catch (e) { toast(e.message); }
};

function renderYouth(sc) {
  sc.innerHTML = backTo('more') + `<div class="card"><h3>Akademi Muda <span class="sub">${S.academy.length} prospek</span></h3>
    <button class="btn" id="intakebtn">Rekrutmen Akademi</button>
    ${S.academy.length ? S.academy.map((p) => `
      <div class="prow" style="cursor:default"><div class="posbadge">${p.position}</div>
      <div><div><b>${esc(p.name)}</b></div><div class="pmeta">Usia ${p.age} · ${p.overall} (pot ${p.potential})</div></div>
      <div><button class="btn small" onclick="promoteYouth('${p.id}')">Promosikan</button>
      <button class="btn small danger" onclick="releaseYouth('${p.id}')">✕</button></div></div>`).join('') : emptyState('🌱', 'Belum ada pemain muda', 'Jalankan rekrutmen akademi untuk menemukan prospek.')}
  </div>`;
  $('#intakebtn').onclick = async () => {
    try { await C('/youth/intake'); await refresh(); render(); toast('Rekrutmen akademi selesai.'); }
    catch (e) { toast(e.message); }
  };
}
window.promoteYouth = async (pid) => {
  try { await C('/youth/promote', { playerId: pid }); await refresh(); render(); toast('Promosi ke tim utama!'); }
  catch (e) { toast(e.message); }
};
window.releaseYouth = (pid) => {
  const p = (S.academy ?? []).find((x) => x.id === pid);
  // Phase 61: explicit confirmation before the destructive release request.
  confirmDestructive({
    title: 'Lepas pemain muda?',
    detail: p
      ? `<b>${esc(p.name)}</b> <span class="dim">${esc(p.position)} · Usia ${p.age} · ${p.overall} (pot ${p.potential})</span><br>Ini tidak bisa dibatalkan.`
      : 'Ini tidak bisa dibatalkan.',
    confirmLabel: 'Lepas',
    onConfirm: async () => {
      await C('/youth/release', { playerId: pid });
      await refresh();
      render();
    },
  });
};

async function renderFinance(sc) {
  sc.innerHTML = backTo('more') + `<div class="card"><h3>Keuangan</h3><div class="dim">Memuat…</div></div>`;
  try {
    const f = await CG('/finance');
    const runway = f.health.runwayWeeks === null ? '∞' : Math.round(f.health.runwayWeeks) + ' mgg';
    sc.innerHTML = backTo('more') + `
      <div class="eco-hero"><div class="eeyebrow">Keuangan Klub</div>
        <div class="ecash">💰 ${fmtCash(f.cash)}</div>
        <div class="emeta">Kesehatan: <b>${esc(healthLabel(f.health.status))}</b> · Dana cukup ${runway}</div>
      </div>
      <div class="card"><h3>Buku Kas</h3>
        ${f.ledger.length ? `<div class="ledger">${f.ledger.map((e) => `<div class="ledger-row"><span><span class="ldesc">${esc(e.description || e.type)}</span><div class="ltype">${esc(e.type)}</div></span><span class="lamt ${e.amount >= 0 ? 'in' : 'out'}">${e.amount >= 0 ? '+' : ''}${fmtCash(e.amount)}</span></div>`).join('')}</div>` : emptyState('💰', 'Belum ada transaksi', 'Transaksi keuangan klub akan tercatat di sini.')}
      </div>`;
  } catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; }
}

// ---------- pvp (friendlies + ranked arena, Phase 20/22) ----------
let PVP_POLL = null;
function stopPvpPoll() { if (PVP_POLL) { clearTimeout(PVP_POLL); PVP_POLL = null; } }

async function renderPvp(sc) {
  stopPvpPoll();
  let history = [], rk = null, rlb = [];
  try {
    const [h, r, lb] = await Promise.all([
      CG('/pvp/history').catch(() => ({ history: [] })),
      GET('/api/pvp/ranked').catch(() => null),
      GET('/api/pvp/leaderboard').catch(() => ({ leaderboard: [] })),
    ]);
    history = h.history ?? [];
    rk = r;
    rlb = lb.leaderboard ?? [];
  } catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }

  const tierCls = rk && (rk.tier === 'Diamond' || rk.tier === 'Platinum') ? 'win' : rk && rk.tier === 'Gold' ? 'draw' : 'neutral';
  let rkHtml = '';
  if (rk) {
    const fx = rk.fixture;
    rkHtml = `<div class="comp-hero">
      <div class="ceyebrow">PvP Kompetitif · Sealed Match</div>
      <h2>🏆 Ranked Arena <span class="badge ${tierCls}">${esc(rk.tier)}</span></h2>
      <div class="csub">Musim ${rk.season.number}${rk.seasonEnded ? ' · berakhir — ganti musim untuk klaim hadiah' : ''}</div>
      <div class="cstats">
        <div class="cstat"><div class="v">${rk.rating}</div><div class="l">Rating Elo</div></div>
        <div class="cstat"><div class="v">${rk.wins}<span class="dim">M</span> ${rk.draws}<span class="dim">S</span> ${rk.losses}<span class="dim">K</span></div><div class="l">Rekor musim</div></div>
      </div>
    </div><div class="card">`;
    if (fx) {
      // Phase 39b: sealed tactical duel fixture card.
      const stBadge = fx.status === 'completed' ? 'win' : fx.mySealed ? 'draw' : 'loss';
      const stLabel = fx.status === 'completed'
        ? `FT ${fx.homeScore}–${fx.awayScore}`
        : fx.mySealed ? (fx.oppSealed ? 'Mensimulasikan…' : 'Tersegel — menunggu lawan') : 'Siapkan taktikmu';
      const cd = fx.status === 'preparing' ? countdownTo(fx.preparationDeadline) : '';
      const sealState = fx.status === 'preparing'
        ? `<div class="pmeta">${fx.mySealed ? '✅ Kamu mengunci' : '⬜ Kamu: belum kunci'} · ${fx.oppSealed ? '✅ Lawan mengunci' : '⬜ Lawan: belum kunci'}</div>` : '';
      const delta = fx.status === 'completed' && fx.myRatingAfter !== null && fx.myRatingBefore !== null
        ? ` <span class="${fx.myRatingAfter >= fx.myRatingBefore ? 'accent' : 'bad'}">(${fx.myRatingBefore} → ${fx.myRatingAfter})</span>` : '';
      rkHtml += `<div class="row"><span><b>Ranked vs ${esc(fx.opponent ?? '?')}</b> <span class="badge ${stBadge}">${stLabel}</span>${delta}
        ${fx.status === 'preparing' ? `<div class="pmeta">⏳ Tenggat: ${cd}${fx.willUseFallback && !fx.mySealed ? ' · fallback dipakai jika kamu tidak mengunci' : ''}</div>` : ''}
        ${sealState}</span>
        <button class="btn small" id="rk-fx-open">${fx.status === 'completed' ? 'Hasil' : fx.mySealed ? 'Lihat' : 'Siapkan'}</button></div>`;
    } else if (rk.inQueue) {
      rkHtml += `<div class="row"><span>Mencari lawan… (${rk.queueSize} dalam antrian)</span><button class="btn small secondary" id="rk-leave">Keluar</button></div>`;
    } else {
      rkHtml += `<button class="btn" id="rk-join">Masuk Antrian Ranked</button>
        <div class="dim">Rating Elo (mulai 1000). Menang/kalah/seri mengubah rating. Hadiah musim per tier.</div>`;
    }
    if (rk.seasonEnded) rkHtml += `<button class="btn secondary" id="rk-rollover">Ganti musim (klaim hadiah)</button>`;
    rkHtml += `</div>`;
    if (rlb.length) {
      rkHtml += `<div class="card"><h3>Papan Peringkat Ranked</h3>${rlb.slice(0, 10).map((r, i) =>
        `<div class="row"><span><b>#${i + 1} ${esc(r.username)}</b> <span class="badge ${i === 0 ? 'win' : 'draw'}">${esc(r.tier)}</span><div class="pmeta">${r.w}W ${r.d}D ${r.l}L</div></span><b>${r.rating}</b></div>`).join('')}</div>`;
    }
    // Phase 33: season dashboard
    const cd = countdownTo(Date.now() + (rk.timeRemainingMs ?? 0));
    rkHtml += `<div class="card"><h3>📅 Dasbor Musim <span class="sub">Musim ${rk.season.number}</span></h3>
      <div class="grid2">
        <div class="card"><div class="dim">Peringkatku</div><div class="big">${rk.myRank ? '#' + rk.myRank : '—'}</div><div class="pmeta">Rating ${rk.rating} · ${esc(rk.tier)}</div></div>
        <div class="card"><div class="dim">Musim berakhir dalam</div><div class="big">${rk.seasonEnded ? 'berakhir' : cd}</div><div class="pmeta">hadiah tier: <b class="accent">+${fmtCash(rk.myTierReward ?? 0)}</b></div></div>
      </div>
      <h3>Target Musiman</h3>
      ${(rk.seasonGoals ?? []).map((g) => `<div class="row"><span><b>${g.done ? '✅' : '🎯'} ${esc(g.title)}</b><div class="pmeta">${esc(g.desc)} · ${g.current}/${g.target}</div>
        <div class="bar"><div class="barfill" style="width:${Math.round((g.current / g.target) * 100)}%"></div></div></span></div>`).join('')}
      ${(rk.mySeasonHistory ?? []).length ? `<h3>Musim Lalu</h3>${rk.mySeasonHistory.map((h) =>
        `<div class="row"><span><b>Musim ${h.season}</b> · finis <b>#${h.rank}</b> <span class="badge draw">${esc(h.tier)}</span></span><span class="dim">${h.w}M ${h.d}S ${h.l}K · +${fmtCash(h.rewardAmount)}</span></div>`).join('')}` : ''}
    </div>`;
  }

  sc.innerHTML = backTo('more') + rkHtml + `<div class="card"><h3>⚔️ Tantangan Persahabatan</h3>
    <label>Username mereka</label>
    <input id="pvp-user" placeholder="cth. budi" maxlength="20" autocapitalize="off">
    <button class="btn" id="pvp-go">Kirim Tantangan Persahabatan</button>
    <div class="dim">Persahabatan. Skuadmu main sungguhan; XI lawan diambil dari snapshot. Menang: +25.000 · Seri: +10.000. Maks 5/hari.</div>
  </div>
  <div class="card"><h3>Riwayat Persahabatan</h3>
    ${history.length ? history.map((r) => `<div class="row"><span><b>${esc(r.opponentClub)}</b><span class="badge ${r.outcome}">${r.outcome}</span><div class="pmeta">${esc(r.score)}${r.prize ? ' · +' + fmtCash(r.prize) : ''}</div></span></div>`).join('') : '<div class="dim">Belum ada laga persahabatan. Tantang seseorang!</div>'}
  </div>`;

  const rerender = () => { if (TAB === 'more' && SUB === 'pvp') renderPvp(sc); };
  if ($('#rk-join')) $('#rk-join').onclick = async () => {
    try {
      const r = await POST('/api/pvp/queue/join', {});
      if (r.matched) toast('Lawan ditemukan!');
      rerender();
    } catch (e) { toast(e.message); }
  };
  if ($('#rk-leave')) $('#rk-leave').onclick = async () => {
    try { await POST('/api/pvp/queue/leave', {}); } catch (e) { toast(e.message); }
    rerender();
  };
  if ($('#rk-fx-open')) $('#rk-fx-open').onclick = async () => {
    try {
      const r = await GET('/api/pvp/ranked');
      if (r.fixture) renderRankedFixture(sc, r.fixture.id);
      else rerender();
    } catch (e) { toast(e.message); }
  };
  if ($('#rk-rollover')) $('#rk-rollover').onclick = async () => {
    try {
      const r = await POST('/api/pvp/season/rollover', {});
      toast(`Musim ${r.toSeason} dimulai. ${r.rewards.length} hadiah dibayar.`);
      rerender();
    } catch (e) { toast(e.message); }
  };
  $('#pvp-go').onclick = async () => {
    const username = $('#pvp-user').value.trim();
    if (!username) return toast('Masukkan username dulu.');
    try {
      const r = await C('/pvp/challenge', { username });
      toast(`Persahabatan vs ${esc(username)}: ${r.score.home}–${r.score.away} (${r.record.outcome})${r.record.prize ? ' · +' + fmtCash(r.record.prize) : ''}`);
      await refresh();
      rerender();
    } catch (e) { toast(e.message); }
  };

  // poll while queued
  if (rk && rk.inQueue && !rk.fixture) {
    PVP_POLL = setTimeout(async () => {
      if (TAB !== 'more' || SUB !== 'pvp') return;
      try {
        const r = await POST('/api/pvp/queue/poll', {});
        if (r.matched) { toast('Lawan ditemukan!'); rerender(); }
        else if (r.inQueue) renderPvp(sc);
      } catch { /* stay queued */ }
    }, 4000);
  }
}

// ---------- ranked sealed fixture (Phase 39b) ----------
const PLAN_MINUTES_UI = [45, 60, 75];
const PLAN_STATES_UI = ['winning', 'drawing', 'losing', 'losing_by_2'];
const PLAN_ACTIONS_UI = ['mentality', 'pressing', 'tempo', 'sub'];

async function renderRankedFixture(sc, fixtureId) {
  let fx;
  try { fx = (await GET(`/api/pvp/ranked/fixture?id=${encodeURIComponent(fixtureId)}`)).fixture; }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  if (!fx) { sc.innerHTML = backTo('more') + `<div class="card bad">Jadwal tidak ditemukan.</div>`; return; }
  if (fx.status === 'completed') return renderRankedResult(sc, fx);
  if (fx.mySealed) {
    const cd = countdownTo(fx.preparationDeadline);
    sc.innerHTML = backTo('more') + `<div class="card"><h3>⚔️ Ranked vs ${esc(fx.opponent ?? '?')}</h3>
      <div class="pmeta">${fx.mySealed ? '✅ Your tactics are sealed' : ''} · ${fx.oppSealed ? '✅ Opponent sealed' : '⬜ Opponent not sealed yet'}</div>
      ${!fx.oppSealed ? `<div class="dim" style="margin-top:8px">Konfigurasi taktik terkunci. Menunggu lawan…<br>Deadline in ${cd} — if they don't seal, their fallback configuration will be used.</div>` : `<div class="dim" style="margin-top:8px">Keduanya tersegel — mensimulasikan…</div>`}
      <div class="dim" style="margin-top:8px">Susunan tersegelmu tidak bisa diubah untuk fixture ini.</div>
      <button class="btn secondary" id="rkf-back">Kembali</button></div>`;
    $('#rkf-back').onclick = () => renderPvp(sc);
    // auto-refresh while waiting
    setTimeout(() => { if (TAB === 'more' && SUB === 'pvp') renderRankedFixture(sc, fixtureId); }, 15000);
    return;
  }
  renderRankedPrepare(sc, fx);
}

function rkfPlayerRow(p, sel) {
  const inXi = sel.xi.has(p.id), inBench = sel.bench.has(p.id);
  const cls = inXi ? 'win' : inBench ? 'draw' : '';
  return `<div class="row rkf-p ${cls}" data-pid="${esc(p.id)}"><span><b>${esc(p.name)}</b> <span class="badge">${esc(p.position)}</span>
    <div class="pmeta">fitness ${p.fitness}${p.injury ? ' · 🚑 injured' : ''}${inXi ? ' · <b>XI</b>' : ''}${inBench ? ' · bench' : ''}</div></span></div>`;
}

function renderRankedPrepare(sc, fx) {
  const pool = fx.myPool ?? [];
  const cfg = fx.myConfig ?? {};
  const sel = {
    xi: new Set((cfg.lineupIds ?? []).filter((id) => pool.some((p) => p.id === id))),
    bench: new Set((cfg.benchIds ?? []).filter((id) => pool.some((p) => p.id === id))),
  };
  const tactics = cfg.tactics ?? {};
  const formation = cfg.formation ?? '4-4-2';
  const rules = (cfg.plan ?? []).slice(0, 5);
  // Phase 39c: per-player instructions for the sealed XI (red/blue/none).
  const instr = { ...(cfg.playerInstructions ?? {}) };

  const paint = () => {
    const list = $('#rkf-pool');
    if (list) list.innerHTML = pool.map((p) => rkfPlayerRow(p, sel)).join('') ||
      '<div class="dim">Tidak ada pemain di pool beku.</div>';
    const c = $('#rkf-count');
    if (c) {
      const gk = [...sel.xi].filter((id) => pool.find((p) => p.id === id)?.position === 'GK').length;
      c.innerHTML = `XI: <b>${sel.xi.size}/11</b>${gk === 1 ? ' ✅ GK' : ' <b class="bad">need 1 GK</b>'} · Bench: <b>${sel.bench.size}/7</b>`;
    }
    document.querySelectorAll('.rkf-p').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.pid;
        if (sel.xi.has(id)) { sel.xi.delete(id); }
        else if (sel.bench.has(id)) { sel.bench.delete(id); }
        else if (sel.xi.size < 11) { sel.xi.add(id); }
        else if (sel.bench.size < 7) { sel.bench.add(id); }
        else { toast('Tim inti dan cadangan penuh.'); return; }
        paint();
        if (typeof paintInstr === 'function') paintInstr();
      };
    });
  };

  const planRow = (r, i) => {
    const act = r ? Object.keys(r.then)[0] : 'mentality';
    const valOpts = act === 'mentality' ? TACTIC_OPTS.mentality
      : act === 'pressing' ? TACTIC_OPTS.pressing
      : act === 'tempo' ? TACTIC_OPTS.tempo : [];
    const xiIds = [...sel.xi], benchIds = [...sel.bench];
    const nm = (id) => pool.find((p) => p.id === id)?.name ?? id;
    return `<div class="card" style="margin:6px 0" data-rule="${i}">
      <div class="grid2">
        <label>Dari menit<select data-k="minuteGte">${PLAN_MINUTES_UI.map((m) => `<option ${r?.if.minuteGte === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label>Jika skor<select data-k="scoreState">${PLAN_STATES_UI.map((s) => `<option ${r?.if.scoreState === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Aksi<select data-k="action">${PLAN_ACTIONS_UI.map((a) => `<option ${act === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        <label class="rkf-val">Nilai<span data-valwrap>${act === 'sub'
          ? `<select data-k="subOut">${xiIds.map((id) => `<option value="${esc(id)}" ${r?.then.sub?.out === id ? 'selected' : ''}>out: ${esc(nm(id))}</option>`).join('')}</select>
             <select data-k="subIn">${benchIds.map((id) => `<option value="${esc(id)}" ${r?.then.sub?.in === id ? 'selected' : ''}>in: ${esc(nm(id))}</option>`).join('')}</select>`
          : `<select data-k="value">${valOpts.map((v) => `<option ${r?.then[act] === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</span></label>
      </div>
      <button class="btn small secondary" data-delrule="${i}">Hapus aturan</button></div>`;
  };

  const paintPlan = () => {
    const wrap = $('#rkf-plan');
    if (!wrap) return;
    wrap.innerHTML = rules.map((r, i) => planRow(r, i)).join('') ||
      '<div class="dim">Belum ada aturan rencana taktik. Tambah hingga 5.</div>';
    wrap.querySelectorAll('[data-k="action"]').forEach((s) => {
      s.onchange = () => {
        const i = +s.closest('[data-rule]').dataset.rule;
        rules[i] = { if: rules[i]?.if ?? { minuteGte: 60, scoreState: 'losing' }, then: {} };
        paintPlan();
      };
    });
    wrap.querySelectorAll('[data-delrule]').forEach((b) => {
      b.onclick = () => { rules.splice(+b.dataset.delrule, 1); paintPlan(); };
    });
  };

  sc.innerHTML = backTo('more') + `
    <div class="card"><h3>⚔️ Prepare vs ${esc(fx.opponent ?? '?')}</h3>
      <div class="pmeta">⏳ Kunci sebelum <b>${countdownTo(fx.preparationDeadline)}</b> atau fallback-mu (dibekukan saat matchmaking) dipakai.</div>
      <div class="bad" style="margin-top:8px"><b>Setelah SEAL, konfigurasi tidak dapat diubah.</b> Lineup, tactics, tactical plan & player instructions terkunci untuk fixture ini.</div>
    </div>
    <div class="card"><h3>Starting XI & bench <span class="sub" id="rkf-count"></span></h3>
      <div class="dim">Ketuk pemain: XI → cadangan → keluarkan. Hanya pool beku — transfer setelah matchmaking tidak bisa main.</div>
      <div id="rkf-pool" style="margin-top:8px"></div>
    </div>
    <div class="card"><h3>Formasi & Taktik</h3>
      <label>Formasi</label><select id="rkf-formation">${FORMATIONS.map((f) => `<option ${formation === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
      ${['mentality', 'pressing', 'tempo', 'passing'].map((k) => `
        <label style="text-transform:capitalize">${k}</label>
        <select id="rkf-${k}">${TACTIC_OPTS[k].map((o) => `<option ${tactics[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`).join('')}
      ${TACTIC_FLAGS.map((k) => `
        <label class="check"><input type="checkbox" id="rkf-${k}" ${tactics[k] === true ? 'checked' : ''}> ${tacticLabel(k)}</label>`).join('')}
      <div class="dim">Tersegel dengan fixture-mu — tidak bisa diubah setelah dikunci.</div>
    </div>
    <div class="card"><h3>Rencana taktik <span class="sub">maks 5 aturan</span></h3>
      <div class="dim">Penyesuaian terbatas saat pertandingan, cth. "dari 60' jika kalah → mentality Attacking". Dievaluasi deterministik oleh server.</div>
      <div id="rkf-plan" style="margin-top:8px"></div>
      <button class="btn small secondary" id="rkf-addrule">+ Tambah aturan</button>
    </div>
    <div class="card"><h3>Instruksi Pemain <span class="sub">opsional</span></h3>
      <div class="dim">🔴 menyerang · 🔵 bertahan · ketuk lagi untuk menghapus. Tersegel bersama XI-mu — hanya memengaruhi kecenderungan pemain ini.</div>
      <div id="rkf-instr" style="margin-top:8px"></div>
    </div>
    <div class="card"><button class="btn" id="rkf-seal">🔒 Kunci Konfigurasi Taktik</button>
      <button class="btn secondary" id="rkf-back2">Kembali</button></div>`;

  const paintInstr = () => {
    const wrap = $('#rkf-instr');
    if (!wrap) return;
    // Drop instructions for players no longer in XI/bench.
    for (const id of Object.keys(instr)) {
      if (!sel.xi.has(id) && !sel.bench.has(id)) delete instr[id];
    }
    const xiIds = [...sel.xi];
    wrap.innerHTML = xiIds.map((id) => {
      const p = pool.find((x) => x.id === id);
      const cur = instr[id] ?? null;
      return `<div class="rowline"><span>${esc(p?.name ?? id)} <span class="dim">${esc(p?.position ?? '')}</span></span>
        <span>
          <button class="btn small ${cur === 'red' ? '' : 'secondary'}" data-rinstr="${esc(id)}" data-arrow="red">🔴</button>
          <button class="btn small ${cur === 'blue' ? '' : 'secondary'}" data-rinstr="${esc(id)}" data-arrow="blue">🔵</button>
        </span></div>`;
    }).join('') || '<div class="dim">Pilih XI-mu dulu.</div>';
    wrap.querySelectorAll('[data-rinstr]').forEach((b) => {
      b.onclick = () => {
        const pid = b.dataset.rinstr;
        const arrow = b.dataset.arrow;
        if (instr[pid] === arrow) delete instr[pid];
        else instr[pid] = arrow;
        paintInstr();
      };
    });
  };

  paint(); paintPlan(); paintInstr();
  $('#rkf-addrule').onclick = () => {
    if (rules.length >= 5) return toast('Maksimal 5 aturan.');
    rules.push({ if: { minuteGte: 60, scoreState: 'losing' }, then: { mentality: 'Attacking' } });
    paintPlan();
  };
  $('#rkf-back2').onclick = () => renderPvp(sc);
  $('#rkf-seal').onclick = async () => {
    const lineupIds = [...sel.xi], benchIds = [...sel.bench];
    if (lineupIds.length !== 11) return toast('Pilih tepat 11 pemain inti.');
    const plan = [];
    document.querySelectorAll('#rkf-plan [data-rule]').forEach((el) => {
      const i = +el.dataset.rule;
      const g = (k) => el.querySelector(`[data-k="${k}"]`)?.value;
      const action = g('action');
      const rule = { if: { minuteGte: +g('minuteGte'), scoreState: g('scoreState') }, then: {} };
      if (action === 'sub') rule.then.sub = { out: g('subOut'), in: g('subIn') };
      else rule.then[action] = g('value');
      plan.push(rule);
    });
    const tactics = { formation: $('#rkf-formation').value };
    for (const k of ['mentality', 'pressing', 'tempo', 'passing']) tactics[k] = $(`#rkf-${k}`).value;
    // Phase 60: flags travel with the sealed config; normalizeTactics validates
    // server-side and the seal is immutable afterwards (existing contract).
    for (const k of TACTIC_FLAGS) tactics[k] = $(`#rkf-${k}`).checked;
    if (!confirm('Kunci konfigurasi taktik?\n\nSetelah dikunci, susunan, taktik, rencana taktik & instruksi pemain tidak dapat diubah untuk fixture ini.')) return;
    try {
      const r = await POST('/api/pvp/ranked/seal', { fixtureId: fx.id, lineupIds, benchIds, formation: tactics.formation, tactics, plan, playerInstructions: { ...instr } });
      toast(r.simulated ? 'Both sealed — match simulated!' : r.alreadySealed ? 'Already sealed.' : 'Configuration sealed. Waiting for opponent…');
      renderRankedFixture(sc, fx.id);
    } catch (e) { toast(e.message); }
  };
}

function renderRankedResult(sc, fx) {
  const r = fx.result;
  const score = r ? `${r.score.home}–${r.score.away}` : `${fx.homeScore}–${fx.awayScore}`;
  const delta = fx.myRatingAfter !== null && fx.myRatingBefore !== null
    ? `<span class="${fx.myRatingAfter >= fx.myRatingBefore ? 'accent' : 'bad'}">rating ${fx.myRatingBefore} → ${fx.myRatingAfter}</span>` : '';
  const evIcon = (t) => t === 'goal' ? '⚽' : t === 'card' ? '🟨' : t === 'sub' ? '🔄' : t === 'injury' ? '🚑' : t === 'halftime' ? '⏸️' : t === 'fulltime' ? '🏁' : t === 'timewasting' ? '⏳' : t === 'counter' ? '⚡' : 'ℹ️';
  sc.innerHTML = backTo('more') + `
    <div class="card scorehead"><h3>⚔️ Hasil Ranked</h3>
      <div class="big">${esc(fx.isHome ? fx.clubName : fx.oppClubName)} ${score} ${esc(fx.isHome ? fx.oppClubName : fx.clubName)}</div>
      <div class="pmeta">vs ${esc(fx.opponent ?? '?')} · ${fx.completedVia === 'deadline' ? 'diputuskan saat tenggat (fallback dipakai)' : 'kedua manajer sudah mengunci'} · ${delta}</div>
    </div>
    <div class="card"><h3>Kejadian Pertandingan</h3>
      ${(r?.events ?? []).map((e) => `<div class="row"><span>${evIcon(e.type)} <b>${e.minute}'</b> ${esc(e.detail || e.type)}</span></div>`).join('') || '<div class="dim">Belum ada kejadian.</div>'}
    </div>
    <div class="card"><h3>Statistik</h3>
      ${r ? `<div class="pmeta">Penguasaan ${r.stats.home.possession}% – ${r.stats.away.possession}% · Tembakan ${r.stats.home.shots}–${r.stats.away.shots} · Tendangan sudut ${r.stats.home.corners}–${r.stats.away.corners} · Pelanggaran ${r.stats.home.fouls}–${r.stats.away.fouls}</div>` : '<div class="dim">—</div>'}
    </div>
    ${renderReportCards(fx.report, fx.isHome ? fx.clubName : fx.oppClubName, fx.isHome ? fx.oppClubName : fx.clubName)}
    <div class="card"><button class="btn secondary" id="rkr-back">Kembali ke PvP</button></div>`;
  $('#rkr-back').onclick = () => renderPvp(sc);
}

// ---------- leaderboard ----------
async function renderLeaderboard(sc) {
  let board = [];
  try { board = (await GET('/api/leaderboard')).leaderboard ?? []; }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  sc.innerHTML = backTo('more') + `<div class="card"><h3>🏅 Papan Peringkat Manajer</h3>
    ${board.length ? board.map((r, i) => `<div class="row"><span><b>#${i + 1} ${esc(r.username)}</b><div class="pmeta">${esc(r.clubName)} · Musim ${r.season}</div></span><b>${r.points} poin</b></div>`).join('') : '<div class="dim">Belum ada manajer di papan.</div>'}
  </div>`;
}


// ---------- online league (Phase 21) ----------
let OL_ID = null; // selected online league
async function mySaves() {
  try { return (await GET('/api/career')).saves ?? []; }
  catch { return []; }
}

async function renderOleague(sc) {
  if (OL_ID) return renderOleagueDetail(sc, OL_ID);
  let leagues = [];
  try { leagues = (await GET('/api/oleagues')).leagues ?? []; }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const saves = await mySaves();
  sc.innerHTML = backTo('more') + `<div class="comp-hero">
      <div class="ceyebrow">Multiplayer</div>
      <h2>🌐 Liga Online</h2>
      <div class="csub">${leagues.length} liga tersedia · buat dan undang manajer lain</div>
    </div>
    <div class="card"><h3>Daftar Liga</h3>
    ${leagues.length ? leagues.map((l) => `<div class="row"><span><b>${esc(l.name)}</b><div class="pmeta">Musim ${l.season} · ${l.status === 'active' ? 'aktif' : l.status === 'lobby' ? 'lobi' : 'selesai'} · ${l.memberCount}/${l.maxManagers} manajer${l.status === 'active' ? ` · MD ${l.currentMatchday}/${l.totalMatchdays}` : ''}</div></span><button class="btn small" onclick="openOleague('${l.id}')">Buka</button></div>`).join('') : emptyState('🌐', 'Belum ada liga online', 'Buat liga dan undang manajer lain untuk bertanding.')}
  </div>
  <div class="card"><h3>Buat Liga</h3>
    <label>Nama Liga</label>
    <input id="ol-name" placeholder="cth. Weekend Masters" maxlength="40">
    <label>Maks manajer (genap, 2–16)</label>
    <input id="ol-max" type="number" value="8" min="2" max="16">
    <label>Klubmu</label>
    <select id="ol-career">${saves.map((s) => `<option value="${s.id}">${esc(s.clubName)} (S${s.season})</option>`).join('')}</select>
    <button class="btn" id="ol-create">Buat & Gabung</button>
    <div class="dim">Musim dimulai saat komisioner menekan Mulai dengan jumlah manajer genap.</div>
  </div>`;
  $('#ol-create').onclick = async () => {
    const name = $('#ol-name').value.trim();
    const careerId = $('#ol-career').value;
    const maxManagers = Math.max(2, Math.min(16, parseInt($('#ol-max').value, 10) || 8));
    if (!name) return toast('Beri nama liga.');
    if (!careerId) return toast('Buat karier dulu.');
    try {
      const { id } = await POST('/api/oleagues', { name, maxManagers, careerId });
      OL_ID = id;
      renderOleague(sc);
    } catch (e) { toast(e.message); }
  };
}
window.openOleague = (id) => { OL_ID = id; nav('more', 'oleague'); };
window.backOleague = () => { OL_ID = null; nav('more', 'oleague'); };

async function renderOleagueDetail(sc, id) {
  let d;
  try { d = await GET(`/api/oleagues/${id}`); }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const L = d.league;
  const saves = d.isMember ? [] : await mySaves();
  const statusBadge = L.status === 'active' ? 'win' : L.status === 'complete' ? 'draw' : 'loss';
  let html = `<button class="btn small secondary" onclick="backOleague()">← Semua Liga</button>
  <div class="card"><h3>${esc(L.name)} <span class="badge ${statusBadge}">${L.status}</span></h3>
    <div class="pmeta">Season ${L.season}${L.status === 'active' ? ` · Matchday ${L.currentMatchday}/${L.totalMatchdays}` : ''} · ${L.memberCount}/${L.maxManagers} managers</div>
    <div class="pmeta">Managers: ${d.managers.map((m) => esc(m.username) + ' (' + esc(m.clubName) + ')').join(', ') || '—'}</div>
    ${L.status === 'complete' && L.champion ? `<div class="pmeta">🏆 Champion: <b>${esc((d.table.find((r) => r.userId === L.champion) || {}).username ?? '?')}</b></div>` : ''}
  </div>`;

  if (!d.isMember && L.status === 'registration') {
    html += `<div class="card"><h3>Gabung ke Liga Ini</h3>
      <label>Klubmu</label>
      <select id="ol-join-career">${saves.map((s) => `<option value="${s.id}">${esc(s.clubName)} (S${s.season})</option>`).join('')}</select>
      <button class="btn" id="ol-join">Gabung Liga</button></div>`;
  }
  if (d.isMember && L.status === 'registration') {
    html += `<div class="card"><div class="row"><span>Waiting for season start…</span><span>
      ${d.isCommissioner ? `<button class="btn small" id="ol-start">Mulai Musim</button> ` : ''}
      <button class="btn small secondary" id="ol-leave">Keluar</button></span></div>
      <div class="dim">Komisioner memulai saat jumlah manajer genap (≥ 2).</div></div>`;
  }
  if (d.myFixture) {
    const fx = d.myFixture;
    const played = fx.status === 'played';
    html += `<div class="card"><h3>Your fixture — MD ${fx.matchday}</h3>
      <div class="big">${esc(fx.homeName)} ${played ? fx.homeScore + ' – ' + fx.awayScore : 'vs'} ${esc(fx.awayName)}</div>
      ${!played ? `<button class="btn" id="ol-play">▶ Mainkan</button><div class="dim">Skuad live-mu bermain; lawan disimulasikan dari snapshot musim mereka.</div>` : `<div class="pmeta">Full time${fx.playedBy ? '' : ' (auto-simmed)'}</div>`}
    </div>`;
  }
  if (d.table.length) {
    html += `<div class="card"><h3>Klasemen</h3>${d.table.map((r, i) => `<div class="row"><span><b>${i + 1}. ${esc(r.clubName)}</b><div class="pmeta">${esc(r.username)} · ${r.w}W ${r.d}D ${r.l}L · GD ${r.gd}</div></span><b>${r.pts} pts</b></div>`).join('')}</div>`;
  }
  if (d.fixtures.length) {
    const mds = {};
    for (const f of d.fixtures) (mds[f.matchday] = mds[f.matchday] ?? []).push(f);
    html += `<div class="card"><h3>Jadwal</h3>${Object.keys(mds).sort((a, b) => a - b).map((md) =>
      `<div class="pmeta" style="margin-top:8px"><b>Matchday ${md}</b></div>` +
      mds[md].map((f) => `<div class="row"><span>${esc(f.homeName)} ${f.status === 'played' ? `<b>${f.homeScore}–${f.awayScore}</b>` : 'vs'} ${esc(f.awayName)}</span>${f.status === 'played' ? '<span class="dim">FT</span>' : '<span class="dim">…</span>'}</div>`).join('')
    ).join('')}</div>`;
  }
  if (d.isMember && L.status === 'active') {
    html += `<div class="card"><button class="btn secondary" id="ol-advance">Matchday Berikutnya</button>
      <div class="dim">Tersedia saat semua fixture MD dimainkan. Komisioner bisa memaksa lanjut (fixture yang belum dimainkan disim otomatis).</div></div>`;
  }
  if (d.isCommissioner && L.status === 'complete') {
    html += `<div class="card"><button class="btn" id="ol-newseason">Start season ${L.season + 1}</button></div>`;
  }
  sc.innerHTML = backTo('more') + html;

  const rerender = () => renderOleagueDetail(sc, id);
  if ($('#ol-join')) $('#ol-join').onclick = async () => {
    try { await POST(`/api/oleagues/${id}/join`, { careerId: $('#ol-join-career').value }); rerender(); }
    catch (e) { toast(e.message); }
  };
  if ($('#ol-leave')) $('#ol-leave').onclick = async () => {
    try { await POST(`/api/oleagues/${id}/leave`, {}); backOleague(); }
    catch (e) { toast(e.message); }
  };
  if ($('#ol-start')) $('#ol-start').onclick = async () => {
    try { await POST(`/api/oleagues/${id}/start`, {}); toast('Musim dimulai!'); rerender(); }
    catch (e) { toast(e.message); }
  };
  if ($('#ol-play')) $('#ol-play').onclick = async () => {
    try {
      const r = await POST(`/api/oleagues/${id}/play`, {});
      toast(r.alreadyPlayed ? 'Already played — showing recorded result.' : `Full time: ${r.score.home}–${r.score.away}`);
      await refresh().catch(() => {});
      rerender();
    } catch (e) { toast(e.message); }
  };
  if ($('#ol-advance')) $('#ol-advance').onclick = async () => {
    try { await POST(`/api/oleagues/${id}/advance`, {}); rerender(); }
    catch (e) {
      if (d.isCommissioner && confirm(e.message + '\n\nForce advance and auto-sim unplayed fixtures?')) {
        try { await POST(`/api/oleagues/${id}/advance`, { force: true }); rerender(); }
        catch (e2) { toast(e2.message); }
      } else toast(e.message);
    }
  };
  if ($('#ol-newseason')) $('#ol-newseason').onclick = async () => {
    try { await POST(`/api/oleagues/${id}/new-season`, {}); toast('Pendaftaran musim baru dibuka.'); rerender(); }
    catch (e) { toast(e.message); }
  };
}


// ---------- rewards (Phase 23) ----------
async function renderRewards(sc) {
  let d = null, ach = [];
  try {
    const [dailyRes, achRes] = await Promise.all([
      GET('/api/rewards/daily').catch(() => null),
      CG('/achievements').catch(() => ({ achievements: [] })),
    ]);
    d = dailyRes;
    ach = achRes.achievements ?? [];
  } catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }

  let html = '';
  if (d) {
    html += `<div class="card"><h3>🎁 Daily rewards <span class="sub">streak: ${d.streak} day(s)</span></h3>
      <div class="grid2">${d.calendar.map((c) => `<div class="card" style="text-align:center;${c.state === 'today' ? 'border:1px solid #c9a227' : ''}">
        <div class="dim">Day ${c.day}</div><div><b>+${fmtCash(c.cash)}</b></div>
        <div class="pmeta">${c.state === 'claimed' ? '✅ claimed' : c.state === 'today' ? '👉 today' : c.label}</div>
      </div>`).join('')}</div>
      ${d.canClaim ? `<button class="btn" id="rw-claim">Claim day ${d.nextStreak} reward</button>` : `<div class="dim">Kembali besok untuk hadiah berikutnya.</div>`}
    </div>`;
  }
  const unlocked = ach.filter((a) => a.unlocked);
  const cats = ['All', ...new Set(ach.map((a) => a.category ?? 'Match'))];
  let achCat = window._achCat ?? 'All';
  const renderAchList = (list) => list.filter((a) => achCat === 'All' || (a.category ?? 'Match') === achCat)
    .map((a) => `<div class="row"><span><b>${a.unlocked ? '✅' : '🔒'} ${esc(a.name)}</b><div class="pmeta">${esc(a.desc)} · ${a.current}/${a.target}</div>
      <div class="bar"><div class="barfill" style="width:${Math.round((a.current / a.target) * 100)}%"></div></div></span>
      <b class="accent">+${fmtCash(a.cash)}</b></div>`).join('') || '<div class="dim">Belum ada pencapaian.</div>';
  html += `<div class="card"><h3>🏆 Achievements <span class="sub">${unlocked.length}/${ach.length}</span></h3>
    <div style="margin-bottom:8px">${cats.map((c) => `<button class="btn small ${c === achCat ? '' : 'secondary'}" onclick="filterAch('${c}')">${c}</button>`).join(' ')}</div>
    <div id="ach-list">${renderAchList(ach)}</div>
  </div>`;
  sc.innerHTML = backTo('more') + html;
  window.filterAch = (c) => { window._achCat = c; nav('more', 'rewards'); };
  if ($('#rw-claim')) $('#rw-claim').onclick = async () => {
    try {
      const r = await POST('/api/rewards/daily/claim', {});
      toast(r.alreadyClaimed ? 'Already claimed today.' : `🎁 +${fmtCash(r.reward.cash + r.bonus)} claimed!`);
      await refresh();
      renderRewards(sc);
    } catch (e) { toast(e.message); }
  };
}

// ---------- live ops: objectives (Phase 32) ----------
function countdownTo(ts) {
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
async function renderObjectives(sc) {
  let d;
  try { d = await GET('/api/objectives'); }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const section = (data, label) => `
    <div class="card"><h3>${label} <span class="sub">reset dalam ${countdownTo(data.endsAt)}</span></h3>
    ${data.items.map((o) => `<div class="row"><span><b>${o.completed && !o.claimed ? '✅' : o.claimed ? '✔️' : '🎯'} ${esc(o.title)}</b>
      <div class="pmeta">${esc(o.desc)} · ${o.progress}/${o.target}</div>
      <div class="bar"><div class="barfill" style="width:${Math.round((o.progress / o.target) * 100)}%"></div></div></span>
      <span style="text-align:right"><b class="accent">+${fmtCash(o.cash)}</b><br>
      ${o.claimed ? '<span class="dim">diklaim</span>'
        : o.completed ? `<button class="btn small" onclick="claimObjective('${o.id}')">Klaim</button>`
        : '<span class="dim">berlangsung</span>'}</span></div>`).join('')}
    </div>`;
  sc.innerHTML = backTo('more') + section(d.daily, '🎯 Misi harian') + section(d.weekly, '🗓️ Misi mingguan');
}
window.claimObjective = async (id) => {
  try {
    const r = await POST(`/api/objectives/${id}/claim`, {});
    toast(`Misi selesai! +${fmtCash(r.cash)}`);
    await refresh();
    nav('more', 'objectives');
  } catch (e) { toast(e.message); }
};

// ---------- live ops: manager progression + reward track (Phase 32) ----------
async function renderManager(sc) {
  let mgr, track;
  try {
    [mgr, track] = await Promise.all([GET('/api/manager'), GET('/api/reward-track')]);
  } catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const next = mgr.next;
  const pct = next ? Math.min(100, Math.round((mgr.xp / next.xpRequired) * 100)) : 100;
  sc.innerHTML = backTo('more') + `
  <div class="card"><h3>⭐ Manajer <span class="sub">Level ${mgr.level}</span></h3>
    <div class="row"><span><b>${mgr.xp} XP</b><div class="pmeta">${next ? `${next.xpRequired - mgr.xp} XP to level ${next.level}` : 'Max level reached'}</div>
      <div class="bar"><div class="barfill" style="width:${pct}%"></div></div></span></div>
    ${mgr.history.length ? `<h3>XP Terakhir</h3>${mgr.history.map((h) => `<div class="row"><span>${esc(h.source.replace(/_/g, ' '))}</span><b class="accent">+${h.amount}</b></div>`).join('')}` : '<div class="dim">Mainkan pertandingan dan latih tim untuk mendapatkan XP manajer.</div>'}
  </div>
  <div class="card"><h3>🎖️ Reward track <span class="sub">free · based on manager XP</span></h3>
    ${track.levels.map((t) => `<div class="row"><span><b>${t.reached ? '✅' : '🔒'} Level ${t.level}</b>
      <div class="pmeta">${t.xpRequired} XP required</div></span>
      <span style="text-align:right"><b class="accent">+${fmtCash(t.cash)}</b><br>
      ${t.claimed ? '<span class="dim">claimed</span>'
        : t.reached ? `<button class="btn small" onclick="claimTrack(${t.level})">Klaim</button>`
        : '<span class="dim">locked</span>'}</span></div>`).join('')}
  </div>
  <div class="card"><h3>⚖️ Bandingkan Manajer</h3>
    <div class="bar-row"><input id="cmp-name" placeholder="Username manajer"><button class="btn small" onclick="compareManager()">Bandingkan</button></div>
    <div id="cmp-result"></div>
  </div>`;
}
window.compareManager = async () => {
  const name = $('#cmp-name').value.trim();
  if (!name) return toast('Masukkan username manajer.');
  const slot = $('#cmp-result');
  slot.innerHTML = '<div class="dim">Memuat…</div>';
  try {
    const d = await GET(`/api/manager/compare/${encodeURIComponent(name)}`);
    slot.innerHTML = d.rows.map(([label, a, b]) =>
      `<div class="row"><span class="dim">${esc(label)}</span><span><b>${esc(String(a))}</b> <span class="dim">vs</span> <b>${esc(String(b))}</b></span></div>`
    ).join('');
  } catch (e) { slot.innerHTML = `<div class="card bad">${esc(e.message)}</div>`; }
};
window.claimTrack = async (level) => {
  try {
    const r = await POST(`/api/reward-track/${level}/claim`, {});
    toast(`Hadiah level ${level} diklaim! +${fmtCash(r.cash)}`);
    await refresh();
    nav('more', 'manager');
  } catch (e) { toast(e.message); }
};

// ---------- live ops: inbox (Phase 32) ----------
const INBOX_ICONS = { objective: '🎯', manager_level: '⭐', reward_track: '🎖️', achievement: '🏆', season: '📊', info: '📣' };
async function renderInbox(sc) {
  let d;
  try { d = await GET('/api/inbox'); }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  sc.innerHTML = backTo('more') + `
  <div class="card"><h3>📥 Kotak Masuk <span class="sub">${d.unreadCount} belum dibaca</span></h3>
    ${d.unreadCount ? '<button class="btn small secondary" onclick="readAllInbox()">Tandai semua dibaca</button>' : ''}
    ${d.messages.map((m) => `<div class="row" style="${m.read ? '' : 'font-weight:bold'}">
      <span>${INBOX_ICONS[m.type] ?? '📣'} <b>${esc(m.title)}</b>
      <div class="pmeta">${esc(m.body)}</div>
      <div class="pmeta dim">${new Date(m.at).toLocaleString()}</div></span>
      ${m.read ? '<span class="dim">read</span>' : `<button class="btn small secondary" onclick="readInbox('${m.id}')">Tandai dibaca</button>`}
    </div>`).join('') || emptyState('📥', 'Kotak masuk kosong', 'Notifikasi penting dari klub akan muncul di sini.')}
  </div>`;
  await refresh(); // update topbar badge after viewing
}
window.readInbox = async (id) => {
  try { await POST(`/api/inbox/${id}/read`, {}); nav('more', 'inbox'); } catch (e) { toast(e.message); }
};
window.readAllInbox = async () => {
  try { await POST('/api/inbox/read-all', {}); nav('more', 'inbox'); } catch (e) { toast(e.message); }
};

// ---------- analytics (Phase 26) ----------
async function renderAnalytics(sc) {
  let sum, recent;
  try {
    sum = await GET('/api/analytics/summary?days=14');
    recent = await GET('/api/analytics/recent');
  } catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const t = sum.totals;
  const days = Object.entries(sum.days);
  const maxM = Math.max(1, ...days.map(([, d]) => d.matches));
  const typeLabel = (k) => k.replace(/_/g, ' ');
  sc.innerHTML = backTo('more') + `
  <div class="card"><h3>📈 Analitik <span class="sub">14 hari terakhir · server-local</span></h3>
    <div class="grid2">
      <div class="card"><div class="dim">Pengguna aktif</div><div class="big">${t.user_login ?? 0}</div><div class="pmeta">login events</div></div>
      <div class="card"><div class="dim">Match dimainkan</div><div class="big">${t.match_played ?? 0}</div><div class="pmeta">matchdays</div></div>
      <div class="card"><div class="dim">Latihan</div><div class="big">${t.training_done ?? 0}</div><div class="pmeta">sesi</div></div>
      <div class="card"><div class="dim">Pembelian</div><div class="big">${t.shop_purchase ?? 0}</div><div class="pmeta">pesanan</div></div>
    </div>
  </div>
  ${days.length ? `<div class="card"><h3>Aktivitas harian</h3>
    ${days.slice(-14).map(([day, d]) => `<div class="row"><span style="min-width:110px">${day}<div class="pmeta">DAU ${d.dau}</div></span>
      <div style="flex:1;background:#eee;border-radius:4px;height:14px"><div style="width:${Math.round(d.matches / maxM * 100)}%;background:#4a9;height:14px;border-radius:4px"></div></div>
      <b>${d.matches}</b></div>`).join('')}</div>` : ''}
  ${sum.topRoutes.length ? `<div class="card"><h3>Endpoint paling lambat</h3>
    ${sum.topRoutes.slice(0, 5).map((r) => `<div class="row"><span><b>${esc(r.route.slice(0, 48))}</b><div class="pmeta">${r.count} req · ${r.errors} err</div></span><b>${r.avgMs} ms</b></div>`).join('')}</div>` : ''}
  <div class="card"><h3>Event terbaru</h3>
    ${recent.events.slice(0, 15).map((e) => `<div class="row"><span><b>${esc(typeLabel(e.type))}</b><div class="pmeta">${new Date(e.ts).toLocaleString('id-ID')}</div></span></div>`).join('') || '<div class="dim">Belum ada event.</div>'}
  </div>`;
}

// ---------- shop / monetization (Phase 25) ----------
const fmtRp = (n) => 'Rp' + n.toLocaleString('id-ID');

async function renderShop(sc) {
  let data;
  try { data = await GET('/api/shop'); }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const { products, entitlements: ent, orders, paymentsLive } = data;
  const vipLine = ent.vip
    ? `👑 VIP aktif sampai ${new Date(ent.vipUntil).toLocaleDateString('id-ID')} · training XP ×${ent.trainingXpMult}`
    : 'Belum VIP. Upgrade untuk bonus training XP & daily reward.';
  const boostLines = Object.entries(ent.boosts).map(([id, until]) =>
    `<div class="pmeta">⚡ ${esc(id)} aktif sampai ${new Date(until).toLocaleDateString('id-ID')}</div>`).join('');
  sc.innerHTML = backTo('more') + `
  <div class="card"><h3>👑 Status</h3><div class="pmeta">${vipLine}</div>${boostLines}
    ${paymentsLive ? '' : '<div class="pmeta dim">Mode demo: pembayaran memakai mock provider (tidak ada uang asli).</div>'}
  </div>
  <div class="card"><h3>🛒 Toko</h3>
    ${products.map((p) => `<div class="row"><span><b>${esc(p.name)}</b><div class="pmeta">${esc(p.description)}</div></span>
      <span style="text-align:right"><div><b>${fmtRp(p.priceIdr)}</b></div>
      <button class="btn small" data-buy="${p.id}">Beli</button></span></div>`).join('')}
  </div>
  ${orders.length ? `<div class="card"><h3>Riwayat</h3>
    ${orders.map((o) => `<div class="row"><span><b>${esc(o.productName)}</b><div class="pmeta">${new Date(o.createdAt).toLocaleString('id-ID')}</div></span><span class="badge ${o.status === 'completed' ? 'win' : 'draw'}">${o.status}</span></div>`).join('')}</div>` : ''}`;
  sc.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await POST('/api/shop/purchase', { productId: btn.dataset.buy });
        toast(`✅ ${esc(r.granted.productId)} aktif!`);
        await refresh().catch(() => {});
        renderShop(sc);
      } catch (e) { toast(e.message); btn.disabled = false; }
    };
  });
}

// ---------- events (Phase 24) ----------
let EV_ID = null;
const badgeFor = (s) => s === 'active' ? 'win' : s === 'ended' ? 'draw' : 'loss';

async function renderEvents(sc) {
  if (EV_ID) return renderEventDetail(sc, EV_ID);
  let data;
  try { data = await GET('/api/events'); }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const { events: evs, templates } = data;
  const fmtT = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  sc.innerHTML = backTo('more') + `<div class="card"><h3>🎪 Acara</h3>
    ${evs.length ? evs.map((ev) => `<div class="row"><span><b>${esc(ev.name)}</b> <span class="badge ${badgeFor(ev.status)}">${ev.status}</span>
      <div class="pmeta">${esc(ev.description)}</div>
      <div class="pmeta">${fmtT(ev.startsAt)} → ${fmtT(ev.endsAt)} · ${ev.participantCount}/${ev.maxParticipants} joined${ev.joined ? ` · you: ${ev.myScore} pts (#${ev.myRank ?? '–'})` : ''}</div></span>
      <button class="btn small" onclick="openEvent('${ev.id}')">Buka</button></div>`).join('')
      : '<div class="dim">Belum ada event. Mulai satu di bawah!</div>'}
  </div>
  <div class="card"><h3>Mulai Event</h3>
    <label>Templat</label>
    <select id="ev-template">${templates.map((t) => `<option value="${t.id}">${esc(t.name)} — ${t.durationDays}d, ${esc(t.scoring.label)}</option>`).join('')}</select>
    <div class="dim">${templates.map((t) => `<b>${esc(t.name)}:</b> ${esc(t.description)}`).join('<br>')}</div>
    <button class="btn" id="ev-create">Luncurkan Event</button>
  </div>`;
  $('#ev-create').onclick = async () => {
    try {
      const { id } = await POST('/api/events', { templateId: $('#ev-template').value });
      EV_ID = id;
      renderEvents(sc);
      toast('Event diluncurkan!');
    } catch (e) { toast(e.message); }
  };
}
window.openEvent = (id) => { EV_ID = id; nav('more', 'events'); };
window.backEvents = () => { EV_ID = null; nav('more', 'events'); };

async function renderEventDetail(sc, id) {
  let ev;
  try { ev = await GET(`/api/events/${id}`); }
  catch (e) { sc.innerHTML = backTo('more') + `<div class="card bad">${esc(e.message)}</div>`; return; }
  const endsIn = ev.status === 'active'
    ? Math.max(0, Math.ceil((ev.endsAt - Date.now()) / 86400000)) + ' day(s) left' : '';
  let html = `<button class="btn small secondary" onclick="backEvents()">← Semua Event</button>
  <div class="card"><h3>${esc(ev.name)} <span class="badge ${badgeFor(ev.status)}">${ev.status}</span></h3>
    <div class="pmeta">${esc(ev.description)}</div>
    <div class="pmeta">Scoring: ${esc(ev.scoring.label)} · ${ev.participantCount}/${ev.maxParticipants} participants · ${endsIn}</div>
    <div class="pmeta">Rewards: 🥇 ${fmtCash(ev.rewards['1'] ?? 0)} · 🥈 ${fmtCash(ev.rewards['2'] ?? 0)} · 🥉 ${fmtCash(ev.rewards['3'] ?? 0)} · participation ${fmtCash(ev.rewards.participation ?? 0)}</div>
    ${ev.joined ? `<div class="pmeta">Your score: <b>${ev.myScore} pts</b> (#${ev.myRank ?? '–'})</div>` : ''}
  </div>`;
  if (!ev.joined && (ev.status === 'active' || ev.status === 'upcoming')) {
    html += `<div class="card"><button class="btn" id="ev-join">Ikut Event</button>
      <div class="dim">Hanya pertandingan setelah bergabung yang dihitung ke skormu.</div></div>`;
  }
  if (ev.leaderboard.length) {
    html += `<div class="card"><h3>Leaderboard <span class="sub">${esc(ev.scoring.label)}</span></h3>
      ${ev.leaderboard.map((r, i) => `<div class="row"><span><b>#${i + 1} ${esc(r.username)}</b><div class="pmeta">${r.played} matches</div></span><b>${r.score} pts</b></div>`).join('')}</div>`;
  }
  if (ev.status === 'ended' && !ev.rewardsPaid) {
    html += `<div class="card"><button class="btn" id="ev-settle">Selesaikan & bayar hadiah</button>
      <div class="dim">Siapa pun bisa menyelesaikan setelah event berakhir. Membayar 3 besar + partisipasi.</div></div>`;
  }
  if (ev.rewardsPaid) html += `<div class="card"><div class="dim">✅ Hadiah dibayar.</div></div>`;
  sc.innerHTML = backTo('more') + html;
  const rerender = () => renderEventDetail(sc, id);
  if ($('#ev-join')) $('#ev-join').onclick = async () => {
    try { await POST(`/api/events/${id}/join`, {}); toast('Bergabung! Semoga beruntung.'); rerender(); }
    catch (e) { toast(e.message); }
  };
  if ($('#ev-settle')) $('#ev-settle').onclick = async () => {
    try {
      const r = await POST(`/api/events/${id}/settle`, {});
      toast(`Selesai! ${r.payouts.length} pembayaran.`);
      await refresh().catch(() => {});
      rerender();
    } catch (e) { toast(e.message); }
  };
}

function renderSettings(sc) {
  sc.innerHTML = backTo('more') + `<div class="card"><h3>Pengaturan</h3>
    <div class="row"><span class="dim">ID Karier</span><span class="pmeta">${esc(CID)}</span></div>
    <div class="row"><span class="dim">Version</span><span class="pmeta">v1.0.0</span></div>
    <button class="btn secondary" id="savebtn">💾 Simpan sekarang</button>
    <button class="btn secondary" id="logoutbtn2">Keluar</button>
    <button class="btn danger" id="newcareer">Buang & mulai karier baru</button>
  </div>`;
  $('#logoutbtn2').onclick = () => { if (confirm('Log out?')) logout(); };
  $('#savebtn').onclick = async () => {
    try { await C('/save', {}); toast('Karier tersimpan.'); }
    catch (e) { toast(e.message); }
  };
  $('#newcareer').onclick = async () => {
    if (!confirm('Abandon this career and start over?')) return;
    try { await api('DELETE', `/api/career/${CID}`); } catch { /* already gone */ }
    localStorage.removeItem(CID_KEY);
    location.reload();
  };
}

// ---------- boot ----------
(async function boot() {
  if (!TOKEN) return renderAuth();
  try {
    await GET('/api/career');
  } catch (e) {
    if (TOKEN) toast(e.message);
    return renderAuth();
  }
  if (!CID) return renderStart();
  try {
    await refresh();
    $('#topbar').classList.remove('hidden');
    $('#bottomnav').classList.remove('hidden');
    nav('home');
  } catch (e) {
    localStorage.removeItem(CID_KEY);
    CID = null;
    renderStart();
  }
})();
