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

// --- Fenêtre modale générique (formulaire)
function openModal({
  title, body, submitLabel = 'Enregistrer', submitClass = 'primary',
  cancelLabel = 'Annuler', closeX = false, onSubmit, onOpen,
}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form class="modal-form" novalidate>
      ${closeX ? '<button type="button" class="modal-x" data-close aria-label="Fermer">×</button>' : ''}
      <h2>${title}</h2>
      ${body}
      <p class="error" data-err></p>
      <div class="actions end">
        ${cancelLabel ? `<button type="button" data-close>${cancelLabel}</button>` : ''}
        <button class="${submitClass}" type="submit">${submitLabel}</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('[data-err]');
  dlg.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dlg.close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
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
    document.getElementById('loginDialog')?.close();
    await enterApp(data.user);
  };
}

// Pop-up d'authentification (connexion / création de compte), ouverte par le bouton en haut à droite.
function authDialogHtml(id, title, inner) {
  return `
    <dialog class="modal auth-modal" id="${id}">
      <div class="modal-form">
        <button type="button" class="modal-x" data-close aria-label="Fermer">×</button>
        <h2>${title}</h2>
        ${inner}
      </div>
    </dialog>`;
}
function bindAuthDialog(id, buttonId, focusSelector) {
  const dlg = document.getElementById(id);
  document.getElementById(buttonId).onclick = () => {
    dlg.showModal();
    dlg.querySelector(focusSelector)?.focus();
  };
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  // Clic sur le fond grisé : fermeture.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  return dlg;
}

function renderLanding() {
  $app.innerHTML = `
    <header class="topbar">
      <div class="brand">${esc(CFG.SITE_TITLE)}</div>
      <nav></nav>
      <div class="who"><button class="primary" id="goLogin">Se connecter</button></div>
    </header>
    <main>${homeHtml()}</main>
    ${authDialogHtml('loginDialog', 'Connexion', loginFormHtml())}`;
  bindAuthDialog('loginDialog', 'goLogin', 'input[name=email]');
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
  // Page d'invitation : présentation + mode d'emploi ; formulaire dans une pop-up.
  const joinForm = `
      <p>Vous avez été invité à l'espace de réservation des cours${CFG.TEACHER_NAME ? ` de ${esc(CFG.TEACHER_NAME)}` : ''}.</p>
      ${warn}
      <form id="join">
        <label>Adresse e-mail (élève ou parent)<input type="email" name="email" required autocomplete="email"></label>
        <label>Mot de passe (8 caractères minimum)<input type="password" name="p1" minlength="8" required autocomplete="new-password"></label>
        <label>Confirmation du mot de passe<input type="password" name="p2" minlength="8" required autocomplete="new-password"></label>
        <button class="primary" type="submit">Créer mon compte</button>
        <p class="error" id="err"></p>
      </form>
      <p class="muted small">Vous avez déjà un compte ? <a href="${esc(location.pathname)}">Se connecter</a></p>`;
  $app.innerHTML = `
    <header class="topbar">
      <div class="brand">${esc(CFG.SITE_TITLE)}</div>
      <nav></nav>
      <div class="who"><button class="primary" id="goJoin">Créer mon compte</button></div>
    </header>
    <main>${homeHtml()}</main>
    ${authDialogHtml('joinDialog', 'Créer votre compte', joinForm)}`;
  const joinDlg = bindAuthDialog('joinDialog', 'goJoin', 'input[name=email]');
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
    joinDlg.close();
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
const DEFAULT_TRAVEL = 45;

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
      ? 'Mode modification : cliquez sur une case (ou cliquez-glissez sur ordinateur) pour la rendre disponible ou indisponible. Les cours et trajets ne sont pas modifiables ici.'
      : 'Cliquez sur un cours pour voir son détail. Cliquez sur le crayon pour modifier vos disponibilités.')
    : 'Cliquez sur un créneau disponible, puis sur un autre plus bas le même jour pour allonger le cours. Cliquez sur un de vos cours pour voir son détail.';
  const legend = S.isAdmin
    ? '<span class="lg open">Disponible</span><span class="lg pending">Demande en attente</span><span class="lg confirmed">Cours programmé</span><span class="lg travel">Trajet</span><span class="lg closed">Indisponible</span>'
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
    // Fenêtre élargie d'un jour : trajets des cours situés juste avant / après la semaine.
    const [av, ls] = await Promise.all([
      sb.from('availability').select('slot_start').gte('slot_start', from).lt('slot_start', to),
      sb.from('lessons').select('*, profiles(student_name,email,travel_minutes)')
        .in('status', ['pending', 'confirmed'])
        .lt('start_at', addDays(S.weekStart, 8).toISOString()).gt('end_at', addDays(S.weekStart, -1).toISOString()),
    ]);
    if (av.error || ls.error) return gridError(av.error || ls.error);
    S.open = new Set(av.data.map((r) => T(r.slot_start)));
    S.weekLessons = ls.data;
  } else {
    const [slots, mine] = await Promise.all([
      sb.rpc('get_slots', { p_from: from, p_to: to }),
      sb.from('lessons').select('*').in('status', ['pending', 'confirmed']).lt('start_at', to).gt('end_at', from),
    ]);
    if (slots.error || mine.error) return gridError(slots.error || mine.error);
    S.slotState = new Map(slots.data.map((r) => [T(r.slot_start), { state: r.state, title: r.title }]));
    S.myLessons = mine.data;
  }
  drawGrid();
}

function gridError(e) {
  const g = document.getElementById('grid');
  if (g) g.innerHTML = `<p class="error pad">Erreur de chargement : ${esc(errMsg(e))}</p>`;
}

const studentName = (l) => l.profiles?.student_name || l.profiles?.email || 'Élève';
const hhmm = (l) => `${fTime(l.start_at)}–${fTime(l.end_at)}`;
const lessonAt = (list, t) => list.find((x) => t >= T(x.start_at) && t < T(x.end_at));
const travelMs = (l) => (l.mode === 'distance' ? 0 : (l.profiles?.travel_minutes ?? DEFAULT_TRAVEL) * 60000);

// Le slot [t, t+30 min[ chevauche-t-il le trajet aller ou retour d'un cours ?
function travelAt(t) {
  const end = t + SLOT_MS;
  return S.weekLessons.some((l) => {
    const tr = travelMs(l);
    if (!tr) return false;
    const s = T(l.start_at), e = T(l.end_at);
    return (t < s && end > s - tr) || (t < e + tr && end > e);
  });
}

// Description d'une case : key (cases fusionnées en bloc si même clé), cls, block, label, sub, lid.
function adminCell(t) {
  const l = lessonAt(S.weekLessons, t);
  if (l) {
    const label = `${lessonTitle(l)} · ${studentName(l)}${l.status === 'pending' ? ' (demande)' : ''}`;
    const tip = [label, fRange(l.start_at, l.end_at), subjectLabel(l), MODES[l.mode], priceText(l)].filter(Boolean).join('\n');
    return { key: 'L' + l.id, cls: l.status, block: true, label, sub: hhmm(l), tip, lid: l.id };
  }
  if (travelAt(t)) return { key: 'travel', cls: 'travel', block: true, label: 'Trajet' };
  const open = S.open.has(t);
  const clickable = S.editMode && t >= Date.now();
  return open
    ? { key: 'open', cls: 'open', block: true, label: 'Disponible', clickable }
    : { key: 'closed', cls: 'closed', block: false, label: '', clickable };
}

// Case élève sans tenir compte de la sélection.
function studentBase(t) {
  const s = S.slotState.get(t);
  const st = s && t >= Date.now() ? s.state : null;   // le passé n'est jamais affiché à l'élève
  if (st === 'free') return { key: 'free', cls: 'open', block: true, label: 'Disponible', clickable: true };
  if (st === 'mine_pending' || st === 'mine_confirmed') {
    const l = lessonAt(S.myLessons || [], t);
    const pending = st === 'mine_pending';
    return {
      key: l ? 'L' + l.id : st, cls: pending ? 'pending' : 'confirmed', block: true,
      label: pending ? 'Demande en attente' : ((s.title && s.title.trim()) || 'Cours'),
      sub: l ? hhmm(l) : '', lid: l?.id,
    };
  }
  return { key: 'unavail', cls: 'unavail', block: false, label: 'Indisponible' };
}

const isSelected = (d, r) => S.selection && S.selection.d === d && r >= S.selection.r0 && r <= S.selection.r1;

function cellInfo(t, d, r) {
  if (S.isAdmin) return adminCell(t);
  if (isSelected(d, r)) {
    const [a, b] = selectionRange();
    return { key: 'sel', cls: 'selected', block: true, label: 'Sélection', sub: `${fTime(a)}–${fTime(b)}`, clickable: true };
  }
  return studentBase(t);
}

function drawGrid() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  const days = weekDays(), rows = days[0].slots.length, now = Date.now(), today = new Date();
  // Description de toutes les cases, colonne par colonne.
  const info = days.map((day, d) => day.slots.map((t, r) => cellInfo(t, d, r)));
  let h = '<table class="grid"><thead><tr><th class="time"></th>';
  h += days.map((d) => `<th class="${sameDay(d.date, today) ? 'today' : ''}">${esc(cap(fDayShort(d.date)))}</th>`).join('');
  h += '</tr></thead><tbody>';
  for (let r = 0; r < rows; r++) {
    const label = r % 2 === 0 ? `${pad(DAY_START + r / 2)}:00` : '';
    h += `<tr class="${r % 2 ? 'half' : 'full'}"><th class="time">${label}</th>`;
    for (let d = 0; d < 7; d++) {
      const t = days[d].slots[r];
      const c = info[d][r];
      const start = r === 0 || info[d][r - 1].key !== c.key;
      const end = r === rows - 1 || info[d][r + 1].key !== c.key;
      const second = !start && r > 0 && (r === 1 || info[d][r - 2].key !== c.key);
      const text = start ? c.label : (second && c.sub ? c.sub : '');
      const cls = ['slot', c.cls,
        c.block ? 'blk' : '', c.block && start ? 'bstart' : '', c.block && end ? 'bend' : '',
        t < now ? 'past' : '', c.clickable ? 'clickable' : '', c.lid ? 'lclick' : '',
        second && c.sub ? 'subline' : ''].filter(Boolean).join(' ');
      h += `<td class="${cls}" data-d="${d}" data-r="${r}" data-t="${t}"${c.lid ? ` data-lid="${c.lid}"` : ''}${c.tip ? ` title="${esc(c.tip)}"` : ''}>${text ? `<span>${esc(text)}</span>` : ''}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  grid.innerHTML = h;
  drawSelBar();
}

// --- Admin : rendre disponible / indisponible (mode modification) ; clic sur un cours
function bindAdminGrid(grid) {
  let paint = null;
  const apply = (td) => {
    const isOpen = td.classList.contains('open');
    if ((paint.mode === 'open') === isOpen) return;
    const open = paint.mode === 'open';
    td.classList.toggle('open', open);
    td.classList.toggle('closed', !open);
    ['blk', 'bstart', 'bend'].forEach((c) => td.classList.toggle(c, open));
    td.innerHTML = open ? '<span>Disponible</span>' : '';
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
  grid.addEventListener('click', (e) => {
    const td = e.target.closest('td[data-lid]');
    if (!td) return;
    const l = S.weekLessons.find((x) => x.id === Number(td.dataset.lid));
    if (l) openLessonPopup(l, loadWeek);
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

// --- Élève : sélection de créneaux contigus puis demande ; clic sur un de ses cours
function bindStudentGrid(grid) {
  grid.addEventListener('click', (e) => {
    const lessonTd = e.target.closest('td[data-lid]');
    if (lessonTd) {
      const l = (S.myLessons || []).find((x) => x.id === Number(lessonTd.dataset.lid));
      if (l) openLessonPopup(l, loadWeek);
      return;
    }
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
    for (let i = lo; i <= hi; i++) if (!studentBase(days[d].slots[i]).clickable) { ok = false; break; }
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

// ---------------------------------------------------------------------
// Fenêtres « cours » : détail, ajout, modification, annulation
// ---------------------------------------------------------------------
async function getStudents() {
  const { data, error } = await sb.from('profiles').select('*').eq('role', 'student');
  if (error) throw error;
  return data.sort((x, y) => (x.student_name || x.email || '').localeCompare(y.student_name || y.email || ''));
}

// Date / heure de début / durée (ajout et déplacement d'un cours).
function scheduleFieldsHtml(start, durMin) {
  const times = [];
  for (let h = 6; h <= 23; h++) for (const m of [0, 30]) times.push(`${pad(h)}:${pad(m)}`);
  const cur = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  if (!times.includes(cur)) times.push(cur);
  times.sort();
  const durs = [];
  for (let m = 30; m <= 360; m += 30) durs.push(m);
  if (!durs.includes(durMin)) { durs.push(durMin); durs.sort((x, y) => x - y); }
  return `
    <div class="row3">
      <label>Date<input type="date" name="date" required value="${isoDate(start)}"></label>
      <label>Début<select name="time">${times.map((t) => `<option ${t === cur ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Durée<select name="dur">${durs.map((m) => `<option value="${m}" ${m === durMin ? 'selected' : ''}>${fDur(m * 60000)}</option>`).join('')}</select></label>
    </div>`;
}
function readSchedule(fd) {
  const start = new Date(`${fd.get('date')}T${fd.get('time')}:00`);
  if (Number.isNaN(start.getTime())) throw new Error('Date invalide.');
  const end = new Date(start.getTime() + Number(fd.get('dur')) * 60000);
  return { start_at: start.toISOString(), end_at: end.toISOString() };
}

async function openAddLessonModal(after) {
  let students;
  try { students = await getStudents(); } catch (e) { return toast(friendlyErr(e), 'err'); }
  if (!students.length) return toast('Aucun élève : invitez d\'abord un élève.', 'err');
  const today = new Date();
  const day = S.weekStart <= today && today < addDays(S.weekStart, 7) ? new Date(today) : new Date(S.weekStart);
  day.setHours(17, 0, 0, 0);
  openModal({
    title: 'Ajouter un cours',
    submitLabel: 'Ajouter le cours',
    body: `
      <label>Élève<select name="student_id" required>
        <option value="">— Choisir —</option>
        ${students.map((s) => `<option value="${s.id}">${esc(s.student_name || s.email)}${s.pending ? ' (compte non créé)' : ''}${s.hourly_rate != null ? ` (${esc(eur(s.hourly_rate))}/h)` : ''}</option>`).join('')}
      </select></label>
      ${scheduleFieldsHtml(day, 60)}
      ${lessonFieldsHtml({}, true)}
      <p class="muted small">Le cours est enregistré directement comme programmé, même en dehors de vos disponibilités.</p>`,
    onOpen: bindLessonFields,
    onSubmit: async (fd) => {
      const { error } = await sb.from('lessons').insert({
        student_id: fd.get('student_id'), status: 'confirmed', ...readSchedule(fd), ...readLessonFields(fd, true),
      });
      if (error) throw error;
      toast('Cours ajouté.');
      await after?.();
    },
  });
}

// Modification complète (admin) : titre, date / heure / durée, lieu, matière, visio, notes, payé.
function openEditLessonModal(l, after) {
  const start = new Date(l.start_at);
  const durMin = Math.round((T(l.end_at) - T(l.start_at)) / 60000);
  openModal({
    title: `Modifier le cours — ${esc(studentName(l))}`,
    closeX: true,
    body: `
      ${lessonFieldsHtml(l, true).replace('<fieldset class="seg"><legend>Lieu', `${scheduleFieldsHtml(start, durMin)}<fieldset class="seg"><legend>Lieu`)}
      <label>Notes de séance<textarea name="notes" rows="4" placeholder="Chapitres vus, exercices, devoirs…">${esc(l.notes)}</textarea></label>
      ${l.status === 'confirmed' ? `<label class="check"><input type="checkbox" name="paid" ${l.paid ? 'checked' : ''}> Payé</label>` : ''}
      <p class="muted small">Le prix est recalculé automatiquement si la durée change.</p>`,
    onOpen: bindLessonFields,
    onSubmit: async (fd) => {
      const patch = {
        ...readLessonFields(fd, true), ...readSchedule(fd),
        notes: String(fd.get('notes') || '').trim() || null,
      };
      if (l.status === 'confirmed') patch.paid = fd.get('paid') === 'on';
      const { error } = await sb.from('lessons').update(patch).eq('id', l.id);
      if (error) throw error;
      toast('Cours modifié.');
      await after?.();
    },
  });
}

// Annulation avec motif (admin).
function openCancelModal(l, after) {
  openModal({
    title: 'Annuler le cours',
    closeX: true,
    cancelLabel: null,
    submitLabel: 'Confirmer l\'annulation',
    submitClass: 'danger-fill',
    body: `
      <p><strong>${esc(studentName(l))}</strong> · ${esc(lessonTitle(l))}<br><span class="muted">${esc(fRange(l.start_at, l.end_at))}</span></p>
      <label>Raison de l'annulation<textarea name="reason" rows="3" maxlength="500" placeholder="ex. élève malade, cours reporté…"></textarea></label>
      <p class="muted small">Le créneau redevient disponible. L'élève verra le cours comme annulé, avec cette raison.</p>`,
    onSubmit: async (fd) => {
      const { error } = await sb.from('lessons')
        .update({ status: 'cancelled', cancel_reason: String(fd.get('reason') || '').trim() || null })
        .eq('id', l.id);
      if (error) throw error;
      toast('Cours annulé.');
      await after?.();
    },
  });
}

async function setLessonStatus(l, status, msg, after) {
  const { error } = await sb.from('lessons').update({ status }).eq('id', l.id);
  if (error) return toast(friendlyErr(error), 'err');
  toast(msg);
  await after?.();
}
async function withdrawRequest(l, after) {
  if (!confirm('Retirer cette demande ?')) return;
  const { error } = await sb.from('lessons').delete().eq('id', l.id);
  if (error) return toast(friendlyErr(error), 'err');
  toast('Demande retirée.');
  await after?.();
}

const statusLabel = { pending: 'Demande en attente', confirmed: 'Cours programmé', refused: 'Demande refusée', cancelled: 'Cours annulé' };

// Détail d'un cours en lecture seule (clic dans le calendrier) ; crayon pour modifier (admin).
function openLessonPopup(l, after) {
  const rows = [
    S.isAdmin ? ['Élève', esc(studentName(l))] : null,
    ['Date', esc(fRange(l.start_at, l.end_at))],
    ['Statut', esc(statusLabel[l.status] || l.status) + (l.status === 'confirmed' ? ` · ${l.paid ? 'payé' : 'non payé'}` : '')],
    subjectLabel(l) ? ['Matière', esc(subjectLabel(l))] : null,
    l.mode ? ['Lieu', esc(MODES[l.mode])] : null,
    priceText(l) ? ['Prix', esc(priceText(l))] : null,
    l.mode === 'distance' ? ['Visio', safeUrl(l.visio_link) ? `<a href="${esc(safeUrl(l.visio_link))}" target="_blank" rel="noopener">Rejoindre la visio</a>` : '<span class="muted">pas encore renseigné</span>'] : null,
    l.notes ? ['Notes', `<span class="prewrap">${esc(l.notes)}</span>`] : null,
  ].filter(Boolean);
  const footer = S.isAdmin
    ? (l.status === 'pending'
      ? '<button data-pop="refuse">Refuser</button><button class="primary" data-pop="accept">Accepter</button>'
      : '<button class="danger" data-pop="cancel">Annuler le cours</button>')
    : (l.status === 'pending' ? '<button data-pop="withdraw">Retirer ma demande</button>' : '');
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <div class="modal-form">
      <div class="info-head">
        <h2>${esc(lessonTitle(l))}</h2>
        <div class="info-tools">
          ${S.isAdmin ? `<button class="icon-only" data-pop="edit" title="Modifier le cours" aria-label="Modifier le cours">${PENCIL}</button>` : ''}
          <button class="icon-only close-x" data-pop="close" aria-label="Fermer">×</button>
        </div>
      </div>
      <dl class="info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${footer ? `<div class="actions end">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) return dlg.close();
    const b = e.target.closest('[data-pop]');
    if (!b) return;
    const act = b.dataset.pop;
    dlg.close();
    if (act === 'edit') openEditLessonModal(l, after);
    else if (act === 'cancel') openCancelModal(l, after);
    else if (act === 'accept') await setLessonStatus(l, 'confirmed', 'Cours confirmé.', after);
    else if (act === 'refuse') { if (confirm('Refuser cette demande ? Le créneau redeviendra libre.')) await setLessonStatus(l, 'refused', 'Demande refusée.', after); }
    else if (act === 'withdraw') await withdrawRequest(l, after);
  });
  dlg.showModal();
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
const metaLine = (l) => { const m = lessonMeta(l); return m ? `<div class="meta">${m}</div>` : ''; };
const shortRange = (l) => `${cap(fDayShort(l.start_at))} · ${hhmm(l)} (${fDur(T(l.end_at) - T(l.start_at))})`;
const cardsHtml = (items, empty) => (items.length ? `<div class="cards">${items.join('')}</div>` : `<p class="muted">${empty}</p>`);
const sectionHtml = (title, items, empty) =>
  `<section><h2>${title} <span class="count">${items.length}</span></h2>${cardsHtml(items, empty)}</section>`;
const foldHtml = (title, items, empty) =>
  `<details class="fold"><summary>${title} <span class="count">${items.length}</span></summary>${cardsHtml(items, empty)}</details>`;

// Carte de cours condensée. Admin : l'élève en titre ; élève : le titre de la séance.
function lessonCard(l, kind) {
  const now = Date.now();
  const main = S.isAdmin ? studentName(l) : lessonTitle(l);
  const sub = S.isAdmin ? `${lessonTitle(l)} · ${shortRange(l)}` : shortRange(l);
  const canEdit = S.isAdmin && kind !== 'closed';
  let foot = '';
  if (S.isAdmin) {
    if (kind === 'pending') {
      foot = `${T(l.start_at) < now ? '<span class="badge warn">date passée</span>' : ''}
        <span class="grow"></span>
        <button data-act="refuse" data-id="${l.id}">Refuser</button>
        <button class="primary" data-act="accept" data-id="${l.id}">Accepter</button>`;
    } else if (kind === 'closed') {
      foot = `<span class="badge">${statusLabel[l.status]}</span><span class="grow"></span>
        <button class="danger" data-act="delete" data-id="${l.id}">Supprimer</button>`;
    } else {
      foot = `<label class="check"><input type="checkbox" data-act="paid" data-id="${l.id}" ${l.paid ? 'checked' : ''}> Payé</label>
        <span class="grow"></span>
        <button class="danger" data-act="cancel" data-id="${l.id}">Annuler le cours</button>`;
    }
  } else if (kind === 'pending') {
    foot = `<span class="badge warn">En attente de validation</span><span class="grow"></span>
      <button data-act="withdraw" data-id="${l.id}">Retirer ma demande</button>`;
  } else if (kind === 'closed') {
    foot = `<span class="badge">${statusLabel[l.status]}</span>`;
  } else {
    foot = paidBadge(l);
  }
  return `
    <div class="lcard ${kind}">
      <div class="lcard-head">
        <div class="lcard-main">
          <div class="lcard-title">${esc(main)}</div>
          <div class="lcard-sub">${esc(sub)}</div>
        </div>
        ${canEdit ? `<button class="icon-only" data-act="edit" data-id="${l.id}" title="Modifier (informations et notes)" aria-label="Modifier">${PENCIL}</button>` : ''}
      </div>
      ${metaLine(l)}
      ${kind === 'upcoming' || (kind === 'past' && S.isAdmin) ? visioHtml(l) : ''}
      ${l.notes && kind !== 'pending' ? `<div class="lcard-notes" title="Notes de séance">${esc(l.notes)}</div>` : ''}
      ${l.status === 'cancelled' && l.cancel_reason ? `<div class="lcard-reason">Motif : ${esc(l.cancel_reason)}</div>` : ''}
      <div class="lcard-foot">${foot}</div>
    </div>`;
}

function splitLessons(L) {
  const now = Date.now();
  return {
    pending: L.filter((l) => l.status === 'pending'),
    upcoming: L.filter((l) => l.status === 'confirmed' && T(l.end_at) >= now),
    past: L.filter((l) => l.status === 'confirmed' && T(l.end_at) < now).reverse(),
    closed: L.filter((l) => l.status === 'refused' || l.status === 'cancelled').reverse(),
  };
}

function drawAdminDash() {
  const all = S.lessons;
  const students = [...new Map(all.map((l) => [l.student_id, studentName(l)])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const { pending, upcoming, past, closed } = splitLessons(S.dashFilter ? all.filter((l) => l.student_id === S.dashFilter) : all);
  const unpaid = past.filter((l) => !l.paid);
  const unpaidSum = unpaid.reduce((s, l) => s + (priceOf(l) || 0), 0);

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
    </div>
    ${sectionHtml('Demandes en attente', pending.map((l) => lessonCard(l, 'pending')), 'Aucune demande en attente.')}
    ${sectionHtml('Cours à venir', upcoming.map((l) => lessonCard(l, 'upcoming')), 'Aucun cours programmé.')}
    ${foldHtml('Cours passés', past.map((l) => lessonCard(l, 'past')), 'Aucun cours passé.')}
    ${foldHtml('Cours annulés et demandes refusées', closed.map((l) => lessonCard(l, 'closed')), 'Aucun.')}`;

  document.getElementById('filter').onchange = (e) => { S.dashFilter = e.target.value; drawAdminDash(); };
  bindDashActions();
}

function drawStudentDash() {
  const { pending, upcoming, past, closed } = splitLessons(S.lessons);
  $view().innerHTML = `
    ${sectionHtml('Mes demandes en attente', pending.map((l) => lessonCard(l, 'pending')), 'Aucune demande en attente.')}
    ${sectionHtml('Cours programmés', upcoming.map((l) => lessonCard(l, 'upcoming')), 'Aucun cours programmé. Réservez depuis l\'onglet « Réserver ».')}
    ${foldHtml('Cours passés', past.map((l) => lessonCard(l, 'past')), 'Aucun cours passé.')}
    ${foldHtml('Cours annulés et demandes refusées', closed.map((l) => lessonCard(l, 'closed')), 'Aucun.')}`;
  bindDashActions();
}

function bindDashActions() {
  const v = $view();
  // Garde les sections repliées ouvertes après un rafraîchissement.
  const refresh = async () => {
    const open = [...v.querySelectorAll('details.fold')].map((d) => d.open);
    await renderDashboard();
    v.querySelectorAll('details.fold').forEach((d, i) => { if (open[i]) d.open = true; });
  };
  v.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const l = S.lessons.find((x) => x.id === Number(b.dataset.id));
    if (!l) return;
    switch (b.dataset.act) {
      case 'accept': await setLessonStatus(l, 'confirmed', 'Cours confirmé.', refresh); break;
      case 'refuse': if (confirm('Refuser cette demande ? Le créneau redeviendra libre.')) await setLessonStatus(l, 'refused', 'Demande refusée.', refresh); break;
      case 'cancel': openCancelModal(l, refresh); break;
      case 'edit': openEditLessonModal(l, refresh); break;
      case 'withdraw': await withdrawRequest(l, refresh); break;
      case 'delete': {
        if (!confirm('Supprimer définitivement ce cours de la base ? Cette action est irréversible.')) break;
        const { error } = await sb.from('lessons').delete().eq('id', l.id);
        if (error) toast(friendlyErr(error), 'err'); else { toast('Cours supprimé.'); await refresh(); }
        break;
      }
    }
  };
  v.onchange = async (e) => {
    const cb = e.target.closest('input[data-act="paid"]');
    if (!cb) return;
    const id = Number(cb.dataset.id);
    const { error } = await sb.from('lessons').update({ paid: cb.checked }).eq('id', id);
    if (error) { cb.checked = !cb.checked; return toast(friendlyErr(error), 'err'); }
    const l = S.lessons.find((x) => x.id === id); if (l) l.paid = cb.checked;
    toast(cb.checked ? 'Marqué payé.' : 'Marqué non payé.');
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
      <label>E-mail de connexion<input type="text" value="${esc(p.pending ? '(compte pas encore créé)' : p.email)}" disabled></label>
      <label>Tarif horaire (€/h, visible par vous seul)<input type="number" name="hourly_rate" min="0" step="0.5" inputmode="decimal" value="${p.hourly_rate ?? ''}" placeholder="laisser vide si non défini"></label>
      <p class="muted small">Un changement de tarif s'applique aux demandes en attente et aux cours à venir ; les cours passés conservent leur tarif.</p>
      <label>Temps de trajet (minutes, aller et retour chacun ; visible par vous seul)<input type="number" name="travel_minutes" min="0" max="240" step="5" required value="${p.travel_minutes ?? 45}"></label>
      <p class="muted small">Bloqué avant et après chaque cours à domicile (affiché « Trajet » dans votre calendrier, indisponible pour les élèves). 0 = pas de trajet.</p>
      ${profileFieldsHtml(p, false)}`,
    onSubmit: async (fd) => {
      const raw = String(fd.get('hourly_rate') || '').replace(',', '.').trim();
      const travel = Number(fd.get('travel_minutes'));
      const patch = { ...readProfileFields(fd), hourly_rate: raw === '' ? null : Number(raw), travel_minutes: travel };
      if (patch.hourly_rate != null && !(patch.hourly_rate >= 0)) throw new Error('Tarif invalide.');
      if (!(travel >= 0 && travel <= 240)) throw new Error('Temps de trajet invalide (0 à 240 min).');
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
        <input type="text" name="name" required maxlength="80" placeholder="Nom de l'élève (ex. Léa Martin)">
        <button class="primary" type="submit">Créer l'élève et générer le lien</button>
      </form>
      <p class="muted small">L'élève apparaît tout de suite dans la liste ci-dessous : vous pouvez remplir sa fiche, fixer son tarif et lui programmer des cours avant qu'il crée son compte. Tout lui sera rattaché dès qu'il utilisera le lien.</p>
      <div id="inviteLink"></div>
    </section>
    <section id="legacyInvSection" hidden>
      <h2>Autres invitations en attente</h2>
      <div id="pendingInv"></div>
    </section>
    <section>
      <h2>Élèves</h2>
      <div id="studentList"><p class="muted">Chargement…</p></div>
    </section>
    ${passwordForm()}`;

  document.getElementById('invite').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const name = String(new FormData(e.target).get('name') || '').trim();
    if (!name) return;
    btn.disabled = true;
    try {
      const data = await callInvite({ action: 'create_invite', name });
      showLink(document.getElementById('inviteLink'), joinLink(data.token),
        `Lien d'invitation pour <strong>${esc(name)}</strong> :`,
        'Envoyez ce lien vous-même (SMS, WhatsApp…). L\'élève y saisira son adresse e-mail et choisira son mot de passe. Usage unique, valable 7 jours.');
      e.target.reset();
      loadStudents();
    } catch (err) { toast(errMsg(err), 'err'); }
    btn.disabled = false;
  };
  bindPasswordForm();
  loadStudents();
}

// Invitations non rattachées à un élève (créées avant la V3).
function renderLegacyInvitations(list) {
  const section = document.getElementById('legacyInvSection');
  const box = document.getElementById('pendingInv');
  const now = Date.now();
  const valid = list.filter((i) => !i.profile_id && T(i.expires_at) > now);
  section.hidden = !valid.length;
  box.innerHTML = valid.map((i) => `
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
      loadStudents();
    };
  });
}

async function loadStudents() {
  const box = document.getElementById('studentList');
  let data;
  try { data = await getStudents(); } catch (e) { box.innerHTML = `<p class="error">${esc(errMsg(e))}</p>`; return; }
  const { data: invs, error: invErr } = await sb.from('invitations').select('*')
    .is('used_at', null).order('created_at', { ascending: false });
  if (invErr) { box.innerHTML = `<p class="error">${esc(errMsg(invErr))}</p>`; return; }
  renderLegacyInvitations(invs);
  // Dernière invitation non utilisée de chaque élève en attente.
  const invOf = new Map();
  for (const i of invs) if (i.profile_id && !invOf.has(i.profile_id)) invOf.set(i.profile_id, i);

  if (!data.length) { box.innerHTML = '<p class="muted">Aucun élève pour l\'instant.</p>'; return; }
  const now = Date.now();
  const inviteBlock = (p) => {
    const inv = invOf.get(p.id);
    const valid = inv && T(inv.expires_at) > now;
    return `
      <div class="invite-status">
        <span>${valid ? `Lien d'invitation valable jusqu'au ${esc(fDate(inv.expires_at))}.` : 'Lien d\'invitation expiré ou absent.'}</span>
        ${valid ? `<button data-copyinv="${esc(inv.token)}">Copier le lien d'invitation</button>` : ''}
        <button data-renew="${p.id}">Générer un nouveau lien</button>
      </div>`;
  };
  box.innerHTML = data.map((p) => `
    <div class="student card" data-id="${p.id}">
      <div class="student-head">
        <strong>${esc(p.student_name || '(profil non complété)')}</strong>
        ${p.pending ? '<span class="badge warn">Compte non créé</span>' : `<span class="muted">${esc(p.email)}</span>`}
      </div>
      ${p.pending ? inviteBlock(p) : ''}
      <dl>
        <dt>Tarif horaire</dt><dd>${esc(rateText(p.hourly_rate))}</dd>
        <dt>Temps de trajet</dt><dd>${esc(String(p.travel_minutes ?? 45))} min (aller et retour, cours à domicile)</dd>
      </dl>
      <div class="psections">${profileReadHtml(p)}</div>
      <div class="actions">
        <button class="primary" data-editstudent="${p.id}">Modifier la fiche</button>
        ${p.pending ? '' : `<button data-relink="${esc(p.email)}">Générer un lien de connexion (mot de passe oublié)</button>`}
        <button class="danger" data-delstudent="${p.id}">Supprimer l'élève</button>
      </div>
      <div class="relink"></div>
    </div>`).join('');

  const byId = (id) => data.find((p) => p.id === id);
  const outOf = (b) => b.closest('.student').querySelector('.relink');
  box.querySelectorAll('[data-editstudent]').forEach((b) => {
    b.onclick = () => openEditStudentModal(byId(b.dataset.editstudent), loadStudents);
  });
  box.querySelectorAll('[data-copyinv]').forEach((b) => { b.onclick = () => copyText(joinLink(b.dataset.copyinv)); });
  box.querySelectorAll('[data-renew]').forEach((b) => {
    b.onclick = async () => {
      const p = byId(b.dataset.renew);
      b.disabled = true;
      // L'ancien lien non utilisé est remplacé par le nouveau.
      await sb.from('invitations').delete().eq('profile_id', p.id).is('used_at', null);
      const { data: inv, error } = await sb.from('invitations')
        .insert({ label: p.student_name, profile_id: p.id }).select('token').single();
      b.disabled = false;
      if (error) return toast(friendlyErr(error), 'err');
      await loadStudents();
      const card = box.querySelector(`.student[data-id="${p.id}"]`);
      if (card) {
        showLink(card.querySelector('.relink'), joinLink(inv.token),
          `Nouveau lien d'invitation pour <strong>${esc(p.student_name || '')}</strong> :`,
          'L\'ancien lien ne fonctionne plus. Usage unique, valable 7 jours.');
      }
    };
  });
  box.querySelectorAll('[data-relink]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        showLink(outOf(b), await loginLink(b.dataset.relink),
          `Lien de connexion pour <strong>${esc(b.dataset.relink)}</strong> :`,
          'L\'élève sera connecté puis invité à choisir un nouveau mot de passe. Usage unique, valable 24 h (réglage Supabase).');
      } catch (err) { toast(errMsg(err), 'err'); }
      b.disabled = false;
    };
  });
  box.querySelectorAll('[data-delstudent]').forEach((b) => {
    b.onclick = async () => {
      const p = byId(b.dataset.delstudent);
      const name = p.student_name || p.email;
      if (!confirm(`Supprimer définitivement ${name} ?\n\nSon compte, sa fiche et tous ses cours (passés, à venir et demandes) seront supprimés. Cette action est irréversible.`)) return;
      b.disabled = true;
      try {
        await callInvite({ action: 'delete_student', id: p.id });
        toast(`${name} a été supprimé.`);
        loadStudents();
      } catch (err) { toast(errMsg(err), 'err'); b.disabled = false; }
    };
  });
}

// Lien collé dans un onglet déjà ouvert sur le site.
window.addEventListener('hashchange', () => { if (/(invite|join)=/.test(location.hash)) boot(); });

boot();
