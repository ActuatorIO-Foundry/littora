# Migrations SQL - lot en cours

Suivi : #8, branche `feature/8-migrations`. Non fusionne et non deploye.
La priorite passe temporairement aux corrections de cartographie #24.

## Principes

- SQL versionne dans `apps/api/migrations`, journal `schema_migrations` avec SHA-256.
- Verrou de session commun aux migrations et seeds ; transaction par migration.
- Refus d'un historique modifie ou inconnu ; pas de migration descendante destructive.
- Verification en lecture seule au demarrage de l'API ; aucun DDL dans la decouverte.
- `db:seed` ne cree que cinq references geographiques, sans mesures sanitaires
  ni equipements supposes. Les anciens UUID, doublons et signalements sont conserves.
- `db:seed:demo` exige `ALLOW_DEMO_SEED=true`, un environnement non production
  et une base distincte dont le nom finit par `_demo`. Les echantillons sont marques.
- `scripts/init.sql` refuse maintenant l'execution. Sa copie historique est
  reservee aux tests d'adoption de l'ancien schema.

## Commandes

Avec `DATABASE_URL` explicitement definie :

```sh
npm --prefix apps/api run db:status
npm --prefix apps/api run db:migrate
npm --prefix apps/api run db:seed
```

Le service Compose `migrate` est dans le profil `tools`, jamais lance par les
requetes HTTP. Pour une base neuve, lancer PostgreSQL, construire l'image de
migration puis executer `docker compose -f docker-compose.local.yml run --rm
--build migrate` avant l'API. Une base existante exige d'abord sauvegarde et
restauration validee, puis un point de controle avant application.

## Verification du 17 novembre 2026

24 tests API reussis, 3 TODO metier preexistants ; 7 tests d'integration reussis.
Installation vierge, schema historique avec doublons, conservation des UUID,
cles et geometries, seed rejoue, verrou concurrent et annulation transactionnelle.
Image `littora-api:migrations-test` construite sans remplacer l'API active.

`scripts/test-restored-migrations.mjs` a restaure la sauvegarde privee dans deux
bases jetables : migration puis restauration de retour arriere. 602 plages,
29 signalements et 602 geometries conserves, empreintes des champs historiques
identiques. La base locale active n'a pas ete migree.

Reste avant validation : mettre a jour les recettes README/exploitation, tester
le demarrage HTTP de l'image sur stockage isole, valider toute la CI puis faire
approuver la bascule locale. Conserver l'image precedente et la sauvegarde ; le
retour arriere complet se fait par restauration, pas suppression des nouveaux champs.

References : [transactions pg](https://node-postgres.com/features/transactions),
[verrous PostgreSQL](https://www.postgresql.org/docs/16/explicit-locking.html).
