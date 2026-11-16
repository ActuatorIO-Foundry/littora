# Correctifs des dependances - issue #9

Date : 16 novembre 2026. Branche : `architecture`. Base : `bc514f4`.
Ce lot ne change pas les regles metier ni les contrats API. Les retouches de
fond littoral et de chargement sont suivies dans un commit visuel distinct.

## Resultat des audits npm

| Perimetre | Avant | Apres |
| --- | --- | --- |
| API, production | 5 alertes, dont 1 critique | 0 |
| API, production et developpement | 15 alertes, dont 1 critique | 0 |
| Web, production | 7 alertes | 0 |
| Web, production et developpement | 60 alertes, dont 5 critiques | 0 |

Ces nombres incluent les parents affectes transitivement. Ils ne representent
pas autant de failles independantes. Aucun avis n'est masque ou accepte par
exception. Resultat valable pour le registre et les lockfiles a cette date.
L'audit npm ne couvre ni les images OS, ni les defauts du code applicatif.

## API : priorite critique

La chaine Express utilisait `proxy-addr` 2.0.7. Un prefixe IPv6 de confiance mal
configure pouvait accorder la confiance a tous les clients IPv4 et permettre
la falsification de l'adresse client via X-Forwarded-For. Aucun `trust proxy`
explicite n'est configure dans le bootstrap courant ; cela limite le chemin
d'exposition actuel mais ne justifie pas de conserver cette dependance.

- NestJS common/core/platform-express/testing : 11.2.10, sans changement de majeure.
- Chaine corrigee : proxy-addr 2.0.8, body-parser 2.4.0, qs 6.17.1, multer 2.5.0.
- Test de regression sur la dependance effectivement resolue par Express :
  echec confirme avec l'ancienne version, succes avec la version corrigee.
- Test positif : les sous-reseaux IPv4 et IPv6 correctement limites restent utilisables.

Les autres avis API concernaient notamment le parsing HTTP et multipart.
L'absence actuelle d'upload ne sert pas d'exemption : les dependances sont corrigees.

La CLI Nest et ses generateurs etaient utilises uniquement pour `start:dev`.
Leur chaine webpack/glob/deepmerge comportait des avis sans correction compatible
complete dans la branche 11. Ils sont retires plutot que de migrer la CLI et les
generateurs vers Nest 12. La compilation reste `tsc` et le developpement utilise
`node --watch --require ts-node/register src/main.ts`. Un test demarre cette
commande sur un port ephemere sans base ni Redis et verifie les routes internes.

## Frontend et outillage

- Framework et compilateur Angular : 21.2.26.
- CLI et builder Angular : 21.2.30. Pas de migration vers Angular 22.
- Three.js, Motion, Leaflet, Lucide et les polices conservent leurs versions.
- Les avis couvrent le compilateur, la sanitisation et plusieurs fonctions SSR.
  L'application est cliente sans SSR/hydratation ; cela n'exempte pas le compilateur.
- Les dependances du serveur de developpement et de la chaine de build sont
  egalement corrigees, meme lorsqu'elles ne sont pas embarquees dans le site statique.

Trois substitutions ciblees dans `overrides` couvrent les correctifs non repris
par tous les parents de la branche Angular 21 :

| Dependance | Version | Limite et controle de compatibilite |
| --- | --- | --- |
| glob | 14.0.6 | Seulement les versions vulnerables >=9 <=14.0.1 ; API `glob` et annulation testees |
| minimatch | 11.0.5 | Seulement >=7 <11.0.1 ; API `Minimatch` utilisee par ignore-walk testee |
| uuid | 11.1.1 | Seulement sous SockJS ; export CommonJS `v4` et chargement SockJS testes |

Ces substitutions restent a reevaluer lors des prochaines mises a jour des
parents. Elles n'affectent pas les anciennes majeures de minimatch non concernees.
Elles sont couvertes par `test:tooling`, les builds et le serveur Playwright.

Le lockfile Web a ete regenere dans une copie sans node_modules : l'ancien
graphe de peers Angular empechait la resolution simultanee des correctifs.
Les versions directes restent exactes. Aucun `--force`, `--legacy-peer-deps`
ou remplacement manuel du contenu d'un paquet installe n'est utilise.

## Controles

```sh
nvm use
npm run install:ci
npm run check:toolchain
npm run audit
npm run test:api
npm --prefix apps/web run test:tooling
npm run build:web
npm run test:ui
```

Les jobs API et Web executent maintenant un audit complet bloquant des le niveau
faible. Un echec du registre n'est pas traite comme une absence d'alerte.
Les trois TODO metier historiques (#12, #13, #21) ne sont pas des exceptions
de dependances et restent distincts des tests reussis.

Verification locale sur installation propre : 18 tests API reussis, 3 TODO
historiques, 3 tests d'outillage reussis, 60 tests UI reussis, integration
PostGIS/Redis et restauration reussies. Images Docker API et Web construites.
Aucun acces fournisseur ni ecriture dans la base applicative pendant ces tests.

Les processus deja lances ne changent pas de dependances avec un push. Reinstaller
avec npm ci et redemarrer les services, ou reconstruire leurs images, pour appliquer
les correctifs a une instance. Aucune mise en production ni fusion dans main dans ce lot.

## Lot d'exploitation suivant

Le [lot d'exploitation locale](EXPLOITATION-LOCALE.md) applique ensuite les
correctifs au conteneur API existant apres sauvegarde/restauration verifiee.
Il complete la politique des scripts, les ports, la protection de main et les
scans des images finales. Les anciennes images d'infrastructure sont suivies
dans #33 ; #9 reste ouvert tant que ce blocage securite n'est pas traite.

## References

- [Avis critique proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
- [Correctif proxy-addr 2.0.8](https://github.com/jshttp/proxy-addr/releases/tag/v2.0.8)
- [NestJS 11.2.10](https://github.com/nestjs/nest/releases/tag/v11.2.10)
- [Angular 21.2.26](https://github.com/angular/angular/releases/tag/v21.2.26)
- [Outillage Angular 21.2.30](https://github.com/angular/angular-cli/releases/tag/v21.2.30)
- [Glob : annulation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [Minimatch : amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [UUID : bornes des buffers](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
