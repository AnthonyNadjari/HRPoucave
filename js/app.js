// app.js — interface. Ne manipule les données qu'à travers store.js.
import * as store from './store.js';
import { CATEGORIES, IMPACTS } from './store.js';
import { parseImport, claudePrompt } from './importer.js';
import { buildReport } from './report.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DOWS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const impactLabel = v => (IMPACTS.find(i => i.value === v) || { label: v }).label;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtBytes = n => n < 1024 ? n + ' o' : n < 1048576 ? (n / 1024).toFixed(0) + ' Ko' : (n / 1048576).toFixed(1) + ' Mo';

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3200);
}

function confirmDlg(title, text, okLabel = 'Confirmer') {
  const d = $('#dlg-confirm');
  $('#confirm-title').textContent = title; $('#confirm-text').textContent = text; $('#confirm-ok').textContent = okLabel;
  return new Promise(res => { d.onclose = () => res(d.returnValue === 'ok'); d.showModal(); });
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');

// ───────────────────────── Démarrage / coffre ─────────────────────────

const supported = typeof indexedDB !== 'undefined' && window.crypto && crypto.subtle && typeof HTMLDialogElement !== 'undefined';

async function boot() {
  $('#gate').hidden = false;
  if (!supported) { $('#gate-unsupported').hidden = false; return; }
  const st = await store.status();
  if (st === 'uninitialized') $('#gate-setup').hidden = false;
  else if (st === 'locked') { $('#gate-unlock').hidden = false; setTimeout(() => $('#form-unlock input[name=pass]').focus(), 50); }
}

function gateError(msg) { const e = $('#gate-error'); e.textContent = msg || ''; e.hidden = !msg; }

$('#form-setup').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target;
  if (f.pass.value !== f.pass2.value) return gateError('Les deux phrases ne correspondent pas.');
  if (f.pass.value.length < 8) return gateError('8 caractères minimum.');
  gateError('');
  f.querySelector('button').disabled = true;
  try { await store.setup(f.pass.value); f.reset(); enterApp(); }
  catch (e) { gateError(e.message); }
  finally { f.querySelector('button').disabled = false; }
});

$('#form-unlock').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target; const btn = f.querySelector('button');
  btn.disabled = true; gateError('');
  try { await store.unlock(f.pass.value); f.reset(); enterApp(); }
  catch (e) { gateError(e.message); }
  finally { btn.disabled = false; }
});

$('#btn-gate-restore').addEventListener('click', () => {
  gateError('Déverrouillez d\'abord ce carnet, puis Menu → Restaurer. Sur un appareil vierge, créez un carnet avec la phrase secrète de votre sauvegarde, puis restaurez-la.');
});

async function enterApp() {
  $('#gate').hidden = true; $('#app').hidden = false;
  populateSelects();
  await loadPrefs();
  render();
  armAutoLock();
  checkBackupReminder();
}

function lockApp() {
  closePanel(true); closeLightbox();
  $$('dialog[open]').forEach(d => d.close());
  store.lock();
  $('#app').hidden = true; $('#gate').hidden = false;
  $('#gate-setup').hidden = true; $('#gate-unlock').hidden = false;
  gateError('');
  setTimeout(() => $('#form-unlock input[name=pass]').focus(), 50);
}

// Verrouillage automatique après inactivité
let lockMinutes = 15, lockTimer = null, lastActivity = Date.now();
function armAutoLock() {
  clearTimeout(lockTimer);
  if (!lockMinutes || !store.isUnlocked()) return;
  lockTimer = setTimeout(() => { if (store.isUnlocked()) { lockApp(); toast('Verrouillé après inactivité.'); } }, lockMinutes * 60000);
}
['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(evn => document.addEventListener(evn, () => { lastActivity = Date.now(); if (store.isUnlocked()) armAutoLock(); }, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.isUnlocked() && lockMinutes && Date.now() - lastActivity > lockMinutes * 60000) lockApp();
});

async function loadPrefs() {
  lockMinutes = Number(await store.getPref('lockMinutes', 15));
  $('#set-lock').value = String(lockMinutes);
}

function populateSelects() {
  const catOpts = CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#f-category').innerHTML = '<option value="">Toutes catégories</option>' + catOpts;
  $('#form-incident select[name=category]').innerHTML = catOpts;
  const impOpts = IMPACTS.map(i => `<option value="${i.value}">${i.label}</option>`).join('');
  $('#f-impact').innerHTML = '<option value="">Tout impact</option>' + impOpts;
  $('#form-incident select[name=impact]').innerHTML = impOpts;
}

// ───────────────────────── Timeline ─────────────────────────

const filters = { q: '', category: '', impact: '', from: '', to: '', evidence: false };
let visibleList = [];

function matches(inc) {
  if (filters.category && inc.category !== filters.category) return false;
  if (filters.impact && inc.impact !== filters.impact) return false;
  if (filters.from && inc.date < filters.from) return false;
  if (filters.to && inc.date > filters.to) return false;
  if (filters.evidence && !inc.attachments.length) return false;
  if (filters.q) {
    const hay = fold([inc.context, inc.category, inc.facts, inc.quotes.join(' '), inc.interpretation, inc.witnesses.join(' '), inc.tags.join(' '), inc.impactNotes, inc.evidenceNote, inc.date].join(' \n '));
    const terms = fold(filters.q).split(/\s+/).filter(Boolean);
    if (!terms.every(t => hay.includes(t))) return false;
  }
  return true;
}

function highlight(text) {
  const s = esc(text);
  if (!filters.q) return s;
  const terms = fold(filters.q).split(/\s+/).filter(t => t.length > 1);
  if (!terms.length) return s;
  // Surlignage approximatif insensible aux accents : on travaille sur la version pliée pour trouver les positions.
  const folded = fold(text);
  const ranges = [];
  for (const t of terms) { let i = 0; while ((i = folded.indexOf(t, i)) >= 0) { ranges.push([i, i + t.length]); i += t.length; } }
  if (!ranges.length || folded.length !== text.length) return s; // si la normalisation a changé la longueur, on évite tout décalage
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [a, b] of ranges) { if (a < pos) continue; out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; pos = b; }
  return out + esc(text.slice(pos));
}

function render() {
  const all = store.listIncidents();
  visibleList = all.filter(matches);
  const tl = $('#timeline');
  const active = filters.q || filters.category || filters.impact || filters.from || filters.to || filters.evidence;
  $('#btn-clear-filters').hidden = !active;
  $('#count').textContent = all.length ? (active ? `${visibleList.length} / ${all.length} incident(s)` : `${all.length} incident(s)`) : '';
  $('#empty').hidden = all.length > 0;
  if (!visibleList.length) { tl.innerHTML = all.length ? '<p class="empty">Aucun incident ne correspond à ces critères.</p>' : ''; return; }
  let html = '', lastMonth = '';
  for (const inc of visibleList) {
    const [y, m, d] = inc.date.split('-').map(Number);
    const monthKey = `${y}-${m}`;
    if (monthKey !== lastMonth) { html += `<div class="month">${MONTHS[m - 1]} ${y}</div>`; lastMonth = monthKey; }
    const dow = DOWS[new Date(y, m - 1, d).getDay()];
    const atts = store.listAttachments(inc.id);
    html += `
<article class="card" data-id="${inc.id}" tabindex="0">
  <div class="when"><span class="day">${d}</span><span class="dow">${dow}</span>${inc.time ? `<span class="time">${esc(inc.time)}</span>` : ''}</div>
  <div class="head"><span class="pill">${esc(inc.category)}</span><span class="imp ${inc.impact}">${impactLabel(inc.impact)}</span>${inc.context ? `<span class="context">${highlight(inc.context)}</span>` : ''}${inc.source === 'import' && !inc.facts ? '<span class="source-import">import à compléter</span>' : ''}</div>
  <div>
    ${inc.facts ? `<div class="facts">${highlight(inc.facts)}</div>` : '<div class="facts muted">Aucun fait saisi.</div>'}
    ${inc.quotes.length ? `<div class="quote">« ${highlight(inc.quotes[0])} »${inc.quotes.length > 1 ? ` <span class="hint">+${inc.quotes.length - 1}</span>` : ''}</div>` : ''}
    ${(inc.witnesses.length || inc.tags.length) ? `<div class="meta">${inc.witnesses.length ? `<span>Témoins : ${highlight(inc.witnesses.join(', '))}</span>` : ''}${inc.tags.map(t => `<span class="tag">${highlight(t)}</span>`).join('')}</div>` : ''}
  </div>
  ${atts.length ? `<details class="ev" data-id="${inc.id}"><summary class="ev-toggle" role="button">Preuves (${atts.length}) <span class="chev">▾</span></summary><div class="ev-grid"></div></details>` : (inc.evidenceNote ? `<div class="ev hint">Preuve à joindre : ${highlight(inc.evidenceNote)}</div>` : '')}
</article>`;
  }
  tl.innerHTML = html;
}

$('#timeline').addEventListener('click', ev => {
  const thumb = ev.target.closest('.thumb');
  if (thumb) { ev.stopPropagation(); openLightbox(thumb.closest('.ev').dataset.id, Number(thumb.dataset.index)); return; }
  if (ev.target.closest('.ev')) return; // le dropdown gère lui-même son ouverture
  const card = ev.target.closest('.card');
  if (card) openEdit(card.dataset.id);
});
$('#timeline').addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.classList.contains('card')) openEdit(ev.target.dataset.id);
});
$('#timeline').addEventListener('toggle', ev => {
  const det = ev.target;
  if (det.tagName !== 'DETAILS' || !det.open) return;
  const grid = $('.ev-grid', det);
  if (grid.childElementCount) return;
  loadThumbs(grid, det.dataset.id);
}, true);

async function loadThumbs(grid, incidentId) {
  const atts = store.listAttachments(incidentId);
  grid.innerHTML = atts.map((a, i) => `<div class="thumb" data-index="${i}" title="${esc(a.name)}"><img alt="${esc(a.name)}">${a.caption ? `<span class="cap">${esc(a.caption)}</span>` : ''}</div>`).join('');
  for (let i = 0; i < atts.length; i++) {
    try { const url = await store.getThumbURL(atts[i].id); const img = grid.children[i] && grid.children[i].querySelector('img'); if (img && url) img.src = url; }
    catch (e) { console.error(e); }
  }
}

// filtres
$('#search').addEventListener('input', ev => { filters.q = ev.target.value.trim(); render(); });
$('#f-category').addEventListener('change', ev => { filters.category = ev.target.value; render(); });
$('#f-impact').addEventListener('change', ev => { filters.impact = ev.target.value; render(); });
$('#f-from').addEventListener('change', ev => { filters.from = ev.target.value; render(); });
$('#f-to').addEventListener('change', ev => { filters.to = ev.target.value; render(); });
$('#f-evidence').addEventListener('change', ev => { filters.evidence = ev.target.checked; render(); });
$('#btn-clear-filters').addEventListener('click', () => {
  Object.assign(filters, { q: '', category: '', impact: '', from: '', to: '', evidence: false });
  $('#search').value = ''; $('#f-category').value = ''; $('#f-impact').value = ''; $('#f-from').value = ''; $('#f-to').value = ''; $('#f-evidence').checked = false;
  render();
});

store.subscribe(type => { if (type === 'changed' && store.isUnlocked()) render(); });

// ───────────────────────── Fiche (panneau) ─────────────────────────

const panel = $('#panel'), form = $('#form-incident');
let currentId = null;      // id de la fiche ouverte (null = nouvelle)
let pendingFiles = [];     // images en attente pour une nouvelle fiche (non enregistrées tant que la fiche n'existe pas)
let dirty = false;

function setSaveState(text, cls = '') { const el = $('#save-state'); el.textContent = text; el.className = 'save-state ' + cls; }

function openNew(prefill = {}) {
  currentId = null; pendingFiles = []; dirty = false;
  form.reset();
  form.date.value = prefill.date || todayISO();
  form.time.value = prefill.time != null ? prefill.time : nowHM();
  form.category.value = prefill.category || CATEGORIES[0];
  form.impact.value = prefill.impact || 'modere';
  $('#panel-title').textContent = 'Nouvel incident';
  $('#btn-delete').hidden = true;
  setSaveState('Non enregistré');
  renderAttachments();
  showPanel();
  setTimeout(() => form.context.focus(), 60);
}

function openEdit(id) {
  const inc = store.getIncident(id);
  if (!inc) return;
  currentId = id; pendingFiles = []; dirty = false;
  form.reset();
  form.date.value = inc.date; form.time.value = inc.time; form.context.value = inc.context;
  form.category.value = CATEGORIES.includes(inc.category) ? inc.category : 'Autre';
  if (!CATEGORIES.includes(inc.category)) { const o = document.createElement('option'); o.value = inc.category; o.textContent = inc.category; form.category.appendChild(o); form.category.value = inc.category; }
  form.impact.value = inc.impact; form.facts.value = inc.facts; form.quotes.value = inc.quotes.join('\n');
  form.interpretation.value = inc.interpretation; form.witnesses.value = inc.witnesses.join(', '); form.tags.value = inc.tags.join(', ');
  form.impactNotes.value = inc.impactNotes; form.evidenceNote.value = inc.evidenceNote;
  $('#panel-title').textContent = 'Fiche du ' + inc.date.split('-').reverse().join('/');
  $('#btn-delete').hidden = false;
  setSaveState('Enregistré');
  renderAttachments();
  showPanel();
}

function showPanel() { panel.hidden = false; $('#scrim').hidden = false; document.body.style.overflow = 'hidden'; }
async function closePanel(force = false) {
  if (panel.hidden) return;
  if (!force && (dirty || pendingFiles.length)) {
    const ok = await confirmDlg('Fermer sans enregistrer ?', pendingFiles.length ? `${pendingFiles.length} capture(s) en attente ne seront pas conservées.` : 'Les modifications non enregistrées seront perdues.', 'Fermer sans enregistrer');
    if (!ok) return;
  }
  panel.hidden = true; $('#scrim').hidden = true; document.body.style.overflow = '';
  currentId = null; pendingFiles = []; dirty = false;
}

form.addEventListener('input', ev => { if (ev.target.closest('.attachments')) return; dirty = true; setSaveState('Modifications non enregistrées'); });
$('#btn-panel-close').addEventListener('click', () => closePanel());
$('#scrim').addEventListener('click', () => closePanel());

function readForm() {
  return {
    id: currentId || undefined,
    date: form.date.value, time: form.time.value, context: form.context.value, category: form.category.value, impact: form.impact.value,
    facts: form.facts.value, quotes: form.quotes.value.split('\n').map(s => s.replace(/^[«"“\s]+|[»"”\s]+$/g, '').trim()).filter(Boolean),
    interpretation: form.interpretation.value, witnesses: form.witnesses.value.split(',').map(s => s.trim()).filter(Boolean),
    tags: form.tags.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean),
    impactNotes: form.impactNotes.value, evidenceNote: form.evidenceNote.value
  };
}

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = $('#btn-save'); btn.disabled = true;
  try {
    const inc = await store.saveIncident(readForm());
    currentId = inc.id; dirty = false;
    $('#panel-title').textContent = 'Fiche du ' + inc.date.split('-').reverse().join('/');
    $('#btn-delete').hidden = false;
    setSaveState('Enregistré à ' + nowHM(), 'ok');
    if (pendingFiles.length) { const files = pendingFiles.map(f => f.file); pendingFiles.forEach(f => URL.revokeObjectURL(f.previewURL)); pendingFiles = []; await attachFiles(files); }
    else renderAttachments();
  } catch (e) {
    console.error(e); setSaveState('Échec : ' + e.message, 'err'); toast('Enregistrement impossible : ' + e.message, 'err');
  } finally { btn.disabled = false; }
});

$('#btn-delete').addEventListener('click', async () => {
  if (!currentId) return;
  const n = store.listAttachments(currentId).length;
  if (!await confirmDlg('Supprimer cette fiche ?', n ? `La fiche et ses ${n} capture(s) seront supprimées définitivement.` : 'La fiche sera supprimée définitivement.', 'Supprimer')) return;
  try { await store.deleteIncident(currentId); closePanel(true); toast('Fiche supprimée.'); }
  catch (e) { toast('Suppression impossible : ' + e.message, 'err'); }
});

// Pièces jointes
async function renderAttachments() {
  const list = $('#attach-list'), hint = $('#attach-hint');
  const atts = currentId ? store.listAttachments(currentId) : [];
  $('#attach-count').textContent = atts.length ? `(${atts.length})` : '';
  hint.hidden = !!currentId && !pendingFiles.length;
  hint.textContent = currentId ? '' : (pendingFiles.length ? `${pendingFiles.length} capture(s) en attente : elles seront enregistrées avec la fiche.` : 'Les captures ajoutées maintenant seront enregistrées avec la fiche. Vous pouvez aussi coller une image (Ctrl/Cmd+V) ou la glisser ici.');
  if (currentId && pendingFiles.length) { hint.hidden = false; hint.textContent = `${pendingFiles.length} capture(s) en attente.`; }
  list.innerHTML = atts.map((a, i) => `
<div class="att" data-id="${a.id}">
  <div class="thumb" data-index="${i}"><img alt="${esc(a.name)}"></div>
  <input type="text" value="${esc(a.caption || '')}" placeholder="Légende (facultatif)" data-caption="${a.id}">
  <div class="att-foot"><span>${fmtBytes(a.size)}</span><button type="button" data-remove="${a.id}">Retirer</button></div>
</div>`).join('') + pendingFiles.map(f => `
<div class="att pending"><div class="thumb"><img alt="" src="${f.previewURL}"></div><div class="att-foot"><span>En attente · ${fmtBytes(f.file.size)}</span><button type="button" data-unpend="${f.key}">Retirer</button></div></div>`).join('');
  for (let i = 0; i < atts.length; i++) {
    try { const url = await store.getThumbURL(atts[i].id); const img = list.children[i] && list.children[i].querySelector('img'); if (img && url) img.src = url; } catch (e) { console.error(e); }
  }
}

$('#attach-list').addEventListener('click', async ev => {
  const rm = ev.target.closest('[data-remove]');
  if (rm) {
    if (!await confirmDlg('Retirer cette capture ?', 'Elle sera supprimée définitivement de la fiche.', 'Retirer')) return;
    try { await store.removeAttachment(rm.dataset.remove); renderAttachments(); toast('Capture retirée.'); }
    catch (e) { toast('Impossible de retirer : ' + e.message, 'err'); }
    return;
  }
  const up = ev.target.closest('[data-unpend]');
  if (up) { pendingFiles = pendingFiles.filter(f => f.key !== up.dataset.unpend); renderAttachments(); return; }
  const th = ev.target.closest('.thumb');
  if (th && currentId && th.dataset.index != null) openLightbox(currentId, Number(th.dataset.index));
});
$('#attach-list').addEventListener('change', async ev => {
  const inp = ev.target.closest('[data-caption]');
  if (!inp) return;
  try { await store.updateAttachmentCaption(inp.dataset.caption, inp.value.trim()); setSaveState('Légende enregistrée', 'ok'); }
  catch (e) { toast('Légende non enregistrée : ' + e.message, 'err'); }
});
// Éviter que la saisie d'une légende marque la fiche comme modifiée
$('#attach-list').addEventListener('input', ev => ev.stopPropagation());

async function attachFiles(files) {
  const imgs = Array.from(files).filter(f => /^image\//.test(f.type));
  if (!imgs.length) { toast('Aucune image reconnue.', 'err'); return; }
  if (!currentId) {
    for (const file of imgs) pendingFiles.push({ key: Math.random().toString(36).slice(2), file, previewURL: URL.createObjectURL(file) });
    renderAttachments();
    return;
  }
  const prog = $('#attach-progress'); prog.hidden = false;
  let ok = 0, failed = [];
  for (let i = 0; i < imgs.length; i++) {
    prog.textContent = `Enregistrement de la capture ${i + 1} / ${imgs.length}…`;
    try { await store.addAttachment(currentId, imgs[i]); ok++; }
    catch (e) { console.error(e); failed.push(imgs[i].name || 'image'); }
  }
  prog.hidden = true;
  renderAttachments();
  if (ok) toast(`${ok} capture(s) enregistrée(s).`, 'ok');
  if (failed.length) toast(`Non enregistrée(s) : ${failed.join(', ')}`, 'err');
}

$('#file-input').addEventListener('change', ev => { attachFiles(ev.target.files); ev.target.value = ''; });

// Coller une image : dans le panneau → jointe à la fiche ; ailleurs → nouvelle fiche avec la capture en attente.
document.addEventListener('paste', ev => {
  if (!store.isUnlocked()) return;
  const items = Array.from(ev.clipboardData ? ev.clipboardData.items : []).filter(it => it.kind === 'file' && /^image\//.test(it.type));
  if (!items.length) return;
  if ($$('dialog[open]').length || !$('#lightbox').hidden) return;
  ev.preventDefault();
  const files = items.map((it, i) => { const f = it.getAsFile(); return new File([f], f.name && f.name !== 'image.png' ? f.name : `collage-${stamp()}-${i + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }); });
  if (panel.hidden) openNew();
  attachFiles(files);
});
// Glisser-déposer dans le panneau
['dragenter', 'dragover'].forEach(evn => panel.addEventListener(evn, ev => { ev.preventDefault(); panel.classList.add('drop'); }));
['dragleave', 'drop'].forEach(evn => panel.addEventListener(evn, ev => { ev.preventDefault(); panel.classList.remove('drop'); }));
panel.addEventListener('drop', ev => { if (ev.dataTransfer && ev.dataTransfer.files.length) attachFiles(ev.dataTransfer.files); });

// ───────────────────────── Visionneuse ─────────────────────────

const lb = $('#lightbox'), lbImg = $('#lb-img'), lbStage = $('#lb-stage');
let lbList = [], lbIndex = 0, lbURL = null;

async function openLightbox(incidentId, index = 0) {
  lbList = store.listAttachments(incidentId);
  if (!lbList.length) return;
  lbIndex = Math.max(0, Math.min(index, lbList.length - 1));
  lb.hidden = false; document.body.style.overflow = 'hidden';
  await showLb();
}
async function showLb() {
  const a = lbList[lbIndex];
  lbStage.classList.remove('zoomed');
  $('#lb-caption').textContent = a.name + (a.caption ? ' — ' + a.caption : '');
  $('#lb-index').textContent = `${lbIndex + 1} / ${lbList.length}`;
  $('#lb-prev').disabled = lbIndex === 0; $('#lb-next').disabled = lbIndex === lbList.length - 1;
  if (lbURL) { URL.revokeObjectURL(lbURL); lbURL = null; }
  lbImg.removeAttribute('src');
  try { const thumb = await store.getThumbURL(a.id); if (thumb) lbImg.src = thumb; } catch (_) {}
  try { lbURL = URL.createObjectURL(await store.getAttachmentBlob(a.id)); lbImg.src = lbURL; }
  catch (e) { toast('Impossible de lire la capture : ' + e.message, 'err'); }
}
function closeLightbox() {
  if (lb.hidden) return;
  lb.hidden = true; if (panel.hidden) document.body.style.overflow = '';
  if (lbURL) { URL.revokeObjectURL(lbURL); lbURL = null; }
  lbImg.removeAttribute('src');
}
$('#lb-close').addEventListener('click', closeLightbox);
$('#lb-prev').addEventListener('click', () => { if (lbIndex > 0) { lbIndex--; showLb(); } });
$('#lb-next').addEventListener('click', () => { if (lbIndex < lbList.length - 1) { lbIndex++; showLb(); } });
$('#lb-download').addEventListener('click', async () => {
  const a = lbList[lbIndex]; if (!a) return;
  try { download(await store.getAttachmentBlob(a.id), a.name); } catch (e) { toast(e.message, 'err'); }
});
lbImg.addEventListener('click', ev => {
  const zoomed = lbStage.classList.toggle('zoomed');
  if (zoomed) {
    // centre le zoom sur le point cliqué
    const rx = (ev.clientX - lbStage.getBoundingClientRect().left) / lbStage.clientWidth, ry = (ev.clientY - lbStage.getBoundingClientRect().top) / lbStage.clientHeight;
    requestAnimationFrame(() => { lbStage.scrollLeft = (lbImg.naturalWidth - lbStage.clientWidth) * rx; lbStage.scrollTop = (lbImg.naturalHeight - lbStage.clientHeight) * ry; });
  }
});
lb.addEventListener('click', ev => { if (ev.target === lbStage) closeLightbox(); });
let touchX = null;
lbStage.addEventListener('touchstart', ev => { touchX = ev.touches[0].clientX; }, { passive: true });
lbStage.addEventListener('touchend', ev => {
  if (touchX == null || lbStage.classList.contains('zoomed')) return;
  const dx = ev.changedTouches[0].clientX - touchX; touchX = null;
  if (dx < -60 && lbIndex < lbList.length - 1) { lbIndex++; showLb(); } else if (dx > 60 && lbIndex > 0) { lbIndex--; showLb(); }
}, { passive: true });

// ───────────────────────── Menu & actions ─────────────────────────

const menu = $('#menu');
$('#btn-menu').addEventListener('click', ev => { ev.stopPropagation(); menu.hidden = !menu.hidden; $('#btn-menu').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', ev => { if (!menu.hidden && !ev.target.closest('.topbar-actions')) menu.hidden = true; });
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-action]'); if (!b) return;
  menu.hidden = true;
  const a = b.dataset.action;
  if (a === 'import') openImport();
  else if (a === 'report') openReport();
  else if (a === 'backup') doBackup();
  else if (a === 'restore') openRestore();
  else if (a === 'settings') openSettings();
  else if (a === 'lock') lockApp();
});
$('#btn-new').addEventListener('click', () => openNew());

document.addEventListener('keydown', ev => {
  if (!store.isUnlocked()) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;
  if (ev.key === 'Escape') {
    if (!lb.hidden) { closeLightbox(); return; }
    if (!menu.hidden) { menu.hidden = true; return; }
    if (!panel.hidden && !$$('dialog[open]').length) { closePanel(); return; }
    return;
  }
  if (!lb.hidden) { if (ev.key === 'ArrowLeft') $('#lb-prev').click(); if (ev.key === 'ArrowRight') $('#lb-next').click(); return; }
  if ((ev.metaKey || ev.ctrlKey) && ev.key === 's' && !panel.hidden) { ev.preventDefault(); form.requestSubmit(); return; }
  if (typing) return;
  if (ev.key === '/') { ev.preventDefault(); $('#search').focus(); }
  else if (ev.key === 'n' && panel.hidden) { ev.preventDefault(); openNew(); }
});

// Sauvegarde
async function doBackup() {
  try {
    toast('Préparation de la sauvegarde…');
    const blob = await store.exportBackup();
    download(blob, `carnet-${stamp()}.carnet`);
    $('#backup-banner').hidden = true;
    toast('Sauvegarde chiffrée téléchargée. Conservez-la en lieu sûr.', 'ok');
  } catch (e) { toast('Sauvegarde impossible : ' + e.message, 'err'); }
}
async function checkBackupReminder() {
  const last = await store.getPref('lastBackupAt', null);
  const dismissed = await store.getPref('backupDismissedAt', null);
  const n = store.listIncidents().length;
  if (!n) return;
  const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  const dismissedDays = dismissed ? (Date.now() - new Date(dismissed).getTime()) / 86400000 : Infinity;
  if (days > 14 && dismissedDays > 3) {
    $('#backup-banner-text').textContent = last ? `Dernière sauvegarde il y a ${Math.floor(days)} jours. Les données ne vivent que dans ce navigateur.` : 'Aucune sauvegarde pour l\'instant. Les données ne vivent que dans ce navigateur : exportez un fichier chiffré régulièrement.';
    $('#backup-banner').hidden = false;
  }
}
$('#btn-banner-dismiss').addEventListener('click', async () => { $('#backup-banner').hidden = true; await store.setPref('backupDismissedAt', new Date().toISOString()); });

// Restauration
function openRestore() { $('#restore-file').value = ''; $('#restore-pass').value = ''; $('#restore-state').textContent = ''; $('#dlg-restore').showModal(); }
$('#btn-restore-go').addEventListener('click', async () => {
  const file = $('#restore-file').files[0], pass = $('#restore-pass').value, mode = $('input[name=restore-mode]:checked').value, st = $('#restore-state');
  if (!file) { st.textContent = 'Choisissez un fichier.'; return; }
  if (!pass) { st.textContent = 'Saisissez la phrase secrète de la sauvegarde.'; return; }
  if (mode === 'replace' && !await confirmDlg('Remplacer tout le contenu ?', 'Toutes les fiches et captures actuelles seront supprimées avant la restauration.', 'Remplacer')) return;
  st.textContent = 'Lecture et déchiffrement…';
  try {
    const plain = await store.readBackup(file, pass);
    st.textContent = `Restauration de ${plain.incidents.length} fiche(s), ${plain.attachments.length} capture(s)…`;
    const r = await store.restoreBackup(plain, mode);
    $('#dlg-restore').close();
    toast(`Restauré : ${r.incidents} fiche(s), ${r.attachments} capture(s).`, 'ok');
    render();
  } catch (e) { st.textContent = 'Échec : ' + e.message; }
});

// Import Claude
let importItems = [];
function openImport() { importItems = []; $('#import-text').value = ''; $('#import-preview').hidden = true; $('#btn-import-go').disabled = true; $('#copy-state').textContent = ''; $('#dlg-import').showModal(); }
$('#btn-copy-prompt').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(claudePrompt()); $('#copy-state').textContent = 'Consigne copiée.'; }
  catch (_) { $('#import-text').value = claudePrompt(); $('#copy-state').textContent = 'Copie refusée par le navigateur : la consigne est affichée ci-dessous, copiez-la manuellement.'; }
});
$('#btn-import-preview').addEventListener('click', () => {
  const pv = $('#import-preview'); pv.hidden = false;
  try {
    const { items, warnings } = parseImport($('#import-text').value);
    importItems = items;
    pv.innerHTML = `<strong>${items.length} fiche(s) prête(s)</strong><ul>${items.map(i => `<li>${esc(i.date)}${i.time ? ' ' + esc(i.time) : ''} · ${esc(i.category)} · ${esc((i.facts || i.context || '(sans fait)').slice(0, 90))}${(i.facts || '').length > 90 ? '…' : ''}</li>`).join('')}</ul>${warnings.length ? `<ul>${warnings.map(w => `<li class="w">${esc(w)}</li>`).join('')}</ul>` : ''}<p class="notice">Aucune capture n'est importée par cette opération : après l'import, ouvrez chaque fiche pour y joindre les images.</p>`;
    $('#btn-import-go').disabled = !items.length;
  } catch (e) { importItems = []; pv.innerHTML = `<span class="w">${esc(e.message)}</span>`; $('#btn-import-go').disabled = true; }
});
$('#btn-import-go').addEventListener('click', async () => {
  if (!importItems.length) return;
  $('#btn-import-go').disabled = true;
  let ok = 0, firstId = null;
  for (const it of importItems) { try { const inc = await store.saveIncident(it); ok++; firstId = firstId || inc.id; } catch (e) { console.error(e); } }
  $('#dlg-import').close();
  if (ok === importItems.length) toast(`${ok} fiche(s) importée(s) — captures à joindre manuellement.`, 'ok'); else toast(`${ok} / ${importItems.length} fiche(s) importée(s).`, 'err');
  render();
  if (ok === 1 && firstId) openEdit(firstId);
});

// Rapport
function openReport() {
  const all = store.listIncidents();
  $('#rep-filtered').checked = false;
  $('#rep-from').value = all.length ? all[all.length - 1].date : ''; $('#rep-to').value = all.length ? all[0].date : '';
  updateReportCount(); $('#dlg-report').showModal();
}
function reportSelection() {
  const base = $('#rep-filtered').checked ? visibleList : store.listIncidents();
  const from = $('#rep-from').value, to = $('#rep-to').value;
  return base.filter(i => (!from || i.date >= from) && (!to || i.date <= to));
}
function updateReportCount() { const sel = reportSelection(); $('#rep-count').textContent = `${sel.length} incident(s), ${sel.reduce((n, i) => n + i.attachments.length, 0)} capture(s) sélectionné(s).`; }
['#rep-from', '#rep-to', '#rep-filtered'].forEach(s => $(s).addEventListener('change', updateReportCount));
$('#btn-report-go').addEventListener('click', async () => {
  const sel = reportSelection();
  if (!sel.length) { toast('Aucun incident dans la sélection.', 'err'); return; }
  const btn = $('#btn-report-go'); btn.disabled = true;
  try {
    const html = await buildReport({ incidents: sel, includeImages: $('#rep-images').checked, includeInterpretation: $('#rep-interp').checked, title: $('#rep-title').value.trim() || 'Chronologie des incidents', author: $('#rep-author').value.trim(), onProgress: (i, n) => { $('#rep-count').textContent = `Génération ${i} / ${n}…`; } });
    download(new Blob([html], { type: 'text/html' }), `rapport-${stamp()}.html`);
    $('#dlg-report').close();
    toast('Rapport téléchargé. Ouvrez-le puis « Imprimer → PDF ».', 'ok');
  } catch (e) { toast('Rapport impossible : ' + e.message, 'err'); }
  finally { btn.disabled = false; updateReportCount(); }
});

// Paramètres
async function openSettings() {
  const s = await store.stats(); const last = await store.getPref('lastBackupAt', null);
  $('#stats').innerHTML = `<dt>Fiches</dt><dd>${s.incidents}</dd><dt>Captures</dt><dd>${s.attachments} (${fmtBytes(s.attachBytes)})</dd><dt>Stockage navigateur</dt><dd>${s.usage != null ? fmtBytes(s.usage) + (s.quota ? ' / ' + fmtBytes(s.quota) : '') : 'inconnu'}</dd><dt>Dernière sauvegarde</dt><dd>${last ? new Date(last).toLocaleString('fr-FR') : 'jamais'}</dd>`;
  $('#pp-state').textContent = ''; ['#pp-old', '#pp-new', '#pp-new2'].forEach(x => $(x).value = '');
  $('#dlg-settings').showModal();
}
$('#set-lock').addEventListener('change', async ev => { lockMinutes = Number(ev.target.value); await store.setPref('lockMinutes', lockMinutes); armAutoLock(); });
$('#btn-pp-go').addEventListener('click', async () => {
  const o = $('#pp-old').value, n = $('#pp-new').value, n2 = $('#pp-new2').value, st = $('#pp-state');
  if (n.length < 8) { st.textContent = '8 caractères minimum.'; return; }
  if (n !== n2) { st.textContent = 'Les deux phrases diffèrent.'; return; }
  st.textContent = 'Re-chiffrement…';
  try { await store.changePassphrase(o, n); st.textContent = 'Phrase modifiée.'; toast('Phrase secrète modifiée. Les anciennes sauvegardes restent lisibles avec l\'ancienne phrase.', 'ok'); ['#pp-old', '#pp-new', '#pp-new2'].forEach(x => $(x).value = ''); }
  catch (e) { st.textContent = e.message; }
});
$('#btn-plain-export').addEventListener('click', () => {
  try { download(new Blob([store.exportPlainJSON()], { type: 'application/json' }), `carnet-clair-${stamp()}.json`); toast('JSON en clair téléchargé (sans images).'); }
  catch (e) { toast(e.message, 'err'); }
});
$('#btn-wipe').addEventListener('click', async () => {
  if (!await confirmDlg('Effacer définitivement ?', 'Toutes les fiches, captures et la phrase secrète seront supprimées de cet appareil. Seule une sauvegarde permettra de les retrouver.', 'Tout effacer')) return;
  $('#dlg-settings').close();
  await store.wipeEverything();
  $('#app').hidden = true; $('#gate').hidden = false; $('#gate-unlock').hidden = true; $('#gate-setup').hidden = false;
  toast('Carnet effacé.');
});

// Fermer un dialogue en cliquant sur le fond
$$('dialog').forEach(d => d.addEventListener('click', ev => { if (ev.target === d) d.close('cancel'); }));

boot();
