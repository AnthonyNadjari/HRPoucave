# Carnet

Carnet personnel pour documenter des incidents professionnels et retrouver instantanément les preuves associées.
Interface statique sur GitHub Pages ; **les données vivent dans un dépôt GitHub privé à vous**, modifié directement par l'application via l'API GitHub. Tout est dans git, accessible depuis mobile et ordinateur.

Application : https://anthonynadjari.github.io/HRPoucave/

> Ce dépôt (public) ne contient que du code. Les fiches et captures sont dans un dépôt privé séparé (`CarnetData`).

## Mise en route (2 minutes)

1. Créer un dépôt **privé** : https://github.com/new → nom `CarnetData`, visibilité *Private*.
2. Créer un token : https://github.com/settings/personal-access-tokens/new → *Fine-grained*, expiration la plus longue, *Only select repositories → CarnetData*, *Permissions → Contents → Read and write*.
3. Ouvrir l'application, saisir `AnthonyNadjari/CarnetData` et le token, **Connecter**. Le token reste dans ce navigateur (à refaire sur chaque appareil).

L'application refuse de se connecter à un dépôt public.

## Fonctionnalités

* **Ajout rapide** (`n`) : date, heure, contexte, catégorie, impact, faits observés, citations exactes, interprétation personnelle, témoins, mots-clés, conséquences.
* **Preuves** : plusieurs captures par fiche (sélection, collage Ctrl/Cmd+V, glisser-déposer), dépliant « Preuves (n) » dans la timeline, visionneuse plein écran avec zoom et navigation.
* **Timeline** : chronologie par mois, recherche plein texte insensible aux accents (`/`), filtres catégorie, impact, période, présence de preuves.
* **Fiches** : faits, citations et interprétations visuellement distincts ; légende par capture ; état d'enregistrement explicite (« Enregistré dans le dépôt » n'apparaît qu'après le commit réussi).
* **Rapport** : HTML chronologique autonome avec captures intégrées, option sans interprétations, imprimable en PDF.
* **Import depuis Claude** : consigne à copier + import du JSON renvoyé ([docs/IMPORT_CLAUDE.md](docs/IMPORT_CLAUDE.md)).
* **Hors ligne** : la dernière copie est affichée en lecture seule ; toute écriture impossible est signalée.

## Stockage

```
CarnetData (privé)
├── incidents.json           toutes les fiches (JSON lisible)
└── images/
    ├── <date>_<id>.<ext>      capture originale
    └── <date>_<id>.thumb.jpg  miniature 360 px
```

Chaque enregistrement est un commit : l'historique git garde toutes les versions. Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Développement

Aucun outil requis. Servir le dossier en HTTP (les modules ES ne se chargent pas en `file://`) : `python3 -m http.server 8000`.
Déploiement : push sur `main` → le workflow reflète vers `gh-pages`, servie par GitHub Pages.
