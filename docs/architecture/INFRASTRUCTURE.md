# Mise a niveau des stockages et du proxy

Suivi : #33. Branche : `architecture`. Recette du 16-17 novembre 2026.
Pas de fusion dans `main`, pas de deploiement de production.

## Images retenues

| Service | Cible | Construction |
| --- | --- | --- |
| PostgreSQL / PostGIS | 16.16 / 3.7.0, Alpine 3.24 | `infra/postgres/Dockerfile` |
| Tiger Geocoder | 2025.2, scripts officiels PostgreSQL 16 | Archive verifiee par SHA-256 |
| Redis | 7.4.12, Alpine 3.22 | `infra/redis/Dockerfile`, zlib 1.4-r0 |
| Caddy | 2.11.9, Go 1.27.4, Alpine 3.24 | `infra/caddy/Dockerfile`, `go.mod`, `go.sum` |

Toutes les bases sont epinglees par version et digest. Les images applicatives
d'infrastructure sont construites localement et en CI, pas publiees dans un registre.
PostGIS officiel est AMD64 : execution emulee sur Apple Silicon, CI Linux AMD64.
Redis/Caddy sont construits sur ARM64 localement et AMD64 en CI.

PostgreSQL conserve sa majeure 16. Le passage glibc vers musl se fait uniquement
par restauration logique dans un nouveau volume : aucun ancien PGDATA n'est
monte dans l'image Alpine. La restauration reconstruit les index avec la nouvelle
locale ; les empreintes utilisent `COLLATE "C"` pour rester comparables.

PostGIS 3.7 a separe Tiger du coeur. L'extension autonome est donc installee sans
suppression des schemas existants. L'ancien gosu embarquait un runtime Go obsolete ;
il est retire et le point d'entree utilise `su-exec` 0.3-r0.

## Securite et exception temporaire

Scans complets Trivy 0.76.2 : PostGIS et Redis ne remontent aucune alerte dans les
images finales verifiees. Caddy conserve trois avis JOSE v3 :

- CVE-2026-116587, eleve : parametres RSA/JWK malveillants, deni de service.
- CVE-2026-116585 et CVE-2026-116586, moderes : parsing JOSE.

La branche v3 ne publie pas de correctif compatible. L'essai avec Smallstep crypto
0.92.0 / JOSE v4 casse la compilation de certificates 0.30.2 ; il n'est pas retenu.
Les correctifs compatibles Go, x/net, x/crypto, OpenTelemetry et zlib sont appliques.
La configuration actuelle n'expose pas de service ACME/PKI interne, mais cela
ne constitue pas une preuve d'inexploitabilite de toutes les dependances.

Une exception CI explicite est limitee a CVE-2026-116587, au paquet/version JOSE
v3.0.5 de Caddy, jusqu'au **30 novembre 2026 exclu**. Un autre avis, un changement
de version, un correctif disponible ou l'echeance fait echouer le controle.
Les rapports complets restent des artefacts CI ; aucun `ignore-unfixed` global.
Les deux avis moderes restent visibles et suivis dans #33.

**Production bloquee** jusqu'a suppression de cette exception apres correction :
`npm run docker:prod` refuse de demarrer tant qu'une exception est presente.
Ne pas contourner ce controle en lancant directement le Compose production.
#33 reste ouvert pour le correctif amont ; #29 conserve le chantier HTTPS public.
Le lanceur production utilise exclusivement `.env.prod` et le projet Compose
`littora-prod`, pour ne pas recuperer les selections de volumes du `.env` local.

## Preparation locale sans modification des volumes actifs

Fermer les clients susceptibles d'ecrire directement dans PostgreSQL/Redis.
Le script est destine a la stack locale, base/role `littora`, Redis sans ACL.
Ce n'est pas une procedure de migration generique de production.

```sh
docker compose -f docker-compose.local.yml build postgres redis api
node scripts/prepare-storage-upgrade.mjs
```

Le script suspend temporairement l'API, sauvegarde PostgreSQL (dump custom et
roles) et Redis (RDB plus archive des fichiers), puis redemarre l'API d'origine.
Il restaure sur de nouveaux volumes dans des conteneurs sans reseau externe.
Il verifie egalement une restauration du dump sur l'ancienne image PostgreSQL.
Sauvegardes, empreintes, noms des volumes et rapport restent dans `.local/backups/`,
exclus de Git. Les conteneurs de recette sont supprimes, les volumes sont conserves.

Controles : 39 tables inventoriees, identifiants/contenu des tables applicatives,
geometries EWKB, contraintes, index, lecture geographique utilisant GiST et memes
voisins ; valeurs Redis dans toutes les bases et dates d'expiration absolues.
Une cle deja expiree naturellement n'est pas consideree comme perdue.

Les nouvelles donnees de reference Tiger ne sont acceptees que si la table source
est strictement identique a celle d'une installation vierge de l'ancienne image.
Une personnalisation bloque la recette. Quatre tables de reference changent :
loader_lookuptables, loader_platform, loader_variables et street_type_lookup.
Les tables applicatives et donnees personnalisees ne beneficient d'aucune exemption.

## Basculement controle

Apres validation de la recette et accord pour une interruption locale :

```sh
node scripts/prepare-storage-upgrade.mjs --keep-paused
```

Ce second passage prend une sauvegarde fraiche. En cas d'echec, l'API d'origine
redemarre automatiquement. En cas de succes, elle reste arretee pour eviter de
perdre des ecritures entre sauvegarde et basculement.

Reporter dans `.env` les deux valeurs `POSTGRES_VOLUME` et `REDIS_VOLUME` du rapport
`verified.json`. Conserver une copie privee de l'ancien `.env`, des images et des
montages listes dans `manifest.json`. Ne pas selectionner un volume non verifie.
Mettre `STORAGE_VOLUMES_EXTERNAL=true` pour interdire la creation silencieuse
d'un volume vide en cas de faute dans son nom. Ces volumes restent exclus du
nettoyage Compose. En cas d'interruption manuelle du script, redemarrer l'API
d'origine avant de reprendre la procedure.

```sh
docker compose -f docker-compose.local.yml up -d --no-deps --no-build --wait postgres redis
docker compose -f docker-compose.local.yml up -d --no-deps --no-build --wait api
curl --fail 'http://127.0.0.1:3000/api/beaches/catalogue?limit=200'
```

Verifier ensuite les empreintes applicatives, les volumes montes, les extensions,
Redis et la recherche via le proxy Web. Les ports PostgreSQL/Redis sont maintenant
lies a 127.0.0.1. Ne jamais executer `down -v` sur la stack applicative ni rejouer
`init.sql` dans la base restauree. Garder les anciens volumes et sauvegardes.

## Retour arriere

Sans ecriture depuis le basculement : arreter l'API, re-selectionner les anciens
volumes et les **anciennes images exactes** du manifeste via un override Compose
prive, recréer uniquement les stockages puis l'API. Les volumes sont intacts.
Le volume Redis historique peut etre anonyme : utiliser son nom Docker complet,
pas un nouveau volume vide. Retirer l'override seulement apres une nouvelle recette.

Avec des ecritures nouvelles : ne pas revenir aveuglement a la sauvegarde ancienne.
Suspendre les ecritures, sauvegarder l'etat courant et preparer une restauration
compatible/reconciliation. Une ancienne image ne sait pas automatiquement retrograder
PostGIS 3.7/Tiger 2025.2. La recette valide la restauration du dump **pre-migration**
sur l'ancienne image, pas un downgrade des extensions mises a niveau.

## Tests reproductibles

`docker-compose.test.yml` est exclusivement jetable (PostgreSQL en tmpfs).
La CI reconstruit les images, teste catalogue et relations, restaure les tables
avec des fixtures sanitaires et geometriques non vides, puis restaure un RDB avec
des jobs BullMQ en pause/differes et execute un job apres reprise.
Le test Caddy utilise un reseau interne avec serveurs factices et verifie `/api`,
ses sous-routes/parametres et les routes frontend. `handle` conserve le prefixe
Nest `/api`, contrairement a l'ancien `handle_path`.

## Catalogue : 602 contre 180

La route historique `/api/beaches` renvoie un tableau borne a 180 par defaut
(500 maximum). Elle reste compatible avec les anciens consommateurs.
La recherche utilise maintenant `/api/beaches/catalogue`, pages de 200, curseur
UUID stable et parametres valides. Elle parcourt les pages jusqu'a `nextCursor=null`
avant d'appliquer les filtres existants. Les cartes de resultats restent affichees
par lots de 20 avec « Afficher plus », sans plafond global de 180/500.

Apres decouverte d'une facade, la recherche recharge tout le catalogue en base
dans son emprise. Cela ne signifie pas que les 602 plages representent toutes les
plages de France : ingestion OSM, dedoublonnage, classification et filtres meteo
restent des chantiers distincts. Une pagination serveur des filtres devra remplacer
le chargement complet lorsque le catalogue grandira fortement.

## References

- [Images officielles PostGIS](https://github.com/postgis/docker-postgis)
- [Ruptures PostGIS 3.7](https://postgis.net/docs/release_notes.html)
- [Tiger 2025.2](https://postgis.net/2026/08/PostGIS-Tiger-Geocoder-2025.2/)
- [Persistance Redis](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Avis JOSE](https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q)
