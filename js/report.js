// report.js — génération d'un rapport chronologique autonome (HTML imprimable → PDF via le navigateur).
// Les images sont intégrées en base64 : le fichier est autonome et ne dépend d'aucun serveur.

import * as store from './store.js';
import { IMPACTS } from './store.js';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function nl(s) { return esc(s).replace(/\n/g, '<br>'); }
function fmtDate(d, t) {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  const s = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1) + (t ? ` à ${t.replace(':', 'h')}` : '');
}
function impactLabel(v) { const f = IMPACTS.find(i => i.value === v); return f ? f.label : v; }

async function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

// options : { incidents: [...], includeInterpretation, includeImages, title, author, from, to, onProgress }
export async function buildReport(options) {
  const { incidents, includeInterpretation = true, includeImages = true, title = 'Chronologie des incidents', author = '', onProgress } = options;
  const sorted = [...incidents].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const now = new Date();
  const parts = [];
  let i = 0;
  for (const inc of sorted) {
    i++;
    if (onProgress) onProgress(i, sorted.length);
    const atts = store.listAttachments(inc.id);
    let imgs = '';
    if (includeImages && atts.length) {
      const figs = [];
      for (const a of atts) {
        try {
          const url = await blobToDataURL(await store.getAttachmentBlob(a));
          figs.push(`<figure><img src="${url}" alt="${esc(a.name)}"><figcaption>Pièce ${esc(a.name)}${a.caption ? ' — ' + esc(a.caption) : ''}</figcaption></figure>`);
        } catch (e) { figs.push(`<p class="muted">Pièce ${esc(a.name)} : illisible.</p>`); }
      }
      imgs = `<div class="evidence"><h4>Pièces jointes (${atts.length})</h4>${figs.join('')}</div>`;
    } else if (atts.length) {
      imgs = `<p class="muted">${atts.length} pièce(s) jointe(s) disponible(s) sur demande : ${atts.map(a => esc(a.name)).join(', ')}.</p>`;
    }
    parts.push(`
<article class="incident">
  <header>
    <div class="num">${i}</div>
    <div>
      <h3>${esc(fmtDate(inc.date, inc.time))}</h3>
      <p class="meta">${esc(inc.category)} · Impact ${esc(impactLabel(inc.impact))}${inc.context ? ' · ' + esc(inc.context) : ''}</p>
    </div>
  </header>
  ${inc.facts ? `<section><h4>Faits observés</h4><p>${nl(inc.facts)}</p></section>` : ''}
  ${inc.quotes.length ? `<section><h4>Propos rapportés (citations exactes)</h4><ul class="quotes">${inc.quotes.map(q => `<li>« ${esc(q)} »</li>`).join('')}</ul></section>` : ''}
  ${inc.witnesses.length ? `<section><h4>Témoins</h4><p>${esc(inc.witnesses.join(', '))}</p></section>` : ''}
  ${inc.impactNotes ? `<section><h4>Conséquences</h4><p>${nl(inc.impactNotes)}</p></section>` : ''}
  ${includeInterpretation && inc.interpretation ? `<section class="interp"><h4>Interprétation personnelle</h4><p>${nl(inc.interpretation)}</p></section>` : ''}
  ${inc.evidenceNote && !atts.length ? `<p class="muted">Preuve mentionnée : ${esc(inc.evidenceNote)}</p>` : ''}
  ${imgs}
</article>`);
  }
  const range = sorted.length ? `${fmtDate(sorted[0].date, '')} — ${fmtDate(sorted[sorted.length - 1].date, '')}` : '';
  const byCat = {};
  sorted.forEach(x => { byCat[x.category] = (byCat[x.category] || 0) + 1; });
  const summary = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<tr><td>${esc(c)}</td><td>${n}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --ink:#1c1b1a; --muted:#6b6763; --line:#e3dfd9; --accent:#2f4858; --paper:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; font: 11pt/1.55 Georgia, 'Times New Roman', serif; color:var(--ink); background:#f4f1ec; }
  .page { max-width: 820px; margin: 0 auto; background: var(--paper); padding: 48px 56px; }
  h1 { font-size: 22pt; font-weight: 500; margin: 0 0 4px; letter-spacing: .01em; }
  .sub { color: var(--muted); margin: 0 0 24px; font-size: 10pt; }
  .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid var(--line); padding: 10px 56px; display:flex; gap: 12px; align-items:center; font: 10pt system-ui, sans-serif; }
  .toolbar button { font: inherit; padding: 6px 12px; border: 1px solid var(--ink); background: var(--ink); color: #fff; border-radius: 4px; cursor: pointer; }
  table.summary { border-collapse: collapse; margin: 0 0 28px; font-size: 10pt; }
  table.summary td { padding: 4px 14px 4px 0; border-bottom: 1px solid var(--line); }
  .incident { border-top: 1px solid var(--line); padding: 20px 0 8px; page-break-inside: avoid; }
  .incident header { display:flex; gap: 14px; align-items:flex-start; margin-bottom: 10px; }
  .num { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--ink); display:flex; align-items:center; justify-content:center; font-size: 10pt; flex: none; margin-top: 2px; }
  h3 { margin: 0; font-size: 13pt; font-weight: 600; }
  .meta { margin: 2px 0 0; color: var(--muted); font-size: 9.5pt; }
  h4 { margin: 12px 0 4px; font: 600 8.5pt system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  section p { margin: 0; }
  ul.quotes { margin: 0; padding-left: 18px; }
  ul.quotes li { margin: 2px 0; font-style: italic; }
  .interp { background: #faf7f2; border-left: 2px solid #d9cdb8; padding: 6px 12px; margin-top: 10px; }
  .interp h4 { margin-top: 2px; color: #8a6d3b; }
  .muted { color: var(--muted); font-size: 9.5pt; }
  .evidence figure { margin: 10px 0; page-break-inside: avoid; }
  .evidence img { max-width: 100%; max-height: 520px; border: 1px solid var(--line); display:block; }
  figcaption { font: 9pt system-ui, sans-serif; color: var(--muted); margin-top: 4px; }
  footer { margin-top: 32px; color: var(--muted); font-size: 9pt; border-top: 1px solid var(--line); padding-top: 10px; }
  @media print { body { background:#fff; } .page { padding: 0; max-width: none; } .toolbar { display:none; } }
</style></head><body>
<div class="toolbar"><strong>Rapport généré</strong><span style="color:#777">Imprimer ou « Enregistrer en PDF » depuis le navigateur.</span><span style="flex:1"></span><button onclick="window.print()">Imprimer / PDF</button></div>
<div class="page">
  <h1>${esc(title)}</h1>
  <p class="sub">${sorted.length} incident(s)${range ? ' · ' + esc(range) : ''}${author ? ' · ' + esc(author) : ''} · Généré le ${esc(now.toLocaleDateString('fr-FR'))} à ${esc(now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}${includeInterpretation ? '' : ' · Faits et citations uniquement (interprétations exclues)'}</p>
  ${summary ? `<table class="summary"><tbody>${summary}</tbody></table>` : ''}
  ${parts.join('\n')}
  <footer>Les sections « Faits observés » et « Propos rapportés » sont distinguées des « Interprétations personnelles ». Les citations sont reproduites telles que notées au moment des faits.</footer>
</div></body></html>`;
}
