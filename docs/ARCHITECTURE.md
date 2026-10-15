# Architecture

Application statique, sans build, sans backend. Un seul principe : **toute donnée sensible reste dans le navigateur de l'utilisateur, chiffrée.**
Le dépôt GitHub ne contient que du code.

```
index.html            coquille HTML (écran de verrouillage, timeline, panneau de fiche, visionneuse, dialogues)
css/app.css           style (thème clair/sombre automatique, mobile first)
js/crypto.js          WebCrypto : PBKDF2 → AES-GCM 256, helpers base64
js/db.js              IndexedDB brut, enregistrements opaques (Uint8Array chiffrés)
js/store.js           modèle de données + chiffrement/déchiffrement + sauvegarde/restauration
js/importer.js        parsing du JSON produit par Claude + consigne à copier
js/report.js          génération du rapport HTML autonome (images intégrées en base64)
js/app.js             interface (seule couche qui touche le DOM) — ne parle qu'à store.js
manifest.webmanifest  installation sur l'écran d'accueil (PWA légère, sans service worker)
docs/                 documentation
```

## Flux des données

```
phrase secrète ──PBKDF2(310 000 it., sel aléatoire)──▶ clé AES-GCM (mémoire uniquement)
                                                          │
  fiche (JSON clair) ──encryptJSON──▶ IndexedDB.incidents ─┤
  image (octets)     ──encryptBytes─▶ IndexedDB.attachments┤  (blob original + miniature JPEG 360px, chacun chiffré)
                                                          │
  verrouillage / inactivité ──▶ clé effacée, caches d'URL révoqués, DOM vidé
```

* **Stores IndexedDB** : `meta` (sel + vérificateur chiffré), `incidents`, `attachments` (index `byIncident`), `prefs` (non sensible : délai de verrouillage, date de dernière sauvegarde).
* **Un enregistrement = un chiffrement** : chaque fiche et chaque image est chiffrée séparément avec un IV aléatoire de 12 octets (`[iv | ciphertext]`), ce qui permet des écritures incrémentales sans tout réécrire.
* **Miniatures** : générées à l'ajout via `createImageBitmap` + canvas, stockées chiffrées ; l'original n'est jamais recompressé (une capture reste une preuve fidèle).
* **Rien n'est confirmé avant d'être écrit** : `addAttachment` n'ajoute l'id de la pièce à la fiche qu'après l'écriture réussie du blob chiffré ; l'interface n'affiche « Enregistré » qu'après la résolution de la transaction. Pour une nouvelle fiche, les images collées restent explicitement « en attente » jusqu'à l'enregistrement.

## Sauvegarde / restauration

Fichier `.carnet` = JSON `{ format, createdAt, salt, iterations, counts, payload }` où `payload` est l'intégralité
(fiches + images en base64) chiffrée avec la clé dérivée de la phrase secrète et du sel inclus dans le fichier.
Il peut être stocké n'importe où (clé USB, cloud personnel) sans exposer son contenu. La restauration accepte
le mode *fusion* (par id) ou *remplacement*.

Un rappel s'affiche si aucune sauvegarde n'a été faite depuis 14 jours : IndexedDB peut être vidé par le navigateur
(nettoyage, navigation privée, réinstallation). `navigator.storage.persist()` est demandé pour limiter ce risque.

## Sécurité : ce que ça couvre, ce que ça ne couvre pas

Couvre : lecture des données par une autre personne ayant accès à l'appareil ou au profil du navigateur
(outils de développement, copie du profil), fichier de sauvegarde intercepté, dépôt GitHub public.

Ne couvre pas : un appareil compromis pendant que le carnet est déverrouillé (keylogger, capture d'écran),
ni un oubli de la phrase secrète (aucune récupération possible, par construction). Le verrouillage automatique
(15 min par défaut) et le masquage du titre d'onglet (« Carnet ») sont des mesures de discrétion, pas de sécurité.

## Déploiement

GitHub Pages sert la branche `gh-pages`, qui est un simple miroir de `main` poussé par le workflow
`.github/workflows/deploy.yml` à chaque push sur `main`. On ne modifie que `main`. `.nojekyll` évite tout traitement Jekyll.
Les modules ES exigent un serveur HTTP : en local, `python3 -m http.server 8000` puis `http://localhost:8000/`.
Aucune dépendance externe hormis les polices Google (facultatives : le site fonctionne avec les polices système si elles sont bloquées).

## Évolutions envisageables

* Export PDF direct (actuellement via « Imprimer → PDF » du navigateur, ce qui évite une bibliothèque lourde).
* Pièces jointes non-image (PDF, audio) : le store accepte déjà des octets quelconques, seule la validation `image/*` et la miniature sont à adapter.
* Synchronisation chiffrée entre appareils : hors périmètre volontairement (pas de backend) ; passer par le fichier `.carnet`.
