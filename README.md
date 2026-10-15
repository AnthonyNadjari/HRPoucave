# Carnet

Carnet personnel pour documenter des incidents professionnels et retrouver instantanément les preuves associées.
Tout est dans ce dépôt GitHub : le code, et les données **chiffrées** (`data/`). Le site est servi par GitHub Pages.

Application : https://anthonynadjari.github.io/HRPoucave/ (s'ouvre avec le lien d'accès, voir plus bas)

## Comment ça marche

* `data/incidents.enc` contient toutes les fiches ; `data/img/*.enc` les captures. Chiffrement AES-GCM 256.
* La clé n'est **jamais** dans le dépôt. Elle est dans le lien d'accès (`…/HRPoucave/#k=…`). Ouvert une fois sur un appareil, le lien est retenu et la clé est retirée de la barre d'adresse. La partie après `#` n'est jamais envoyée à GitHub.
* Sans la clé, le contenu de `data/` est illisible, même si le dépôt est public.

## Ajouter ou modifier des fiches

* **Par Claude (recommandé)** : envoyez la capture et quelques mots dans une conversation avec le lien d'accès. Claude structure la fiche et la publie avec `tools/carnet.mjs`.
* **Depuis l'application** : *Nouveau*, collage d'une capture ou modification d'une fiche crée un **brouillon sur l'appareil**, signalé comme non publié. GitHub Pages ne permet pas d'écrire dans le dépôt sans identifiant. Menu ⋯ → *Brouillons → Claude* exporte les brouillons (avec captures) à envoyer à Claude, qui les publie. Une fois publiés, ils disparaissent de l'appareil.

## Fonctionnalités

* Timeline par mois, recherche plein texte insensible aux accents (`/`), filtres catégorie, impact, période, présence de preuves.
* Fiches : faits observés, citations exactes et interprétation personnelle visuellement distincts ; témoins, mots-clés, conséquences.
* Preuves : dépliant « Preuves (n) » dans chaque carte, visionneuse plein écran avec zoom, navigation clavier et balayage.
* Rapport HTML chronologique autonome avec les captures intégrées, option sans interprétations, imprimable en PDF.
* Import du JSON produit par Claude ([docs/IMPORT_CLAUDE.md](docs/IMPORT_CLAUDE.md)).

## Outil de publication

```
CARNET_KEY=<partie après #k=> node tools/carnet.mjs show
CARNET_KEY=… node tools/carnet.mjs img <capture.png> <id-aléatoire>
CARNET_KEY=… node tools/carnet.mjs upsert <fiches.json>
CARNET_KEY=… node tools/carnet.mjs merge-drafts <carnet-brouillons-….json>
git add data && git commit -m "Mise à jour des données" && git push
```

Les noms de fichiers d'images et les messages de commit restent neutres : ils sont publics.

Architecture détaillée : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
