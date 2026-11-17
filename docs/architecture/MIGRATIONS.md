# Migrations SQL et conservation des donnees

Suivi : #8. Branche de livraison : `feature/8-migrations`.
Le schema est prepare par une operation explicite, jamais par une requete HTTP.
La bascule d'une base existante exige un point de validation apres restauration.

## Fonctionnement

- SQL consecutif dans `apps/api/migrations`, journal `schema_migrations` avec SHA-256.
- Verrou de session commun aux migrations et seeds ; transaction par migration.
- Delai d'attente des verrous 5 secondes ; requete SQL limitee a 120 secondes.
- Refus d'un historique modifie, incomplet ou plus recent que l'image.
- Verification en lecture seule au demarrage de l'API ; refus si migrations manquantes.
- Pas de migration descendante automatique ni suppression de donnees pour dedoublonner.

`0001_baseline.sql` adopte le schema historique, complete les geometries absentes
et pose les index. Les UUID, geometries deja renseignees, identifiants OSM et
cles etrangeres sont conserves. Un conflit sur l'unicite OSM bloque la migration,
sans supprimer les lignes conflictuelles.

`0002_seed_identity.sql` ajoute l'identite du seed et le marquage `is_demo` des
echantillons sanitaires. Les anciens echantillons `local-seed` sont conserves
et marques comme demonstrations. Le filtrage de toute simulation dans les
reponses publiques reste dans #11 : cette migration ne termine pas ce chantier.

Ne jamais modifier une migration deja appliquee. Ajouter le prochain fichier
numerote pour toute evolution du schema. Le journal n'est pas un mecanisme de
validation de tous les contenus metier ; classification et provenance restent
suivies dans #7/#13.

## Commandes natives

Avec la version Node du projet et une `DATABASE_URL` explicite :

```sh
npm --prefix apps/api run db:status
npm --prefix apps/api run db:migrate
npm --prefix apps/api run db:seed
```

`status` indique les migrations en attente sans les appliquer. Aucun chargement
implicite du fichier `.env` par cette CLI. Dans Docker, utiliser le service
`migrate`, qui recoit le meme fichier d'environnement que l'API. Il appartient
au profil `tools` et ne fait pas partie du demarrage ordinaire de la stack.
Activer explicitement `--profile tools` lors de `compose run` : avec Compose
2.34, le ciblage implicite du service profile peut omettre son `env_file`.
La CLI refuse alors le demarrage sans `DATABASE_URL`, avant toute ecriture.

## Installation neuve

```sh
test -f .env || cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build --wait postgres redis
docker compose -f docker-compose.local.yml build api migrate
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate node scripts/database.cjs seed
docker compose -f docker-compose.local.yml up -d --no-deps --no-build --wait api
curl --fail 'http://127.0.0.1:3000/api/beaches?limit=1'
```

Adapter le port HTTP si `API_PORT` est different. Le seed de reference est
optionnel : cinq lieux geographiques, sans mesures sanitaires ni equipements
supposes. Une base migree sans seed constitue aussi une installation valide.
Le frontend natif peut ensuite etre lance avec `npm --prefix apps/web run start:local`.

## Base existante

Ne changer ni `COMPOSE_PROJECT_NAME` ni les noms de volumes. Ne jamais executer
`down -v`, `volume rm` ou le seed historique. `scripts/init.sql` refuse maintenant
l'execution ; il n'est plus monte dans PostgreSQL. Sa copie historique est
reservee aux tests d'adoption du schema.

1. Lire le statut des conteneurs et le montage PostgreSQL ; garder leurs noms.
2. Conserver l'image API precedente avant toute construction de remplacement.
3. Prendre un dump prive, le restaurer sur stockage jetable et verifier la migration.
4. Apres validation de l'interruption, suspendre les ecritures et refaire un dump final.
5. Appliquer les migrations, verifier le journal et les donnees, puis demarrer l'API.

Image de secours et sauvegarde privee :

```sh
api_container="$(docker compose -f docker-compose.local.yml ps -q api)"
api_image="$(docker inspect --format '{{.Image}}' "$api_container")"
docker image tag "$api_image" littora-api:before-migrations
umask 077
backup_dir=".local/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
docker compose -f docker-compose.local.yml exec -T postgres \
  pg_dump -U littora -d littora -Fc > "$backup_dir/littora.dump"
```

Verifier le code de sortie du dump avant toute autre operation. Une sauvegarde
faite pendant l'activite est coherente, mais des ecritures ulterieures peuvent
exister : la sauvegarde de recette ne remplace pas celle de la bascule finale.
Les fichiers `.local/` sont exclus de Git.

Tester la copie, avec les services jetables uniquement :

```sh
docker compose -f docker-compose.test.yml up -d --build --wait
export TEST_DATABASE_URL='postgresql://littora:test-only-password@127.0.0.1:55432/littora_ci_test'
export TEST_REDIS_URL='redis://127.0.0.1:56379/15'
npm run test:integration
POSTGRES_CONTAINER="$(docker compose -f docker-compose.test.yml ps -q postgres)" \
MIGRATION_TEST_DUMP="$backup_dir/littora.dump" node scripts/test-restored-migrations.mjs
```

Le script refuse un serveur qui ne declare pas `littora_ci_test`, cree deux
bases temporaires, verifie que les connexions Docker et TCP visent la meme base,
restaure sans proprietaires, migre et compare comptes/empreintes/geometries.
Une seconde restauration teste le retour a la sauvegarde. Les bases temporaires
sont retirees en fin de test ; la base applicative n'est jamais ciblee.

Apres le point de validation, construire puis suspendre le seul processus qui
ecrit actuellement en base. Si un worker distinct est ajoute, le suspendre aussi.

```sh
docker compose -f docker-compose.local.yml build api migrate
docker compose -f docker-compose.local.yml stop api
# Refaire et verifier la sauvegarde finale avant la commande suivante.
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate
docker compose -f docker-compose.local.yml --profile tools run --rm --no-deps migrate node scripts/database.cjs status
docker compose -f docker-compose.local.yml up -d --no-deps --no-build --wait api
curl --fail 'http://127.0.0.1:3000/api/beaches?limit=1'
```

Sur une base existante, ne pas lancer le seed automatiquement : la migration
n'ajoute aucune plage. Comparer les UUID, identifiants OSM, signalements et
geometries avec le dump final. Les colonnes ajoutees (`seed_key`, `is_demo`) sont
exclues uniquement de la comparaison des champs historiques.

## Reprise et retour arriere

Une migration en echec annule sa transaction, pas les migrations precedentes
deja validees. Le journal permet une reprise apres correction de la cause.
Ne pas modifier les empreintes du journal pour forcer un demarrage. Une collision
OSM demande une analyse metier, pas un effacement automatique des doublons.

Le schema de ce lot est additif. Pour revenir au code precedent sans supprimer
les nouvelles colonnes, utiliser l'image conservee et ne pas reconstruire :

```sh
docker compose -f docker-compose.local.yml stop api
api_container="$(docker compose -f docker-compose.local.yml ps --all -q api)"
api_tag="$(docker inspect --format '{{.Config.Image}}' "$api_container")"
docker image tag littora-api:before-migrations "$api_tag"
docker compose -f docker-compose.local.yml up -d --no-deps --no-build --wait api
```

La compatibilite doit etre reverifiee pour chaque future migration. Pour un
retour complet au schema precedent, restaurer le dump dans un **nouveau volume**,
verifier les empreintes, puis basculer explicitement les references selon
[INFRASTRUCTURE.md](INFRASTRUCTURE.md). Garder le volume original. Les ecritures
posterieures a la sauvegarde exigent un arbitrage explicite avant toute bascule.

## Demonstration isolee

`db:seed:demo` exige simultanement `ALLOW_DEMO_SEED=true`, un environnement autre
que `production` et une base distincte dont le nom finit par `_demo`. Les donnees
synthetiques sont marquees par `source=demo-seed`, `is_demo=true` et `raw.demo=true`.
Ne jamais connecter le service public a cette base. Les seeds sont rejouables :
ils ne recreent pas les UUID et ne dupliquent pas les echantillons.

## Recette et CI

Recette locale du 17 novembre 2026 : 29 tests API reussis (3 TODO metier
preexistants), 7 tests d'integration et 9 tests d'exploitation. La sauvegarde
reelle a ete restauree deux fois : 609 plages, 30 signalements et 609 geometries
preserves, empreintes des champs historiques identiques. L'image Docker a passe
le test de demarrage et la lecture avec l'image precedente. Ces verifications
n'ont pas migre la base locale active ni applique le seed sur celle-ci.

- Tests API : manifeste, historique, demarrage en lecture seule, absence de DDL
  dans la decouverte et garde-fous de demonstration.
- Tests PostGIS : base vierge, schema historique avec doublons, preservation des
  relations, geometries, echec transactionnel, verrou concurrent et seed rejoue.
- `scripts/test-api-migrations.mjs` : reseau Docker interne sans ports publics,
  stockage temporaire, refus de demarrage avant migration, CLI de l'image finale,
  double seed, API HTTP non-root et lectures sans modification de donnees.
- `PREVIOUS_API_IMAGE` active en plus le test de compatibilite de l'image precedente.
- La CI execute le test de l'image, la restauration PostgreSQL/Redis, les suites
  API/UI et le controle des images. La production reste bloquee par #33/#29.

References : [transactions pg](https://node-postgres.com/features/transactions),
[verrous PostgreSQL](https://www.postgresql.org/docs/16/explicit-locking.html),
[profils Compose](https://docs.docker.com/compose/how-tos/profiles/).
