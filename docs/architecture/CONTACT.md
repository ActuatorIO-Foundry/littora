# Boîte de contact privée

Le formulaire public ne collecte que l'adresse de réponse, le sujet et le texte.
Un accusé avec référence UUID signifie que la transaction de dépôt a été validée,
pas qu'une réponse a été envoyée. La référence seule ne donne aucun droit de lecture.
Sans boîte configurée, la copie du brouillon reste locale au navigateur.

## Séparation des accès

- Sur une instance PostgreSQL **distincte** du catalogue, créer la base vide
  `littora_contact` et y appliquer `infra/contact/0001_inbox.sql` une fois.
  Ne pas l'ajouter aux migrations du catalogue ni à ses sauvegardes. En recette
  jetable uniquement, les bases peuvent partager un serveur.
- Créer deux identifiants d'application sans privilèges spéciaux : l'un hérite
  de `littora_contact_submit`, l'autre de `littora_contact_manage`. Aucun ne
  doit être propriétaire, administrateur ou membre de l'autre groupe.
- L'API publique seule reçoit `CONTACT_SUBMIT_DATABASE_URL` et `CONTACT_QUOTA_KEY`
  (32 octets aléatoires encodés en hexadécimal). Les injecter dans ce service seul
  via des secrets privés, jamais dans le fichier d'environnement partagé des conteneurs.
  Entre machines, utiliser une connexion PostgreSQL chiffrée et vérifiée.
- La relève est une application HTTPS séparée : après compilation, démarrer
  `node apps/api/dist/contact-management.js` sur le poste ou bastion privé.
  Elle écoute exclusivement sur `127.0.0.1`, au port de `CONTACT_MANAGE_ORIGIN`.
  Ne pas la publier via le Caddy public. Accès via un tunnel privé conservant TLS de bout en bout.
- Elle reçoit uniquement son `CONTACT_MANAGE_DATABASE_URL`, son origine HTTPS,
  `CONTACT_TLS_CERT_FILE`, `CONTACT_TLS_KEY_FILE`, `CONTACT_CLIENT_CA_FILE` et
  `CONTACT_MANAGER_FINGERPRINTS` (empreintes SHA-256 individuelles séparées par des virgules).
  Le nom du certificat serveur doit correspondre au nom ouvert par le navigateur.
  La chaîne du certificat client **et** son empreinte doivent être autorisées.
  Une session membre, un rôle de modération ou un certificat valide non inscrit ne suffisent pas.
- Ouvrir `/gestion/contact` avec un certificat nominatif habilité. La boîte
  présente les 50 demandes les plus anciennes ; terminer un message le supprime
  et libère sa place. Après 72 h sans ouverture de la liste, le dépôt se ferme
  automatiquement ; les messages en attente restent accessibles aux gestionnaires.

## Conservation et exploitation

Les demandes traitées sont supprimées immédiatement, les autres ne sont plus
consultables à 30 jours. L'API purge tous les quarts d'heure ; prévoir aussi
une tâche privée appelant `select inbox.purge()` indépendamment de l'API et
une alerte sur les échecs. Purger avant toute remise en service après arrêt.
Cette politique vise les données actives. Ne pas activer la collecte publique
avant d'avoir validé la politique des copies privées et de leur effacement.

Plafonds par heure UTC : 5 dépôts par adresse réseau et 120 au total. La
base ne conserve pas l'adresse IP : seule une empreinte secrète renouvelée
chaque heure sert au quota. Les compteurs sont purgés après deux heures.
Avec un proxy, configurer l'adresse de confiance comme pour les signalements ;
ne pas accepter un en-tête client arbitraire comme adresse réseau.

Ne journaliser ni requêtes avec corps, ni paramètres SQL, ni messages, adresses,
références ou certificats. Désactiver la capture des formulaires, traces et
exports de la boîte. Les compteurs et codes d'erreur suffisent au suivi.

**Avant ouverture réelle (#97)** : nommer une relève, vérifier l'authentification
forte (clé privée non exportable avec vérification de l'utilisateur, ou seconde
barrière MFA), puis tester la révocation et la perte d'un appareil. Un certificat
logiciel seul ne démontre pas deux facteurs. En cas de retrait, supprimer
l'empreinte et redémarrer le lecteur pour couper les connexions. Ne pas distribuer
de certificat partagé. Seuls des certificats éphémères sont utilisés en recette.

## Vérification

La suite `npm run test:integration` effectue un dépôt HTTP réel sur PostgreSQL,
ouvre la boîte avec un client TLS habilité, exerce les refus et les quotas,
puis vérifie la suppression et l'expiration. Les tests navigateur contrôlent que
la panne, la limitation ou un accusé mal formé ne vident pas le brouillon.
