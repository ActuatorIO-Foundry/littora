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
