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
```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up --build
```

Frontend: http://localhost:4200  
API: http://localhost:3000/api

## Lancer en production
```bash
cp .env.example .env.prod
# Renseigner DOMAIN, JWT_SECRET et les clés API disponibles.
docker compose -f docker-compose.prod.yml up --build -d
```

Le reverse proxy Caddy expose le front et route `/api/*` vers NestJS.

## Fonctionnalités incluses
- Référentiel plages Postgres/PostGIS
- Scores baignade, famille, paddle, bateau
- Open-Meteo Forecast API fonctionnelle avec cache Redis et fallback local
- Open-Meteo Marine API fonctionnelle avec cache Redis et fallback local
- Connecteur SHOM prêt via `SHOM_API_KEY` avec fallback local non navigable
- Connecteur Météo-France prêt via `METEOFRANCE_API_KEY` avec fallback Open-Meteo
- Module qualité des eaux alimenté par seed local, prêt pour ingestion dataset officiel
- Signalements communautaires
- Recommandation des meilleures plages autour d'une position
- Docker local/prod + Caddy

## Sources de données
- Météo et prévisions mer : Open-Meteo est actif par défaut pour disposer d'une API temps réel sans clé. Météo-France peut être branché via `METEOFRANCE_API_KEY` après choix du produit API officiel.
- Référentiel plages : découverte par zone via OpenStreetMap Overpass (`OVERPASS_API_URL`) puis Nominatim (`NOMINATIM_API_URL`) en fallback, avec persistance PostgreSQL/PostGIS et fallback base locale.
- Vagues/houle : Open-Meteo Marine est actif par défaut. Les modèles Météo-France type MFWAM demandent un mapping produit spécifique.
- Marées : fallback local non navigable en développement. Les services SHOM SUP/SAPM nécessitent une clé d'abonnement `SHOM_API_KEY`.
- Qualité des eaux : seed local en développement. L'ingestion officielle passe par `WATER_QUALITY_DATASET_URL`, à renseigner avec la ressource data.gouv / baignades.sante.gouv retenue.
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
npm --prefix apps/api run build
npm --prefix apps/web run build
npm run test:ui
```

Ne pas recréer le volume `pgdata` ni rejouer le seed historique sur une base
existante pour changer son schéma. Préserver les données et attendre les
migrations versionnées suivies dans #8, avec sauvegarde préalable.
