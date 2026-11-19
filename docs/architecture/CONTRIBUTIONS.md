# Contributions anonymes

Decision implementee pour #23, avant V1. Une contribution n'est ni une mesure
officielle, ni une preuve de presence sur place. Aucun compte n'est requis.

## Identite et limites

- `POST /reports/session` emet un jeton opaque aleatoire de 256 bits, valable
  30 jours. Seul son SHA-256 est stocke en base. Le navigateur conserve le jeton
  localement pour ne pas recreer une identite a chaque contribution.
- `REPORT_IP_HASH_KEY` est une cle serveur separee, d'au moins 32 caracteres.
  Une valeur absente ou invalide desactive les contributions (503).
  La cle et les jetons ne doivent jamais figurer dans des journaux.
- L'adresse du socket est transformee par HMAC-SHA-256 ; aucune adresse brute
  ni empreinte du navigateur n'est conservee. Les en-tetes IP fournis par le
  client ne sont pas utilises.
- Une session n'est pas une personne unique. Un reseau partage peut reunir
  plusieurs personnes ; une personne peut changer de reseau. Aucune probabilite
  de securite ne peut etre deduite de ces identifiants.

| Limite | Valeur |
| --- | --- |
| Creation de sessions / reseau | 3 / heure, 8 / jour |
| Contributions / session | 3 / 10 minutes, 20 / jour |
| Contributions / reseau | 15 / heure, 40 / jour |
| Meme plage et type / session ou reseau | Une contribution / 15 minutes |

Les compteurs partages PostgreSQL sont atomiques. Les verrous transactionnels
empechent deux requetes simultanees de contourner les doublons. Les fenetres de
quota sont fixes. Une panne de stockage refuse la soumission, sans passer en
mode non protege.

## Validation et publication

Le contrat OpenAPI borne UUID, types, champs, taille des textes et dates. La
plage doit exister. L'observation doit dater de moins de 24 heures ; une avance
de 30 secondes maximum est ramenee a l'heure de reception. Les couleurs
contradictoires et la gravite hors liste sont refusees.

La confiance envoyee par un ancien client est ignoree. Le serveur attribue
`confidence=0` et `pending`. Le champ `source` du client est retire.
La [file de modération privée](#modération-privée-27) sépare la réception et la publication.
Les listes publiques, agregats et votes excluent les contributions en attente,
rejetees, expirees ou de demonstration. Les anciennes lignes sont conservees
sans etre rendues fiables par la migration.

Le presenter utilise une liste explicite de champs publics. Aucun identifiant
de contributeur, jeton, condensat de jeton ou de reseau n'est expose.

## Conservation et exploitation

Les observations expirent apres 24 heures pour la consultation. Les anciennes
lignes restent disponibles pour la moderation et l'audit interne ; leur duree
de conservation definitive appartient a #31. Le nettoyage horaire et la
creation de session retirent les compteurs expires, sessions de plus de 30 jours
et condensats reseau des observations de plus de 24 heures. Un arret du service
peut retarder ce nettoyage ; son echec produit seulement un evenement technique
generique. Aucun fichier de trace n'est versionne.

Les codes 400, 401, 404, 409, 429 et 503 sont normalises sans erreur SQL ni secret.
L'UI annonce explicitement l'attente de moderation, les doublons et les quotas.

Avant un deploiement derriere proxy (#29), definir les seuls proxies de confiance
et tester les adresses transmises. En l'etat, les visiteurs d'un meme proxy
partagent le quota de son socket : comportement conservateur, pas une protection
multi-utilisateur de production validee. L'acces direct a l'API doit etre ferme.
Les attaques distribuees et la rotation de reseaux ne sont pas eliminees par les
quotas ; moderation et protections de perimetre restent requises avant V1.

## Verification et migration

`0005_report_contributions.sql` ajoute trois tables sans modifier les plages ni
les signalements historiques. Tests HTTP/PostGIS reels : valeurs invalides,
autorisation, expiration, concurrence, reinitialisation de session, en-tetes
IP falsifies, quotas, nettoyage et absence de donnees privees dans les reponses.
Tests UI sur cinq formats : soumission, reutilisation du jeton, erreurs et absence
de confiance auto-declaree. Aucune collecte externe dans ces tests.

Pour un retour arriere, conserver une image precedente avec le manifeste de
migration 0005, comme pour les autres migrations additives. Ne pas supprimer
les tables ni restaurer un ancien volume par-dessus des donnees nouvelles.

## Modération privée (#27)

La migration additive `0009_report_moderation.sql` crée une file de travail et
un journal dans le schéma privé `moderation`. Elle ne publie aucune observation,
ne crée aucun login et ne modifie pas le catalogue. Pour activer le lot sur une
instance : sauvegarder, tester la migration sur restauration, appliquer les migrations
avant de redémarrer l’API et le worker, puis habiliter les opérateurs. Garder
l’image précédente et la sauvegarde ; ne pas effacer le journal pour revenir en arrière.

**Habilitation.** En pré-V1, la console opérateur est `psql`, sur connexion de
confiance (locale ou privée chiffrée). Utiliser un login PostgreSQL *individuel*
avec identifiant technique, non propriétaire, sans privilèges d’administration,
sans accès aux tables publiques ni aux rôles d’écriture. Ne jamais modérer via le
compte partagé de l’API. Le jeton de contribution et le jeton HTTP d’administration
ne donnent pas accès à cette console. L’opérateur de la base peut attribuer ces
droits à un rôle de groupe sans login, puis y rattacher les logins habilités :

```sql
CREATE ROLE littora_moderation NOLOGIN;
GRANT USAGE ON SCHEMA moderation TO littora_moderation;
GRANT SELECT ON moderation.queue, moderation.decisions TO littora_moderation;
GRANT EXECUTE ON FUNCTION moderation.decide(uuid,text,text) TO littora_moderation;
-- À exécuter dans psql avec operator défini au login technique concerné.
GRANT littora_moderation TO :"operator";
```

Pour révoquer l’accès : `REVOKE littora_moderation FROM :"operator";`.
Ne pas publier le port PostgreSQL sur Internet ; ne pas fournir de secret par
argument de commande. Le compte propriétaire reste un compte d’exploitation
privilégié : le journal est protégé contre les modifications des modérateurs,
pas contre celles d’un administrateur de la base. Sur un nouveau cluster,
recréer le rôle de groupe avant de restaurer les droits du dump ; gérer les
identifiants individuels séparément de la sauvegarde applicative.

**Traiter la file.** Consulter les plus anciens dossiers d’abord, avec leurs
dates et, pour une contestation, l’observation visée. La liste ne contient ni
identité de contributeur ni empreinte réseau. La commande `decide` verrouille
le dossier et écrit la transition et son motif dans la même transaction ; le
login est celui de la connexion, jamais un paramètre fourni par le client.

```sql
SELECT * FROM moderation.queue ORDER BY created_at, id LIMIT 50;
-- Dans psql, définir report_id à l’identifiant lu dans la file.
SELECT moderation.decide(:'report_id', 'publish', 'consistent');
SELECT action, previous_status, next_status, operator_login, reason, decided_at, dispute_id
FROM moderation.decisions WHERE report_id = :'report_id' ORDER BY id;
```

| Dossier | Décision | Effet |
|---|---|---|
| Observation active en attente | `publish` ou `reject` | Visible comme contribution modérée ou définitivement écartée. |
| Observation publiée active | `withdraw` | Retrait immédiat des nouvelles lectures et des agrégats. |
| Contestation en attente | `dismiss` | Clôture privée sans modifier l’observation. |
| Contestation en attente | `uphold` | Retrait de l’observation et clôture privée du dossier, atomiquement. |

Motif obligatoire : `consistent`, `incorrect`, `duplicate`, `unverifiable` ou
`outdated`. Une publication n’est pas une certification officielle ; elle ne
relève pas la confiance numérique. Une décision répétée ou incompatible est
refusée. Expiration : 24 h **depuis l’observation**, sans modifier ni prolonger
son horodatage. Une correction factuelle est une nouvelle contribution soumise
aux mêmes règles. Les dossiers échus et anciennes lignes sans métadonnées
de contribution ne peuvent pas être promus par la file.

**Contester.** Sur une ligne publique, « Contester » envoie un signalement
privé `other` avec `value.contests` : même session anonyme et mêmes quotas
que pour les autres envois. La cible doit être publiée, active et appartenir
à la même plage. La contestation ne dépublie pas automatiquement l’original
et ne peut jamais être approuvée comme observation. Les décisions et motifs
restent internes. Le bouton n’est pas un service de secours.

Le hub relit les observations ouvertes au moins toutes les minutes lorsque la
fiche est active, ou plus tôt à l’expiration, et recoupe les identifiants du
flux et de l’historique des drapeaux. Les nouvelles recherches reprennent le
consensus et les facteurs communautaires en base, même si le cache météo est
chaud. Un instantané paginé est invalidé (409) si les observations actives
changent ; sinon il expire en deux minutes. `GET /api/admin/health` indique si la file contient au moins un
dossier actif, pas si une permanence humaine est en place. L’organisation de
cette permanence et la durée de conservation des décisions restent à valider
avant ouverture (#31, #32).
