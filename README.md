# Littora - plateforme intelligente plage & mer

> **Prototype en cours d'audit, non prêt pour la production.** Le code est
> consultable sous [licence propriétaire](LICENSE). L'exécution, le déploiement,
> la réutilisation et l'exploitation commerciale nécessitent une autorisation
> écrite. Les instructions techniques ci-dessous s'adressent au titulaire et
> aux personnes autorisées. Elles ne constituent pas une permission d'usage.
>
> L'[audit du 16 novembre 2026](docs/AUDIT-2026-11-16.md) distingue les fonctions
> existantes à cette date des simulations et des connecteurs à développer.

Littora aide à comparer les conditions de baignade et de loisirs nautiques en
France métropolitaine, Corse comprise. Le [périmètre V1](docs/PERIMETRE-V1.md)
distingue les fonctionnalités retenues, les sources indisponibles, les reports
et les seuils à vérifier avant l'ouverture gratuite du service.

## Lancer en local
Voir le [guide d'exploitation locale](docs/architecture/EXPLOITATION-LOCALE.md)
pour conserver les donnees, choisir des ports libres et reconstruire uniquement
l'API. Ne pas remplacer un fichier `.env` existant.

Pour une **installation neuve** uniquement :

```bash
test -f .env || cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build --wait postgres redis
docker compose -f docker-compose.local.yml build api worker migrate
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate node scripts/database.cjs seed
docker compose -f docker-compose.local.yml up -d --no-deps --no-build api worker
docker compose -f docker-compose.local.yml up -d --no-deps --build web
```

Pour une **base existante**, suivre le [guide des migrations](docs/architecture/MIGRATIONS.md)
avant de reconstruire l'API : sauvegarde, restauration de controle, migration
explicite puis redemarrage. Le demarrage de l'API ne modifie jamais le schema
et refuse une version non preparee. Ne pas rejouer `scripts/init.sql`.

La [collecte météo automatique](docs/architecture/COLLECTE-METEO.md) démarre
progressivement après migration. Une consultation n'appelle pas Open-Meteo.

Frontend: http://localhost:4200  
API: http://localhost:3000/api

Les ports exposes sont configurables via `API_PORT`, `WEB_PORT`,
`POSTGRES_PORT` et `REDIS_PORT`. Pour le frontend natif avec l'API Docker :

```bash
nvm use
npm ci
npm run start:local --workspace apps/web
```

Le lanceur lit les ports dans `.env`, avec priorite aux variables du shell.
Le monorepo utilise un lockfile racine et un client Angular genere depuis OpenAPI.
Voir [contrats et provenance](docs/architecture/CONTRATS-API.md) pour les commandes
de generation, la validation et la compatibilite front/back.
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

## Ce que l'on peut consulter
- Catalogue PostGIS et recherche par commune, zone et critères. La liste est partielle ; un équipement inconnu ne signifie pas absent.
- Prévisions Open-Meteo et Open-Meteo Marine collectées par le worker. Le site distingue collecte et validité ; les calculs ne remplacent pas une mesure ou un drapeau officiel.
- Fiches, scores par usage lorsque les données suffisent, et signalements communautaires distincts des informations officielles.
- Aucun flux direct de marées SHOM, de vigilance Météo-France ou d'ingestion sanitaire ARS n'est garanti par la présence d'une clé ou d'une URL dans la configuration.

Pour mesurer la couverture du catalogue servi, sans import :
`npm run check:v1-coverage -- http://127.0.0.1:4200`.

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
Suivre la [matrice de recette V1](docs/PERIMETRE-V1.md), le registre de
[préversion #43](https://github.com/ActuatorIO-Foundry/littora/issues/43) et
les blocages de mise en service. Ni la disponibilité des fournisseurs ni
l'autorisation de diffusion ne se déduisent d'un build réussi.

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
