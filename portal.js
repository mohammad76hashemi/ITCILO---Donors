/* ACCOUNT FEATURES: login, Donor Profile Card form, my submissions,
   admin review (approve / return) and admin filter management. */
(() => {
'use strict';
const { h, arr, SDG } = DPE;
const $ = s => document.querySelector(s);
let user = null;
let editingSubmission = null;

/* ---------- helpers ---------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const STATUS = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Returned' };
const badge = s => h('span', { class: `status status-${s}`, text: STATUS[s] || s });

/* Close buttons and backdrop clicks for every dialog */
document.querySelectorAll('dialog.modal').forEach(d => {
  d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
});

/* ---------- top bar ---------- */
async function renderAccount() {
  user = await Store.currentUser();
  const nav = $('#account');
  nav.replaceChildren();
  if (!user) {
    nav.append(h('button', { type: 'button', class: 'top-btn solid', onclick: openLogin }, 'Log in'));
    return;
  }
  nav.append(h('button', { type: 'button', class: 'top-btn solid', onclick: () => openForm() }, '+ Submit a donor card'));
  if (user.role === 'admin') {
    const pending = (await Store.allSubmissions()).filter(s => s.status === 'pending').length;
    nav.append(
      h('button', { type: 'button', class: 'top-btn', onclick: () => openReview('pending') }, 'Review',
        pending ? h('span', { class: 'top-count', text: pending, 'aria-label': `${pending} waiting` }) : null),
      h('button', { type: 'button', class: 'top-btn', onclick: () => window.dispatchEvent(new CustomEvent('dpe:new-profile')) }, '+ Add profile'),
      h('button', { type: 'button', class: 'top-btn', onclick: openFilters }, 'Manage filters'));
  } else {
    const mine = await Store.mySubmissions();
    const returned = mine.filter(s => s.status === 'rejected').length;
    nav.append(h('button', { type: 'button', class: 'top-btn', onclick: openMine }, 'My submissions',
      returned ? h('span', { class: 'top-count alert', text: `${returned} returned`, title: 'Returned by the reviewer: open to edit and resubmit' })
        : mine.length ? h('span', { class: 'top-count', text: mine.length }) : null));
    if (returned && !renderAccount.told?.has(user.email)) {
      (renderAccount.told ||= new Set()).add(user.email);
      toast(`${returned} of your cards ${returned === 1 ? 'was' : 'were'} returned. Open “My submissions” to edit and resubmit.`);
    }
  }
  nav.append(h('span', { class: 'top-user', title: user.email },
    h('span', { class: 'avatar', 'aria-hidden': 'true', text: (user.name || user.email)[0].toUpperCase() }),
    h('span', { class: 'top-name', text: user.name }),
    user.role === 'admin' ? h('span', { class: 'role', text: 'Admin' }) : null));
  nav.append(h('button', { type: 'button', class: 'top-btn link', onclick: logout }, 'Log out'));
  renderModeBanner();
}

/* Warn logged-in people when nothing reaches the database, and offer to move old browser-only edits into it */
async function renderModeBanner() {
  const b = $('#mode-banner');
  b.className = 'mode-banner';
  if (!user) { b.hidden = true; return; }
  if (!Store.onServer) {
    b.classList.add('is-warning');
    b.replaceChildren(h('div', { class: 'wrap' },
      h('strong', { text: 'Not connected to the database. ' }),
      user.role === 'admin'
        ? 'The site is open without its server, so changes stay in this browser only. Close this page and double-click start.command in the project folder (or run python3 server.py).'
        : 'Anything you submit now stays in this browser and will not reach the course team. Please use the link the course team gave you.'));
    b.hidden = false;
    return;
  }
  const left = user.role === 'admin' && await Store.browserLeftovers();
  if (!left) { b.hidden = true; return; }
  const parts = [left.profiles ? `${left.profiles} profile change${left.profiles === 1 ? '' : 's'}` : '', left.submissions ? `${left.submissions} submission${left.submissions === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const btn = h('button', { type: 'button', class: 'btn primary', text: 'Move them into the database', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Moving…';
    try { await Store.moveLeftovers(); toast('Done. Everything is now saved in the database.'); renderModeBanner(); }
    catch (ex) { btn.disabled = false; btn.textContent = 'Move them into the database'; toast(ex.message); }
  } });
  b.replaceChildren(h('div', { class: 'wrap banner-row' },
    h('p', {}, h('strong', { text: 'This browser still has ' + parts + ' ' }), 'saved before the server was running. They are not in the database yet.'), btn));
  b.hidden = false;
}

/* ---------- login ---------- */
function openLogin() {
  $('#login-error').hidden = true;
  $('#login-dlg').showModal();
  $('#login-email').focus();
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-error');
  const email = $('#login-email').value, pw = $('#login-password').value;
  if (!email || !pw) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
  try {
    const u = await Store.login(email, pw);
    $('#login-dlg').close();
    $('#login-form').reset();
    toast(`Logged in as ${u.name}`);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});
async function logout() {
  await Store.logout();
  toast('Logged out');
}

/* ---------- Donor Profile Card form ---------- */
(() => {
  const picker = $('#sdg-picker');
  Object.entries(SDG).forEach(([n, name]) => picker.append(
    h('label', { class: 'sdg-opt' },
      h('input', { type: 'checkbox', name: 'sdgs', value: n }),
      h('span', { class: 'sdg-num', text: n }),
      h('span', { class: 'sdg-name', text: name }))));
})();

async function openForm(submission = null) {
  if (!user) { openLogin(); return; }
  editingSubmission = submission;
  const form = $('#card-form');
  form.reset();
  /* "About you": the participant's name and student ID. Pre-filled from their last card.
     When an admin edits someone's card, the participant's details are shown read-only instead. */
  const adminEditing = submission && user.role === 'admin';
  $('#about-you').hidden = !!adminEditing;
  form.querySelectorAll('[data-who]').forEach(i => { i.required = !adminEditing; });
  $('#who-readonly').hidden = !adminEditing;
  if (adminEditing) $('#who-readonly').replaceChildren(h('p', {}, h('strong', { text: 'Submitted by: ' }), whoText(submission)));
  else {
    const last = submission || (await Store.mySubmissions()).find(s => s.studentId);
    $('#f-student-name').value = last?.userName || (user.name.includes('@') ? '' : user.name);
    $('#f-student-id').value = last?.studentId || '';
    $('#f-student-email').textContent = user.email;
  }
  form.querySelectorAll('[data-extra-edit]').forEach(el => el.remove());
  form.querySelectorAll('[data-edit-option]').forEach(el => el.remove());
  if (submission) {
    const c = submission.card;
    for (const key of ['name','type','annualFunding','regions','modalities','innovative','links']) {
      const el = form.elements.namedItem(key);
      if (key === 'type' && c[key] && ![...el.options].some(o => o.value === c[key]))
        el.append(h('option', { value: c[key], text: c[key], 'data-edit-option': 'true' }));
      if (el) el.value = c[key] || '';
    }
    for (const key of ['priorities','opportunities','challenges']) {
      const inputs = [...form.querySelectorAll(`[name="${key}"]`)];
      arr(c[key]).forEach((value, i) => {
        if (inputs[i]) inputs[i].value = value;
        else inputs[0].parentElement.parentElement.append(h('div', { class: 'field', 'data-extra-edit': 'true' },
          h('label', { text: `${key} ${i + 1}` }), h('input', { name: key, value, type: 'text', 'aria-label': `${key} ${i + 1}` })));
      });
    }
    form.querySelectorAll('[name="sdgs"]').forEach(el => { el.checked = arr(c.sdgs).map(Number).includes(Number(el.value)); });
  }
  const adminEdit = submission && user.role === 'admin';
  $('#submit-title').textContent = submission ? (adminEdit ? 'Edit participant submission' : 'Edit and resubmit card') : 'Donor Profile Card';
  form.querySelector('button[type="submit"]').textContent = submission ? (adminEdit ? 'Save changes' : 'Resubmit for review') : 'Submit for approval';
  form.querySelector('.foot-note').textContent = (adminEdit ? 'Saving preserves the current approval status. ' : 'An admin reviews every card before it appears in the library. ') + Store.whereSaved();
  $('#card-error').hidden = true;
  $('#card-form').querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
  $('#submit-dlg').showModal();
  $('#submit-dlg .modal-body').scrollTop = 0;
  ([...form.querySelectorAll('[data-who]')].find(i => i.required && !i.value) || $('#f-name')).focus();
}

function readForm(form) {
  const fd = new FormData(form);
  const all = k => fd.getAll(k).map(v => String(v).trim()).filter(Boolean);
  const one = k => String(fd.get(k) || '').trim();
  return {
    name: one('name'), type: one('type'), annualFunding: one('annualFunding'),
    priorities: all('priorities'), regions: one('regions'), modalities: one('modalities'),
    innovative: one('innovative'), sdgs: all('sdgs').map(Number),
    opportunities: all('opportunities'), challenges: all('challenges'), links: one('links')
  };
}

$('#card-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, err = $('#card-error');
  form.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
  const missing = [];
  form.querySelectorAll('[required]').forEach(inp => {
    if (!inp.value.trim()) { inp.classList.add('invalid'); missing.push(inp); }
  });
  const card = readForm(form);
  if (!card.sdgs.length) { $('#sdg-field').classList.add('invalid'); missing.push($('#sdg-picker input')); }
  if (missing.length) {
    err.textContent = `Please complete the ${missing.length} required field${missing.length === 1 ? '' : 's'} marked in red.`;
    err.hidden = false;
    missing[0].focus();
    return;
  }
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const who = { name: $('#f-student-name').value, studentId: $('#f-student-id').value };
    if (editingSubmission) await Store.updateSubmission(editingSubmission.id, card, editingSubmission.version || 1, who);
    else await Store.submit(card, who);
    form.reset();
    $('#submit-dlg').close();
    toast(editingSubmission ? (user.role === 'admin' ? 'Changes saved. Approval status unchanged.' : 'Card resubmitted for review.') : 'Card sent for review.');
    editingSubmission = null;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});
/* Clear the red mark as soon as a field is filled in */
$('#card-form').addEventListener('input', e => {
  if (e.target.value?.trim()) e.target.classList.remove('invalid');
  if (e.target.name === 'sdgs') $('#sdg-field').classList.remove('invalid');
  if (!$('#card-form .invalid')) $('#card-error').hidden = true;
});

/* Read-only view of a card (used in My submissions and Review) */
function cardView(c) {
  const row = (label, value) => value && (Array.isArray(value) ? value.length : true)
    ? h('div', { class: 'cv-row' }, h('dt', { text: label }),
        h('dd', {}, Array.isArray(value) ? h('ul', {}, value.map(v => h('li', { text: v }))) : value))
    : null;
  return h('dl', { class: 'card-view' },
    row('Type of donor', c.type),
    row('Annual funding volume', c.annualFunding),
    row('Top priorities', arr(c.priorities)),
    row('Regions / countries', c.regions),
    row('Funding modalities', c.modalities),
    row('Innovative financing', c.innovative),
    row('SDGs', arr(c.sdgs).map(n => `SDG ${n} · ${SDG[n]}`)),
    row('Opportunities', arr(c.opportunities)),
    row('Challenges / barriers', arr(c.challenges)),
    row('Links / references', String(c.links || '').split(/\n+/).filter(Boolean)));
}


const whoText = s => [s.userName || '—', s.studentId ? `ID ${s.studentId}` : 'no student ID', s.userEmail].join(' · ');
const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/* Everything that happened to one card, oldest first: sent, returned (with note), resubmitted, approved, edited */
function timeline(s) {
  const hist = s.history || [];
  const noteAfter = i => (hist[i + 1] ? hist[i + 1].previous?.note : s.note) || '';
  const events = [{ at: s.submittedAt, kind: 'sent', text: `Submitted by ${s.userName || s.userEmail}` }];
  hist.forEach((item, i) => {
    if (item.action === 'review:reject') events.push({ at: item.at, kind: 'rejected', text: `Returned by ${item.by}`, note: noteAfter(i) });
    else if (item.action === 'review:approve') events.push({ at: item.at, kind: 'approved', text: `Approved by ${item.by}`, note: noteAfter(i) });
    else if (item.action === 'resubmit') events.push({ at: item.at, kind: 'sent', text: 'Edited and resubmitted by the participant' });
    else if (item.action === 'admin-edit') events.push({ at: item.at, kind: 'edit', text: `Edited by admin ${item.by}` });
  });
  return h('ol', { class: 'timeline' }, events.map(e => h('li', { class: 'tl-' + e.kind },
    h('span', { class: 'tl-when', text: fmtTime(e.at) }),
    h('span', { class: 'tl-what', text: e.text }),
    e.note ? h('span', { class: 'tl-note', text: `Note: ${e.note}` }) : null)));
}
function historyView(s) {
  const n = (s.history || []).length + 1;
  return h('details', { class: 'edit-history' }, h('summary', { text: `History (${n} step${n === 1 ? '' : 's'})` }), timeline(s));
}

/* ---------- my submissions ---------- */
async function openMine() {
  await renderMine();
  $('#mine-dlg').showModal();
}
async function renderMine() {
  const body = $('#mine-body');
  const list = await Store.mySubmissions();
  body.replaceChildren();
  if (!list.length) {
    body.append(h('div', { class: 'empty-small' }, h('strong', { text: 'You have not submitted a card yet.' }),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { $('#mine-dlg').close(); openForm(); } }, 'Submit a donor card')));
    return;
  }
  const editBtn = s => h('button', { type: 'button', class: 'btn primary',
    onclick: () => { $('#mine-dlg').close(); openForm(s); } }, 'Edit and resubmit');
  const returned = list.filter(s => s.status === 'rejected').length;
  if (returned) body.append(h('p', { class: 'returned-banner' },
    h('strong', { text: `${returned} card${returned === 1 ? ' was' : 's were'} returned.` }),
    ' Read the reviewer note, then click “Edit and resubmit” to fix and send it again.'));
  // Returned cards come first and open, with the reviewer note and the edit button visible straight away
  list.sort((a, b) => (b.status === 'rejected') - (a.status === 'rejected'));
  list.forEach(s => {
    const back = s.status === 'rejected';
    body.append(h('details', { class: 'sub-item' + (back ? ' is-returned' : ''), open: back },
      h('summary', {},
        h('span', { class: 'sub-title' }, h('strong', { text: s.card.name }),
          h('span', { class: 'muted', text: `Sent ${fmtDate(s.submittedAt)}${s.resubmittedAt ? ` · resubmitted ${fmtDate(s.resubmittedAt)}` : ''}` })),
        badge(s.status)),
      back || s.note ? h('p', { class: 'review-note' }, h('strong', { text: 'Reviewer note: ' }), s.note || 'No note was added.') : null,
      back ? h('div', { class: 'returned-actions' }, editBtn(s)) : null,
      cardView(s.card),
      historyView(s)));
  });
}

/* ---------- admin: review ---------- */
let reviewTab = 'pending';
async function openReview(tab) {
  reviewTab = tab || 'pending';
  await renderReview();
  $('#review-dlg').showModal();
}
$('#review-tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  reviewTab = t.dataset.tab;
  personEmail = null;
  renderReview();
});
async function renderReview() {
  document.querySelectorAll('#review-tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === reviewTab)));
  const body = $('#review-body');
  const all = await Store.allSubmissions();
  if (reviewTab === 'people') return renderPeople(all);
  const list = all.filter(s => s.status === reviewTab);
  body.replaceChildren();
  if (!list.length) {
    body.append(h('div', { class: 'empty-small' }, h('strong', { text: reviewTab === 'pending' ? 'Nothing is waiting for review.' : 'No cards here yet.' })));
    return;
  }
  list.forEach(s => {
    const noteId = `note-${s.id}`;
    body.append(h('details', { class: 'sub-item', open: reviewTab === 'pending' && list.length < 4 },
      h('summary', {},
        h('span', { class: 'sub-title' }, h('strong', { text: s.card.name }),
          h('span', { class: 'muted', text: `${whoText(s)} · ${fmtDate(s.submittedAt)}` })),
        badge(s.status)),
      h('p', { class: 'who-line' }, 'Submitted by ', h('strong', { text: s.userName || '—' }),
        ` · ${s.studentId ? 'Student ID ' + s.studentId : 'no student ID'} · ${s.userEmail} `,
        h('button', { type: 'button', class: 'linkish', text: 'See all their submissions', onclick: () => { personEmail = s.userEmail; reviewTab = 'people'; renderReview(); } })),
      cardView(s.card),
      historyView(s),
      h('button', { type: 'button', class: 'btn', onclick: () => { $('#review-dlg').close(); openForm(s); } }, 'Edit submission'),
      s.status === 'pending'
        ? h('div', { class: 'review-actions' },
            h('label', { for: noteId, text: 'Note to the participant (optional, shown if you return the card)' }),
            h('textarea', { id: noteId, rows: '2', maxlength: '600' }),
            h('div', { class: 'foot-btns' },
              h('button', { type: 'button', class: 'btn danger', onclick: () => decide(s.id, 'reject', noteId) }, 'Return for changes'),
              h('button', { type: 'button', class: 'btn primary', onclick: () => decide(s.id, 'approve', noteId) }, 'Approve and publish')))
        : h('p', { class: 'muted' }, `${STATUS[s.status]} by ${s.reviewer} on ${fmtDate(s.reviewedAt)}`, s.note ? ` · Note: ${s.note}` : '')));
  });
}
/* ---------- admin: participants and their submission history ---------- */
let personEmail = null, peopleQuery = '';
function groupPeople(all) {
  const map = new Map();
  all.slice().sort((a, b) => String(a.submittedAt).localeCompare(b.submittedAt)).forEach(s => {
    const p = map.get(s.userEmail) || { email: s.userEmail, name: '', ids: new Set(), subs: [] };
    if (s.userName) p.name = s.userName;              // latest name they used
    if (s.studentId) p.ids.add(s.studentId);
    p.subs.push(s);
    map.set(s.userEmail, p);
  });
  return [...map.values()].map(p => ({ ...p,
    count: st => p.subs.filter(s => s.status === st).length,
    last: p.subs.reduce((m, s) => [s.submittedAt, s.resubmittedAt, s.reviewedAt].reduce((x, d) => d && d > x ? d : x, m), '') }))
    .sort((a, b) => b.last.localeCompare(a.last));
}
function renderPeople(all) {
  const body = $('#review-body');
  body.replaceChildren();
  const people = groupPeople(all);
  const person = personEmail && people.find(p => p.email === personEmail);
  if (person) return renderPerson(person);
  personEmail = null;
  if (!people.length) { body.append(h('div', { class: 'empty-small' }, h('strong', { text: 'No participant has submitted a card yet.' }))); return; }
  const search = h('input', { type: 'search', class: 'people-search', placeholder: 'Search by name, student ID or email', value: peopleQuery, 'aria-label': 'Search participants' });
  const table = h('div', { class: 'people-wrap' });
  const draw = () => {
    const q = peopleQuery.toLowerCase().trim();
    const rows = people.filter(p => !q || [p.name, p.email, ...p.ids].join(' ').toLowerCase().includes(q));
    table.replaceChildren(rows.length ? h('table', { class: 'people' },
      h('thead', {}, h('tr', {}, ['Participant', 'Student ID', 'Cards', 'Approved', 'Waiting', 'Returned', 'Last activity'].map(t => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, rows.map(p => h('tr', {},
        h('td', {}, h('button', { type: 'button', class: 'linkish', text: p.name || p.email, onclick: () => { personEmail = p.email; renderReview(); } }),
          h('span', { class: 'muted block', text: p.email })),
        h('td', { text: [...p.ids].join(', ') || '—' }),
        h('td', { class: 'num', text: p.subs.length }),
        h('td', { class: 'num', text: p.count('approved') }),
        h('td', { class: 'num', text: p.count('pending') }),
        h('td', { class: 'num', text: p.count('rejected') }),
        h('td', { text: fmtDate(p.last) })))))
      : h('p', { class: 'muted', text: 'No participant matches this search.' }));
  };
  search.addEventListener('input', () => { peopleQuery = search.value; draw(); });
  body.append(h('p', { class: 'muted', text: `${people.length} participant${people.length === 1 ? '' : 's'}. Click a name to see their submission history.` }), search, table);
  draw();
}
function renderPerson(p) {
  const body = $('#review-body');
  body.append(
    h('button', { type: 'button', class: 'btn text back-btn', onclick: () => { personEmail = null; renderReview(); } }, '← All participants'),
    h('div', { class: 'person-head' },
      h('h3', { text: p.name || p.email }),
      h('p', {}, `Student ID: ${[...p.ids].join(', ') || '—'} · `, h('a', { href: `mailto:${p.email}`, text: p.email })),
      h('p', { class: 'muted', text: `${p.subs.length} card${p.subs.length === 1 ? '' : 's'} · ${p.count('approved')} approved · ${p.count('pending')} waiting · ${p.count('rejected')} returned` })));
  p.subs.slice().reverse().forEach(s => body.append(h('details', { class: 'sub-item', open: p.subs.length < 4 },
    h('summary', {},
      h('span', { class: 'sub-title' }, h('strong', { text: s.card.name }), h('span', { class: 'muted', text: `Sent ${fmtDate(s.submittedAt)}` })),
      badge(s.status)),
    timeline(s),
    h('details', { class: 'edit-history' }, h('summary', { text: 'Show the card' }), cardView(s.card)),
    h('div', { class: 'foot-btns' },
      s.status === 'pending' ? h('button', { type: 'button', class: 'btn primary', onclick: () => { personEmail = null; reviewTab = 'pending'; renderReview(); } }, 'Go to review') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => { $('#review-dlg').close(); openForm(s); } }, 'Edit submission')))));
}

async function decide(id, decision, noteId) {
  try {
    await Store.review(id, decision, document.getElementById(noteId)?.value.trim());
    toast(decision === 'approve' ? 'Approved. The card is now in the library.' : 'Returned to the participant.');
    renderReview();
  } catch (ex) { toast(ex.message); }
}

/* ---------- admin: manage filters ---------- */
let draft = [];
async function openFilters() {
  draft = (await Store.getFilterConfig()).map(f => ({ ...f }));
  renderFilterRows();
  $('#filters-dlg').showModal();
}
function renderFilterRows() {
  const ol = $('#filter-rows');
  ol.replaceChildren();
  draft.forEach((f, i) => {
    const id = `fl-${f.key}`;
    ol.append(h('li', { class: 'filter-row' },
      h('div', { class: 'fr-name' },
        h('label', { for: id, class: 'sr-only', text: `Label for ${DPE.FILTER_FIELDS[f.key]}` }),
        h('input', { type: 'text', id, value: f.label, maxlength: '40', oninput: e => { f.label = e.target.value; } }),
        h('span', { class: 'muted', text: `Data field: ${DPE.FILTER_FIELDS[f.key]}` })),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': `Where to show ${f.label}` },
        ['quick', 'more'].map(p => h('label', {},
          h('input', { type: 'radio', name: `place-${f.key}`, value: p, checked: f.place === p, onchange: () => { f.place = p; } }),
          p === 'quick' ? 'Filter bar' : 'More filters'))),
      h('div', { class: 'fr-btns' },
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Move ${f.label} up`, disabled: i === 0, onclick: () => move(i, -1), text: '↑' }),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Move ${f.label} down`, disabled: i === draft.length - 1, onclick: () => move(i, 1), text: '↓' }),
        h('button', { type: 'button', class: 'btn text danger-text', onclick: () => { draft.splice(i, 1); renderFilterRows(); } }, 'Remove'))));
  });
  const sel = $('#add-filter-field');
  sel.replaceChildren();
  const unused = Object.entries(DPE.FILTER_FIELDS).filter(([k]) => !draft.some(f => f.key === k));
  unused.forEach(([k, l]) => sel.append(h('option', { value: k, text: l })));
  sel.disabled = $('#add-filter-btn').disabled = !unused.length;
  if (!unused.length) sel.append(h('option', { text: 'All fields are in use' }));
}
function move(i, d) {
  const [x] = draft.splice(i, 1);
  draft.splice(i + d, 0, x);
  renderFilterRows();
}
$('#add-filter-btn').addEventListener('click', () => {
  const k = $('#add-filter-field').value;
  if (!DPE.FILTER_FIELDS[k]) return;
  draft.push({ key: k, label: DPE.FILTER_FIELDS[k], place: 'more' });
  renderFilterRows();
});
$('#filters-save').addEventListener('click', async () => {
  draft.forEach(f => { f.label = f.label.trim() || DPE.FILTER_FIELDS[f.key]; });
  try {
    await Store.saveFilterConfig(draft);
    $('#filters-dlg').close();
    toast('Filters saved');
  } catch (ex) { toast(ex.message); }
});
$('#filters-reset').addEventListener('click', async () => {
  try {
    await Store.resetFilterConfig();
    draft = DPE.DEFAULT_FILTERS.map(f => ({ ...f }));
    renderFilterRows();
    toast('Default filters restored');
  } catch (ex) { toast(ex.message); }
});

window.addEventListener('dpe:edit-submission', e => openForm(e.detail));

/* ---------- keep everything in sync ---------- */
window.addEventListener('store:change', async () => {
  const previousEmail = user?.email;
  await renderAccount();
  if (previousEmail !== user?.email) {
    ['submit-dlg','mine-dlg','review-dlg','filters-dlg','profile-edit-dlg'].forEach(id => document.getElementById(id)?.close());
    editingSubmission = null;
  }
  if ($('#mine-dlg').open) renderMine();
  if ($('#review-dlg').open) renderReview();
});
renderAccount();
})();
