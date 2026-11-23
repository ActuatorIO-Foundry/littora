# Premier lot : garde-fous

Branche : `architecture`. Decision : [ADR-001](ADR-001-monolithe-modulaire.md).
Suivi : #9 et #10. Aucun changement d'apparence ou de regle de score dans ce lot.
Reference historique : `bc514f4`. Les [correctifs de dependances](SECURITE-DEPENDANCES.md)
documentent les mises a jour du lot suivant et les audits desormais bloquants.

## Environnement reproductible

Node 24.22.3 LTS et npm 11.19.1, alignes entre `.nvmrc`, manifestes et Docker.
Les versions directes sont celles des lockfiles existants : aucune mise a niveau
Angular, Three.js, Motion ou des autres dependances applicatives dans ce lot.
Les deux lockfiles restent separes jusqu'au lot contrats/workspaces.

```sh
nvm install
nvm use
npm run check:toolchain
npm run install:ci
npm run test:api
npm run build:web
npm exec --prefix apps/web -- playwright install chromium firefox webkit
npm run test:ui
```

`npm ci` doit echouer si manifeste et lockfile divergent ; ne pas remplacer par
`npm install` pour faire passer la CI. `check:toolchain` controle aussi les
versions directes et l'utilisation de `npm ci` dans les images.
Les couches OS des images ne sont pas encore figees par digest : cela reste
un travail de durcissement, pas une garantie de reproductibilite bit a bit.

Playwright lance et arrete son propre serveur sur le port 4300. Un port occupe
fait echouer le lancement sans arreter l'application existante. Pour viser
explicitement un serveur deja lance : `LITTORA_URL=http://127.0.0.1:4200 npm run test:ui`.
`PLAYWRIGHT_CHANNEL=chrome` permet d'utiliser Chrome local.
Les requetes API non simulees et les origines externes sont bloquees dans les
tests navigateur. Aucune cle fournisseur ni ecriture dans la base de consultation.

## CI et couverture

Le workflow CI tourne sur push `main`/`architecture` et sur PR vers `main` :

- Compilation API et tests natifs Node, dont fumee HTTP avec services doubles.
- Compilation production Angular et 55 tests Playwright sur cinq viewports.
- Integration avec PostgreSQL/PostGIS et Redis isoles, puis dump/restauration.
- Verification que les installations ne changent pas les lockfiles.
- Rapports et captures Playwright conserves sept jours.

Les actions sont referencees par revision, le jeton CI est en lecture seule.
Pas de deploiement automatique. La protection obligatoire des branches devra
etre configuree dans GitHub apres verification des noms des checks et des droits.

Les tests metier couvrent les distances, classifications simples, requetes
parametrees, limites, scores bornes, alertes, absence de series et historique
communautaire. Les seuils actuels ne constituent pas une validation de securite.

Trois assertions executables restent marquees TODO avec leur ticket :

- #13 : une plage de Loire-Atlantique est actuellement classee riviere.
- #12 : une prevision `null` est actuellement convertie en zero.
- #21 : un score est actuellement produit sans couverture meteo/marine.

Elles apparaissent distinctement des tests reussis et ne rendent pas la CI
rouge en permanence. Retirer le TODO avec chaque correctif. Tout nouveau defaut
introduit dans ce lot doit etre corrige, pas ajoute a cette liste.
La couverture etendue des contrats, filtres serveur, fuseaux horaires, fournisseurs,
autorisations communautaires et le lint restent a construire dans les lots suivants.

## Integration et restauration locales

Les services de test n'utilisent aucun volume ni base de l'application. Les ports
55432 et 56379 peuvent etre adaptes avec TEST_POSTGRES_PORT et TEST_REDIS_PORT.
Adapter alors les URL ci-dessous ; ne jamais reutiliser les URL de production.

```sh
docker compose -f docker-compose.test.yml up -d --wait
TEST_DATABASE_URL=postgresql://littora:test-only-password@127.0.0.1:55432/littora_ci_test \
TEST_REDIS_URL=redis://127.0.0.1:56379/15 npm run test:integration
POSTGRES_CONTAINER=$(docker compose -f docker-compose.test.yml ps -q postgres) \
  bash scripts/test-database-restore.sh
docker compose -f docker-compose.test.yml down
```

Les tests refusent une base dont le nom n'est pas `littora_ci_test`. Le script
de restauration refuse un conteneur non dedie aux tests, cree une base temporaire
et compare les lignes et identifiants des plages, signalements et qualite d'eau.
Il supprime uniquement cette base temporaire et son dump en sortie.
Le schema et seed historiques sont testes tels quels ; leur idempotence sera
corrigee dans #8. Cette verification ne remplace pas une sauvegarde de la base
reelle avant migration : aucune migration ni sauvegarde de production dans ce lot.

## Routes internes

`/api/admin/*` et `/api/ingestion/*` sont desormais proteges par un jeton serveur
provisoire `ADMIN_API_TOKEN`, transmis en `Authorization: Bearer ...`.
Sans configuration, avec moins de 32 caracteres ou avec des espaces, ces routes
repondent 503. Un jeton absent ou incorrect repond 401 sans lancer d'operation.
Le jeton configure doit etre aleatoire ; generation locale possible :

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Garder ce secret dans l'environnement du serveur, jamais dans Angular, Git,
une capture ou un journal. Utiliser HTTPS hors loopback. Le jeton est une
protection d'attente, pas le futur systeme d'identite/roles de #26. Ne pas utiliser
`/api/admin/health` comme probe publique ; son contenu historique n'est pas un
diagnostic des dependances. L'ingestion reste un prototype, meme avec un jeton.

Les contributions publiques, quotas, CORS et autres endpoints restent a durcir.
La securisation de ces deux routes ne rend pas l'application prete pour Internet.

## Suite

Verification locale du 16 novembre 2026 : installations propres sans changement
des lockfiles, compilations API/Web, 15 tests API reussis et 3 TODO reproduits,
55 tests UI reussis, integration PostGIS/Redis et restauration reussies.
L'image API multi-stage compile et n'embarque pas les dependances de developpement.

Audit `npm audit --omit=dev` du meme jour : 5 alertes API (1 critique, 3 elevees,
1 moderee) et 7 Web (4 elevees, 3 moderees). Ces nombres incluent les dependances
affectees transitivement, pas autant de failles independantes. Le triage de
l'exposition et les correctifs restent dans #9 ; aucune exception de securite
n'est acceptee implicitement par une CI verte. Traiter ce point avant publication.

Le constat d'audit ci-dessus est historique : les alertes npm ont ensuite ete
corrigees dans le lot [securite des dependances](SECURITE-DEPENDANCES.md).
#9 reste ouvert pour les images systeme, la politique des scripts d'installation
et la documentation complete des ports de lancement.
#10 reste ouvert pour les controles manquants et les regressions des prochains lots.
Ne pas fusionner automatiquement la branche ; conserver le visuel valide.
