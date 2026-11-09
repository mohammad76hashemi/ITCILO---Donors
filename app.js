/* DONOR LIBRARY: search, filters, list and profile panel.
   Data = data/donors.json + approved participant submissions (from store.js). */
(async () => {
'use strict';
const { h, arr, SDG } = DPE;
const $ = s => document.querySelector(s);

const LINKS = { website: 'Official website', strategy: 'Strategy', annualReport: 'Annual report', partnership: 'Partnership page', contact: 'Contact page' };
const SORTS = { name: 'Name (A–Z)', type: 'Organisation type', sdgs: 'Most SDGs covered' };

const state = { q: '', sort: 'name', sel: {}, openId: null, pushed: false, pop: null, picked: new Set(), page: 1 };
const PAGE_SIZE = DPE.PAGE_SIZE || 10;   // organisations per page (set in config.js)
let lastQuery = '';                      // when the search or filters change, go back to page 1
let adminUser = null;
let baseDonors = [], donors = [], byId = new Map(), filters = [], VALUES = {}, meta = {};

/* ---------- loading ---------- */
async function loadBase() {
  await Store.ready;
  const res = await fetch('data/donors.json?v=' + (await Store.donorsVersion()), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  baseDonors = data.donors || [];
  meta = data.meta || {};
  $('#updated').textContent = meta.lastUpdated || '';
}
try {
  await loadBase();
} catch (err) {
  console.error(err);
  $('#list').replaceChildren(h('div', { class: 'empty' },
    h('strong', { text: 'The donor data could not be loaded.' }),
    'Check that data/donors.json exists and is valid JSON. If you opened index.html directly from your computer, start a local server first (see README).'));
  return;
}

/* Turn an approved participant submission into a library profile */
function submissionToDonor(s) {
  const c = s.card;
  const lines = String(c.links || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const firstUrl = lines.find(l => /^https:\/\//.test(l));
  return {
    id: 'sub-' + s.id,
    contributed: true,
    name: c.name,
    type: c.type,
    shortDescription: [c.annualFunding ? `Annual funding: ${c.annualFunding}.` : '', arr(c.priorities).length ? `Priorities: ${arr(c.priorities).join(', ')}.` : ''].join(' ').trim(),
    priorities: arr(c.priorities),
    sectors: [], regions: [], countries: [],
    focusText: c.regions || '',
    sdgs: arr(c.sdgs).map(Number),
    modalities: String(c.modalities || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean),
    worksWith: [],
    annualFunding: c.annualFunding || '',
    innovativeFinance: c.innovative || '',
    opportunities: arr(c.opportunities),
    challenges: arr(c.challenges),
    references: lines,
    links: { website: firstUrl || '' },
    source: `Participant submission by ${s.userName} (Donor Detective Challenge)`,
    lastChecked: '',
    submissionId: s.id
  };
}

async function loadDynamic() {
  const approved = await Store.approvedSubmissions();
  adminUser = await Store.currentUser();
  const overrides = await Store.getProfileOverrides();
  donors = teamProfiles(overrides).concat(approved.map(submissionToDonor));
  byId = new Map(donors.map(d => [d.id, d]));
  filters = (await Store.getFilterConfig()).filter(f => DPE.FILTER_FIELDS[f.key]);
  filters.forEach(f => { if (!state.sel[f.key]) state.sel[f.key] = new Set(); });
  // drop selections for filters the admin removed
  Object.keys(state.sel).forEach(k => { if (!filters.some(f => f.key === k)) delete state.sel[k]; });
  VALUES = Object.fromEntries(filters.map(f => [f.key, valuesOf(f.key)]));
}
/* Course-team profiles = donors.json + admin edits, minus deleted ones, plus profiles added by admins */
function teamProfiles(overrides) {
  const baseIds = new Set(baseDonors.map(d => d.id));
  const edited = baseDonors.filter(d => !overrides[d.id]?.deleted)
    .map(d => ({ ...d, ...(overrides[d.id]?.profile || {}), id: d.id }));
  const added = Object.entries(overrides)
    .filter(([id, o]) => !baseIds.has(id) && !o.deleted && o.profile)
    .map(([id, o]) => ({ ...o.profile, id, addedByAdmin: true }));
  return edited.concat(added);
}
const valuesOf = k => {
  const s = [...new Set(donors.flatMap(d => arr(d[k])))];
  return k === 'sdgs' ? s.sort((a, b) => a - b) : s.sort((a, b) => String(a).localeCompare(b));
};
const quick = () => filters.filter(f => f.place === 'quick');
const more = () => filters.filter(f => f.place !== 'quick');
const labelOf = k => filters.find(f => f.key === k)?.label || DPE.FILTER_FIELDS[k] || k;
const lab = (k, v) => k === 'sdgs' ? `SDG ${v} · ${SDG[v] || ''}` : String(v);
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- filtering ---------- */
function matches(d, skip) {
  if (state.q) {
    const hay = norm([d.name, d.type, d.shortDescription, d.overview, d.howToPartner, d.focusText, d.innovativeFinance,
      ...arr(d.countries), ...arr(d.priorities), ...arr(d.sectors), ...arr(d.regions)].join(' '));
    if (!norm(state.q).split(/\s+/).every(w => hay.includes(w))) return false;
  }
  for (const [k, set] of Object.entries(state.sel)) {
    if (k === skip || !set.size) continue;
    if (!arr(d[k]).some(v => set.has(v))) return false;
  }
  return true;
}
function counts(k) {
  const c = new Map();
  donors.filter(d => matches(d, k)).forEach(d => arr(d[k]).forEach(v => c.set(v, (c.get(v) || 0) + 1)));
  return c;
}
/* ---------- "Describe what you are looking for" (keyword detection, no AI) ---------- */
const desc = { text: '', tags: [], off: new Set(), scores: new Map() };
const activeTags = () => desc.tags.filter(t => !desc.off.has(t.key));
const textCache = new WeakMap();
const donorText = d => {
  if (!textCache.has(d)) textCache.set(d, DPE.normText([d.name, d.type, d.shortDescription, d.overview, d.howToPartner,
    d.focusText, d.innovativeFinance, d.annualFunding, ...['sectors', 'priorities', 'regions', 'countries', 'modalities', 'worksWith', 'opportunities', 'challenges']
      .flatMap(k => arr(d[k]))].join(' ')));
  return textCache.get(d);
};
/* 1 point when the donor has the value as a tag, ½ point when the word only appears in its text */
function scoreOf(d, tags) {
  let score = 0; const hits = [];
  for (const t of tags) {
    if (arr(d[t.field]).some(v => String(v) === t.value)) { score += 1; hits.push(t); }
    else if (t.words.some(w => DPE.hasTerm(donorText(d), w))) { score += .5; hits.push({ ...t, partial: true }); }
    if (t.words.some(w => DPE.hasTerm(DPE.normText(d.name), w))) score += .25;   // small bonus: keyword in the name
  }
  return { score, hits };
}
function detect() {
  const dataValues = Object.fromEntries(Object.keys(DPE.FILTER_FIELDS).filter(k => k !== 'sdgs')
    .map(k => [k, [...new Set(donors.flatMap(d => arr(d[k])))]]));
  desc.tags = DPE.detectKeywords(desc.text, dataValues);
  const keys = new Set(desc.tags.map(t => t.key));
  [...desc.off].forEach(k => { if (!keys.has(k)) desc.off.delete(k); });
}

function results() {
  let r = donors.filter(d => matches(d));
  const tags = activeTags();
  desc.scores = new Map();
  if (tags.length) {
    r.forEach(d => desc.scores.set(d.id, scoreOf(d, tags)));
    r = r.filter(d => desc.scores.get(d.id).score > 0);
    return r.sort((a, b) => desc.scores.get(b.id).score - desc.scores.get(a.id).score || a.name.localeCompare(b.name));
  }
  if (state.sort === 'type') r.sort((a, b) => String(a.type).localeCompare(b.type) || a.name.localeCompare(b.name));
  else if (state.sort === 'sdgs') r.sort((a, b) => arr(b.sdgs).length - arr(a.sdgs).length || a.name.localeCompare(b.name));
  else r.sort((a, b) => a.name.localeCompare(b.name));
  return r;
}
const selectedIn = list => list.reduce((n, f) => n + (state.sel[f.key]?.size || 0), 0);

/* ---------- filter bar ---------- */
let leaveTimer = null;
const cancelLeave = () => { clearTimeout(leaveTimer); leaveTimer = null; };
const scheduleLeave = e => {
  if (e.pointerType !== 'mouse' || !state.pop) return;
  cancelLeave();
  leaveTimer = setTimeout(() => closePop(), 400);   // close when the mouse moves away
};

function renderPills() {
  const wrap = $('#pills');
  wrap.replaceChildren();
  quick().forEach(({ key: k, label }) => {
    const n = state.sel[k].size;
    wrap.append(h('button', {
      type: 'button', class: 'pill' + (n ? ' is-active' : '') + (state.pop === k ? ' is-open' : ''),
      'aria-haspopup': 'dialog', 'aria-expanded': String(state.pop === k), dataset: { key: k },
      onclick: e => togglePop(k, e.currentTarget),
      onpointerleave: scheduleLeave, onpointerenter: e => { if (state.pop === k) cancelLeave(); }
    }, label, n ? h('span', { class: 'pill-count', text: n }) : null, h('span', { class: 'caret', 'aria-hidden': 'true', text: '▾' })));
  });
  const m = selectedIn(more()) + (state.sort !== 'name' ? 1 : 0);
  wrap.append(h('button', { type: 'button', class: 'pill more' + (m ? ' is-active' : ''), onclick: openMore },
    'More filters & sort', m ? h('span', { class: 'pill-count', text: m }) : null));
  if (selectedIn(filters) || state.q || desc.text)
    wrap.append(h('button', { type: 'button', class: 'pill clear', onclick: clearAll, text: 'Clear all' }));
}

function optionList(k, container) {
  const c = counts(k);
  VALUES[k].forEach(v => {
    const id = `opt-${k}-${String(v).replace(/\W+/g, '-')}-${container.id}`;
    const checked = state.sel[k].has(v);
    const n = c.get(v) || 0;
    container.append(h('label', { class: 'opt' + (checked ? ' is-checked' : '') + (!n && !checked ? ' is-empty' : ''), for: id },
      h('input', { type: 'checkbox', id, checked, onchange: e => { e.target.checked ? state.sel[k].add(v) : state.sel[k].delete(v); update({ keep: id }); } }),
      h('span', { text: lab(k, v) }),
      h('span', { class: 'count', text: n })));
  });
  if (!VALUES[k].length) container.append(h('p', { class: 'muted', style: 'padding:.5rem', text: 'No values yet.' }));
}

/* ---------- quick-filter popover ---------- */
const pop = $('#popover');
pop.addEventListener('pointerleave', scheduleLeave);
pop.addEventListener('pointerenter', cancelLeave);

function togglePop(k, btn) { state.pop === k ? closePop() : openPop(k, btn); }
function openPop(k, btn) {
  cancelLeave();
  state.pop = k;
  renderPop();
  renderPills();
  positionPop(document.querySelector(`.pill[data-key="${k}"]`) || btn);
  pop.querySelector('input')?.focus({ preventScroll: true });
}
function renderPop() {
  const k = state.pop;
  if (!k) return;
  const body = h('div', { class: 'pop-body', id: 'pop-body' });
  optionList(k, body);
  pop.setAttribute('aria-label', labelOf(k));
  pop.replaceChildren(
    h('div', { class: 'pop-head', text: labelOf(k) }), body,
    h('div', { class: 'pop-foot' },
      h('button', { type: 'button', class: 'btn text', text: 'Clear', onclick: () => { state.sel[k].clear(); update(); } }),
      h('button', { type: 'button', class: 'btn primary', text: 'Done', onclick: () => closePop(true) })));
  pop.hidden = false;
}
function positionPop(btn) {
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(16, Math.min(r.left, window.innerWidth - pop.offsetWidth - 16))}px`;
}
function closePop(focusBtn) {
  cancelLeave();
  const k = state.pop;
  if (!k) return;
  state.pop = null;
  pop.hidden = true;
  renderPills();
  if (focusBtn) document.querySelector(`.pill[data-key="${k}"]`)?.focus();
}
document.addEventListener('pointerdown', e => {
  if (state.pop && !e.target.closest('#popover') && !e.target.closest('.pill[data-key]')) closePop();
});
window.addEventListener('resize', () => { if (state.pop) closePop(); measureToolbar(); });
window.addEventListener('scroll', () => { if (state.pop) positionPop(document.querySelector(`.pill[data-key="${state.pop}"]`)); }, { passive: true });
$('#pills').addEventListener('scroll', () => { if (state.pop) closePop(); }, { passive: true });

/* ---------- more filters dialog ---------- */
function renderMore() {
  const body = $('#more-body');
  body.replaceChildren();
  const so = h('div', { class: 'sort-opts', role: 'radiogroup', 'aria-label': 'Sort results by' });
  Object.entries(SORTS).forEach(([v, t]) => so.append(h('label', {},
    h('input', { type: 'radio', name: 'sort', value: v, checked: state.sort === v, onchange: () => { state.sort = v; update(); } }), t)));
  body.append(h('div', { class: 'more-sec' }, h('h3', { text: 'Sort results by' }), so));
  more().forEach(({ key: k, label }) => {
    const grid = h('div', { class: 'opt-grid', id: `more-${k}` });
    optionList(k, grid);
    body.append(h('div', { class: 'more-sec' }, h('h3', { text: label }), grid));
  });
  const n = results().length;
  $('#more-done').textContent = `Show ${n} result${n === 1 ? '' : 's'}`;
}
function openMore() { closePop(); renderMore(); $('#more').showModal(); }
$('#more-close').addEventListener('click', () => $('#more').close());
$('#more-done').addEventListener('click', () => $('#more').close());
$('#more-clear').addEventListener('click', () => { more().forEach(f => state.sel[f.key].clear()); state.sort = 'name'; update(); });
$('#more').addEventListener('click', e => { if (e.target === $('#more')) $('#more').close(); });

/* ---------- active filter chips ---------- */
function renderChips() {
  const ul = $('#chips');
  ul.replaceChildren();
  if (desc.text) {
    const short = desc.text.length > 40 ? desc.text.slice(0, 40).trim() + '…' : desc.text;
    ul.append(h('li', { class: 'chip-pair' },
      h('button', { type: 'button', class: 'chip chip-desc', title: 'Open to edit your description', onclick: openAsk },
        h('b', { text: 'Described:' }), ` “${short}”`),
      h('button', { type: 'button', class: 'chip chip-x', 'aria-label': 'Remove description', onclick: () => { setDescribe(''); update(); } },
        h('span', { 'aria-hidden': 'true', text: '×' }))));
  }
  if (state.q) ul.append(h('li', {}, h('button', { type: 'button', class: 'chip', 'aria-label': `Remove search "${state.q}"`,
    onclick: () => { state.q = ''; $('#q').value = ''; update(); } }, h('b', { text: 'Search:' }), ` “${state.q}”`, h('span', { 'aria-hidden': 'true', text: '×' }))));
  for (const [k, set] of Object.entries(state.sel)) set.forEach(v => ul.append(h('li', {},
    h('button', { type: 'button', class: 'chip', 'aria-label': `Remove filter ${labelOf(k)}: ${lab(k, v)}`, onclick: () => { set.delete(v); update(); } },
      h('b', { text: labelOf(k) + ':' }), ' ' + (k === 'sdgs' ? `SDG ${v}` : v), h('span', { 'aria-hidden': 'true', text: '×' })))));
}

/* ---------- cards ---------- */
const geoText = d => [...arr(d.regions), ...arr(d.countries)].join(' · ') || d.focusText || '';
function renderList(r) {
  const list = $('#list');
  list.replaceChildren();
  const pages = Math.max(1, Math.ceil(r.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE, pageItems = r.slice(start, start + PAGE_SIZE);
  const noun = r.length === 1 ? 'organisation' : 'organisations';
  $('#count').textContent = (pages > 1 ? `${start + 1}–${start + pageItems.length} of ${r.length} ${noun}` : `${r.length} ${noun}`)
    + (activeTags().length ? ', best match first' : '');
  renderPickBar(r);
  if (!r.length) {
    list.append(h('div', { class: 'empty' }, h('strong', { text: 'No organisations match these filters' }),
      'Try removing a filter or searching for a broader term. ',
      h('button', { type: 'button', class: 'btn', text: 'Clear all filters', onclick: clearAll })));
    return;
  }
  const hit = new Set([...(state.sel.sectors || []), ...activeTags().filter(t => t.field === 'sectors').map(t => t.value)]);
  const nTags = activeTags().length;
  pageItems.forEach(d => {
    const m = desc.scores.get(d.id);
    const picked = state.picked.has(d.id);
    list.append(h('article', { class: 'card' + (d.id === state.openId ? ' is-selected' : '') + (picked ? ' is-picked' : ''), dataset: { id: d.id } },
      h('label', { class: 'pick', title: 'Select to print or download' },
        h('input', { type: 'checkbox', checked: picked, 'aria-label': `Select ${d.name}`,
          onchange: e => { e.target.checked ? state.picked.add(d.id) : state.picked.delete(d.id); e.target.closest('.card').classList.toggle('is-picked', e.target.checked); renderPickBar(); } }),
        h('span', { text: 'Select' })),
      h('h3', {}, h('button', { type: 'button', class: 'card-link', 'aria-pressed': String(d.id === state.openId), onclick: () => select(d.id) }, d.name)),
      h('div', { class: 'card-badges' },
        h('p', { class: 'card-type', text: d.type }),
        d.contributed ? h('p', { class: 'card-type contributed', text: 'Participant profile' }) : null),
      m ? h('div', { class: 'match' },
        h('p', { class: 'match-score' }, h('strong', { text: `Matches ${m.hits.length} of ${nTags}` }),
          h('span', { class: 'match-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.min(100, Math.round(100 * m.score / nTags))}%` }))),
        h('ul', { class: 'match-tags', 'aria-label': 'Matching keywords' }, m.hits.map(t =>
          h('li', { class: t.partial ? 'partial' : '', title: t.partial ? 'Mentioned in the profile text' : `${labelOf(t.field)}: ${t.value}`, text: t.value })))) : null,
      geoText(d) ? h('p', { class: 'card-geo', text: geoText(d) }) : null,
      arr(d.modalities).length ? h('ul', { class: 'mods', 'aria-label': 'Funding and partnership modalities' },
        arr(d.modalities).slice(0, 3).map(m => h('li', { class: 'mod' }, h('span', { 'aria-hidden': 'true', text: '✓' }), m))) : null,
      d.shortDescription ? h('p', { class: 'card-desc', text: d.shortDescription }) : null,
      arr(d.sectors).length ? h('ul', { class: 'tags tags-sectors', 'aria-label': 'Sectors' }, arr(d.sectors).map(s => h('li', { class: 'tag' + (hit.has(s) ? ' hit' : ''), text: s }))) : null,
      h('ul', { class: 'tags tags-sdgs', 'aria-label': 'SDGs' }, arr(d.sdgs).map(n => h('li', { class: 'sdg', title: SDG[n], text: `SDG ${n}` })))));
  });
  if (pages > 1) list.append(pager(pages));
}

/* ---------- pagination ---------- */
/* Page numbers to show: always first and last, the current page and its neighbours, "…" for gaps */
function pageNumbers(pages, cur) {
  const keep = new Set([1, pages, cur - 1, cur, cur + 1].filter(n => n >= 1 && n <= pages));
  const out = [];
  [...keep].sort((a, b) => a - b).forEach((n, i, all) => {
    if (i && n - all[i - 1] > 1) out.push(n - all[i - 1] === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}
function pager(pages) {
  const cur = state.page;
  const btn = (label, page, extra = {}) => h('button', { type: 'button', class: 'page-btn' + (extra.cls || ''),
    disabled: extra.disabled, 'aria-label': extra.aria, 'aria-current': extra.current ? 'page' : null,
    onclick: () => goToPage(page) }, label);
  return h('nav', { class: 'pager', 'aria-label': 'Pages' },
    btn(h('span', {}, h('span', { 'aria-hidden': 'true', text: '‹ ' }), h('span', { class: 'pg-word', text: 'Previous' })), cur - 1,
      { disabled: cur === 1, aria: 'Previous page', cls: ' page-step' }),
    h('ol', { class: 'page-nums' }, pageNumbers(pages, cur).map(n => h('li', {},
      n == null ? h('span', { class: 'page-gap', 'aria-hidden': 'true', text: '…' })
        : btn(String(n), n, { current: n === cur, aria: `Page ${n}`, cls: n === cur ? ' is-current' : '' })))),
    btn(h('span', {}, h('span', { class: 'pg-word', text: 'Next' }), h('span', { 'aria-hidden': 'true', text: ' ›' })), cur + 1,
      { disabled: cur === pages, aria: 'Next page', cls: ' page-step' }));
}
function goToPage(n) {
  state.page = n;
  renderList(results());
  // bring the top of the list back into view, just below the fixed search bar
  const top = $('.results-head').getBoundingClientRect().top + window.scrollY - $('#toolbar').offsetHeight - 8;
  if (window.scrollY > top) window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('#count').focus({ preventScroll: true });
}
/* Open the page that holds a donor (e.g. when it is picked from "Similar organisations") */
function revealOnPage(id) {
  const i = results().findIndex(d => d.id === id);
  if (i < 0) return;
  const page = Math.floor(i / PAGE_SIZE) + 1;
  if (page !== state.page) { state.page = page; renderList(results()); }
}

/* ---------- profile panel ---------- */
const paragraphs = text => String(text || '').split(/\n\s*\n/).filter(Boolean).map(p => h('p', { text: p.trim() }));
const bullets = items => h('ul', { class: 'bul' }, arr(items).map(p => h('li', { text: p })));
function similarTo(d) {
  const score = o => ['sectors', 'priorities', 'regions', 'sdgs'].reduce((s, k) => s + arr(o[k]).filter(v => arr(d[k]).includes(v)).length, 0);
  return donors.filter(o => o.id !== d.id).map(o => [o, score(o)]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
}
function renderDetail(d) {
  const panel = $('#detail');
  const links = Object.entries(d.links || {}).filter(([, u]) => /^https:\/\//.test(u));
  const site = /^https:\/\//.test(d.links?.website || '') ? d.links.website : null;
  const glance = [
    d.annualFunding ? ['Annual funding volume', h('dd', { text: d.annualFunding })] : null,
    arr(d.modalities).length ? ['Funding & partnership', h('dd', {}, h('ul', { class: 'mods' }, arr(d.modalities).map(m => h('li', { class: 'mod' }, h('span', { 'aria-hidden': 'true', text: '✓' }), m))))] : null,
    arr(d.worksWith).length ? ['Works with', h('dd', { text: arr(d.worksWith).join(', ') })] : null,
    arr(d.sectors).length ? ['Sectors', h('dd', { text: arr(d.sectors).join(', ') })] : null
  ].filter(Boolean);

  panel.replaceChildren(
    h('div', { class: 'd-head' },
      h('button', { type: 'button', class: 'd-back', onclick: closeDetail }, h('span', { 'aria-hidden': 'true', text: '←' }), 'Back to results'),
      h('div', { class: 'd-top' },
        h('div', { style: 'flex:1;min-width:0' },
          h('h2', { id: 'd-title', tabindex: '-1', text: d.name }),
          h('div', { class: 'card-badges' }, h('p', { class: 'card-type', text: d.type }),
            d.contributed ? h('p', { class: 'card-type contributed', text: 'Participant profile' }) : null)),
        h('button', { type: 'button', class: 'icon-btn d-close', 'aria-label': 'Close profile', onclick: closeDetail, text: '×' })),
      geoText(d) ? h('p', { class: 'd-geo', text: geoText(d) }) : null,
      site ? h('div', { class: 'd-actions' }, h('a', { class: 'btn primary', href: site, target: '_blank', rel: 'noopener noreferrer' }, 'Visit official website ↗')) : null),
    h('div', { class: 'd-body' },
      adminUser?.role === 'admin' ? h('div', { class: 'profile-edit-tools' },
        h('button', { type: 'button', class: 'btn primary', text: d.contributed ? 'Edit participant submission' : 'Edit profile',
          onclick: async () => {
            if (d.contributed) {
              const s = (await Store.allSubmissions()).find(s => s.id === d.submissionId);
              if (s) window.dispatchEvent(new CustomEvent('dpe:edit-submission', { detail: s }));
            } else openProfileEditor(d);
          } }),
        !d.contributed ? deleteButton(d) : null,
        Store.onServer ? null : h('p', { class: 'save-warning', text: 'Changes will not be saved to the database: the site is open without its server. Start it with start.command.' })) : null,
      glance.length ? h('section', {}, h('dl', { class: 'glance' }, glance.map(([t, dd]) => h('div', {}, h('dt', { text: t }), dd)))) : null,
      d.overview ? h('section', {}, h('h3', { text: 'About' }), paragraphs(d.overview)) : null,
      arr(d.priorities).length ? h('section', {}, h('h3', { text: d.contributed ? 'Top priority sectors / themes' : 'Thematic priorities' }), bullets(d.priorities)) : null,
      d.howToPartner ? h('section', {}, h('h3', { text: 'How to partner' }), paragraphs(d.howToPartner)) : null,
      d.innovativeFinance ? h('section', {}, h('h3', { text: 'Innovative financing mechanisms' }), paragraphs(d.innovativeFinance)) : null,
      arr(d.opportunities).length ? h('section', {}, h('h3', { text: 'Opportunities for partnership' }), bullets(d.opportunities)) : null,
      arr(d.challenges).length ? h('section', {}, h('h3', { text: 'Challenges / barriers' }), bullets(d.challenges)) : null,
      arr(d.sdgs).length ? h('section', {}, h('h3', { text: 'Relevant SDGs' }),
        h('ul', { class: 'tags' }, arr(d.sdgs).map(n => h('li', { class: 'sdg', title: SDG[n], text: `SDG ${n} · ${SDG[n]}` })))) : null,
      d.contributed
        ? (arr(d.references).length ? h('section', {}, h('h3', { text: 'Links and references' }),
            h('ul', { class: 'links' }, arr(d.references).map(r => h('li', {}, /^https:\/\//.test(r) ? h('a', { href: r, target: '_blank', rel: 'noopener noreferrer', text: r }) : r)))) : null)
        : h('section', {}, h('h3', { text: 'Useful links' }),
            links.length ? h('ul', { class: 'links' }, links.map(([k, u]) => h('li', {}, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, `${LINKS[k] || k} ↗`)))) : h('p', { class: 'muted', text: 'No links yet.' })),
      h('section', {}, h('h3', { text: 'Similar organisations' }),
        h('ul', { class: 'similar' }, similarTo(d).map(o => h('li', {}, h('button', { type: 'button', onclick: () => select(o.id) },
          h('strong', { text: o.name }), h('span', { text: [o.type, ...arr(o.sectors).slice(0, 2)].join(' · ') })))))),
      h('div', { class: 'source' },
        h('p', { text: `Source: ${d.source || '—'}` }),
        h('p', { text: `Last checked: ${d.lastChecked || 'not yet verified'}` })),
      h('p', { class: 'key-hint' }, 'Press ', h('kbd', { text: 'Esc' }), ' or ', h('kbd', { text: '←' }), ' to close')));
}


/* Course-team profile editor: preserves IDs and unedited metadata. */
const profileFields = {
  name: 'Organisation name', type: 'Organisation type', shortDescription: 'Short description',
  overview: 'About', howToPartner: 'How to partner', annualFunding: 'Annual funding (include year and scope)',
  innovativeFinance: 'Innovative financing', focusText: 'Additional geographic context',
  sectors: 'Sectors', priorities: 'Thematic priorities', regions: 'Regions', countries: 'Countries',
  sdgs: 'SDG numbers (one per line)', modalities: 'Partnership / funding modalities', worksWith: 'Works with',
  opportunities: 'Partnership opportunities', challenges: 'Challenges / barriers',
  source: 'Source description', lastChecked: 'Last verified date (YYYY-MM-DD; leave blank if unverified)'
};
const arrayFields = new Set(['sectors','priorities','regions','countries','sdgs','modalities','worksWith','opportunities','challenges']);
/* Delete needs a second click, so a profile is never removed by accident */
function deleteButton(d) {
  let armed = false, timer;
  const btn = h('button', { type: 'button', class: 'btn danger', text: 'Delete profile', onclick: async () => {
    if (!armed) {
      armed = true; btn.textContent = 'Click again to delete';
      timer = setTimeout(() => { armed = false; btn.textContent = 'Delete profile'; }, 4000);
      return;
    }
    clearTimeout(timer); btn.disabled = true;
    try { await Store.deleteProfile(d.id); clearHash(); }
    catch (ex) { btn.disabled = false; btn.textContent = ex.message; }
  } });
  return btn;
}
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profile';

/* Called with no profile → "Add a new profile" */
async function openProfileEditor(d) {
  if ((await Store.currentUser())?.role !== 'admin') return;
  const isNew = !d;
  d = d || { name: '', type: '', links: {}, sdgs: [], contributed: false, verificationStatus: 'unverified' };
  document.getElementById('profile-edit-dlg')?.remove();
  const revision = isNew ? 0 : (await Store.getProfileOverrides())[d.id]?.revision || 0;
  const dialog = h('dialog', { id: 'profile-edit-dlg', class: 'modal', 'aria-labelledby': 'profile-edit-title' });
  const body = h('div', { class: 'modal-body form-body' },
    Store.onServer ? null : h('p', { class: 'save-warning', text: 'Not connected to the database: the site is open without its server, so this change would stay in this browser only. Close this page and start the site with start.command.' }),
    h('p', { class: 'hint', text: 'In list fields, put one item per line. The labels already in use are shown under each field: reuse the same spelling so the filters keep working.' }));
  const controls = {};
  for (const [key, label] of Object.entries(profileFields)) {
    const id = 'edit-profile-' + key;
    controls[key] = h('textarea', { id, rows: arrayFields.has(key) || ['overview','howToPartner'].includes(key) ? '4' : '2' });
    controls[key].value = arrayFields.has(key) ? arr(d[key]).join('\n') : (d[key] || '');
    const suggestions = arrayFields.has(key) && !['sdgs','opportunities','challenges'].includes(key)
      ? [...new Set(baseDonors.flatMap(x => arr(x[key])))].sort().join(' · ') : '';
    body.append(h('div', { class: 'field' }, h('label', { for: id, text: label }), controls[key],
      suggestions ? h('p', { class: 'hint', text: 'Existing labels: ' + suggestions }) : null));
  }
  const linkControls = {};
  for (const key of Object.keys(LINKS)) {
    linkControls[key] = h('input', { id: 'edit-link-' + key, type: 'url', value: d.links?.[key] || '' });
    body.append(h('div', { class: 'field' }, h('label', { for: 'edit-link-' + key, text: LINKS[key] }), linkControls[key]));
  }
  const error = h('p', { class: 'form-error', role: 'alert' }); body.append(error);
  const save = h('button', { type: 'submit', class: 'btn primary', text: isNew ? 'Add profile' : 'Save changes' });
  const form = h('form', { class: 'modal-inner' },
    h('div', { class: 'modal-head' }, h('h2', { id: 'profile-edit-title', text: isNew ? 'Add a new profile' : 'Edit course-team profile' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close editor', text: '×', onclick: () => dialog.close() })),
    body, h('div', { class: 'modal-foot' },
      h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => dialog.close() }), save));
  form.addEventListener('submit', async e => {
    e.preventDefault(); save.disabled = true; error.textContent = '';
    try {
      const profile = { ...d, links: { ...(d.links || {}) } };
      for (const [key, input] of Object.entries(controls)) {
        profile[key] = arrayFields.has(key) ? [...new Set(input.value.split(/\n+/).map(s => s.trim()).filter(Boolean))] : input.value.trim();
      }
      profile.sdgs = profile.sdgs.map(Number);
      if (profile.sdgs.some(n => !Number.isInteger(n) || n < 1 || n > 17)) throw new Error('SDGs must be numbers between 1 and 17.');
      if (!profile.type) throw new Error('Organisation type is required.');
      if (profile.lastChecked && !/^\d{4}-\d{2}-\d{2}$/.test(profile.lastChecked)) throw new Error('Use YYYY-MM-DD for the verified date.');
      for (const [key, input] of Object.entries(linkControls)) {
        const value = input.value.trim();
        if (value && !/^https:\/\//i.test(value)) throw new Error('Links must start with https://');
        profile.links[key] = value;
      }
      if (!profile.name) throw new Error('Organisation name is required.');
      let id = d.id;
      if (isNew) {
        const taken = new Set([...baseDonors.map(x => x.id), ...Object.keys(await Store.getProfileOverrides())]);
        id = slug(profile.name);
        for (let i = 2; taken.has(id); i++) id = `${slug(profile.name)}-${i}`;
        profile.provenance = { origin: 'added-by-admin', addedAt: new Date().toISOString() };
      }
      await Store.saveProfile(id, profile, revision);
      dialog.close();
      if (isNew) { const open = (n = 0) => byId.has(id) ? select(id) : n < 30 && setTimeout(() => open(n + 1), 100); open(); }
    } catch (ex) { error.textContent = ex.message; }
    finally { save.disabled = false; }
  });
  dialog.append(form); document.body.append(dialog); dialog.showModal(); controls.name.focus();
}

/* ---------- open / close, linked to browser history ---------- */
const isPhone = () => window.matchMedia('(max-width: 820px)').matches;
function select(id) {
  if (!byId.has(id)) return;
  if (state.openId) location.replace('#' + id);          // switching donors: no extra history step
  else { state.pushed = true; location.hash = id; }      // first open: one step, so Back closes it
}
function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (byId.has(id)) showDetail(id); else hideDetail();
}
function markSelected(id) {
  document.querySelectorAll('.card').forEach(c => {
    const on = c.dataset.id === id;
    c.classList.toggle('is-selected', on);
    c.querySelector('.card-link').setAttribute('aria-pressed', String(on));
  });
}
function showDetail(id) {
  state.openId = id;
  revealOnPage(id);
  renderDetail(byId.get(id));
  const panel = $('#detail');
  panel.hidden = false;
  panel.scrollTop = 0;
  $('#split').classList.add('is-open');
  document.body.classList.toggle('lock', isPhone());
  markSelected(id);
  $('#d-title')?.focus({ preventScroll: true });
}
function hideDetail() {
  if (!state.openId) return;
  const id = state.openId;
  state.openId = null;
  state.pushed = false;
  $('#detail').hidden = true;
  $('#split').classList.remove('is-open');
  document.body.classList.remove('lock');
  markSelected(null);
  document.querySelector(`.card[data-id="${CSS.escape(id)}"] .card-link`)?.focus({ preventScroll: !isPhone() });
}
function closeDetail() {
  if (state.pushed) {
    history.back();
    setTimeout(() => { if (state.openId) clearHash(); }, 350);
  } else clearHash();
}
function clearHash() {
  try { history.replaceState(null, '', location.pathname + location.search); } catch { location.hash = ''; }
  hideDetail();
}
window.addEventListener('hashchange', route);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.pop) { closePop(true); return; }
  if (document.querySelector('dialog[open]')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (state.openId && !typing && (e.key === 'Escape' || e.key === 'ArrowLeft')) { e.preventDefault(); closeDetail(); }
});

(() => {   // swipe right on the full-screen profile (phone) to go back
  let x0 = null, y0 = 0;
  const panel = $('#detail');
  panel.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX > 24 ? t.clientX : null; y0 = t.clientY; }, { passive: true });
  panel.addEventListener('touchend', e => {
    if (x0 == null || !isPhone()) return;
    const t = e.changedTouches[0];
    if (t.clientX - x0 > 80 && Math.abs(t.clientY - y0) < 60) closeDetail();
    x0 = null;
  }, { passive: true });
})();

/* ---------- search ---------- */
let timer;
$('#q').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 180); });
$('#search-form').addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); state.q = $('#q').value.trim(); update(); $('#q').blur(); });

function clearAll() {
  Object.values(state.sel).forEach(s => s.clear());
  state.q = ''; $('#q').value = ''; state.sort = 'name';
  setDescribe('');
  update();
}

/* ---------- describe box ---------- */
function renderDescribeTags() {
  const ul = $('#describe-tags');
  ul.replaceChildren();
  $('#describe-clear').hidden = !desc.text;
  $('#ask-dot').hidden = !activeTags().length;
  if (!desc.text) { ul.append(h('li', { class: 'muted', text: 'Detected keywords will appear here as you type.' })); return; }
  if (!desc.tags.length) { ul.append(h('li', { class: 'muted', text: 'No known keywords yet. Try words like health, Africa, loan, NGO, youth, climate.' })); return; }
  ul.append(h('li', { class: 'describe-label', text: 'Detected:' }));
  desc.tags.forEach(t => {
    const off = desc.off.has(t.key);
    const from = t.words.filter(w => DPE.normText(w) !== DPE.normText(t.value));
    ul.append(h('li', {}, h('button', { type: 'button', class: 'chip kw' + (off ? ' is-off' : ''), 'aria-pressed': String(!off),
      title: off ? 'Ignored. Click to use it again.' : 'Click to ignore this keyword',
      onclick: () => { off ? desc.off.delete(t.key) : desc.off.add(t.key); renderDescribeTags(); update(); } },
      h('b', { text: labelOf(t.field) + ':' }), ' ' + t.value,
      from.length ? h('span', { class: 'kw-from', text: `“${from.slice(0, 2).join('”, “')}”` }) : null,
      h('span', { 'aria-hidden': 'true', text: off ? '+' : '×' }))));
  });
}
function setDescribe(text) {
  desc.text = text.trim();
  if ($('#describe-text').value.trim() !== desc.text) $('#describe-text').value = text;
  detect();
  renderDescribeTags();
}
let dTimer;
$('#describe-text').addEventListener('input', e => {
  clearTimeout(dTimer);
  dTimer = setTimeout(() => { setDescribe(e.target.value); update(); }, 250);
});
$('#describe-clear').addEventListener('click', () => { setDescribe(''); update(); $('#describe-text').focus(); });

/* Round button bottom right opens the describe panel; a tip bubble appears above it on each visit */
const askPanel = $('#ask-panel'), askFab = $('#ask-fab'), askHint = $('#ask-hint');
let hintTimer;
function hideHint() { clearTimeout(hintTimer); askHint.hidden = true; }
function openAsk() {
  hideHint(); closePop();
  askPanel.hidden = false;
  askFab.setAttribute('aria-expanded', 'true');
  $('#ask').classList.add('is-open');
  $('#describe-text').focus();
}
function closeAsk(focusFab) {
  if (askPanel.hidden) return;
  askPanel.hidden = true;
  askFab.setAttribute('aria-expanded', 'false');
  $('#ask').classList.remove('is-open');
  if (focusFab) askFab.focus();
}
askFab.addEventListener('click', () => askPanel.hidden ? openAsk() : closeAsk());
$('#ask-close').addEventListener('click', () => closeAsk(true));
$('#ask-hint-open').addEventListener('click', openAsk);
$('#ask-hint-close').addEventListener('click', hideHint);
$('#ask-show').addEventListener('click', () => {
  clearTimeout(dTimer); setDescribe($('#describe-text').value); update(); closeAsk();
  $('.results-head').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.addEventListener('pointerdown', e => {
  if (!askPanel.hidden && !e.target.closest('#ask') && !e.target.closest('.chip-desc')) closeAsk();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !askPanel.hidden && !document.querySelector('dialog[open]')) { e.stopImmediatePropagation(); closeAsk(true); }
}, true);
setTimeout(() => {
  if (!askPanel.hidden || desc.text) return;
  askHint.hidden = false;
  hintTimer = setTimeout(hideHint, 9000);
}, 1200);

/* ---------- select cards, print, CSV ----------
   Print and CSV use the selected cards; with nothing selected they use everything shown. */
function pickedList() {
  [...state.picked].forEach(id => { if (!byId.has(id)) state.picked.delete(id); });
  const shown = results(), order = new Map(shown.map((d, i) => [d.id, i]));
  return [...state.picked].map(id => byId.get(id))
    .sort((a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6) || a.name.localeCompare(b.name));
}
const outputList = () => state.picked.size ? pickedList() : results();
function renderPickBar(r = results()) {
  const bar = $('#pick-bar'), n = state.picked.size;
  [...state.picked].forEach(id => { if (!byId.has(id)) state.picked.delete(id); });
  bar.replaceChildren(n
    ? h('p', {}, h('strong', { text: `${n} selected` }), ' · ',
        h('button', { type: 'button', class: 'linkish', text: 'Clear selection', onclick: () => { state.picked.clear(); update(); } }))
    : r.length ? h('button', { type: 'button', class: 'linkish', text: r.length > PAGE_SIZE ? `Select all ${r.length} results` : `Select all ${r.length} shown`,
        onclick: () => { r.forEach(d => state.picked.add(d.id)); update(); } }) : '');
  // Print and CSV appear only once there is something to keep: a search, a filter, a description or a selection
  const searching = !!(state.q || selectedIn(filters) || activeTags().length);
  $('.out-btns').hidden = !(searching || n);
  const count = n || r.length, what = n ? `the ${n} selected` : `all ${r.length} shown`;
  $('#print-count').hidden = !n; $('#print-count').textContent = n;
  $('#print-btn').title = `Print ${what} organisation${count === 1 ? '' : 's'}. Tick “Select” on cards to choose.`;
  $('#export-csv').title = `Download ${what} as a spreadsheet (CSV)`;
  $('#print-btn').disabled = $('#export-csv').disabled = !count;
}

/* Printing builds a clean page with the full profile of each organisation */
function printProfiles() {
  const list = outputList();
  if (!list.length) return;
  const section = (title, content) => content ? h('section', {}, h('h3', { text: title }), content) : null;
  const items = v => arr(v).length ? h('ul', {}, arr(v).map(x => h('li', { text: x }))) : null;
  const text = v => v ? paragraphs(v) : null;
  const facts = d => [
    ['Region / countries', geoText(d)], ['Funding & partnership', arr(d.modalities).join(', ')],
    ['Annual funding', d.annualFunding], ['Works with', arr(d.worksWith).join(', ')], ['Sectors', arr(d.sectors).join(', ')],
    ['SDGs', arr(d.sdgs).map(n => `${n} ${SDG[n] || ''}`).join(' · ')], ['Website', d.links?.website]
  ].filter(([, v]) => v);
  const area = h('div', { id: 'print-area' },
    h('header', { class: 'p-head' },
      h('h1', { text: 'Donor & Partner Explorer' }),
      h('p', { text: `${list.length} organisation${list.length === 1 ? '' : 's'} · printed ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` }),
      desc.text ? h('p', { class: 'p-desc' }, h('strong', { text: 'Looking for: ' }), desc.text) : null),
    list.map(d => {
      const m = desc.scores.get(d.id);
      return h('article', { class: 'p-donor' },
        h('h2', { text: d.name }),
        h('p', { class: 'p-type', text: [d.type, d.contributed ? 'Participant profile' : ''].filter(Boolean).join(' · ') }),
        m ? h('p', { class: 'p-match', text: `Matches ${m.hits.length} of ${activeTags().length}: ${m.hits.map(t => t.value).join(', ')}` }) : null,
        d.shortDescription ? h('p', { class: 'p-short', text: d.shortDescription }) : null,
        h('dl', { class: 'p-facts' }, facts(d).map(([t, v]) => h('div', {}, h('dt', { text: t }), h('dd', { text: v })))),
        section('About', text(d.overview)),
        section(d.contributed ? 'Top priorities' : 'Thematic priorities', items(d.priorities)),
        section('How to partner', text(d.howToPartner)),
        section('Innovative financing', text(d.innovativeFinance)),
        section('Opportunities for partnership', items(d.opportunities)),
        section('Challenges / barriers', items(d.challenges)),
        h('p', { class: 'p-source', text: `Source: ${d.source || '—'} · Last checked: ${d.lastChecked || 'not yet verified'}` }));
    }));
  document.getElementById('print-area')?.remove();
  document.body.append(area);
  const done = () => { area.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
$('#print-btn').addEventListener('click', printProfiles);

/* ---------- CSV export ---------- */
function exportCsv() {
  const r = outputList();
  if (!r.length) return;
  const list = k => d => arr(d[k]).join('; ');
  const cols = [
    ['Name', d => d.name], ['Type', d => d.type],
    ['Sectors', list('sectors')], ['Regions', list('regions')], ['Countries', d => arr(d.countries).join('; ') || d.focusText || ''],
    ['Funding modalities', list('modalities')], ['Thematic priorities', list('priorities')], ['Works with', list('worksWith')],
    ['SDGs', d => arr(d.sdgs).join('; ')], ['Annual funding', d => d.annualFunding],
    ['Short description', d => d.shortDescription], ['Website', d => d.links?.website],
    ['Profile by', d => d.contributed ? 'Participant' : 'Course team'], ['Last checked', d => d.lastChecked]
  ];
  if (activeTags().length) cols.splice(2, 0,
    ['Match score', d => { const m = desc.scores.get(d.id); return m ? `${m.hits.length} of ${activeTags().length}` : ''; }],
    ['Matched keywords', d => (desc.scores.get(d.id)?.hits || []).map(t => t.value + (t.partial ? ' (text)' : '')).join('; ')]);
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // stop spreadsheets from running it as a formula
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = '﻿' + [cols.map(c => cell(c[0])), ...r.map(d => cols.map(c => cell(c[1](d))))].map(row => row.join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `donors-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#export-csv').addEventListener('click', exportCsv);
window.addEventListener('dpe:new-profile', () => openProfileEditor());

/* ---------- render cycle ---------- */
function update(opts = {}) {
  const query = JSON.stringify([state.q, state.sort, Object.entries(state.sel).map(([k, s]) => [k, [...s]]), activeTags().map(t => t.key)]);
  if (query !== lastQuery) { state.page = 1; lastQuery = query; }
  const r = results();
  renderPills();
  renderChips();
  renderList(r);
  if (state.pop) {
    if (!quick().some(f => f.key === state.pop)) closePop();
    else {
      const st = $('#pop-body')?.scrollTop || 0;
      renderPop();
      $('#pop-body').scrollTop = st;
      positionPop(document.querySelector(`.pill[data-key="${state.pop}"]`));
    }
  }
  if ($('#more').open) { const b = $('#more-body'), st = b.scrollTop; renderMore(); b.scrollTop = st; }
  if (opts.keep) document.getElementById(opts.keep)?.focus({ preventScroll: true });
  measureToolbar();
}
function measureToolbar() {
  document.documentElement.style.setProperty('--toolbar-h', $('#toolbar').offsetHeight + 'px');
}

/* ---------- footer: data source and disclaimer ----------
   Text comes from data/donors.json "meta"; an admin can replace it with "Edit footer". */
async function footerText() {
  const custom = await Store.getSiteText();
  return {
    sourceNote: custom ? custom.sourceNote : (meta.sourceNote || ''),
    disclaimer: custom ? custom.disclaimer : (meta.disclaimer || ''),
    custom: !!custom
  };
}
async function renderFooter() {
  const t = await footerText();
  $('#source-note').textContent = t.sourceNote;
  $('#disclaimer-text').textContent = t.disclaimer;
  $('#foot-source').hidden = !t.sourceNote;
  $('#foot-disclaimer').hidden = !t.disclaimer;
  $('#foot-tools').hidden = adminUser?.role !== 'admin';
}
$('#edit-footer').addEventListener('click', async () => {
  const t = await footerText();
  $('#f-source-note').value = t.sourceNote;
  $('#f-disclaimer').value = t.disclaimer;
  $('#footer-error').hidden = true;
  $('#footer-reset').hidden = !t.custom;
  $('#footer-dlg').showModal();
  $('#f-source-note').focus();
});
async function saveFooter(text, message) {
  try {
    await Store.saveSiteText(text);
    $('#footer-dlg').close();
    $('#toast').textContent = message; $('#toast').hidden = false;
    setTimeout(() => { $('#toast').hidden = true; }, 3000);
  } catch (ex) {
    $('#footer-error').textContent = ex.message;
    $('#footer-error').hidden = false;
  }
}
$('#footer-form').addEventListener('submit', e => {
  e.preventDefault();
  saveFooter({ sourceNote: $('#f-source-note').value, disclaimer: $('#f-disclaimer').value }, 'Footer saved');
});
$('#footer-reset').addEventListener('click', () => saveFooter(null, 'Original footer text restored'));

/* Reload when a submission is approved or an admin changes the filters */
window.addEventListener('store:change', async e => {
  if (e.detail?.key === 'donors') await loadBase().catch(console.error);   // donors.json was changed
  await loadDynamic();
  await renderFooter();
  if (desc.text) { detect(); renderDescribeTags(); }
  update();
  if (state.openId && !byId.has(state.openId)) clearHash();
  else if (state.openId) renderDetail(byId.get(state.openId));
});

$('#updated').textContent = meta.lastUpdated || '';
await loadDynamic();
await renderFooter();
renderDescribeTags();
update();
route();
})();
