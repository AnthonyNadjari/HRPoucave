// importer.js — import rapide depuis Claude (ou toute saisie structurée).
// Format accepté : objet { format: 'carnet-incidents/import/1', incidents: [...] }
// ou directement un tableau d'incidents, ou un seul incident.
// Les captures ne peuvent PAS transiter par ce JSON : l'import crée les fiches,
// puis l'utilisateur joint lui-même les images. L'interface le dit explicitement.

import { CATEGORIES, normalizeIncident } from './store.js';

export const IMPORT_FORMAT = 'carnet-incidents/import/1';

export function parseImport(text) {
  let raw = String(text || '').trim();
  // Tolère un bloc ```json ... ```
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  // Tolère du texte autour : prend du premier { ou [ jusqu'au dernier } ou ]
  if (!/^[\[{]/.test(raw)) {
    const start = Math.min(...['{', '['].map(c => { const i = raw.indexOf(c); return i < 0 ? Infinity : i; }));
    const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (start !== Infinity && end > start) raw = raw.slice(start, end + 1);
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error('JSON invalide : ' + e.message); }
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.incidents)) list = data.incidents;
  else if (data && typeof data === 'object' && (data.date || data.facts || data.category)) list = [data];
  else throw new Error('Structure non reconnue : attendu { "incidents": [...] }.');
  const warnings = [];
  const items = list.map((x, i) => {
    const w = [];
    if (!x || typeof x !== 'object') throw new Error(`Incident n°${i + 1} invalide.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ''))) w.push('date absente ou invalide → aujourd\'hui');
    if (x.category && !CATEGORIES.includes(x.category)) w.push(`catégorie « ${x.category} » conservée telle quelle`);
    if (!x.facts) w.push('aucun fait observé');
    const inc = normalizeIncident({ ...x, id: undefined, attachments: [], source: 'import', createdAt: undefined, updatedAt: undefined });
    if (w.length) warnings.push(`Incident n°${i + 1} : ${w.join(' ; ')}`);
    return inc;
  });
  return { items, warnings };
}

export function claudePrompt() {
  return `Tu m'aides à documenter un incident professionnel. À partir de la capture d'écran ou de la note ci-jointe, produis UNIQUEMENT un objet JSON valide (sans commentaire, sans texte autour) au format suivant :

{
  "format": "${IMPORT_FORMAT}",
  "incidents": [
    {
      "date": "AAAA-MM-JJ",
      "time": "HH:MM",
      "context": "Lieu, réunion ou canal (ex. : point hebdo Teams, open space, mail)",
      "category": "une valeur parmi : ${CATEGORIES.join(' | ')}",
      "impact": "faible | modere | eleve | critique",
      "impactNotes": "Conséquence concrète pour moi (stress, travail refait, retard, etc.)",
      "facts": "Faits observables uniquement, au passé, sans jugement, chronologiques.",
      "quotes": ["Citation exacte 1, mot pour mot", "Citation exacte 2"],
      "interpretation": "Mon ressenti / interprétation, clairement séparé des faits.",
      "witnesses": ["Prénom N."],
      "tags": ["mot-clé", "projet"],
      "evidenceNote": "Description de la preuve à joindre (ex. : capture Teams du 12/03 10h32)"
    }
  ]
}

Règles :
- Ne reformule pas les citations : recopie-les exactement, entre guillemets. Si un mot est illisible, écris [illisible].
- Mets dans "facts" seulement ce qui est visible/observé ; mets le ressenti dans "interpretation".
- Si une information manque (heure, témoins…), laisse la chaîne vide ou le tableau vide. N'invente rien.
- Si la date n'est pas visible, laisse "date" vide et signale-le dans "evidenceNote".
- Un seul incident par capture sauf si plusieurs événements distincts sont visibles.`;
}
