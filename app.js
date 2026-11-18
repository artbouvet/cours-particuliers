// =====================================================================
//  Cours particuliers — application V1 (JS vanilla, aucune étape de build)
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as CFG from './config.js';

const $app = document.getElementById('app');
// Tolère une URL copiée avec un suffixe (/rest/v1/, /auth/v1/…) ou un « / » final.
const SUPABASE_BASE = CFG.SUPABASE_URL.trim().replace(/\/(rest|auth|functions)\/v1\/?.*$/, '').replace(/\/+$/, '');
const sb = createClient(SUPABASE_BASE, CFG.SUPABASE_KEY.trim());
const SLOT_MS = 30 * 60 * 1000;
const DAY_START = CFG.DAY_START_HOUR ?? 8;
const DAY_END = CFG.DAY_END_HOUR ?? 21;

const S = {
  user: null, profile: null, isAdmin: false,
  tab: 'calendar',
  weekStart: mondayOf(new Date()),
  editMode: false,                 // admin : modification des disponibilités
  selection: null,                 // élève : { d, r0, r1 }
  open: new Set(), weekLessons: [], // admin : semaine affichée
  slotState: new Map(),            // élève : semaine affichée
  lessons: [], dashFilter: '',
};

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (s) => new Date(s).getTime();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');
const fTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fDay = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fDayShort = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eur = (n) => EUR.format(Number(n));

function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fDur(ms) {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${pad(r)}` : `${h} h`;
}
const fRange = (a, b) => `${cap(fDay(a))} · ${fTime(a)} – ${fTime(b)} (${fDur(T(b) - T(a))})`;
const errMsg = (e) => e?.message || String(e);
function friendlyErr(e) {
  const m = errMsg(e);
  if (/lesson_no_overlap|exclusion/i.test(m)) return 'Ce créneau chevauche un autre cours ou une demande en attente.';
  if (/row-level security|permission denied/i.test(m)) return 'Action non autorisée.';
  return m;
}

// --- Cours : libellés, prix, visio
const SUBJECTS = { maths: 'Mathématiques', physique: 'Physique-Chimie', autre: 'Autre' };
const MODES = { domicile: 'Domicile', distance: 'À distance' };
const subjectLabel = (l) => (l.subject === 'autre' ? (l.subject_other || 'Autre') : SUBJECTS[l.subject] || null);
function priceOf(l) {
  if (l.price != null) return Number(l.price);
  if (l.hourly_rate == null) return null;
  return Math.round(Number(l.hourly_rate) * ((T(l.end_at) - T(l.start_at)) / 3600000) * 100) / 100;
}
// Le tarif horaire n'est affiché qu'au professeur ; l'élève ne voit que le prix du cours.
function priceText(l) {
  const p = priceOf(l);
  if (p == null) return null;
  return S.isAdmin ? `${eur(p)} (${eur(l.hourly_rate)}/h)` : eur(p);
}
const lessonTitle = (l) => (l.title && l.title.trim()) || 'Cours';
const lessonMeta = (l) => [subjectLabel(l), MODES[l.mode], priceText(l)].filter(Boolean).map(esc).join(' · ');
const safeUrl = (u) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
function visioHtml(l) {
  if (l.mode !== 'distance') return '';
  const u = safeUrl(l.visio_link);
  return u
    ? `<div class="visio"><a href="${esc(u)}" target="_blank" rel="noopener">Rejoindre la visio</a> <span class="muted small">${esc(u)}</span></div>`
    : '<div class="visio muted small">Lien de visio pas encore renseigné.</div>';
}

function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = ''; }, 3500);
}

const $view = () => document.getElementById('view');

// --- Fenêtre modale générique
function openModal({ title, body, submitLabel = 'Enregistrer', onSubmit, onOpen }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form class="modal-form" novalidate>
      <h2>${title}</h2>
      ${body}
      <p class="error" data-err></p>
      <div class="actions end">
        <button type="button" data-close>Annuler</button>
        <button class="primary" type="submit">${submitLabel}</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('[data-err]');
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; err.textContent = '';
    try {
      const ok = await onSubmit(new FormData(form), form);
      if (ok !== false) dlg.close();
    } catch (ex) { err.textContent = friendlyErr(ex); }
    btn.disabled = false;
  };
  onOpen?.(form);
  dlg.showModal();
}

// --- Champs « lieu / matière / visio » d'un cours
function lessonFieldsHtml(l = {}, admin = false) {
  const r = (name, val, label, cur) =>
    `<label class="opt"><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''} required> ${label}</label>`;
  return `
    ${admin ? `<label>Titre de la séance (affiché à l'élève)<input type="text" name="title" required maxlength="80" value="${esc(l.title || 'Cours')}" placeholder="Cours, Séance d'essai…"></label>` : ''}
    <fieldset class="seg"><legend>Lieu du cours</legend>
      ${r('mode', 'domicile', 'Domicile', l.mode)}${r('mode', 'distance', 'À distance', l.mode)}
    </fieldset>
    <fieldset class="seg"><legend>Matière</legend>
      ${r('subject', 'maths', 'Mathématiques', l.subject)}${r('subject', 'physique', 'Physique-Chimie', l.subject)}${r('subject', 'autre', 'Autre', l.subject)}
    </fieldset>
    <label data-show="autre">Préciser la matière<input type="text" name="subject_other" maxlength="80" value="${esc(l.subject_other)}" placeholder="ex. SES, informatique…"></label>
    ${admin ? `<label data-show="distance">Lien de visio<input type="url" name="visio_link" value="${esc(l.visio_link)}" placeholder="https://meet.google.com/…"></label>` : ''}`;
}
function bindLessonFields(form) {
  const update = () => {
    const subject = form.querySelector('input[name=subject]:checked')?.value;
    const mode = form.querySelector('input[name=mode]:checked')?.value;
    const other = form.querySelector('[data-show=autre]');
    other.hidden = subject !== 'autre';
    other.querySelector('input').required = subject === 'autre';
    const visio = form.querySelector('[data-show=distance]');
    if (visio) visio.hidden = mode !== 'distance';
  };
  form.addEventListener('change', update);
  update();
}
function readLessonFields(fd, admin = false) {
  const mode = fd.get('mode'), subject = fd.get('subject');
  const o = {
    mode, subject,
    subject_other: subject === 'autre' ? (String(fd.get('subject_other') || '').trim() || null) : null,
  };
  if (admin) {
    o.visio_link = mode === 'distance' ? (String(fd.get('visio_link') || '').trim() || null) : null;
    o.title = String(fd.get('title') || '').trim() || 'Cours';
  }
  return o;
}

// ---------------------------------------------------------------------
// Page d'accueil (contenu dans config.js)
// ---------------------------------------------------------------------
// Coordonnées cliquables : e-mail (mailto:) et téléphone (tel:, format international).
function contactHtml() {
  const mail = CFG.CONTACT_EMAIL, phone = CFG.CONTACT_PHONE;
  if (!mail && !phone) return '';
  const digits = String(phone || '').replace(/\D/g, '');
  const telHref = /^0\d{9}$/.test(digits) ? `+33${digits.slice(1)}` : digits;
  const telText = /^0\d{9}$/.test(digits) ? digits.replace(/(\d{2})(?=\d)/g, '$1 ') : phone;
  return `
    <div class="contact">
      ${mail ? `<a href="mailto:${esc(mail)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>${esc(mail)}</a>` : ''}
      ${phone ? `<a href="tel:${esc(telHref)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>${esc(telText)}</a>` : ''}
    </div>`;
}

function heroHtml() {
  const name = CFG.TEACHER_NAME || '';
  const photo = CFG.PHOTO_URL
    ? `<img class="photo" src="${esc(CFG.PHOTO_URL)}" alt="${esc(name)}" onerror="this.remove()">`
    : '';
  const about = (CFG.ABOUT_PARAGRAPHS || []).map((p) => `<p>${esc(p)}</p>`).join('');
  return `
    <section class="hero card">
      ${photo}
      <div>
        ${name ? `<h1>${esc(name)}</h1>` : ''}
        ${CFG.TAGLINE ? `<p class="tagline">${esc(CFG.TAGLINE)}</p>` : ''}
        ${about}
        ${contactHtml()}
      </div>
    </section>`;
}

function howToHtml() {
  const steps = (CFG.HOW_TO || []).map(([t, d]) => `<li><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join('');
  return steps ? `<section class="card"><h2>Comment utiliser le site</h2><ol class="steps">${steps}</ol></section>` : '';
}

const homeHtml = () => heroHtml() + howToHtml();

// ---------------------------------------------------------------------
// Démarrage, connexion, invitation, lien de connexion
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
  if (!session) return renderLanding();
  await enterApp(session.user);
}

function loginFormHtml() {
  return `
    <form id="login">
      <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
      <label>Mot de passe<input type="password" name="password" required autocomplete="current-password"></label>
      <button class="primary" type="submit">Se connecter</button>
      <p class="error" id="err"></p>
    </form>
    <p class="muted small">Accès sur invitation uniquement. Mot de passe oublié ? Demandez un lien de connexion à votre professeur.</p>`;
}
function bindLogin() {
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data, error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) {
      const m = error.message || '';
      document.getElementById('err').textContent =
        /invalid login credentials/i.test(m) ? 'E-mail ou mot de passe incorrect.'
        : /email not confirmed/i.test(m) ? 'Compte non confirmé.'
        : /invalid api key|failed to fetch|network/i.test(m) ? `Connexion à Supabase impossible : vérifiez config.js. (${m})`
        : `Erreur : ${m}`;
      return;
    }
    S.tab = 'calendar';
    await enterApp(data.user);
  };
}

function renderLanding() {
  $app.innerHTML = `
    <header class="topbar">
      <div class="brand">${esc(CFG.SITE_TITLE)}</div>
      <nav></nav>
      <div class="who"><button class="primary" id="goLogin">Se connecter</button></div>
    </header>
    <main>
      ${homeHtml()}
      <section class="card login-card" id="connexion">
        <h2>Connexion</h2>
        ${loginFormHtml()}
      </section>
    </main>`;
  document.getElementById('goLogin').onclick = () => {
    document.getElementById('connexion').scrollIntoView({ behavior: 'smooth' });
    document.querySelector('#login input[name=email]').focus({ preventScroll: true });
  };
  bindLogin();
}

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
  // Page d'invitation : présentation (contexte) + formulaire + mode d'emploi.
  $app.innerHTML = `
    <header class="topbar">
      <div class="brand">${esc(CFG.SITE_TITLE)}</div>
      <nav></nav>
      <div class="who"><button class="primary" id="goJoin">Créer mon compte</button></div>
    </header>
    <main>
    ${heroHtml()}
    <section class="card login-card" id="creation">
      <h2>Créer votre compte</h2>
      <p>Vous avez été invité à l'espace de réservation des cours${CFG.TEACHER_NAME ? ` de ${esc(CFG.TEACHER_NAME)}` : ''}.</p>
      ${warn}
      <form id="join">
        <label>Adresse e-mail (élève ou parent)<input type="email" name="email" required autocomplete="email"></label>
        <label>Mot de passe (8 caractères minimum)<input type="password" name="p1" minlength="8" required autocomplete="new-password"></label>
        <label>Confirmation du mot de passe<input type="password" name="p2" minlength="8" required autocomplete="new-password"></label>
        <button class="primary" type="submit">Créer mon compte</button>
        <p class="error" id="err"></p>
      </form>
      <p class="muted small">Vous avez déjà un compte ? <a href="${esc(location.pathname)}">Se connecter</a></p>
    </section>
    ${howToHtml()}
    </main>`;
  document.getElementById('goJoin').onclick = () => {
    document.getElementById('creation').scrollIntoView({ behavior: 'smooth' });
    document.querySelector('#join input[name=email]').focus({ preventScroll: true });
  };
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
      <button class="primary" id="activate">Me connecter</button>
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
  Object.assign(S, { user: null, profile: null, tab: 'calendar', selection: null, editMode: false });
  renderLanding();
}

// ---------------------------------------------------------------------
// Coquille : en-tête + onglets
// ---------------------------------------------------------------------
function renderShell() {
  const tabs = S.isAdmin
    ? [['home', 'Accueil'], ['calendar', 'Calendrier'], ['dashboard', 'Tableau de bord'], ['students', 'Élèves']]
    : [['home', 'Accueil'], ['calendar', 'Réserver'], ['dashboard', 'Mes cours'], ['profile', 'Mon profil']];
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
    b.onclick = () => { S.tab = b.dataset.tab; S.selection = null; S.editMode = false; renderShell(); };
  });
  document.getElementById('logout').onclick = logout;
  ({
    home: () => { $view().innerHTML = homeHtml(); },
    calendar: renderCalendar, dashboard: renderDashboard, profile: renderProfile, students: renderStudents,
  })[S.tab]();
}

// ---------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------
const PENCIL = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

function weekDays() {
  const rows = (DAY_END - DAY_START) * 2;
  const days = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(S.weekStart, d);
    const slots = [];
    for (let r = 0; r < rows; r++) {
      const t = new Date(date);
      t.setHours(DAY_START + Math.floor(r / 2), (r % 2) * 30, 0, 0);
      slots.push(t.getTime());
    }
    days.push({ date, slots });
  }
  return days;
}

function renderCalendar() {
  // Élève : pas de navigation dans les semaines passées.
  const thisWeek = mondayOf(new Date());
  if (!S.isAdmin && S.weekStart < thisWeek) S.weekStart = thisWeek;
  const canGoBack = S.isAdmin || S.weekStart > thisWeek;
  const end = addDays(S.weekStart, 6);
  const adminTools = S.isAdmin ? `
    <div class="tools">
      <button id="editToggle" class="icon-btn ${S.editMode ? 'active' : ''}" title="Modifier les disponibilités">
        ${PENCIL}<span>${S.editMode ? 'Terminer la modification' : 'Modifier les disponibilités'}</span>
      </button>
      ${S.editMode ? '<button id="copyPrev">Copier les dispos de la semaine précédente</button>' : ''}
      <button id="addLesson">+ Ajouter un cours</button>
    </div>` : '';
  const help = S.isAdmin
    ? (S.editMode
      ? 'Mode modification : cliquez sur une case (ou cliquez-glissez sur ordinateur) pour la rendre disponible ou indisponible. Les créneaux réservés ne sont pas modifiables.'
      : 'Cliquez sur le crayon pour modifier vos disponibilités. Survolez un cours pour voir son détail.')
    : 'Cliquez sur un créneau disponible, puis sur un autre plus bas le même jour pour allonger le cours. Recliquez dans la sélection pour l\'annuler.';
  const legend = S.isAdmin
    ? '<span class="lg open">Disponible</span><span class="lg pending">Demande en attente</span><span class="lg confirmed">Cours programmé</span><span class="lg closed">Indisponible</span>'
    : '<span class="lg open">Disponible</span><span class="lg unavail">Indisponible</span><span class="lg pending">Demande en attente</span><span class="lg confirmed">Cours programmé</span><span class="lg selected">Sélection</span>';
  $view().innerHTML = `
    <div class="weeknav">
      <button id="prevW" aria-label="Semaine précédente" ${canGoBack ? '' : 'disabled title="Les cours passés sont dans « Mes cours »"'}>←</button>
      <div class="weeklabel">Semaine du ${S.weekStart.getDate()} au ${fDate(end)}</div>
      <button id="nextW" aria-label="Semaine suivante">→</button>
      <button id="todayW">Aujourd'hui</button>
    </div>
    ${adminTools}
    <p class="muted small">${help}</p>
    <div class="legend">${legend}</div>
    <div class="gridwrap ${S.editMode ? 'editing' : ''}"><div id="grid"><p class="muted pad">Chargement…</p></div></div>
    <div id="selbar"></div>`;
  const nav = (n) => () => { S.weekStart = n === 0 ? mondayOf(new Date()) : addDays(S.weekStart, n); S.selection = null; renderCalendar(); };
  document.getElementById('prevW').onclick = nav(-7);
  document.getElementById('nextW').onclick = nav(7);
  document.getElementById('todayW').onclick = nav(0);
  if (S.isAdmin) {
    document.getElementById('editToggle').onclick = () => { S.editMode = !S.editMode; renderCalendar(); };
    if (S.editMode) document.getElementById('copyPrev').onclick = copyPreviousWeek;
    document.getElementById('addLesson').onclick = () => openAddLessonModal(loadWeek);
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
      sb.from('lessons').select('*, profiles(student_name,email)')
        .in('status', ['pending', 'confirmed']).lt('start_at', to).gt('end_at', from),
    ]);
    if (av.error || ls.error) return gridError(av.error || ls.error);
    S.open = new Set(av.data.map((r) => T(r.slot_start)));
    S.weekLessons = ls.data;
  } else {
    const { data, error } = await sb.rpc('get_slots', { p_from: from, p_to: to });
    if (error) return gridError(error);
    S.slotState = new Map(data.map((r) => [T(r.slot_start), { state: r.state, title: r.title }]));
  }
  drawGrid();
}

function gridError(e) {
  const g = document.getElementById('grid');
  if (g) g.innerHTML = `<p class="error pad">Erreur de chargement : ${esc(errMsg(e))}</p>`;
}

const studentName = (l) => l.profiles?.student_name || l.profiles?.email || 'Élève';

function adminCell(t) {
  const l = S.weekLessons.find((x) => t >= T(x.start_at) && t < T(x.end_at));
  if (l) {
    const name = studentName(l);
    const label = `${lessonTitle(l)} · ${name}${l.status === 'pending' ? ' (demande)' : ''}`;
    const tip = [label, fRange(l.start_at, l.end_at), subjectLabel(l), MODES[l.mode], priceText(l),
      l.status === 'pending' ? 'Demande en attente' : 'Cours programmé'].filter(Boolean).join('\n');
    return { cls: l.status, key: 'L' + l.id, label, tip, clickable: false };
  }
  const open = S.open.has(t);
  return { cls: open ? 'open' : 'closed', key: open ? 'open' : 'closed', label: open ? 'Disponible' : '', clickable: S.editMode && t >= Date.now() };
}

function studentCell(t) {
  const s = S.slotState.get(t);
  const st = s && t >= Date.now() ? s.state : null;   // le passé n'est jamais affiché à l'élève
  if (st === 'free') return { cls: 'open', key: 'free', label: 'Disponible', clickable: true };
  if (st === 'mine_pending') return { cls: 'pending', key: 'pending', label: 'Demande en attente', clickable: false };
  if (st === 'mine_confirmed') {
    const title = (s.title && s.title.trim()) || 'Cours';
    return { cls: 'confirmed', key: `c:${title}`, label: title, tip: `${title} (cours programmé)`, clickable: false };
  }
  return { cls: 'unavail', key: 'unavail', label: 'Indisponible', clickable: false };
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
    const label = r % 2 === 0 ? `${pad(DAY_START + r / 2)}:00` : '';
    h += `<tr class="${r % 2 ? 'half' : 'full'}"><th class="time">${label}</th>`;
    for (let d = 0; d < 7; d++) {
      const t = days[d].slots[r];
      const info = cellInfo(t);
      const prev = r > 0 ? cellInfo(days[d].slots[r - 1]) : null;
      const showLabel = info.label && (!prev || prev.key !== info.key);
      const cls = ['slot', info.cls, t < now ? 'past' : '', info.clickable ? 'clickable' : '', isSelected(d, r) ? 'selected' : ''].join(' ');
      h += `<td class="${cls}" data-d="${d}" data-r="${r}" data-t="${t}" ${info.tip ? `title="${esc(info.tip)}"` : ''}>${showLabel ? `<span>${esc(info.label)}</span>` : ''}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  grid.innerHTML = h;
  drawSelBar();
}

// --- Admin : rendre disponible / indisponible (mode modification uniquement)
function bindAdminGrid(grid) {
  let paint = null;
  const apply = (td) => {
    const isOpen = td.classList.contains('open');
    if ((paint.mode === 'open') === isOpen) return;
    td.classList.toggle('open', paint.mode === 'open');
    td.classList.toggle('closed', paint.mode !== 'open');
    td.innerHTML = paint.mode === 'open' ? '<span>Disponible</span>' : '';
    paint.cells.add(Number(td.dataset.t));
  };
  grid.addEventListener('pointerdown', (e) => {
    if (!S.editMode) return;
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
  if (res.error) toast(friendlyErr(res.error), 'err');
  await loadWeek();
}

async function copyPreviousWeek() {
  const from = addDays(S.weekStart, -7), to = S.weekStart;
  const { data, error } = await sb.from('availability').select('slot_start')
    .gte('slot_start', from.toISOString()).lt('slot_start', to.toISOString());
  if (error) return toast(friendlyErr(error), 'err');
  const now = Date.now();
  const rows = data
    .map((r) => addDays(new Date(r.slot_start), 7))   // +7 jours en heure locale (gère le changement d'heure)
    .filter((d) => d.getTime() >= now)
    .map((d) => ({ slot_start: d.toISOString() }));
  if (!rows.length) return toast('Aucun créneau à copier.', 'err');
  const res = await sb.from('availability').upsert(rows, { onConflict: 'slot_start', ignoreDuplicates: true });
  if (res.error) return toast(friendlyErr(res.error), 'err');
  toast(`${rows.length} créneau(x) copié(s).`);
  await loadWeek();
}

// --- Élève : sélection de créneaux contigus puis demande
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

function selectionRange() {
  const days = weekDays();
  return [new Date(days[S.selection.d].slots[S.selection.r0]), new Date(days[S.selection.d].slots[S.selection.r1] + SLOT_MS)];
}

function estimate(a, b) {
  const rate = S.profile.hourly_rate;
  return rate == null ? null : priceOf({ hourly_rate: rate, start_at: a, end_at: b });
}

function drawSelBar() {
  const bar = document.getElementById('selbar');
  if (!bar) return;
  if (S.isAdmin || !S.selection) { bar.className = ''; bar.innerHTML = ''; return; }
  const [a, b] = selectionRange();
  const p = estimate(a, b);
  bar.className = 'selbar';
  bar.innerHTML = `<span>${esc(fRange(a, b))}${p != null ? ` · <strong>${esc(eur(p))}</strong>` : ''}</span>
    <div><button class="primary" id="sendReq">Continuer</button><button id="cancelSel">Annuler</button></div>`;
  document.getElementById('cancelSel').onclick = () => { S.selection = null; drawGrid(); };
  document.getElementById('sendReq').onclick = () => openRequestModal(a, b);
}

function openRequestModal(a, b) {
  const p = estimate(a, b);
  openModal({
    title: 'Demande de cours',
    submitLabel: 'Envoyer la demande',
    body: `
      <p><strong>${esc(fRange(a, b))}</strong>${p != null ? `<br><span class="muted">Prix : ${esc(eur(p))}</span>` : ''}</p>
      ${lessonFieldsHtml({}, false)}`,
    onOpen: bindLessonFields,
    onSubmit: async (fd) => {
      const f = readLessonFields(fd);
      const { error } = await sb.rpc('request_lesson', {
        p_start: a.toISOString(), p_end: b.toISOString(),
        p_mode: f.mode, p_subject: f.subject, p_subject_other: f.subject_other,
      });
      if (error) { await loadWeek(); throw error; }
      S.selection = null;
      toast('Demande envoyée. Elle sera confirmée après validation.');
      await loadWeek();
    },
  });
}

// --- Admin : ajouter un cours à un élève (sans passer par une demande)
async function getStudents() {
  const { data, error } = await sb.from('profiles').select('*').eq('role', 'student');
  if (error) throw error;
  return data.sort((x, y) => (x.student_name || x.email || '').localeCompare(y.student_name || y.email || ''));
}

async function openAddLessonModal(after) {
  let students;
  try { students = await getStudents(); } catch (e) { return toast(friendlyErr(e), 'err'); }
  if (!students.length) return toast('Aucun élève : invitez d\'abord un élève.', 'err');
  const today = new Date();
  const defDay = S.weekStart <= today && today < addDays(S.weekStart, 7) ? today : S.weekStart;
  const times = [];
  for (let h = 7; h <= 22; h++) for (const m of [0, 30]) times.push(`${pad(h)}:${pad(m)}`);
  const durs = [30, 60, 90, 120, 150, 180, 210, 240];
  openModal({
    title: 'Ajouter un cours',
    submitLabel: 'Ajouter le cours',
    body: `
      <label>Élève<select name="student_id" required>
        <option value="">— Choisir —</option>
        ${students.map((s) => `<option value="${s.id}">${esc(s.student_name || s.email)}${s.hourly_rate != null ? ` (${esc(eur(s.hourly_rate))}/h)` : ''}</option>`).join('')}
      </select></label>
      <div class="row3">
        <label>Date<input type="date" name="date" required value="${isoDate(defDay)}"></label>
        <label>Début<select name="time">${times.map((t) => `<option ${t === '17:00' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Durée<select name="dur">${durs.map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${fDur(m * 60000)}</option>`).join('')}</select></label>
      </div>
      ${lessonFieldsHtml({}, true)}
      <p class="muted small">Le cours est enregistré directement comme programmé, même en dehors de vos disponibilités.</p>`,
    onOpen: bindLessonFields,
    onSubmit: async (fd) => {
      const start = new Date(`${fd.get('date')}T${fd.get('time')}:00`);
      const end = new Date(start.getTime() + Number(fd.get('dur')) * 60000);
      const { error } = await sb.from('lessons').insert({
        student_id: fd.get('student_id'), start_at: start.toISOString(), end_at: end.toISOString(),
        status: 'confirmed', ...readLessonFields(fd, true),
      });
      if (error) throw error;
      toast('Cours ajouté.');
      await after?.();
    },
  });
}

function openEditLessonModal(l, after) {
  openModal({
    title: 'Modifier le cours',
    body: `
      <p><strong>${esc(fRange(l.start_at, l.end_at))}</strong><br><span class="muted">${esc(studentName(l))}${priceText(l) ? ` · ${esc(priceText(l))}` : ''}</span></p>
      ${lessonFieldsHtml(l, true)}`,
    onOpen: bindLessonFields,
    onSubmit: async (fd) => {
      const patch = readLessonFields(fd, true);
      const { error } = await sb.from('lessons').update(patch).eq('id', l.id);
      if (error) throw error;
      toast('Cours modifié.');
      await after?.();
    },
  });
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

const paidBadge = (l) => `<span class="badge ${l.paid ? 'ok' : 'warn'}">${l.paid ? 'Payé' : 'Non payé'}</span>`;
const statusLabel = { pending: 'En attente', confirmed: 'Confirmé', refused: 'Refusé', cancelled: 'Annulé' };
const section = (title, items, empty) =>
  `<section><h2>${title} <span class="count">${items.length}</span></h2>${items.length ? items.join('') : `<p class="muted">${empty}</p>`}</section>`;
const metaLine = (l) => { const m = lessonMeta(l); return m ? `<div class="meta">${m}</div>` : ''; };

function drawAdminDash() {
  const now = Date.now();
  const all = S.lessons;
  const students = [...new Map(all.map((l) => [l.student_id, studentName(l)])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const L = S.dashFilter ? all.filter((l) => l.student_id === S.dashFilter) : all;

  const pending = L.filter((l) => l.status === 'pending');
  const upcoming = L.filter((l) => l.status === 'confirmed' && T(l.end_at) >= now);
  const past = L.filter((l) => l.status === 'confirmed' && T(l.end_at) < now).reverse();
  const closed = L.filter((l) => l.status === 'refused' || l.status === 'cancelled').reverse();
  const unpaid = past.filter((l) => !l.paid);
  const unpaidSum = unpaid.reduce((s, l) => s + (priceOf(l) || 0), 0);

  const pendingCard = (l) => `
    <div class="lesson">
      <div class="ltitle">${esc(lessonTitle(l))}</div>
      <div class="when">${esc(fRange(l.start_at, l.end_at))} ${T(l.start_at) < now ? '<span class="badge warn">date passée</span>' : ''}</div>
      <div class="whois">${esc(studentName(l))}</div>
      ${metaLine(l)}
      <div class="actions">
        <button class="primary" data-act="accept" data-id="${l.id}">Accepter</button>
        <button data-act="refuse" data-id="${l.id}">Refuser</button>
      </div>
    </div>`;
  const lessonCard = (l, isUpcoming) => `
    <div class="lesson">
      <div class="ltitle">${esc(lessonTitle(l))}</div>
      <div class="when">${esc(fRange(l.start_at, l.end_at))}</div>
      <div class="whois">${esc(studentName(l))}</div>
      ${metaLine(l)}
      ${visioHtml(l)}
      <label class="check"><input type="checkbox" data-act="paid" data-id="${l.id}" ${l.paid ? 'checked' : ''}> Payé</label>
      <label class="notes">Notes de séance
        <textarea rows="2" data-notes="${l.id}" placeholder="Chapitres vus, exercices, devoirs…">${esc(l.notes)}</textarea>
      </label>
      <div class="actions">
        <button data-act="savenotes" data-id="${l.id}">Enregistrer les notes</button>
        <button data-act="edit" data-id="${l.id}">Modifier (titre, lieu, matière, visio)</button>
        ${isUpcoming
          ? `<button class="danger" data-act="cancel" data-id="${l.id}">Annuler le cours</button>`
          : `<button class="danger" data-act="delete" data-id="${l.id}">Supprimer</button>`}
      </div>
    </div>`;
  const closedCard = (l) => `
    <div class="lesson dim"><div class="ltitle">${esc(lessonTitle(l))}</div><div class="when">${esc(fRange(l.start_at, l.end_at))}</div>
    <div class="whois">${esc(studentName(l))} · <span class="badge">${statusLabel[l.status]}</span></div>${metaLine(l)}
    <div class="actions"><button class="danger" data-act="delete" data-id="${l.id}">Supprimer</button></div></div>`;

  $view().innerHTML = `
    <div class="summary">
      <div><strong>${pending.length}</strong> demande(s) en attente</div>
      <div><strong>${upcoming.length}</strong> cours à venir</div>
      <div><strong>${unpaid.length}</strong> cours passé(s) non payé(s)${unpaidSum ? ` · <strong>${esc(eur(unpaidSum))}</strong>` : ''}</div>
    </div>
    <div class="dash-tools">
      <label class="filter">Élève :
        <select id="filter"><option value="">Tous</option>
          ${students.map(([id, n]) => `<option value="${id}" ${S.dashFilter === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
      </label>
      <button class="primary" id="addLesson">+ Ajouter un cours</button>
    </div>
    ${section('Demandes en attente', pending.map(pendingCard), 'Aucune demande en attente.')}
    ${section('Cours à venir', upcoming.map((l) => lessonCard(l, true)), 'Aucun cours programmé.')}
    ${section('Cours passés', past.map((l) => lessonCard(l, false)), 'Aucun cours passé.')}
    <details><summary>Demandes refusées et cours annulés (${closed.length})</summary>${closed.map(closedCard).join('')}</details>`;

  document.getElementById('filter').onchange = (e) => { S.dashFilter = e.target.value; drawAdminDash(); };
  document.getElementById('addLesson').onclick = () => openAddLessonModal(renderDashboard);
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
  const card = (l, withVisio) => `
    <div class="lesson">
      <div class="ltitle">${esc(lessonTitle(l))}</div>
      <div class="when">${esc(fRange(l.start_at, l.end_at))}</div>
      ${metaLine(l)}
      ${withVisio ? visioHtml(l) : ''}
      ${paidBadge(l)}${notes(l)}
    </div>`;
  const pendingCard = (l) => `
    <div class="lesson"><div class="ltitle">${esc(lessonTitle(l))}</div><div class="when">${esc(fRange(l.start_at, l.end_at))}</div>
    ${metaLine(l)}
    <div class="actions"><span class="badge warn">En attente de validation</span>
    <button data-act="withdraw" data-id="${l.id}">Retirer ma demande</button></div></div>`;
  const closedCard = (l) => `<div class="lesson dim"><div class="ltitle">${esc(lessonTitle(l))}</div><div class="when">${esc(fRange(l.start_at, l.end_at))}</div>${metaLine(l)}<span class="badge">${statusLabel[l.status]}</span></div>`;

  $view().innerHTML = `
    ${section('Mes demandes en attente', pending.map(pendingCard), 'Aucune demande en attente.')}
    ${section('Cours programmés', upcoming.map((l) => card(l, true)), 'Aucun cours programmé. Réservez depuis l\'onglet « Réserver ».')}
    ${section('Cours passés', past.map((l) => card(l, false)), 'Aucun cours passé.')}
    <details><summary>Demandes refusées et cours annulés (${closed.length})</summary>${closed.map(closedCard).join('')}</details>`;
  bindDashActions();
}

function bindDashActions() {
  const v = $view();
  const update = async (id, patch, okMsg, rerender = true) => {
    const { error } = await sb.from('lessons').update(patch).eq('id', id);
    if (error) { toast(friendlyErr(error), 'err'); return false; }
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
      case 'edit': openEditLessonModal(S.lessons.find((x) => x.id === id), renderDashboard); break;
      case 'savenotes': {
        const ta = v.querySelector(`textarea[data-notes="${id}"]`);
        await update(id, { notes: ta.value.trim() || null }, 'Notes enregistrées.', false);
        break;
      }
      case 'delete': {
        if (!confirm('Supprimer définitivement ce cours ? Cette action est irréversible.')) break;
        const { error } = await sb.from('lessons').delete().eq('id', id);
        if (error) toast(friendlyErr(error), 'err'); else { toast('Cours supprimé.'); renderDashboard(); }
        break;
      }
      case 'withdraw': {
        if (!confirm('Retirer cette demande ?')) break;
        const { error } = await sb.from('lessons').delete().eq('id', id);
        if (error) toast(friendlyErr(error), 'err'); else { toast('Demande retirée.'); renderDashboard(); }
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
// Profil (élève) et fiche élève (admin)
// ---------------------------------------------------------------------
// Fiche élève : sections « Élève », « Parent », « Remarques ».
const PROFILE_SECTIONS = [
  ['Élève', [
    ['student_name', 'Nom et prénom', 'text'],
    ['phone', 'Téléphone', 'tel'],
    ['student_email', 'E-mail', 'email'],
    ['address', 'Adresse (cours à domicile)', 'textarea'],
    ['level', 'Classe / niveau', 'text'],
  ]],
  ['Parent (si élève mineur)', [
    ['parent_name', 'Nom et prénom', 'text'],
    ['parent_phone', 'Téléphone', 'tel'],
    ['parent_email', 'E-mail', 'email'],
  ]],
  ['Remarques', [
    ['remarks', 'Objectifs, difficultés, informations utiles…', 'textarea'],
  ]],
];
const PROFILE_FIELDS = PROFILE_SECTIONS.flatMap(([, fields]) => fields);
const fieldHtml = (p, [k, l, type], requireName) => (type === 'textarea'
  ? `<label>${l}<textarea name="${k}" rows="${k === 'remarks' ? 3 : 2}">${esc(p[k])}</textarea></label>`
  : `<label>${l}<input type="${type}" name="${k}" value="${esc(p[k])}" ${k === 'student_name' && requireName ? 'required' : ''}></label>`);
const profileFieldsHtml = (p, requireName = true) => PROFILE_SECTIONS.map(([title, fields]) => `
  <fieldset class="psection"><legend>${title}</legend>
    ${fields.map((f) => fieldHtml(p, f, requireName)).join('')}
  </fieldset>`).join('');
const readProfileFields = (fd) => Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, String(fd.get(k) || '').trim() || null]));
// Affichage en lecture (fiche élève côté professeur).
const profileReadHtml = (p) => PROFILE_SECTIONS.map(([title, fields]) => `
  <div class="psection-ro"><h3>${title}</h3>${fields.length === 1
    ? `<p class="ro-text">${esc(p[fields[0][0]]) || '<span class="muted">—</span>'}</p>`
    : `<dl>${fields.filter(([k]) => k !== 'student_name').map(([k, l]) => `<dt>${esc(l)}</dt><dd>${esc(p[k]) || '<span class="muted">—</span>'}</dd>`).join('')}</dl>`}
  </div>`).join('');
const rateText = (r) => (r == null ? 'non renseigné' : `${eur(r)}/h`);

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
        <label>E-mail de connexion<input type="email" value="${esc(p.email)}" disabled></label>
        ${profileFieldsHtml(p)}
        <button class="primary" type="submit">Enregistrer</button>
      </form>
    </section>
    ${passwordForm()}`;
  document.getElementById('profile').onsubmit = async (e) => {
    e.preventDefault();
    const patch = readProfileFields(new FormData(e.target));
    const { error } = await sb.from('profiles').update(patch).eq('id', S.user.id);
    if (error) return toast(friendlyErr(error), 'err');
    Object.assign(S.profile, patch);
    toast('Profil enregistré.');
    renderShell();
  };
  bindPasswordForm();
}

function openEditStudentModal(p, after) {
  openModal({
    title: 'Modifier la fiche élève',
    body: `
      <label>E-mail de connexion<input type="email" value="${esc(p.email)}" disabled></label>
      <label>Tarif horaire (€/h, visible par vous seul)<input type="number" name="hourly_rate" min="0" step="0.5" inputmode="decimal" value="${p.hourly_rate ?? ''}" placeholder="laisser vide si non défini"></label>
      <p class="muted small">Un changement de tarif s'applique aux demandes en attente et aux cours à venir ; les cours passés conservent leur tarif.</p>
      ${profileFieldsHtml(p, false)}`,
    onSubmit: async (fd) => {
      const raw = String(fd.get('hourly_rate') || '').replace(',', '.').trim();
      const patch = { ...readProfileFields(fd), hourly_rate: raw === '' ? null : Number(raw) };
      if (patch.hourly_rate != null && !(patch.hourly_rate >= 0)) throw new Error('Tarif invalide.');
      const { error } = await sb.from('profiles').update(patch).eq('id', p.id);
      if (error) throw error;
      toast('Fiche enregistrée.');
      await after?.();
    },
  });
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
    if (error) return toast(friendlyErr(error), 'err');
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
      if (err) return toast(friendlyErr(err), 'err');
      toast('Invitation révoquée.');
      loadInvitations();
    };
  });
}

async function loadStudents() {
  const box = document.getElementById('studentList');
  let data;
  try { data = await getStudents(); } catch (e) { box.innerHTML = `<p class="error">${esc(errMsg(e))}</p>`; return; }
  if (!data.length) { box.innerHTML = '<p class="muted">Aucun élève pour l\'instant.</p>'; return; }
  box.innerHTML = data.map((p) => `
    <div class="student card">
      <div class="student-head">
        <strong>${esc(p.student_name || '(profil non complété)')}</strong>
        <span class="muted">${esc(p.email)}</span>
      </div>
      <dl>
        <dt>Tarif horaire</dt><dd>${esc(rateText(p.hourly_rate))}</dd>
      </dl>
      <div class="psections">${profileReadHtml(p)}</div>
      <div class="actions">
        <button class="primary" data-editstudent="${p.id}">Modifier la fiche</button>
        <button data-relink="${esc(p.email)}">Générer un lien de connexion (mot de passe oublié)</button>
      </div>
      <div class="relink"></div>
    </div>`).join('');
  box.querySelectorAll('[data-editstudent]').forEach((b) => {
    b.onclick = () => openEditStudentModal(data.find((p) => p.id === b.dataset.editstudent), loadStudents);
  });
  box.querySelectorAll('[data-relink]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      const out = b.closest('.student').querySelector('.relink');
      try {
        showLink(out, await loginLink(b.dataset.relink),
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
