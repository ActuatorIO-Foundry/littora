# Littora - plateforme intelligente plage & mer

> **Prototype en cours d'audit, non prêt pour la production.** Le code est
> consultable sous [licence propriétaire](LICENSE). L'exécution, le déploiement,
> la réutilisation et l'exploitation commerciale nécessitent une autorisation
> écrite. Les instructions techniques ci-dessous s'adressent au titulaire et
> aux personnes autorisées. Elles ne constituent pas une permission d'usage.
>
> L'[audit du 16 novembre 2026](docs/AUDIT-2026-11-16.md) distingue les fonctions
> existantes des simulations et des connecteurs à développer. Les anciennes
> mentions « prêt » ci-dessous doivent être lues à la lumière de cet audit.

Application web de recommandation plage et mer : Angular + NestJS + PostgreSQL/PostGIS + Redis + Docker Compose, avec API météo/marine branchées et fallbacks locaux pour travailler sans clé payante.

## Lancer en local
Voir le [guide d'exploitation locale](docs/architecture/EXPLOITATION-LOCALE.md)
pour conserver les donnees, choisir des ports libres et reconstruire uniquement
l'API. Ne pas remplacer un fichier `.env` existant.

Pour une **installation neuve** uniquement :

```bash
test -f .env || cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build --wait postgres redis
docker compose -f docker-compose.local.yml build api migrate
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate node scripts/database.cjs seed
docker compose -f docker-compose.local.yml up -d --no-deps --no-build api
docker compose -f docker-compose.local.yml up -d --no-deps --build web
```

Pour une **base existante**, suivre le [guide des migrations](docs/architecture/MIGRATIONS.md)
avant de reconstruire l'API : sauvegarde, restauration de controle, migration
explicite puis redemarrage. Le demarrage de l'API ne modifie jamais le schema
et refuse une version non preparee. Ne pas rejouer `scripts/init.sql`.

Frontend: http://localhost:4200  
API: http://localhost:3000/api

Les ports exposes sont configurables via `API_PORT`, `WEB_PORT`,
`POSTGRES_PORT` et `REDIS_PORT`. Pour le frontend natif avec l'API Docker :

```bash
nvm use
npm --prefix apps/web ci
npm --prefix apps/web run start:local
```

Le lanceur lit les ports dans `.env`, avec priorite aux variables du shell.
Les ports internes Docker restent fixes ; ne pas arreter une autre application
pour liberer un port, choisir par exemple `API_PORT=3001`.

## Lancer en production
**Configuration presente mais non validee pour un deploiement public.** Les
corrections proxy/HTTPS (#29) et les images d'infrastructure (#33) restent
bloquantes. Une CI verte des images applicatives ne valide pas toute la stack.

```bash
cp .env.example .env.prod
# Renseigner DOMAIN, JWT_SECRET et les clés API disponibles.
npm run docker:prod
```

Le lanceur reste bloque tant que l'exception de securite #33 existe. Ne pas
contourner ce controle par un `compose up` direct. La preparation explicite
du schema avec le service `migrate` reste obligatoire avant toute future mise
en service ; ce lot ne valide pas le deploiement de production (#29).

Le reverse proxy Caddy expose le front et route `/api/*` vers NestJS.

## Fonctionnalités incluses
- Référentiel plages Postgres/PostGIS
- Scores baignade, famille, paddle, bateau
- Open-Meteo Forecast API fonctionnelle avec cache Redis et fallback local
- Open-Meteo Marine API fonctionnelle avec cache Redis et fallback local
- Connecteur SHOM prêt via `SHOM_API_KEY` avec fallback local non navigable
- Connecteur Météo-France prêt via `METEOFRANCE_API_KEY` avec fallback Open-Meteo
- Module qualité des eaux : ingestion officielle encore à développer ; aucune mesure sanitaire dans le seed de référence
- Signalements communautaires
- Recommandation des meilleures plages autour d'une position
- Docker local/prod + Caddy

## Sources de données
- Météo et prévisions mer : Open-Meteo est actif par défaut pour disposer d'une API temps réel sans clé. Météo-France peut être branché via `METEOFRANCE_API_KEY` après choix du produit API officiel.
- Référentiel plages : découverte par zone via OpenStreetMap Overpass (`OVERPASS_API_URL`) puis Nominatim (`NOMINATIM_API_URL`) en fallback, avec persistance PostgreSQL/PostGIS et fallback base locale.
- Vagues/houle : Open-Meteo Marine est actif par défaut. Les modèles Météo-France type MFWAM demandent un mapping produit spécifique.
- Marées : fallback local non navigable en développement. Les services SHOM SUP/SAPM nécessitent une clé d'abonnement `SHOM_API_KEY`.
- Qualité des eaux : aucune mesure ajoutée au démarrage ou par le seed de référence. Les exemples synthétiques exigent une base de démonstration séparée. L'ingestion officielle reste suivie dans #18 ; renseigner `WATER_QUALITY_DATASET_URL` ne suffit pas à l'implémenter.
- Signalements : stockés dans PostgreSQL et pris en compte dans le score des dernières 24h.

## Notes importantes production
SHOM SUP/SAPM nécessite une clé d'abonnement. Météo-France nécessite de choisir les produits API et mapper les réponses. Les données baignade doivent être importées depuis une ressource officielle data.gouv / baignades.sante.gouv compatible avec votre usage.

## Variables principales
Voir `.env.example`.

## Endpoints clés
- `GET /api/beaches`
- `GET /api/score/beach/:id`
- `GET /api/recommendations?lat=43.5&lon=6.7&usage=bathing`
- `GET /api/tides?lat=...&lon=...`
- `GET /api/water-quality?beachId=...`
- `POST /api/reports`

## Avant publication
1. Obtenir clé SHOM SUP/SAPM si besoin marées officielles.
2. Obtenir/choisir produits Météo-France API pour vigilance/BMS/modèles.
3. Fixer le dataset officiel qualité baignade et son mapping.
4. Ajouter authentification complète et modération reports.
5. Ajouter mentions légales, politique RGPD, disclaimer sécurité mer.

## Vérifications utiles
La [décision d'architecture](docs/architecture/ADR-001-monolithe-modulaire.md)
et le [premier lot de garde-fous](docs/architecture/GARDE-FOUS.md) décrivent la
migration progressive, la CI, les tests isolés et la restauration.

```bash
nvm use
npm run check:toolchain
npm run install:ci
npm run test:api
npm run test:ops
npm --prefix apps/api run build
npm --prefix apps/web run build
npm run test:ui
```

Ne pas recréer le volume `pgdata` ni rejouer le seed historique sur une base
existante pour changer son schéma. Utiliser les migrations versionnées de #8
avec sauvegarde et restauration préalables. Les commandes et les procédures
de retour arrière sont dans le [guide des migrations](docs/architecture/MIGRATIONS.md).
