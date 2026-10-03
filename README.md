# Terra Nova

Portail citoyen pour le 24H By Webcup 2026, construit à partir des demandes actuellement publiées dans l’API officielle.

## Démarrer

Node.js 22.15 ou plus récent est requis. Le projet n’a aucune dépendance npm. Le module `node:sqlite` affiche un avertissement expérimental avec certaines versions de Node.

1. Copier `.env.example` vers `.env` et placer la clé API de l’équipe dans `TERRA_NOVA_API_KEY`. Ne jamais publier ce fichier.
2. Lancer `npm start`.
3. Ouvrir `http://127.0.0.1:3000`.

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

La clé API reste sur le serveur. Le flux du concours est accessible aux agents et administrateurs authentifiés uniquement. Le serveur ne déduit ni le nombre ni le calendrier des vagues : il affiche les demandes réellement reçues et utilise `request_code` comme référence stable.

## Hébergement et données

Par défaut, le serveur écoute uniquement sur `127.0.0.1`. Pour un hébergement public, placer Node derrière HTTPS, définir `NODE_ENV=production`, choisir `HOST` et `PORT` selon l’hébergeur, et conserver `DATA_PATH` sur un volume persistant. Le drapeau `Secure` est alors appliqué au cookie de session. Ne pas exposer `.env` ni le dossier `data/` par le serveur web.

SQLite conserve les comptes, sessions, messages, services et actualités dans `data/terra-nova.sqlite` par défaut. Pour une sauvegarde simple, arrêter le serveur puis copier le dossier `data/`. Le serveur sert seulement les fichiers publics explicitement autorisés.

L’ajout des signalements avec lieu conserve les messages antérieurs. Leur type est défini comme `contact` pendant la mise à jour de la base.

Les informations officielles sur les services municipaux, l’adresse de déploiement et le nom définitif de la cité restent à confirmer avec l’équipe.
