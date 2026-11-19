# Collecte des prévisions

Le processus `node dist/worker.js` utilise la même image que l'API, sans
serveur HTTP. Appliquer la migration 0007 avant de démarrer les deux services.
Elle ajoute des tables et une vue ; elle n'importe ni ne modifie de plage.
L'API lit PostgreSQL. La recherche et les recommandations lisent des projections
Redis produites même en l'absence de visiteurs. Le cache est reconstructible.

## Couverture et cadence

- Zones de 0,01° (arrondi des coordonnées du catalogue public). Une prévision
  atmosphérique par zone ; marine uniquement si une plage classée mer s'y trouve.
  La maille du modèle peut être beaucoup plus grande. Il ne s'agit pas de mesures sur place.
- Trois jours de prévisions horaires. Sélection du point horaire le plus proche
  à la lecture, unités normalisées à l'ingestion. Collecte cible toutes les six
  heures ; la cadence de production réelle dépend du modèle. Sa date d'émission
  n'est pas fournie : `producedAt` reste nul.
- Un seul job actif. Une zone par tick de 15 secondes ; réserve durable minimale
  de 12 secondes entre deux appels, tous processus et sources confondus. Au plus
  7 200 appels sur 24 heures pour ce worker (une position, trois jours, au plus
  dix variables par appel). Le remplissage initial est progressif : compter
  environ 25 minutes pour 100 couples source/zone sans erreur.
- Chaque minute, recalcul d'au plus 100 projections locales dues depuis huit
  minutes. TTL de recherche : 15 minutes, pas la cadence du modèle.
- Timeout HTTP : 8 secondes. Après une erreur transitoire : 1, 2 puis 4 minutes
  avant retour au cycle de six heures. Un 429 suspend les deux sources pendant
  au moins cinq minutes, ou davantage selon Retry-After. Pour 5xx/timeout,
  pause globale d'au moins 30 secondes. Réponse vide : pas de reprise immédiate.
- Aucun échec ne remplace le dernier succès. Valeurs périmées exclues des
  scores et filtres ; plus de valeurs courantes après 24 h ou sans échéance
  admissible. Une pause globale ou la file peuvent repousser la prochaine
  vérification au-delà de `nextCheckAt`.

## Recette après un cycle réel (#43)

Un heartbeat sain ou six heures écoulées ne prouvent pas que toutes les zones
ont été traitées. Depuis la racine avec le Node du projet et Compose local :

```sh
npm run check:v1-cycle -- start
npm run check:v1-cycle -- watch HORODATAGE EMPREINTE http://127.0.0.1:4200
```

Reprendre les valeurs `start` et `scope` imprimées par la première commande.
Le suivi lit PostgreSQL toutes les cinq minutes, sans appeler le fournisseur,
déclencher de job ni visiter les fiches. Il compare les mêmes zones et sites
(identifiants, positions, milieux). Un succès ou un échec **terminé** compte
pour le passage ; une simple réservation, même avec une erreur héritée,
ne compte pas. Les succès et les erreurs sont indiqués séparément.

Une fois les deux sources entièrement parcourues, attendre au moins 15 minutes
(une durée de vie de projection), puis mesurer une nouvelle recherche paginée.
Sa date et l’empreinte de ses identifiants doivent correspondre à la base locale.
Une projection manquante est donc visible comme telle, pas réparée par le test.
Les seuils restent 90 % des sites publics pour l’air, 80 % des sites marins pour
l’eau ; aucun indicateur marin en eau douce. Sortie 0 : seuils atteints à cet
instant ; 2 : cycle mesuré sous les seuils ; 1 : pas de verdict (périmètre
modifié, indisponibilité, horloge incohérente ou délai de huit heures).
Après une interruption, utiliser `npm run check:v1-cycle -- resume HORODATAGE EMPREINTE`
avec la référence initiale. Seule la fenêtre d’observation de huit heures repart :
le périmètre et la date des passages restent les mêmes. Le contrôle attend à nouveau
15 minutes après avoir constaté le dernier passage et mesure la fraîcheur à la date
de la recherche. Une reprise après veille ne démontre pas que le cycle a duré six heures.
Conserver les seuls agrégats dans le ticket, jamais le journal ni le cache.
Un passage réussi n’établit pas une disponibilité continue ou de production.

### Après une mise en veille

Docker ne collecte rien pendant la suspension de son hôte. Au réveil, un tour
qui a bien traité toutes les zones peut encore contenir des prévisions trop
anciennes : la recherche évalue leur âge à l’instant de consultation.
Pour la recette locale sur macOS, brancher le poste, laisser le capot ouvert
et lancer le suivi avec une prévention temporaire de la veille sur secteur :

```sh
caffeinate -s npm run check:v1-cycle -- watch HORODATAGE EMPREINTE
```

La protection prend fin avec la commande. Pour la reprise d’un ancien tour,
remplacer `watch` par `resume`. Pour vérifier un **nouveau** tour sans veille,
prendre une nouvelle référence avec `start`. Laisser le worker rattraper le
retard : ne pas vider Redis, changer les seuils ni lancer un deuxième collecteur.
En exploitation, utiliser un hôte qui reste disponible sans dépendre d’une session locale.

Avant d’attribuer un déficit à la recherche, comparer les zones déjà périmées
en base aux projections encore dans leur durée de vie. Ces compteurs de diagnostic
ne remplacent pas la mesure publique de la température sur chaque site :

```sql
SELECT t.source, count(*) AS zones,
       count(*) FILTER (WHERE z.last_success_at IS NULL OR
         z.last_success_at <= now() - interval '6 hours') AS sans_succes_frais,
       count(*) FILTER (WHERE z.error_code IS NOT NULL) AS en_erreur
FROM forecast_targets t LEFT JOIN forecast_zones z USING (source, y, x)
GROUP BY t.source;
SELECT count(*) AS sites, count(*) FILTER (
  WHERE p.updated_at > now() - interval '15 minutes') AS projections_recalculees
FROM beach_catalogue b LEFT JOIN forecast_projections p ON p.beach_id = b.id;
```

## Exploitation

`docker compose -f docker-compose.local.yml ps worker` contrôle l'activité
de consommation (heartbeat, pas disponibilité du fournisseur). La file BullMQ
`littora-weather` conserve les 200 derniers échecs et 100 dernières exécutions
réussies. Les planifications ont des identifiants stables ; redémarrer le worker
ne rejoue pas les zones fraîches. En production, Redis jobs est distinct du
cache, persistant (AOF), en mode noeviction.

```sql
SELECT source, error_code, count(*) AS zones, max(last_success_at) AS dernier_succes,
       min(next_check_at) AS prochaine_verification
FROM forecast_zones GROUP BY source, error_code ORDER BY source, error_code;
SELECT next_request_at FROM forecast_dispatch;
```

Vérifier les [limites et licences Open-Meteo](https://open-meteo.com/en/pricing)
avant mise en service publique ou commerciale ; l'IP peut avoir d'autres
consommateurs. Voir les [limites des modèles marins](https://open-meteo.com/en/docs/marine-weather-api).
Le worker ne consulte ni Overpass ni Nominatim. La découverte OSM reste
désactivée par défaut ; l'énumération de POI avec Nominatim exige une instance
dédiée. En cas d'indisponibilité, le catalogue local reste consultable.
[Politique Nominatim](https://operations.osmfoundation.org/policies/nominatim/)
et [limites Overpass](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).
