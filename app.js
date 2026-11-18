// =====================================================================
//  Cours de maths — application (JS vanilla, aucune étape de build)
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as CFG from './config.js';

const $app = document.getElementById('app');
// Tolère une URL copiée avec un suffixe (/rest/v1/, /auth/v1/…) ou un « / » final.
const SUPABASE_BASE = CFG.SUPABASE_URL.trim().replace(/\/(rest|auth|functions)\/v1\/?.*$/, '').replace(/\/+$/, '');
const sb = createClient(SUPABASE_BASE, CFG.SUPABASE_KEY.trim());
const SLOT_MS = 30 * 60 * 1000;

const S = {
  user: null, profile: null, isAdmin: false,
  tab: 'calendar',
  weekStart: mondayOf(new Date()),
  selection: null,                 // élève : { d, r0, r1 }
  open: new Set(), weekLessons: [], // admin : semaine affichée
  slotState: new Map(),            // élève : semaine affichée
  dashFilter: '',
};

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (s) => new Date(s).getTime();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fDay = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fDayShort = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();

function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fDur(ms) {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
const fRange = (a, b) => `${cap(fDay(a))} · ${fTime(a)} – ${fTime(b)} (${fDur(T(b) - T(a))})`;
const errMsg = (e) => e?.message || String(e);

function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = ''; }, 3500);
}

const $view = () => document.getElementById('view');

// ---------------------------------------------------------------------
// Démarrage, connexion, activation d'un lien d'invitation
// ---------------------------------------------------------------------
async function boot() {
  if (CFG.SUPABASE_URL.includes('VOTRE-PROJET')) {
    $app.innerHTML = `<div class="card narrow"><h2>Configuration manquante</h2>
      <p>Renseignez <code>SUPABASE_URL</code> et <code>SUPABASE_KEY</code> dans le fichier <code>config.js</code>.</p></div>`;
    return;
  }
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('join')) return renderJoin(params.get('join'));
  if (params.get('invite')) return renderActivation(params.get('invite'), params.get('type') || 'magiclink');

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  await enterApp(session.user);
}

function renderLogin() {
  $app.innerHTML = `
    <div class="card narrow">
      <h1>${esc(CFG.SITE_TITLE)}</h1>
      <form id="login">
        <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
        <label>Mot de passe<input type="password" name="password" required autocomplete="current-password"></label>
        <button class="primary" type="submit">Se connecter</button>
        <p class="error" id="err"></p>
      </form>
      <p class="muted small">Accès sur invitation uniquement. Mot de passe oublié ? Demandez un nouveau lien de connexion à votre professeur.</p>
    </div>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data, error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) {
      const m = error.message || '';
      document.getElementById('err').textContent =
        /invalid login credentials/i.test(m) ? 'E-mail ou mot de passe incorrect.'
        : /email not confirmed/i.test(m) ? 'Compte non confirmé (cocher « Auto Confirm User » ou confirmer l\'e-mail dans Supabase).'
        : /invalid api key|failed to fetch|network/i.test(m) ? `Connexion à Supabase impossible : vérifiez SUPABASE_URL et SUPABASE_KEY dans config.js. (${m})`
        : `Erreur : ${m}`;
      return;
    }
    await enterApp(data.user);
  };
}

// Appel de la fonction serveur « invite », avec message d'erreur lisible.
async function callInvite(body) {
  const { data, error } = await sb.functions.invoke('invite', { body });
  if (error) {
    let m = error.message;
    try { const j = await error.context.json(); m = j.error || m; } catch { /* réponse non JSON */ }
    throw new Error(m);
  }
  return data;
}

// Lien d'invitation anonyme : l'élève crée son compte (e-mail + mot de passe).
async function renderJoin(token) {
  const { data: { session } } = await sb.auth.getSession();
  const warn = session
    ? `<p class="warn">Vous êtes actuellement connecté en tant que ${esc(session.user.email)}. Créer un compte vous déconnectera.</p>`
    : '';
  $app.innerHTML = `
    <div class="card narrow">
      <h1>Créer votre compte</h1>
      <p>Vous avez été invité à l'espace de réservation des cours de mathématiques.</p>
      ${warn}
      <form id="join">
        <label>Adresse e-mail (élève ou parent)<input type="email" name="email" required autocomplete="email"></label>
        <label>Mot de passe (8 caractères minimum)<input type="password" name="p1" minlength="8" required autocomplete="new-password"></label>
        <label>Confirmation du mot de passe<input type="password" name="p2" minlength="8" required autocomplete="new-password"></label>
        <button class="primary" type="submit">Créer mon compte</button>
        <p class="error" id="err"></p>
      </form>
      <p class="muted small">Vous avez déjà un compte ? <a href="${esc(location.pathname)}">Se connecter</a></p>
    </div>`;
  document.getElementById('join').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = document.getElementById('err');
    const btn = e.target.querySelector('button');
    const email = String(f.get('email')).trim().toLowerCase();
    if (f.get('p1') !== f.get('p2')) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    btn.disabled = true; err.textContent = '';
    try {
      await callInvite({ action: 'redeem', token, email, password: f.get('p1') });
    } catch (ex) { err.textContent = errMsg(ex); btn.disabled = false; return; }
    if (session) await sb.auth.signOut();
    const { data, error } = await sb.auth.signInWithPassword({ email, password: f.get('p1') });
    if (error) { err.textContent = `Compte créé, mais connexion impossible : ${errMsg(error)}`; btn.disabled = false; return; }
    history.replaceState(null, '', location.pathname);
    await enterApp(data.user);
  };
}

// Lien de connexion (mot de passe oublié) généré par l'admin.
async function renderActivation(token, type) {
  const { data: { session } } = await sb.auth.getSession();
  const warn = session
    ? `<p class="warn">Vous êtes actuellement connecté en tant que ${esc(session.user.email)}. Activer ce lien remplacera cette session.</p>`
    : '';
  $app.innerHTML = `
    <div class="card narrow">
      <h1>Connexion par lien</h1>
      <p>Ce lien vous connecte à votre compte ; vous pourrez ensuite choisir un nouveau mot de passe.</p>
      ${warn}
      <button class="primary" id="activate">Activer mon accès</button>
      <p class="error" id="err"></p>
    </div>`;
  const btn = document.getElementById('activate');
  btn.onclick = async () => {
    btn.disabled = true;
    const { data, error } = await sb.auth.verifyOtp({ token_hash: token, type });
    if (error) {
      document.getElementById('err').textContent =
        'Ce lien de connexion est invalide, expiré ou a déjà été utilisé. Demandez un nouveau lien à votre professeur.';
      btn.disabled = false;
      return;
    }
    history.replaceState(null, '', location.pathname);
    renderSetPassword(data.user);
  };
}

function renderSetPassword(user) {
  $app.innerHTML = `
    <div class="card narrow">
      <h1>Choisissez votre mot de passe</h1>
      <p class="muted">Compte : ${esc(user.email)}</p>
      <form id="pw">
        <label>Mot de passe (8 caractères minimum)<input type="password" name="p1" minlength="8" required autocomplete="new-password"></label>
        <label>Confirmation<input type="password" name="p2" minlength="8" required autocomplete="new-password"></label>
        <button class="primary" type="submit">Enregistrer et continuer</button>
        <p class="error" id="err"></p>
      </form>
    </div>`;
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = document.getElementById('err');
    if (f.get('p1') !== f.get('p2')) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    const { error } = await sb.auth.updateUser({ password: f.get('p1') });
    if (error) { err.textContent = errMsg(error); return; }
    await enterApp(user);
  };
}

async function enterApp(user) {
  S.user = user;
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error || !data) {
    $app.innerHTML = `<div class="card narrow"><h2>Profil introuvable</h2>
      <p>Votre compte existe mais n'a pas de profil. Vérifiez que le script SQL a bien été exécuté.</p>
      <button id="logout">Se déconnecter</button></div>`;
    document.getElementById('logout').onclick = logout;
    return;
  }
  S.profile = data;
  S.isAdmin = data.role === 'admin';
  if (!S.isAdmin && !data.student_name) S.tab = 'profile';
  renderShell();
}

async function logout() {
  await sb.auth.signOut();
  S.user = null; S.profile = null; S.tab = 'calendar'; S.selection = null;
  renderLogin();
}

// ---------------------------------------------------------------------
// Coquille : en-tête + onglets
// ---------------------------------------------------------------------
function renderShell() {
  const tabs = S.isAdmin
    ? [['calendar', 'Calendrier'], ['dashboard', 'Tableau de bord'], ['students', 'Élèves']]
    : [['calendar', 'Réserver'], ['dashboard', 'Mes cours'], ['profile', 'Mon profil']];
  $app.innerHTML = `
    <header class="topbar">
      <div class="brand">${esc(CFG.SITE_TITLE)}</div>
      <nav>${tabs.map(([k, l]) => `<button class="tab ${S.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
      <div class="who">
        <span>${esc(S.profile.student_name || S.user.email)}</span>
        ${S.isAdmin ? '<span class="badge">admin</span>' : ''}
        <button class="link" id="logout">Déconnexion</button>
      </div>
    </header>
    <main id="view"></main>`;
  $app.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { S.tab = b.dataset.tab; S.selection = null; renderShell(); };
  });
  document.getElementById('logout').onclick = logout;
  ({ calendar: renderCalendar, dashboard: renderDashboard, profile: renderProfile, students: renderStudents })[S.tab]();
}

// ---------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------
function weekDays() {
  const rows = (CFG.DAY_END_HOUR - CFG.DAY_START_HOUR) * 2;
  const days = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(S.weekStart, d);
    const slots = [];
    for (let r = 0; r < rows; r++) {
      const t = new Date(date);
      t.setHours(CFG.DAY_START_HOUR + Math.floor(r / 2), (r % 2) * 30, 0, 0);
      slots.push(t.getTime());
    }
    days.push({ date, slots });
  }
  return days;
}

function renderCalendar() {
  const end = addDays(S.weekStart, 6);
  const adminTools = S.isAdmin ? `
    <div class="tools">
      <button id="copyPrev">Copier les dispos de la semaine précédente</button>
      <button id="clearWeek">Fermer les créneaux libres de la semaine</button>
    </div>` : '';
  const help = S.isAdmin
    ? 'Cliquez sur une case (ou cliquez-glissez sur ordinateur) pour ouvrir ou fermer des créneaux de 30 min. Les créneaux réservés ne sont pas modifiables ici.'
    : 'Cliquez sur un créneau libre, puis sur un autre créneau libre du même jour pour étendre la sélection. Recliquez dans la sélection pour l\'annuler.';
  const legend = S.isAdmin
    ? '<span class="lg open">Ouvert</span><span class="lg pending">Demande en attente</span><span class="lg confirmed">Cours confirmé</span><span class="lg closed">Fermé</span>'
    : '<span class="lg open">Libre</span><span class="lg taken">Pris</span><span class="lg pending">Ma demande</span><span class="lg confirmed">Mon cours</span><span class="lg selected">Sélection</span>';
  $view().innerHTML = `
    <div class="weeknav">
      <button id="prevW" aria-label="Semaine précédente">←</button>
      <div class="weeklabel">Semaine du ${S.weekStart.getDate()} au ${fDate(end)}</div>
      <button id="nextW" aria-label="Semaine suivante">→</button>
      <button id="todayW">Aujourd'hui</button>
    </div>
    ${adminTools}
    <p class="muted small">${help}</p>
    <div class="legend">${legend}</div>
    <div class="gridwrap"><div id="grid"><p class="muted pad">Chargement…</p></div></div>
    <div id="selbar"></div>`;
  document.getElementById('prevW').onclick = () => { S.weekStart = addDays(S.weekStart, -7); S.selection = null; renderCalendar(); };
  document.getElementById('nextW').onclick = () => { S.weekStart = addDays(S.weekStart, 7); S.selection = null; renderCalendar(); };
  document.getElementById('todayW').onclick = () => { S.weekStart = mondayOf(new Date()); S.selection = null; renderCalendar(); };
  if (S.isAdmin) {
    document.getElementById('copyPrev').onclick = copyPreviousWeek;
    document.getElementById('clearWeek').onclick = clearWeek;
  }
  // Écouteurs attachés une seule fois : la grille est redessinée sans être recréée.
  const grid = document.getElementById('grid');
  if (S.isAdmin) bindAdminGrid(grid); else bindStudentGrid(grid);
  loadWeek();
}

async function loadWeek() {
  const from = S.weekStart.toISOString(), to = addDays(S.weekStart, 7).toISOString();
  if (S.isAdmin) {
    const [av, ls] = await Promise.all([
      sb.from('availability').select('slot_start').gte('slot_start', from).lt('slot_start', to),
      sb.from('lessons').select('id,start_at,end_at,status,profiles(student_name,email)')
        .in('status', ['pending', 'confirmed']).lt('start_at', to).gt('end_at', from),
    ]);
    if (av.error || ls.error) return gridError(av.error || ls.error);
    S.open = new Set(av.data.map((r) => T(r.slot_start)));
    S.weekLessons = ls.data;
  } else {
    const { data, error } = await sb.rpc('get_slots', { p_from: from, p_to: to });
    if (error) return gridError(error);
    S.slotState = new Map(data.map((r) => [T(r.slot_start), r.state]));
  }
  drawGrid();
}

function gridError(e) {
  const g = document.getElementById('grid');
  if (g) g.innerHTML = `<p class="error pad">Erreur de chargement : ${esc(errMsg(e))}</p>`;
}

function adminCell(t) {
  const l = S.weekLessons.find((x) => t >= T(x.start_at) && t < T(x.end_at));
  if (l) {
    const name = l.profiles?.student_name || l.profiles?.email || 'Élève';
    return { cls: l.status, key: 'L' + l.id, label: l.status === 'pending' ? `${name} (demande)` : name, clickable: false };
  }
  const open = S.open.has(t);
  return { cls: open ? 'open' : 'closed', key: open ? 'open' : 'closed', label: open ? 'Ouvert' : '', clickable: t >= Date.now() };
}

function studentCell(t) {
  const st = S.slotState.get(t);
  if (!st) return { cls: 'closed', key: 'closed', label: '', clickable: false };
  const map = {
    free: ['open', 'Libre'], taken: ['taken', 'Pris'],
    mine_pending: ['pending', 'Ma demande'], mine_confirmed: ['confirmed', 'Mon cours'],
  };
  const [cls, label] = map[st] || ['taken', 'Pris'];
  return { cls, key: st, label, clickable: st === 'free' && t >= Date.now() };
}

const cellInfo = (t) => (S.isAdmin ? adminCell(t) : studentCell(t));
const isSelected = (d, r) => S.selection && S.selection.d === d && r >= S.selection.r0 && r <= S.selection.r1;

function drawGrid() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  const days = weekDays(), rows = days[0].slots.length, now = Date.now(), today = new Date();
  let h = '<table class="grid"><thead><tr><th class="time"></th>';
  h += days.map((d) => `<th class="${sameDay(d.date, today) ? 'today' : ''}">${esc(cap(fDayShort(d.date)))}</th>`).join('');
  h += '</tr></thead><tbody>';
  for (let r = 0; r < rows; r++) {
    const label = r % 2 === 0 ? `${String(CFG.DAY_START_HOUR + r / 2).padStart(2, '0')}:00` : '';
    h += `<tr class="${r % 2 ? 'half' : 'full'}"><th class="time">${label}</th>`;
    for (let d = 0; d < 7; d++) {
      const t = days[d].slots[r];
      const info = cellInfo(t);
      const prev = r > 0 ? cellInfo(days[d].slots[r - 1]) : null;
      const showLabel = info.label && (!prev || prev.key !== info.key);
      const cls = ['slot', info.cls, t < now ? 'past' : '', info.clickable ? 'clickable' : '', isSelected(d, r) ? 'selected' : ''].join(' ');
      h += `<td class="${cls}" data-d="${d}" data-r="${r}" data-t="${t}">${showLabel ? `<span>${esc(info.label)}</span>` : ''}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  grid.innerHTML = h;
  drawSelBar();
}

// --- Admin : ouvrir / fermer des créneaux (clic ou cliquer-glisser)
function bindAdminGrid(grid) {
  let paint = null;
  const apply = (td) => {
    const isOpen = td.classList.contains('open');
    if ((paint.mode === 'open') === isOpen) return;
    td.classList.toggle('open', paint.mode === 'open');
    td.classList.toggle('closed', paint.mode !== 'open');
    td.innerHTML = paint.mode === 'open' ? '<span>Ouvert</span>' : '';
    paint.cells.add(Number(td.dataset.t));
  };
  grid.addEventListener('pointerdown', (e) => {
    const td = e.target.closest('td.slot.clickable');
    if (!td) return;
    e.preventDefault();
    paint = { mode: td.classList.contains('open') ? 'close' : 'open', cells: new Set() };
    apply(td);
  });
  grid.addEventListener('pointerover', (e) => {
    if (!paint) return;
    const td = e.target.closest('td.slot.clickable');
    if (td) apply(td);
  });
  const finish = async () => {
    if (!paint) return;
    const p = paint; paint = null;
    if (p.cells.size) await commitAvailability(p.mode, [...p.cells]);
  };
  window.onpointerup = finish;
  window.onpointercancel = finish;
}

async function commitAvailability(mode, times) {
  const iso = times.map((t) => new Date(t).toISOString());
  const res = mode === 'open'
    ? await sb.from('availability').upsert(iso.map((s) => ({ slot_start: s })), { onConflict: 'slot_start', ignoreDuplicates: true })
    : await sb.from('availability').delete().in('slot_start', iso);
  if (res.error) toast(errMsg(res.error), 'err');
  await loadWeek();
}

async function copyPreviousWeek() {
  const from = addDays(S.weekStart, -7), to = S.weekStart;
  const { data, error } = await sb.from('availability').select('slot_start')
    .gte('slot_start', from.toISOString()).lt('slot_start', to.toISOString());
  if (error) return toast(errMsg(error), 'err');
  const now = Date.now();
  const rows = data
    .map((r) => addDays(new Date(r.slot_start), 7))   // +7 jours en heure locale (gère le changement d'heure)
    .filter((d) => d.getTime() >= now)
    .map((d) => ({ slot_start: d.toISOString() }));
  if (!rows.length) return toast('Aucun créneau à copier.', 'err');
  const res = await sb.from('availability').upsert(rows, { onConflict: 'slot_start', ignoreDuplicates: true });
  if (res.error) return toast(errMsg(res.error), 'err');
  toast(`${rows.length} créneau(x) copié(s).`);
  await loadWeek();
}

async function clearWeek() {
  const now = Date.now();
  const busy = (t) => S.weekLessons.some((l) => t >= T(l.start_at) && t < T(l.end_at));
  const targets = [...S.open].filter((t) => t >= now && !busy(t));
  if (!targets.length) return toast('Aucun créneau libre à fermer.', 'err');
  if (!confirm(`Fermer ${targets.length} créneau(x) libre(s) de cette semaine ?`)) return;
  await commitAvailability('close', targets);
  toast('Créneaux fermés.');
}

// --- Élève : sélection de créneaux contigus et demande
function bindStudentGrid(grid) {
  grid.addEventListener('click', (e) => {
    const td = e.target.closest('td.slot.clickable');
    if (!td) return;
    selectCell(Number(td.dataset.d), Number(td.dataset.r));
    drawGrid();
  });
}

function selectCell(d, r) {
  const s = S.selection;
  if (isSelected(d, r)) { S.selection = null; return; }
  if (s && s.d === d) {
    const lo = Math.min(s.r0, r), hi = Math.max(s.r1, r);
    const days = weekDays();
    let ok = true;
    for (let i = lo; i <= hi; i++) if (!studentCell(days[d].slots[i]).clickable) { ok = false; break; }
    if (ok) { S.selection = { d, r0: lo, r1: hi }; return; }
  }
  S.selection = { d, r0: r, r1: r };
}

function drawSelBar() {
  const bar = document.getElementById('selbar');
  if (!bar) return;
  if (S.isAdmin || !S.selection) { bar.className = ''; bar.innerHTML = ''; return; }
  const days = weekDays();
  const a = new Date(days[S.selection.d].slots[S.selection.r0]);
  const b = new Date(days[S.selection.d].slots[S.selection.r1] + SLOT_MS);
  bar.className = 'selbar';
  bar.innerHTML = `<span>${esc(fRange(a, b))}</span>
    <div><button class="primary" id="sendReq">Envoyer la demande</button><button id="cancelSel">Annuler</button></div>`;
  document.getElementById('cancelSel').onclick = () => { S.selection = null; drawGrid(); };
  document.getElementById('sendReq').onclick = async (e) => {
    e.target.disabled = true;
    const { error } = await sb.rpc('request_lesson', { p_start: a.toISOString(), p_end: b.toISOString() });
    if (error) { toast(errMsg(error), 'err'); e.target.disabled = false; await loadWeek(); return; }
    S.selection = null;
    toast('Demande envoyée. Elle sera confirmée après validation.');
    await loadWeek();
  };
}

// ---------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------
async function renderDashboard() {
  $view().innerHTML = '<p class="muted pad">Chargement…</p>';
  const { data, error } = await sb.from('lessons')
    .select('*, profiles(student_name,parent_name,email)')
    .order('start_at', { ascending: true });
  if (error) { $view().innerHTML = `<p class="error pad">${esc(errMsg(error))}</p>`; return; }
  S.lessons = data;
  if (S.isAdmin) drawAdminDash(); else drawStudentDash();
}

const who = (l) => esc(l.profiles?.student_name || l.profiles?.email || 'Élève');
const paidBadge = (l) => `<span class="badge ${l.paid ? 'ok' : 'warn'}">${l.paid ? 'Payé' : 'Non payé'}</span>`;
const statusLabel = { pending: 'En attente', confirmed: 'Confirmé', refused: 'Refusé', cancelled: 'Annulé' };
const section = (title, items, empty) =>
  `<section><h2>${title} <span class="count">${items.length}</span></h2>${items.length ? items.join('') : `<p class="muted">${empty}</p>`}</section>`;

function drawAdminDash() {
  const now = Date.now();
  const all = S.lessons;
  const students = [...new Map(all.map((l) => [l.student_id, l.profiles?.student_name || l.profiles?.email || 'Élève'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const L = S.dashFilter ? all.filter((l) => l.student_id === S.dashFilter) : all;

  const pending = L.filter((l) => l.status === 'pending');
  const upcoming = L.filter((l) => l.status === 'confirmed' && T(l.end_at) >= now);
  const past = L.filter((l) => l.status === 'confirmed' && T(l.end_at) < now).reverse();
  const closed = L.filter((l) => l.status === 'refused' || l.status === 'cancelled').reverse();
  const unpaid = past.filter((l) => !l.paid).length;

  const pendingCard = (l) => `
    <div class="lesson">
      <div class="when">${esc(fRange(l.start_at, l.end_at))} ${T(l.start_at) < now ? '<span class="badge warn">date passée</span>' : ''}</div>
      <div class="whois">${who(l)}</div>
      <div class="actions">
        <button class="primary" data-act="accept" data-id="${l.id}">Accepter</button>
        <button data-act="refuse" data-id="${l.id}">Refuser</button>
      </div>
    </div>`;
  const lessonCard = (l, upcomingCard) => `
    <div class="lesson">
      <div class="when">${esc(fRange(l.start_at, l.end_at))}</div>
      <div class="whois">${who(l)}</div>
      <label class="check"><input type="checkbox" data-act="paid" data-id="${l.id}" ${l.paid ? 'checked' : ''}> Payé</label>
      <label class="notes">Notes de séance
        <textarea rows="2" data-notes="${l.id}" placeholder="Chapitres vus, exercices, devoirs…">${esc(l.notes)}</textarea>
      </label>
      <div class="actions">
        <button data-act="savenotes" data-id="${l.id}">Enregistrer les notes</button>
        ${upcomingCard ? `<button class="danger" data-act="cancel" data-id="${l.id}">Annuler le cours</button>` : ''}
      </div>
    </div>`;
  const closedCard = (l) => `
    <div class="lesson dim"><div class="when">${esc(fRange(l.start_at, l.end_at))}</div>
    <div class="whois">${who(l)} · <span class="badge">${statusLabel[l.status]}</span></div></div>`;

  $view().innerHTML = `
    <div class="summary">
      <div><strong>${pending.length}</strong> demande(s) en attente</div>
      <div><strong>${upcoming.length}</strong> cours à venir</div>
      <div><strong>${unpaid}</strong> cours passé(s) non payé(s)</div>
    </div>
    <label class="filter">Élève :
      <select id="filter"><option value="">Tous</option>
        ${students.map(([id, n]) => `<option value="${id}" ${S.dashFilter === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </label>
    ${section('Demandes en attente', pending.map(pendingCard), 'Aucune demande en attente.')}
    ${section('Cours à venir', upcoming.map((l) => lessonCard(l, true)), 'Aucun cours programmé.')}
    ${section('Cours passés', past.map((l) => lessonCard(l, false)), 'Aucun cours passé.')}
    <details><summary>Demandes refusées et cours annulés (${closed.length})</summary>${closed.map(closedCard).join('')}</details>`;

  document.getElementById('filter').onchange = (e) => { S.dashFilter = e.target.value; drawAdminDash(); };
  bindDashActions();
}

function drawStudentDash() {
  const now = Date.now();
  const L = S.lessons;
  const pending = L.filter((l) => l.status === 'pending');
  const upcoming = L.filter((l) => l.status === 'confirmed' && T(l.end_at) >= now);
  const past = L.filter((l) => l.status === 'confirmed' && T(l.end_at) < now).reverse();
  const closed = L.filter((l) => l.status === 'refused' || l.status === 'cancelled').reverse();

  const notes = (l) => (l.notes ? `<div class="notes-ro"><div class="small muted">Notes de séance</div>${esc(l.notes)}</div>` : '');
  const card = (l) => `<div class="lesson"><div class="when">${esc(fRange(l.start_at, l.end_at))}</div>${paidBadge(l)}${notes(l)}</div>`;
  const pendingCard = (l) => `
    <div class="lesson"><div class="when">${esc(fRange(l.start_at, l.end_at))}</div>
    <div class="actions"><span class="badge warn">En attente de validation</span>
    <button data-act="withdraw" data-id="${l.id}">Retirer ma demande</button></div></div>`;
  const closedCard = (l) => `<div class="lesson dim"><div class="when">${esc(fRange(l.start_at, l.end_at))}</div><span class="badge">${statusLabel[l.status]}</span></div>`;

  $view().innerHTML = `
    ${section('Mes demandes en attente', pending.map(pendingCard), 'Aucune demande en attente.')}
    ${section('Cours à venir', upcoming.map(card), 'Aucun cours programmé. Réservez depuis l\'onglet « Réserver ».')}
    ${section('Cours passés', past.map(card), 'Aucun cours passé.')}
    <details><summary>Demandes refusées et cours annulés (${closed.length})</summary>${closed.map(closedCard).join('')}</details>`;
  bindDashActions();
}

function bindDashActions() {
  const v = $view();
  const update = async (id, patch, okMsg, rerender = true) => {
    const { error } = await sb.from('lessons').update(patch).eq('id', id);
    if (error) { toast(errMsg(error), 'err'); return false; }
    const l = S.lessons.find((x) => x.id === id); if (l) Object.assign(l, patch);
    toast(okMsg);
    if (rerender) renderDashboard();
    return true;
  };
  v.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = Number(b.dataset.id);
    switch (b.dataset.act) {
      case 'accept': await update(id, { status: 'confirmed' }, 'Cours confirmé.'); break;
      case 'refuse': if (confirm('Refuser cette demande ? Le créneau redeviendra libre.')) await update(id, { status: 'refused' }, 'Demande refusée.'); break;
      case 'cancel': if (confirm('Annuler ce cours ? Le créneau redeviendra libre.')) await update(id, { status: 'cancelled' }, 'Cours annulé.'); break;
      case 'savenotes': {
        const ta = v.querySelector(`textarea[data-notes="${id}"]`);
        await update(id, { notes: ta.value.trim() || null }, 'Notes enregistrées.', false);
        break;
      }
      case 'withdraw': {
        if (!confirm('Retirer cette demande ?')) break;
        const { error } = await sb.from('lessons').delete().eq('id', id);
        if (error) toast(errMsg(error), 'err'); else { toast('Demande retirée.'); renderDashboard(); }
        break;
      }
    }
  };
  v.onchange = async (e) => {
    const cb = e.target.closest('input[data-act="paid"]');
    if (!cb) return;
    const ok = await update(Number(cb.dataset.id), { paid: cb.checked }, cb.checked ? 'Marqué payé.' : 'Marqué non payé.', false);
    if (!ok) cb.checked = !cb.checked;
  };
}

// ---------------------------------------------------------------------
// Profil élève
// ---------------------------------------------------------------------
const PROFILE_FIELDS = [
  ['student_name', 'Nom et prénom de l\'élève', 'text'],
  ['parent_name', 'Nom du parent (si élève mineur)', 'text'],
  ['phone', 'Téléphone', 'tel'],
  ['address', 'Adresse', 'textarea'],
  ['level', 'Classe / niveau', 'text'],
  ['remarks', 'Remarques (objectifs, difficultés…)', 'textarea'],
];

function passwordForm() {
  return `
    <section class="card">
      <h2>Changer mon mot de passe</h2>
      <form id="pwchange">
        <label>Nouveau mot de passe (8 caractères minimum)<input type="password" name="p1" minlength="8" required autocomplete="new-password"></label>
        <label>Confirmation<input type="password" name="p2" minlength="8" required autocomplete="new-password"></label>
        <button type="submit">Changer le mot de passe</button>
      </form>
    </section>`;
}
function bindPasswordForm() {
  document.getElementById('pwchange').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) return toast('Les deux mots de passe ne correspondent pas.', 'err');
    const { error } = await sb.auth.updateUser({ password: f.get('p1') });
    if (error) return toast(errMsg(error), 'err');
    e.target.reset();
    toast('Mot de passe modifié.');
  };
}

function renderProfile() {
  const p = S.profile;
  const first = !p.student_name ? '<p class="warn">Bienvenue ! Merci de compléter votre profil avant de réserver un cours.</p>' : '';
  $view().innerHTML = `
    <section class="card">
      <h2>Mon profil</h2>
      ${first}
      <form id="profile">
        <label>E-mail du compte<input type="email" value="${esc(p.email)}" disabled></label>
        ${PROFILE_FIELDS.map(([k, l, type]) => type === 'textarea'
          ? `<label>${l}<textarea name="${k}" rows="3">${esc(p[k])}</textarea></label>`
          : `<label>${l}<input type="${type}" name="${k}" value="${esc(p[k])}" ${k === 'student_name' ? 'required' : ''}></label>`).join('')}
        <button class="primary" type="submit">Enregistrer</button>
      </form>
    </section>
    ${passwordForm()}`;
  document.getElementById('profile').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const patch = Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, (f.get(k) || '').trim() || null]));
    const { error } = await sb.from('profiles').update(patch).eq('id', S.user.id);
    if (error) return toast(errMsg(error), 'err');
    Object.assign(S.profile, patch);
    toast('Profil enregistré.');
    renderShell();
  };
  bindPasswordForm();
}

// ---------------------------------------------------------------------
// Élèves (admin) : invitations anonymes, liens de connexion, fiches
// ---------------------------------------------------------------------
const baseUrl = () => `${location.origin}${location.pathname}`;
const joinLink = (token) => `${baseUrl()}#join=${token}`;

async function loginLink(email) {
  const data = await callInvite({ action: 'login_link', email });
  return `${baseUrl()}#invite=${encodeURIComponent(data.token_hash)}&type=${encodeURIComponent(data.type)}`;
}

function showLink(container, link, title, note) {
  container.innerHTML = `
    <div class="linkbox">
      <div class="small">${title}</div>
      <div class="row"><input readonly value="${esc(link)}"><button class="primary" data-copy>Copier</button></div>
      <p class="muted small">${note}</p>
    </div>`;
  const input = container.querySelector('input');
  container.querySelector('[data-copy]').onclick = () => copyText(link, input);
}

async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); }
  catch { if (input) { input.select(); document.execCommand('copy'); } }
  toast('Lien copié.');
}

async function renderStudents() {
  $view().innerHTML = `
    <section class="card">
      <h2>Inviter un élève</h2>
      <form id="invite" class="row">
        <input type="text" name="label" placeholder="Note pour vous retrouver (facultatif, ex. « Léa, 1re »)">
        <button class="primary" type="submit">Générer un lien d'invitation</button>
      </form>
      <div id="inviteLink"></div>
    </section>
    <section>
      <h2>Invitations en attente</h2>
      <div id="pendingInv"><p class="muted">Chargement…</p></div>
    </section>
    <section>
      <h2>Élèves</h2>
      <div id="studentList"><p class="muted">Chargement…</p></div>
    </section>
    ${passwordForm()}`;

  document.getElementById('invite').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const label = String(new FormData(e.target).get('label') || '').trim() || null;
    btn.disabled = true;
    const { data, error } = await sb.from('invitations').insert({ label }).select('token').single();
    btn.disabled = false;
    if (error) return toast(errMsg(error), 'err');
    showLink(document.getElementById('inviteLink'), joinLink(data.token),
      `Lien d'invitation${label ? ` pour <strong>${esc(label)}</strong>` : ''} :`,
      'Envoyez ce lien vous-même (SMS, WhatsApp…). L\'élève y saisira son adresse e-mail et choisira son mot de passe. Usage unique, valable 7 jours.');
    e.target.reset();
    loadInvitations();
  };
  bindPasswordForm();
  loadInvitations();
  loadStudents();
}

async function loadInvitations() {
  const box = document.getElementById('pendingInv');
  const { data, error } = await sb.from('invitations').select('*')
    .is('used_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) { box.innerHTML = `<p class="error">${esc(errMsg(error))}</p>`; return; }
  if (!data.length) { box.innerHTML = '<p class="muted">Aucune invitation en attente.</p>'; return; }
  box.innerHTML = data.map((i) => `
    <div class="lesson">
      <div class="when">${esc(i.label || '(sans note)')}</div>
      <div class="whois">Créée le ${esc(fDate(i.created_at))} · expire le ${esc(fDate(i.expires_at))}</div>
      <div class="actions">
        <button data-copyinv="${esc(i.token)}">Copier le lien</button>
        <button class="danger" data-revoke="${esc(i.token)}">Révoquer</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-copyinv]').forEach((b) => { b.onclick = () => copyText(joinLink(b.dataset.copyinv)); });
  box.querySelectorAll('[data-revoke]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Révoquer cette invitation ? Le lien ne fonctionnera plus.')) return;
      const { error: err } = await sb.from('invitations').delete().eq('token', b.dataset.revoke);
      if (err) return toast(errMsg(err), 'err');
      toast('Invitation révoquée.');
      loadInvitations();
    };
  });
}

async function loadStudents() {
  const box = document.getElementById('studentList');
  const { data, error } = await sb.from('profiles').select('*').eq('role', 'student').order('created_at');
  if (error) { box.innerHTML = `<p class="error">${esc(errMsg(error))}</p>`; return; }
  if (!data.length) { box.innerHTML = '<p class="muted">Aucun élève pour l\'instant.</p>'; return; }
  box.innerHTML = data.map((p) => `
    <div class="student card">
      <div class="student-head">
        <strong>${esc(p.student_name || '(profil non complété)')}</strong>
        <span class="muted">${esc(p.email)}</span>
      </div>
      <dl>
        ${PROFILE_FIELDS.slice(1).map(([k, l]) => `<dt>${esc(l)}</dt><dd>${esc(p[k]) || '<span class="muted">—</span>'}</dd>`).join('')}
      </dl>
      <button data-relink="${esc(p.email)}">Générer un lien de connexion (mot de passe oublié)</button>
      <div class="relink"></div>
    </div>`).join('');
  box.querySelectorAll('[data-relink]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        showLink(b.nextElementSibling, await loginLink(b.dataset.relink),
          `Lien de connexion pour <strong>${esc(b.dataset.relink)}</strong> :`,
          'L\'élève sera connecté puis invité à choisir un nouveau mot de passe. Usage unique, valable 24 h (réglage Supabase).');
      } catch (err) { toast(errMsg(err), 'err'); }
      b.disabled = false;
    };
  });
}

// Lien collé dans un onglet déjà ouvert sur le site.
window.addEventListener('hashchange', () => { if (/(invite|join)=/.test(location.hash)) boot(); });

boot();
