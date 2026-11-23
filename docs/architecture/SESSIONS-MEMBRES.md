# Sessions membres : lot de recette (#26)

Une session Littora identifie un membre ; elle ne lui attribue aucun droit de
modération ou de gestion. Ce lot ne connecte pas Google et n’ajoute pas de
bouton de connexion. La consultation des plages et le jeton de contribution
anonyme ne dépendent pas du service de comptes.

## Frontière de stockage

Utiliser une **instance PostgreSQL dédiée**, inaccessible depuis le Web, les
workers et le réseau du catalogue. Deux bases sur le même serveur ne protègent
pas des superutilisateurs de ce serveur. Ne pas réutiliser le compte PostgreSQL
du catalogue. Aucun service ni secret n’est ajouté au Compose par défaut.

Sur une instance de recette vierge, un administrateur crée une base nommée
`littora_members` (template0), puis applique **une fois** :

```sh
psql 'service=littora-members-owner' -X -v ON_ERROR_STOP=1 -f infra/members/0001_sessions.sql
```

Le service psql est une configuration privée sur la machine d’exploitation.
Le script refuse le nom de la base catalogue et une base déjà initialisée.
Le propriétaire des tables et les deux groupes créés ne peuvent pas se connecter.
Créer séparément un login sans privilèges administratifs pour chaque service ;
accorder uniquement son groupe, jamais les deux au même login :

| Groupe | Opérations autorisées |
| --- | --- |
| `littora_session_reader` | Lire ou révoquer la session correspondant à un secret présenté, sans accès direct aux tables. |
| `littora_session_issuer` | Créer une session après authentification vérifiée ; pas de lecture des sessions ni de droit de gestion. |

Pour activer **la lecture uniquement**, injecter `MEMBER_SESSION_DATABASE_URL`
(login lecteur) et `MEMBER_PUBLIC_ORIGIN` (origine HTTPS exacte, sans chemin
ni barre finale) dans **le seul processus API**. Ne pas utiliser le fichier
d’environnement partagé avec les workers. Utiliser une connexion de base
chiffrée avec validation du certificat en dehors d’un environnement jetable.
Une configuration absente ou un stockage indisponible laisse les routes membres
indisponibles ; aucune substitution par la base publique. Aucun identifiant
émetteur n’est nécessaire dans le déploiement actuel.

## Cycle de vie

- Seul le futur retour d’authentification serveur pourra appeler
  `establishMemberSession`, après validation OIDC **et de tout facteur requis**.
  Aucun endpoint public n’accepte un sujet ou un identifiant pour émettre une session.
- L’identité est le couple exact (émetteur, sujet). Pas d’e-mail, profil
  Google, rôle, position, jeton fournisseur ou historique des plages en base.
  Le navigateur n’obtient qu’un cookie opaque de 32 octets aléatoires :
  `__Host-littora-member`, Secure, HttpOnly, SameSite=Lax, Path=/, sans Domain.
  Seule l’empreinte SHA-256 est stockée.
- Une nouvelle authentification remplace le secret du navigateur présenté.
  Au plus cinq sessions par compte, avec une échéance absolue de douze heures
  imposée en base. La plus ancienne est retirée au-delà de cinq.
- `GET /api/member/session` renvoie uniquement un identifiant de membre opaque
  et l’échéance de sa propre session, sinon 401. Une indisponibilité retourne
  503. Les réponses, y compris les erreurs, ne sont pas mises en cache.
- `DELETE /api/member/session` exige l’origine attendue. Le cookie n’est effacé
  qu’après vérification du stockage ; un échec ne simule pas une déconnexion.
  Les autres appareils et comptes ne sont pas déconnectés.

## Conservation et reprise

L’expiration interdit la lecture même en l’absence de maintenance. Pour la
suppression physique, programmer quotidiennement sur l’instance dédiée
`DELETE FROM members.session WHERE expires_at <= now()` avec une identité
de maintenance privée ; ce nettoyage n’est pas activé par cette livraison.
La suppression d’un compte par le propriétaire supprime ses sessions en cascade.
Le parcours membre d’effacement et la politique de rétention des sauvegardes
restent à livrer avant ouverture (#26, #30, #31).

Ne jamais journaliser les cookies ni sauvegarder les sessions pour les rejouer.
Pour une sauvegarde logique de la base privée, exclure les lignes de session
avec `pg_dump --exclude-table-data=members.session` et chiffrer l'archive.
Après restauration, **vider la table des sessions avant de reconnecter l’API** :
une ancienne sauvegarde pourrait autrement réactiver une session révoquée.
Tester cette procédure, la récupération MFA et la révocation de tous les
appareils avant ouverture ; ce lot n’active aucun accès privilégié (#97).

Références : [gestion des sessions (OWASP)](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
et [fonctions avec droits du propriétaire (PostgreSQL)](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).
