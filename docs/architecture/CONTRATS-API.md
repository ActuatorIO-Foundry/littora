# Contrats API et provenance

Decision #7, dans la continuite de [ADR-001](ADR-001-monolithe-modulaire.md).
Le contrat externe est `contracts/openapi.yaml` (OpenAPI 3.0.3, version 0.2.0).
Il est consultable en JSON sur `/api/openapi.json`, sans secret ni appel fournisseur.

## Frontiere HTTP

Les services metier ne dependent ni du client Angular ni des schemas HTTP.
`apps/api/src/http` valide les entrees avec Ajv, presente les resultats des services,
puis valide leur representation JSON avant publication. Un UUID, une coordonnee,
une pagination ou un signalement invalide est refuse avant l'appel metier.
Les champs inattendus des requetes sont refuses. Les nombres des query strings
sont controles comme nombres ; les corps JSON ne subissent aucune coercition.

Une reponse invalide produit une erreur interne generique et un journal technique
limite a l'operation, l'identifiant de requete et les chemins invalides. Les erreurs
publiques ont `statusCode`, `code`, `message`, `requestId` et `details`, sans SQL,
trace d'execution ni message brut d'un fournisseur. `x-request-id` est genere cote
serveur et `x-api-version` identifie le contrat.

## Mesures

Une mesure contient `value` nullable, `unit`, `source.provider`, `source.product`,
`kind`, `status`, `fetchedAt`, `validAt`, `validUntil`, `producedAt`, `resolution`
et `isDemo`. Les previsions actuelles restent des previsions, meme a l'heure courante.
La collecte ne devient jamais la date de production du modele. Produit exact,
resolution et fin de validite restent `null` quand la source ne les renseigne pas.

- `0` est une valeur disponible ; `null` est une mesure inconnue.
- `stale` conserve la valeur et les dates de la derniere collecte reelle.
- `observation`, `forecast`, `contribution` et `calculation` ne sont pas interchangeables.
- Les mesures courantes et les points de prevision ont leur propre provenance.
- Les fixtures de demonstration portent `isDemo: true` ; les echantillons sanitaires
  de demonstration restent exclus des routes publiques.

`contracts/examples/measurements.json` contient des exemples de format, pas des
releves reellement collectes : observation, prevision, inconnu, perime, zero,
contribution et demonstration. Ils sont verifies par les tests de schema.

Les equipements exposent `facilities.*.value` et `status` : `present`, `absent`,
`unknown`. Les anciens indicateurs du catalogue ne sont pas une verification de
terrain : `source: legacy-catalogue`, `verified: false`, `fetchedAt: null`.
La provenance des POI et leur validation terrain restent le perimetre de #14.

## Securite de baignade

`safety.officialFlag` reste explicitement inconnu sans source officielle.
`safety.communityFlag` contient le consensus et son historique, sans valeur officielle.
`safety.calculatedConditions` exprime le niveau calcule independamment du consensus.
Aucune moyenne n'est appliquee entre ces trois sources. Les seuils et la politique
de confiance existants ne changent pas dans ce lot ; leur refonte releve de #21/#22/#23.

## Compatibilite et pagination

Les URL existantes restent en place. Les nouveaux champs sont additifs.
`current`, `forecast`, `dataStatus` et les anciens champs de securite restent lisibles
par le front precedent. Les champs de presentation legacy sont marques deprecated
dans OpenAPI, sans date de suppression silencieuse.

Le catalogue expose l'enveloppe `items` + `pageInfo` (`nextCursor`, `hasNextPage`,
`limit`), avec ordre stable par UUID. `beaches` et `nextCursor` restent des alias
de transition. Les listes legacy `/beaches` et `/reports` restent bornees et ne
pretendent pas representer tout le catalogue. Les filtres serveur relevent de #19.

Ordre de livraison pour une evolution additive :

1. Modifier OpenAPI, les exemples et les tests ; generer le client dans la meme PR.
2. Livrer l'API compatible avec le front precedent.
3. Livrer le front. La facade actuelle accepte aussi les anciennes pages de catalogue.
4. Retirer un champ uniquement dans une version majeure, apres migration des consommateurs
   et verification d'une fenetre de compatibilite. Conserver une route/adaptateur ancien
   si un deploiement coordonne n'est pas possible.

Retour arriere de ce lot : ancienne image API et ancien front, independamment.
Aucune migration SQL, modification de volume ou extension de catalogue n'est requise.

## Workspaces et verification

`apps/api`, `apps/web` et `packages/api-client` partagent le lockfile racine.
`apps/nova` n'est pas un workspace et reste exclu des builds Docker.
La politique `strict-allow-scripts` et ses approbations exactes sont centralisees.
Les images API n'installent que le workspace serveur, sans generateur ou Angular.
Les contextes Docker sont la racine ; les COPY ciblent les seuls fichiers necessaires.

```sh
npm ci
npm run check:toolchain
npm run generate:api
npm run check:contracts
npm run test:api
npm run test:ops
npm run build:web
npm run test:ui
npm run audit
```

Le client est genere par ng-openapi-gen et utilise par `LittoraApiService`.
Ne pas modifier les fichiers generes a la main. La CI refuse toute derive, y compris
un nouveau fichier genere non versionne. Les tests controlent aussi la correspondance
entre toutes les routes Nest et OpenAPI, les reponses, les erreurs, les inconnues,
la pagination compatible et l'absence de mutation metier sur requete invalide.

Les adaptateurs officiels non raccordes, les favoris et l'authentification restent
documentes comme incomplets. Ce contrat ne les rend pas fonctionnels et ne leve pas
le blocage de production lie a #33.

References techniques : [ng-openapi-gen](https://github.com/cyclosproject/ng-openapi-gen),
[Ajv et OpenAPI](https://ajv.js.org/json-schema.html#openapi-support),
[npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/).
