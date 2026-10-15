# Architecture

Un seul dépôt, public, servi par GitHub Pages. Le code est en clair ; les données sont chiffrées.

```
index.html            coquille HTML (accès, timeline, panneau de fiche, visionneuse, dialogues)
css/app.css           style (thème clair/sombre automatique, mobile first)
js/store.js           lecture des données chiffrées + brouillons locaux (IndexedDB)
js/importer.js        parsing du JSON produit par Claude + consigne à copier
js/report.js          rapport HTML autonome (images intégrées en base64)
js/app.js             interface, ne parle qu'à store.js
tools/carnet.mjs      publication des données chiffrées (Node 20+, sans dépendance)
data/incidents.enc    fiches chiffrées
data/img/<id>.enc     captures chiffrées (id aléatoire, sans information)
.github/workflows/    miroir main → gh-pages
```

## Chiffrement

* AES-GCM 256, IV aléatoire de 12 octets par fichier, format binaire `[iv | chiffré]`.
* Clé de 32 octets aléatoires, encodée en base64url (43 caractères), transmise uniquement par le fragment d'URL `#k=…`. Le fragment n'est pas envoyé au serveur ; l'application le retire de la barre d'adresse et garde la clé dans `localStorage`.
* Un mauvais lien est détecté (échec d'authentification GCM) et refusé.

## Lecture

`fetch('data/incidents.enc')` puis déchiffrement en mémoire. Les captures sont téléchargées et déchiffrées à la demande (miniature `thumbId` si présente, sinon l'original).

## Écriture

GitHub Pages est statique et l'API GitHub exige un identifiant : le navigateur ne peut pas écrire dans le dépôt sans que l'utilisateur fournisse un token. Choix retenu :

* Saisie dans l'application → **brouillon local** (IndexedDB, fiches et images), affiché avec un badge « non publié » et un bandeau. Jamais présenté comme enregistré sur GitHub.
* Publication par Claude avec `tools/carnet.mjs` (`upsert`, `img`, `merge-drafts`), puis commit et push.
* Au chargement, un brouillon dont l'id existe sur GitHub avec un `updatedAt` au moins aussi récent est supprimé de l'appareil (il a été publié).

## Ce qui est public

Le code, la taille des fichiers chiffrés, leur nombre et les dates de commit. Rien du contenu. Les messages de commit des données restent neutres.

## Limites

* Perdre le lien d'accès rend les données illisibles. Le garder en favori ; Claude le demande pour publier.
* Quiconque a accès au navigateur déverrouillé où le lien a été ouvert peut lire le carnet. Paramètres → *Oublier le lien sur cet appareil*.
