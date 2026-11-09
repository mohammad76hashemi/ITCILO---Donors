/* DATA LAYER
   ------------------------------------------------------------------
   Submissions, approvals, filter settings and profile edits are saved:
   - ON THE SERVER when the site is started with `python3 server.py`.
     Everyone who opens the site sees the same data, and it survives
     closing the browser. It is stored in server-data/store.json.
   - IN THIS BROWSER ONLY when the site is opened another way (for
     example `python -m http.server` or GitHub Pages). Same as the old demo.

   The login is still a demo: accounts are listed below and passwords are
   not secure. The login session is always kept in the browser.

   app.js and portal.js only use the functions exported at the bottom,
   so a real backend (for example Supabase) can replace this file later.
   ------------------------------------------------------------------ */
(() => {
'use strict';

const DEMO_USERS = {
  'student@demo.org': { password: 'demo', name: 'Demo Student', role: 'student' },
  'admin@demo.org':   { password: 'demo', name: 'Course Admin', role: 'admin' }
};
const KEYS = { session: 'dpe.session', subs: 'dpe.submissions', config: 'dpe.filterConfig', overrides: 'dpe.profileOverrides', siteText: 'dpe.siteText' };
const SHARED = new Set([KEYS.subs, KEYS.config, KEYS.overrides, KEYS.siteText]);   // saved on the server when there is one
const memory = {};
const cache = {}, revs = {};       // server copy of the shared keys and their revision numbers
let remote = false;

const changed = key => window.dispatchEvent(new CustomEvent('store:change', { detail: { key } }));
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

/* ---------- server connection ---------- */
async function pull() {
  const res = await fetch('api/store', { cache: 'no-store' });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error('No server');
  const db = await res.json();
  const changedKeys = [];
  for (const key of SHARED) {
    const rev = db.revs?.[key] || 0;
    if (rev !== revs[key]) changedKeys.push(key);
    revs[key] = rev;
    cache[key] = db.values?.[key] ?? null;
  }
  const donorsRev = db.revs?.donors || 0;           // data/donors.json changed on the server
  if (donorsRev !== revs.donors) changedKeys.push('donors');
  revs.donors = donorsRev;
  return changedKeys;
}
const ready = (async () => {
  try { await pull(); remote = true; } catch { remote = false; }
})();

/* Check the server now and then, so a new submission reaches the admin without reloading */
async function poll() {
  if (!remote || document.hidden) return;
  try { (await pull()).forEach(changed); } catch { /* server stopped: keep last copy */ }
}
setInterval(poll, 10000);
window.addEventListener('focus', poll);

/* ---------- read / write ---------- */
function read(key, fallback) {
  if (remote && SHARED.has(key)) return clone(cache[key]) ?? fallback;
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : (key in memory ? memory[key] : fallback); }
  catch { return key in memory ? memory[key] : fallback; }
}
async function write(key, value) {
  if (remote && SHARED.has(key)) {
    let res;
    try {
      res = await fetch('api/store/' + encodeURIComponent(key), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, rev: revs[key] || 0 })
      });
    } catch { throw new Error('Cannot reach the server. No changes were saved.'); }
    if (res.status === 409) {
      await pull().catch(() => {}); changed(key);
      throw new Error('Someone else saved a change at the same time. The page has been refreshed: please try again.');
    }
    if (!res.ok) throw new Error('The server could not save this change.');
    revs[key] = (await res.json()).rev;
    cache[key] = clone(value);
  } else {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch { throw new Error('Cannot save: browser storage is blocked or full. No changes were saved.'); }
    memory[key] = value;
  }
  changed(key);
}
/* Before changing shared data, get the latest copy from the server */
const fresh = async () => { if (remote) await pull().catch(() => {}); };

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- login (demo) ---------- */
async function currentUser() {
  try { const v = localStorage.getItem(KEYS.session); return v ? JSON.parse(v) : (memory[KEYS.session] || null); }
  catch { return memory[KEYS.session] || null; }
}
function setSession(s) {
  memory[KEYS.session] = s;
  try { s ? localStorage.setItem(KEYS.session, JSON.stringify(s)) : localStorage.removeItem(KEYS.session); } catch {}
  changed(KEYS.session);
}
async function login(email, password) {
  const e = String(email || '').trim().toLowerCase();
  let u = DEMO_USERS[e];
  // In the demo, any other email with the password "demo" logs in as a participant
  if (!u && password === 'demo' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) u = { password: 'demo', name: e.split('@')[0], role: 'student' };
  if (!u || u.password !== password) throw new Error('Email or password is incorrect.');
  const session = { email: e, name: u.name, role: u.role };
  setSession(session);
  return session;
}
async function logout() { setSession(null); }
const requireAdmin = async (msg) => {
  const user = await currentUser();
  if (user?.role !== 'admin') throw new Error(msg);
  return user;
};

/* ---------- participant submissions ---------- */
/* who = { name, studentId } typed by the participant in the card form */
function cleanWho(who, user) {
  const name = String(who?.name || '').trim(), studentId = String(who?.studentId || '').trim();
  if (!name || !studentId) throw new Error('Please enter your full name and student ID.');
  return { userName: name.slice(0, 120), studentId: studentId.slice(0, 40) };
}
async function submit(card, who) {
  const user = await currentUser();
  if (!user) throw new Error('Please log in first.');
  const w = cleanWho(who, user);
  await fresh();
  const subs = read(KEYS.subs, []);
  const rec = {
    id: newId(), status: 'pending', card, version: 1,
    userEmail: user.email, ...w,
    submittedAt: new Date().toISOString(), reviewedAt: null, reviewer: null, note: ''
  };
  subs.push(rec);
  await write(KEYS.subs, subs);
  return rec;
}
async function mySubmissions() {
  const user = await currentUser();
  if (!user) return [];
  return read(KEYS.subs, []).filter(s => s.userEmail === user.email).reverse();
}
async function allSubmissions() {
  await requireAdmin('Only admins can see this.');
  return read(KEYS.subs, []).slice().reverse();
}
async function review(id, decision, note) {
  const user = await requireAdmin('Only admins can review submissions.');
  await fresh();
  const subs = read(KEYS.subs, []);
  const s = subs.find(x => x.id === id);
  if (!s) throw new Error('Submission not found.');
  if (!['approve', 'reject'].includes(decision)) throw new Error('Invalid review decision.');
  if (s.status !== 'pending') throw new Error('This card is no longer waiting for review.');
  recordHistory(s, 'review:' + decision, user);
  s.status = decision === 'approve' ? 'approved' : 'rejected';
  s.note = note || '';
  s.reviewer = user.email;
  s.reviewedAt = new Date().toISOString();
  await write(KEYS.subs, subs);
  return s;
}
async function approvedSubmissions() {
  return read(KEYS.subs, []).filter(s => s.status === 'approved');
}
function recordHistory(s, action, user) {
  s.history = Array.isArray(s.history) ? s.history : [];
  const previous = { ...s }; delete previous.history;
  s.history.push({ action, at: new Date().toISOString(), by: user.email, previous: clone(previous) });
}
function validateCard(card) {
  if (!card || !String(card.name || '').trim() || !String(card.type || '').trim())
    throw new Error('Donor name and type are required.');
  if (!Array.isArray(card.sdgs) || !card.sdgs.length || card.sdgs.some(n => !Number.isInteger(n) || n < 1 || n > 17))
    throw new Error('Select valid SDGs.');
}
async function updateSubmission(id, card, expectedVersion, who) {
  const user = await currentUser();
  if (!user) throw new Error('Please log in first.');
  validateCard(card);
  const w = user.role !== 'admin' ? cleanWho(who, user) : null;
  await fresh();
  const subs = read(KEYS.subs, []), s = subs.find(x => x.id === id);
  if (!s) throw new Error('Submission not found.');
  if (expectedVersion !== undefined && (s.version || 1) !== expectedVersion)
    throw new Error('This card changed after you opened it. Close and reopen the editor.');
  const admin = user.role === 'admin';
  if (!admin && (s.userEmail !== user.email || s.status !== 'rejected'))
    throw new Error('You can only resubmit your own returned cards.');
  recordHistory(s, admin ? 'admin-edit' : 'resubmit', user);
  s.card = { ...s.card, ...card };
  s.version = (s.version || 1) + 1;
  s.updatedAt = new Date().toISOString(); s.updatedBy = user.email;
  if (!admin) {
    Object.assign(s, w);
    s.status = 'pending'; s.resubmittedAt = s.updatedAt;
    s.note = ''; s.reviewer = null; s.reviewedAt = null;
  }
  await write(KEYS.subs, subs);
  return s;
}

/* ---------- course-team profiles: edit, add, delete ----------
   With server.py: written straight into data/donors.json (backups in server-data/backups/).
   Without it: kept in this browser as overrides { profile, revision } or { deleted: true }. */
async function changeDonorFile(id, action, profile) {
  const user = await requireAdmin('Only admins can change library profiles.');
  let res;
  try {
    res = await fetch('api/donors/' + encodeURIComponent(id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, profile, rev: revs.donors || 0, by: user.email })
    });
  } catch { throw new Error('Cannot reach the server. No changes were saved.'); }
  if (res.status === 409) {
    await pull().catch(() => {}); changed('donors');
    throw new Error('Someone else changed the profiles at the same time. The page has been refreshed: please try again.');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The server could not save this change.');
  revs.donors = (await res.json()).rev;
  changed('donors');
}
const donorsVersion = () => revs.donors || 0;
async function getProfileOverrides() { return remote ? {} : read(KEYS.overrides, {}); }
function nextOverride(old, user, extra) {
  const history = old?.history || [];
  if (old) { const previous = { ...old }; delete previous.history; history.push(previous); }
  return { ...extra, revision: (old?.revision || 0) + 1, updatedAt: new Date().toISOString(), updatedBy: user.email, history };
}
async function saveProfile(id, profile, expectedRevision) {
  const user = await requireAdmin('Only admins can edit library profiles.');
  if (!id || !String(profile.name || '').trim()) throw new Error('Profile name is required.');
  if (remote) return changeDonorFile(id, 'save', profile);
  await fresh();
  const overrides = read(KEYS.overrides, {}), old = overrides[id];
  if (expectedRevision !== undefined && (old?.revision || 0) !== expectedRevision)
    throw new Error('This profile changed. Close and reopen the editor.');
  overrides[id] = nextOverride(old, user, { profile: { ...profile, id } });
  await write(KEYS.overrides, overrides);
}
async function deleteProfile(id) {
  const user = await requireAdmin('Only admins can delete library profiles.');
  if (remote) return changeDonorFile(id, 'delete');
  await fresh();
  const overrides = read(KEYS.overrides, {});
  overrides[id] = nextOverride(overrides[id], user, { deleted: true });
  await write(KEYS.overrides, overrides);
}

/* ---------- data left in this browser from before the server was used ---------- */
function readLocal(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }
function dropLocal(key) { try { localStorage.removeItem(key); } catch {} delete memory[key]; }
async function browserLeftovers() {
  if (!remote) return null;
  const profiles = Object.keys(readLocal(KEYS.overrides) || {}).length, submissions = (readLocal(KEYS.subs) || []).length;
  return profiles || submissions ? { profiles, submissions } : null;
}
async function moveLeftovers() {
  await requireAdmin('Only admins can do this.');
  if (!remote) throw new Error('Start the site with server.py first.');
  for (const [id, o] of Object.entries(readLocal(KEYS.overrides) || {})) {
    try {
      if (o.deleted) await changeDonorFile(id, 'delete');
      else if (o.profile) await changeDonorFile(id, 'save', o.profile);
    } catch (ex) { if (!/not found/i.test(ex.message)) throw ex; }
  }
  dropLocal(KEYS.overrides);
  const local = readLocal(KEYS.subs) || [];
  if (local.length) {
    await fresh();
    const subs = read(KEYS.subs, []), ids = new Set(subs.map(s => s.id));
    local.forEach(s => { if (!ids.has(s.id)) subs.push(s); });
    await write(KEYS.subs, subs);
  }
  dropLocal(KEYS.subs);
  const cfg = readLocal(KEYS.config);
  if (cfg && !read(KEYS.config, null)) await write(KEYS.config, cfg);
  dropLocal(KEYS.config);
  changed('donors');
}

/* ---------- filter settings ---------- */
async function getFilterConfig() {
  return read(KEYS.config, null) || DPE.DEFAULT_FILTERS.map(f => ({ ...f }));
}
async function saveFilterConfig(cfg) {
  await requireAdmin('Only admins can change filters.');
  await fresh();
  await write(KEYS.config, cfg);
}
async function resetFilterConfig() {
  await requireAdmin('Only admins can change filters.');
  await fresh();
  await write(KEYS.config, null);
}

/* ---------- footer text (data source, disclaimer) ----------
   null = use the text from data/donors.json "meta" */
async function getSiteText() {
  return read(KEYS.siteText, null);
}
async function saveSiteText(text) {
  const user = await requireAdmin('Only admins can edit the footer.');
  const clean = v => String(v ?? '').trim().slice(0, 2000);
  await fresh();
  await write(KEYS.siteText, text == null ? null
    : { sourceNote: clean(text.sourceNote), disclaimer: clean(text.disclaimer), updatedAt: new Date().toISOString(), updatedBy: user.email });
}

/* Every exported function waits until we know whether a server is there */
const api = {
  currentUser, login, logout,
  submit, mySubmissions, allSubmissions, review, approvedSubmissions, updateSubmission,
  getProfileOverrides, saveProfile, deleteProfile, donorsVersion,
  browserLeftovers, moveLeftovers,
  getFilterConfig, saveFilterConfig, resetFilterConfig,
  getSiteText, saveSiteText
};
window.Store = Object.fromEntries(Object.entries(api).map(([k, fn]) => [k, async (...a) => { await ready; return fn(...a); }]));
window.Store.isDemo = true;              // logins are demo accounts
window.Store.ready = ready;
Object.defineProperty(window.Store, 'onServer', { get: () => remote });
window.Store.whereSaved = () => remote ? 'Saved in the database.' : 'Not saved to the database: the site is open without its server.';

/* Keep two open tabs in sync (browser-only mode) */
window.addEventListener('storage', e => {
  if (e.key === KEYS.session || (!remote && Object.values(KEYS).includes(e.key))) changed(e.key);
});
})();
