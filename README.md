# Carnet

Carnet personnel pour documenter des incidents professionnels et retrouver instantanément les preuves associées.
Application statique (GitHub Pages), **chiffrée côté navigateur**, utilisable sur mobile et ordinateur.

Démo : https://anthonynadjari.github.io/HRPoucave/

> Ce dépôt ne contient que du code. Aucune donnée, aucune capture n'y est stockée : tout reste dans le navigateur
> de l'utilisateur, chiffré avec une phrase secrète connue de lui seul.

## Fonctionnalités

* **Ajout rapide** : date, heure, contexte, catégorie, impact, faits observés, citations exactes, interprétation personnelle, témoins, mots-clés, conséquences. Raccourci `n`.
* **Preuves** : plusieurs captures par fiche, par sélection, collage (Ctrl/Cmd+V) ou glisser-déposer. Aperçu dans un dépliant « Preuves (n) » directement dans la timeline, agrandissement plein écran avec zoom et navigation.
* **Timeline** : chronologie groupée par mois, recherche plein texte insensible aux accents (`/`), filtres par catégorie, impact, période, présence de preuves.
* **Fiches** : faits, citations et interprétations visuellement distincts ; légende par capture ; état d'enregistrement explicite.
* **Rapport** : HTML chronologique autonome avec les captures intégrées, option « sans interprétations », imprimable en PDF.
* **Import depuis Claude** : consigne à copier + import du JSON renvoyé ([docs/IMPORT_CLAUDE.md](docs/IMPORT_CLAUDE.md)).
* **Sauvegarde / restauration** : fichier `.carnet` chiffré, fusion ou remplacement, restauration sur un autre appareil.
* **Protection** : phrase secrète, AES-GCM 256, verrouillage automatique après inactivité, titre d'onglet neutre.

## Utilisation

1. Ouvrir la page, créer une phrase secrète (8 caractères minimum). **Elle n'est pas récupérable.**
2. Ajouter une fiche, enregistrer, joindre les captures.
3. Faire une sauvegarde (`⋯ → Sauvegarder`) régulièrement et la conserver hors du navigateur.

Pour restaurer sur un nouvel appareil : créer un carnet **avec la même phrase secrète** que la sauvegarde, puis `⋯ → Restaurer`.

## Développement

Aucun outil requis. Servir le dossier en HTTP (les modules ES ne se chargent pas en `file://`) :

```
python3 -m http.server 8000
```

Architecture, modèle de données et choix de sécurité : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Limites à connaître

* Les données vivent dans IndexedDB du navigateur : un nettoyage des données de site les efface. D'où les sauvegardes.
* Pas de synchronisation entre appareils (choix : aucun serveur). Le fichier `.carnet` joue ce rôle.
* GitHub Pages ne fournit ni authentification ni stockage : c'est le chiffrement local qui protège le contenu, pas l'hébergement.
