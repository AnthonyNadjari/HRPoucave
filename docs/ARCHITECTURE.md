# Architecture

Deux dépôts, un seul principe : **le code est public, les données sont privées.**

* `HRPoucave` (public, GitHub Pages) : l'application, statique, sans build.
* `CarnetData` (privé) : `incidents.json` + `images/`. Modifié par l'application via l'API GitHub Contents, avec un token fine-grained limité à ce dépôt.

```
index.html            coquille HTML (connexion, timeline, panneau de fiche, visionneuse, dialogues)
css/app.css           style (thème clair/sombre automatique, mobile first)
js/store.js           modèle de données + lecture/écriture dans le dépôt privé (API Contents)
js/importer.js        parsing du JSON produit par Claude + consigne à copier
js/report.js          rapport HTML autonome (images intégrées en base64)
js/app.js             interface (seule couche qui touche le DOM), ne parle qu'à store.js
.github/workflows/    miroir main → gh-pages
```

## Flux des données

* **Connexion** : `GET /repos/{owner}/{repo}` vérifie le token, que le dépôt est privé et que le token peut écrire. Config (dépôt + token) dans `localStorage`.
* **Lecture** : `GET /contents/incidents.json` (avec son `sha`), parsé en mémoire. Une copie est gardée dans `localStorage` pour un affichage immédiat et la lecture hors ligne.
* **Écriture** : `PUT /contents/incidents.json` avec le `sha` courant. Un `409`/`422` signifie qu'un autre appareil a écrit entre-temps : on recharge, on ré-applique la mutation, on réessaie (3 tentatives). Chaque écriture = un commit lisible (« Ajoute fiche 2026-10-15 »).
* **Images** : envoyées en base64 (`PUT /contents/images/...`), original + miniature JPEG 360 px générée dans le navigateur. La fiche ne référence l'image qu'après le succès des deux envois. Lecture avec `Accept: application/vnd.github.raw+json` (fonctionne au-delà de 1 Mo).
* **Suppression** : `DELETE` des fichiers puis mise à jour de `incidents.json`. L'historique git conserve tout.

## Sécurité

* Le dépôt de données est privé : seuls le compte GitHub et les tokens autorisés y accèdent.
* Le token est stocké dans le navigateur (`localStorage`). Quiconque a accès au navigateur déverrouillé peut lire les fiches : c'est le compromis choisi pour la simplicité. « Déconnecter ce navigateur » efface le token.
* Limiter le token à `CarnetData` et à la permission *Contents*. Le révoquer sur GitHub s'il fuit.
* L'application refuse un dépôt public.

## Limites

* L'API Contents accepte des fichiers jusqu'à 100 Mo ; largement suffisant pour des captures.
* Quota API GitHub : 5 000 requêtes/heure par token, sans rapport avec l'usage réel.
* Pas de synchronisation temps réel : l'app recharge à l'ouverture, au retour sur l'onglet, et via « Actualiser ».
