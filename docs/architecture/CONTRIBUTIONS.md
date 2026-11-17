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
Une moderation distincte (#27) doit verifier l'observation avant publication.
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
