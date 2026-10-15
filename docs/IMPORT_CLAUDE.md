# Import rapide depuis Claude

L'application sait importer des fiches au format JSON ci-dessous (menu **⋯ → Importer depuis Claude…**).
Le bouton **Copier la consigne pour Claude** dans ce dialogue copie un prompt prêt à l'emploi.

## Flux

1. Dans Claude, joignez votre capture d'écran ou collez votre note, puis collez la consigne.
2. Claude renvoie un objet JSON. Copiez-le (bloc ```json accepté tel quel).
3. Dans le carnet : **Importer depuis Claude… → coller → Vérifier → Importer**.
4. **Les images ne transitent pas par le JSON.** Ouvrez ensuite chaque fiche importée et joignez la capture
   (bouton *Ajouter des captures*, collage Ctrl/Cmd+V, ou glisser-déposer).
5. Les fiches importées sont des **brouillons sur l'appareil** : envoyez-les à Claude (menu ⋯ → *Brouillons → Claude*) pour qu'il les publie dans le dépôt.

Le plus simple reste d'envoyer directement la capture à Claude : il crée la fiche et la publie lui-même.

## Format

```json
{
  "format": "carnet-incidents/import/1",
  "incidents": [
    {
      "date": "2026-10-14",
      "time": "10:30",
      "context": "Point hebdo Teams",
      "category": "Humiliation publique",
      "impact": "eleve",
      "impactNotes": "Présentation reprise à zéro, soirée de travail supplémentaire.",
      "facts": "Lors du point hebdo, en présence de l'équipe, M. a interrompu ma présentation après 2 minutes et a demandé à R. de « reprendre le sujet ».",
      "quotes": ["On va demander à quelqu'un de compétent de reprendre le sujet."],
      "interpretation": "J'ai ressenti cela comme une humiliation délibérée devant l'équipe.",
      "witnesses": ["R. D.", "S. M."],
      "tags": ["point hebdo", "présentation Q4"],
      "evidenceNote": "Capture du chat Teams 10h34 à joindre"
    }
  ]
}
```

Un tableau nu `[ {...}, {...} ]` ou un incident seul `{...}` sont aussi acceptés.

| Champ | Type | Règles |
|---|---|---|
| `date` | `AAAA-MM-JJ` | Obligatoire en pratique ; sinon la date du jour est utilisée et un avertissement s'affiche. |
| `time` | `HH:MM` | Facultatif. |
| `context` | texte | Lieu, réunion, canal. |
| `category` | texte | De préférence l'une des catégories de l'application (voir `js/store.js`, `CATEGORIES`). Une valeur inconnue est conservée telle quelle. |
| `impact` | `faible` · `modere` · `eleve` · `critique` | Défaut : `modere`. |
| `impactNotes` | texte | Conséquences concrètes. |
| `facts` | texte | Faits observables uniquement. |
| `quotes` | tableau de textes | Citations exactes, mot pour mot. |
| `interpretation` | texte | Ressenti, hypothèses. Toujours séparé des faits. |
| `witnesses` | tableau de textes | |
| `tags` | tableau de textes | Mots-clés de recherche. |
| `evidenceNote` | texte | Mémo sur la preuve à joindre. |

Les fiches importées portent `source: "import"` et sont signalées « import à compléter » dans la timeline tant que le champ `facts` est vide.
