# Our workflow :
-  GPT6-Astra - High acting as a Project Manager and tasks dispatcher
-  Claude Opus 5.5 - High x2 - Session A and Session B responsible for Portal / API requests and our 3D world / game building.

# Terra Nova

Portail citoyen pour le 24H By Webcup 2026, construit à partir des demandes actuellement publiées dans l’API officielle.

## Démarrer

Node.js 22.15 ou plus récent est requis (Hodifly utilise Node 24). Le serveur (`server.mjs`, `store.mjs`, `security.mjs`) n’a qu’une dépendance d’exécution, `@simplewebauthn/server` (version exacte dans `package.json`, vérification des clés d’accès WebAuthn : rien n’est analysé à la main) ; le reste utilise `node:http`, `node:crypto` et `node:sqlite`, qui affiche un avertissement expérimental avec certaines versions de Node. Le monde 3D (`world/`) est une application Vite + React + React Three Fiber ; ses paquets sont des `devDependencies` utilisées uniquement à la compilation (`npm run build` → `dist/monde/`, servi sous `/monde/`).

1. `npm ci` pour installer les outils de compilation du monde.
2. Copier `.env.example` vers `.env` et placer la clé API de l’équipe dans `TERRA_NOVA_API_KEY`. Ne jamais publier ce fichier.
3. `npm run build` (le portail dans `public/` n’a pas d’étape de compilation ; seul le monde en a une), puis `npm start`.
4. Ouvrir `http://127.0.0.1:3000`. Pour développer le monde avec rechargement : `npm run dev:world` (proxy `/api` vers le port 3000).

Vérifications locales de la session A : `node tools/smoke-a.mjs` (API, rôles, comptes, service de `/monde/`, sur une base temporaire). `tools/qa-a/portal.mjs` et `tools/qa-a/world-ui.mjs` testent le portail et les composants du téléphone dans jsdom (`npm i --no-save jsdom` d’abord).

Les citoyens peuvent créer leur propre compte. Pour créer un agent ou un administrateur, exécuter :

```sh
npm run create-staff -- agent@example.org "Nom affiché" agent
npm run create-staff -- admin@example.org "Nom affiché" admin
```

La commande affiche un mot de passe aléatoire une seule fois. Conservez-le dans un gestionnaire de mots de passe. Relancer la commande pour le même compte remplace son mot de passe et ferme ses sessions existantes.

## Parcours disponibles

- Inscription et connexion citoyennes ; espace personnel séparé des espaces agent et administrateur.
- Messages adressés aux services municipaux et signalements avec lieu, confirmation d’envoi, historique et suivi du statut.
- Espace agent avec nombre de messages à traiter, changement de statut et flux officiel des demandes du concours, actualisé toutes les 30 secondes.
- Services et actualités consultables par tous ; publication réservée aux administrateurs.
- Repères de navigation, structure adaptée au clavier et au lecteur d’écran, contraste renforcé et taille de texte réglable jusqu’à 150 %.
- Alertes : l’administrateur publie une actualité urgente avec son public concerné ; elle s’affiche en bandeau `role="alert"` en haut de chaque page, les habitants peuvent activer les notifications du navigateur, et l’alerte peut être levée.
- Recherche instantanée dans les services (sans tenir compte des accents) et services mis à la une par l’administrateur.
- Guide de première connexion (profil, service, démarche) et profil citoyen avec quartier.
- Interface, services et actualités en français ou en anglais (bouton « English »). Un contenu sans version anglaise reste affiché en français.
- Monde 3D servi sous `/monde/`, avec avatar et présence des autres joueurs (`/api/me/avatar`, `/api/presence`). Un fichier manquant (modèle, texture, script) renvoie un vrai 404 ; seule une navigation sans extension retombe sur l’application. Les fichiers au nom haché sont mis en cache un an, les autres sont revalidés (ETag) ; les fichiers texte volumineux sont servis en gzip.
- Transports (F36) : `GET /api/transports` (deux lignes, trois prochains passages par arrêt, perturbations). Le portail met l’arrêt du quartier du profil en premier ; les agents mettent à jour l’info trafic.
- Suppression de son propre compte avec confirmation par mot de passe (F33) : le compte, les messages et les signalements sont effacés, les sessions fermées.
- Administration des comptes citoyens (F34, agents et administrateurs) : recherche, désactivation/réactivation (les sessions sont fermées et la connexion refusée), mot de passe temporaire affiché une seule fois, suppression avec confirmation. Les comptes du personnel ne sont jamais modifiables depuis cet écran.
- Protection des connexions (F37) : limites en trois couches sur 15 minutes (5 erreurs par adresse et compte, 20 par compte, 40 par adresse), pause annoncée avec le temps restant, alerte au titulaire après une connexion réussie, vue de sécurité pour les agents. Derrière un proxy, définir `TRUST_PROXY=1`. Les compteurs sont en mémoire (réinitialisés au redémarrage).
- Disponibilité des services (F38) : un agent signale une interruption avec motif, reprise prévue (heure de Terra Nova, UTC+4) et alternative ; les habitants le voient sur la carte du service, avant d’écrire, et dans le téléphone du monde. L’interruption se termine d’elle-même à l’heure de reprise.
- Rendez-vous (F39) et rappels (F40) : les agents publient des créneaux, les habitants réservent (un seul gagne si deux personnes cliquent en même temps), annulent, et retrouvent date, heures, lieu et consignes. Rappel en bandeau 24 h puis 1 h avant, notification du navigateur si activée, et fichier d’agenda `.ics` avec deux alarmes. Il n’y a ni e-mail ni SMS.
- Accessibilité (D13, D20, F41–F44) : lien d’évitement qui place le focus dans le contenu, liens de saut dans l’espace personnel et l’espace agent, anneau de focus visible partout, erreurs de formulaire qui nomment le champ et y placent le focus, état « Envoi en cours… », taille du texte jusqu’à 200 %, mise en page sans défilement horizontal jusqu’à 400 % de zoom, mots expliqués simplement, aucun statut signalé par la seule couleur, réglage système « plus de contraste » suivi. Vérifié par `node tools/qa-a/a11y-browser.mjs` (Chrome) ; aucune technologie d’assistance réelle n’a été utilisée.
- Formulaires protégés contre les robots et les envois répétés (F81, F82) : un champ caché que personne ne voit (`fax_ref`, refusé s’il est rempli), un jeton de formulaire signé à usage unique demandé quand la personne commence à remplir (`GET /api/forms/token`), valable de 1,5 s à 2 h : un envoi plus rapide est retenté par la page elle-même, un jeton renvoyé reçoit la première réponse sans créer un second enregistrement. Quotas : 6 messages par 10 minutes et 40 par jour par compte, 60 par heure par adresse, 30 inscriptions par heure par adresse (600 au total), 30 préoccupations par heure par adresse, 20 réservations par 10 minutes ; le refus indique l’attente (429 + `Retry-After`). Le même texte envoyé deux fois en 10 minutes par la même personne n’est créé qu’une fois (message ou préoccupation, même après un redémarrage) ; une annonce ou un service identique est publié une fois. Les agents voient les compteurs (envois automatiques refusés, trop rapides, refus de quota, doublons évités), sans nom ni contenu. Ce n’est pas un CAPTCHA : il ralentit et rend visibles les envois scriptés, il ne les rend pas impossibles. Réglages de test uniquement (un avertissement s’affiche) : `TN_FORM_MIN_AGE_MS`, `TN_FORM_LIMIT_SCALE`, `TN_FORM_TOKENS=optional`.
- Astuces contextuelles au premier usage (F35) : recherche de services, premier message, premier signalement ; masquables et mémorisées par utilisateur.

La clé API reste sur le serveur. Le flux du concours est accessible aux agents et administrateurs authentifiés uniquement. Le serveur ne déduit ni le nombre ni le calendrier des vagues : il affiche les demandes réellement reçues et utilise `request_code` comme référence stable.

## Site de test déployé

Portail : https://losfablitos.lareunion.webcup.hodi.cloud/ — monde 3D : https://losfablitos.lareunion.webcup.hodi.cloud/monde/ (Hodifly, chaque envoi sur `main` redéploie). Contrôle sans écriture : `node tools/qa-a/host-smoke.mjs https://losfablitos.lareunion.webcup.hodi.cloud dist/monde` (requêtes GET uniquement ; ne publie ni compte, ni message, ni alerte).

## Hébergement et données

Par défaut, le serveur écoute uniquement sur `127.0.0.1`. Pour un hébergement public, placer Node derrière HTTPS, définir `NODE_ENV=production`, choisir `HOST` et `PORT` selon l’hébergeur, et conserver `DATA_PATH` sur un volume persistant. Le drapeau `Secure` est alors appliqué au cookie de session. Ne pas exposer `.env` ni le dossier `data/` par le serveur web.

SQLite conserve les comptes, sessions, messages, services et actualités dans `data/terra-nova.sqlite` par défaut. Pour une sauvegarde simple, arrêter le serveur puis copier le dossier `data/`. Le serveur sert seulement les fichiers publics explicitement autorisés.

L’ajout des signalements avec lieu conserve les messages antérieurs. Leur type est défini comme `contact` pendant la mise à jour de la base.

Les informations officielles sur les services municipaux, l’adresse de déploiement et le nom définitif de la cité restent à confirmer avec l’équipe.
