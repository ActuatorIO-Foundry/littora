# Accès au personnel habilité

La console privée n'est pas une route Angular : elle écoute en HTTPS sur la
boucle locale du bastion. Aucun accès à la boîte ou à la file de modération par
un compte membre, un jeton de collecte ou une simple connexion Google. Le site
public et les contributions anonymes ne dépendent pas de cette console.

## Préparation privée

1. Créer une base vide `littora_staff` sur une instance privée distincte du
   catalogue. Appliquer une fois `infra/staff/0001_webauthn.sql` comme opérateur
   de la base. Aucun login ni compte humain par défaut. Le service reçoit un
   login dédié, membre uniquement de `littora_staff_runtime`, via `STAFF_DATABASE_URL`.
   Ne pas le mettre dans le fichier d'environnement partagé. Réserver
   `littora_staff_owner` à l'administration hors ligne, protégée séparément.
2. Préparer le lecteur de [contact](CONTACT.md), le certificat serveur et une
   autorité cliente privée. Présenter à chaque personne son propre certificat
   client ; vérifier son empreinte par un canal privé indépendant. Origine HTTPS
   fixe pour toute la durée de vie des clés. Ne publier ni la console, ni les
   bases, ni les fichiers de connexions via le proxy public.
3. Dans la base privée, sous le rôle propriétaire, provisionner
   `insert into staff.account(certificate,capability) values (:'fp', :'capability') returning id`.
   `fp` est le SHA-256 hexadécimal majuscule sans séparateurs. Choisir
   `contact` ou `moderation`. Ce sont des droits métier indépendants :
   **aucun des deux ne peut attribuer des droits**. Le responsable des
   habilitations agit exclusivement par la procédure hors ligne.
4. Dans les dix minutes, ouvrir `/gestion/connexion` avec le certificat prévu.
   Enregistrer **deux clés physiques distinctes**, une par une, chacune avec
   vérification locale (PIN ou biométrie). Conserver la seconde à part.
   L'enregistrement seul n'ouvre pas de session. Les identifiants synchronisables
   sont refusés. L'attestation matérielle du constructeur n'est pas vérifiée :
   deux identifiants distincts ne prouvent pas deux objets physiques. Vérifier
   les deux appareils lors du provisionnement supervisé.
5. Après vérification indépendante, le propriétaire active le compte :
   `update staff.account set state='active' where id=:'id' and state='enrolling'`.
   Sans deux clés, la base refuse. L'utilisateur se reconnecte avec l'une
   d'elles ; le serveur vérifie signature, origine, RP, défi à usage unique,
   présence et vérification utilisateur. La session privée est liée au certificat,
   limitée à cinq minutes sans prolongation. Un redémarrage l'invalide.

## Modération et ancienne console

Préparer un login de **service**, `staff_<uuid du modérateur sans tirets>`,
sans privilège administratif. Lui donner uniquement l'usage du schéma
`moderation`, la lecture de `moderation.queue` et l'exécution de
`moderation.decide(uuid,text,text)`. Ne jamais remettre son secret au
modérateur. Le fichier privé désigné par `STAFF_MODERATOR_DATABASES_FILE`
associe chaque UUID à sa connexion au catalogue. Limiter sa lecture au processus
privé. Utiliser TLS vérifié entre machines et restreindre les connexions réseau
et les règles PostgreSQL à cette seule origine. Pas de secret SQL dans le navigateur.

À `/gestion/moderation`, la console utilise le login individuel côté serveur ;
la décision conserve donc son attribution dans le journal existant. Un compte
de modération ne peut ni ouvrir les contacts ni consulter les données d'identité.
Les actions de maintenance automatisée restent séparées.

**Bascule contrôlée uniquement** : inventorier les anciens opérateurs en privé,
retirer leurs droits directs et leurs appartenances alternatives, neutraliser les
logins dédiés obsolètes et terminer leurs sessions existantes avant ouverture.
Contrôler ensuite dans le catalogue, avec `psql -X -v ON_ERROR_STOP=1`, le script
    `infra/staff/check-moderation-logins.sql`, dans une transaction en lecture seule
    avec `SET LOCAL littora.approved_logins` (tableau JSON exact des seuls services attendus et comptes
d'exploitation hors ligne). Il échoue sans imprimer les identités si un autre
login peut atteindre la file ou la fonction, même via un changement de rôle.
Ce contrôle ne prouve pas le cloisonnement réseau ou celui des secrets.

## Perte, retrait et alertes

- Une clé perdue : utiliser la réserve pour la continuité, puis révoquer
  l'ancienne identité, remplacer le certificat et reprovisionner deux clés.
  Perte des deux clés : révoquer **avant** la récupération ; pas de lien par
  courriel, de récupération Google ou de mot de passe de secours. Faire vérifier
  l'identité hors bande et recommencer l'enrôlement supervisé. Ne pas réactiver
  une identité révoquée. Conserver le dossier de vérification hors Git.
- Retrait : `update staff.account set state='revoked' where id=:'id'`.
  À la prochaine requête, l'ancienne session est refusée. Un changement de
  capacité impose aussi une nouvelle vérification. Retirer les secrets et
  accès du service de modération qui ne sont plus nécessaires.
- Les changements d'état et de rôle produisent une ligne durable dans
  `staff.audit` (identifiant technique, état, capacité, heure) et un signal
  `staff_access_changed` sans contenu personnel. Le consommateur privé doit
  garder un curseur sur l'identifiant du journal et rattraper les interruptions ;
  un simple `LISTEN` n'est pas une preuve de réception. L'acheminement effectif
  des notifications relève du #30. Aucun certificat, défi, cookie, décision
  nominative ou document de récupération dans Git ou les journaux techniques.
- Avant utilisation réelle : effectuer la recette de retrait et de récupération
  sur clés physiques, contrôler les anciens accès et les sauvegardes privées.
  En cas de panne, suspendre la console ; ne pas réactiver une voie sans MFA.

Références : [WebAuthn](https://www.w3.org/TR/webauthn-3/),
[vérification serveur](https://simplewebauthn.dev/docs/packages/server).
