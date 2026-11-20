# Classification des milieux aquatiques

Le lot #13 remplace les heuristiques sur les noms par une classification geographique
persistante. Il ne collecte aucune nouvelle plage. Une region, un departement, la
salinite ou le mot "lac" dans un nom ne determinent pas le milieu.

## Source et decision

Les extraits BD TOPO de l'IGN sont recuperes en GeoJSON depuis le
[service WFS de la Geoplateforme](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wfs/).
Les couches utilisees sont `BDTOPO_V3:limite_terre_mer` et
`BDTOPO_V3:surface_hydrographique`. Attribution des references : IGN, BD TOPO.

- `Plus hautes eaux` dans la limite terre-mer : candidat mer.
- `Lac` en service : candidat lac, independamment de sa salinite.
- `Ecoulement naturel` en service : candidat riviere.
- Bassins techniques, canaux, lagunes et natures non reconnues : inconnu.

PostGIS mesure la distance geodesique entre la position de la plage et les geometries.
La reference la plus proche doit etre a 200 metres maximum. Si un autre milieu,
y compris non classe, est a moins de 30 metres de difference, le resultat reste
inconnu. Ces seuils sont une inference de proximite, pas une certification de terrain
ni une autorisation de baignade. Une grande plage, un estuaire ou une position
imprecise peuvent necessiter une correction documentee.

Une source incomplete, invalide ou indisponible ne devient jamais "mer" par defaut.
Un echec de collecte ne remplace pas une classification precedente. Les geometries
invalides ne doivent pas servir de preuve. Les dates de collecte et de modification
de la source sont distinctes ; aucune date de mesure meteo n'est deduite de ces dates.

## Persistance et API

La migration `0003_water_classification.sql` ajoute une table distincte et la vue
`beach_catalogue`. Aucun identifiant, nom, equipement, signalement ou echantillon
sanitaire existant n'est modifie. Aucune classification n'est fabriquee par le seed.

Le champ public `waterType` reste `sea`, `lake`, `river` ou `unknown`.
`waterClassification` ajoute methode, source, date, motif et preuves (identifiant
IGN, couche, nature, type, distance et date de modification). Il vaut `null` tant
qu'aucune classification n'est disponible ou si les coordonnees ont change.
Les listes, le catalogue pagine, la commune, le detail et les recommandations lisent
la meme vue. Les filtres existants utilisent ce type sans modification visuelle.

Les fiches lac, riviere ou de milieu inconnu ne demandent pas de previsions marines
ni de marees. La temperature de l'eau et les scores qui dependent de mesures marines
restent inconnus jusqu'a l'integration de sources adaptees aux eaux interieures.
La meteo atmospherique et les observations communautaires restent consultables.

## Exploitation

Construire l'API avant la commande native. `DATABASE_URL` doit cibler la base voulue.
Le mode `collect` est en lecture seule sur PostgreSQL ; les extraits et le rapport
restent dans un dossier local ignore de Git.

```sh
npm run build:api
node apps/api/scripts/classify-water.cjs collect .local/water-classification/report.json
```

La collecte groupe les positions existantes par maille de 0,1 degre, avec marge de
500 metres environ. Les requetes sont sequentielles, espacees d'au moins 200 ms,
limitees a 20 s et 16 Mio par page. La pagination est ordonnee et bornee a 5 pages
de 1000 objets par couche/maille. Une limite atteinte sans completude est une erreur
explicite. Le cache d'extraits dure 7 jours ; une relance reprend les extraits valides
et retente les echecs. Le rapport expose progression, echecs, inconnus et preuves.

Apres sauvegarde, restauration de verification et migration, appliquer le rapport
controle. La transaction refuse un catalogue ou des coordonnees differents. Elle
n'ecrit que dans `beach_water_classifications` et n'ecrase pas une correction revue.

```sh
node apps/api/scripts/classify-water.cjs apply .local/water-classification/report.json
node apps/api/scripts/classify-water.cjs review BEACH_UUID lake https://source-officielle.example/page "Justification documentee du milieu"
```

La commande `review` est reservee a l'exploitation disposant des acces PostgreSQL ;
aucune route publique de correction n'est ajoutee. Conserver le rapport applique
avec la sauvegarde. Les acces et l'historique de moderation restent suivis separement.

Les routes publiques sont en lecture seule, y compris avec un ancien fichier
de configuration. La [collecte privee par commune](../CARTOGRAPHIE.md#collecte-privee-par-commune)
distingue simulation, exclusions, conflits a revoir et insertion explicite.
Le catalogue n'est pas presente comme exhaustif.

## Verification et retour arriere

Les tests couvrent La Baule/Pornic, lac sale, riviere, ambiguite d'estuaire, absence
de source, zero metre, pagination, correction, deplacement et absence de mutation
du catalogue. Les empreintes des tables historiques doivent etre identiques avant
et apres migration/application sur la copie restauree puis sur la base locale.

L'ancienne API peut lire le schema additif, mais son garde-fou refuse un historique
de migrations plus recent. Preparer et tester une image de compatibilite contenant
l'ancien code et le manifeste complet incluant 0003 ; ne pas effacer une migration
appliquee. Autre retour possible : restaurer la sauvegarde dans un volume distinct
et utiliser l'image correspondante. Ne jamais remplacer le volume actif sans verifier
les ecritures intervenues depuis la sauvegarde.
## Parcours par milieu (#35)

La recherche conserve la vue d'ensemble et propose trois sections partageables :
`/recherche?water=sea`, `/recherche?water=lake`, `/recherche?water=river`.
Seuls les sites publics deja classes figurent dans une section. Une classification
inconnue reste consultable dans la vue d'ensemble. Les rubriques ne constituent
pas un inventaire exhaustif ni un recensement de sites autorises a la baignade.

En eau douce, la carte OpenStreetMap cadre les sites du resultat ou le contour
de la commune choisie. Pas de trait de cote, de selecteur de facade, de tri
par confort marin ni de filtre de temperature marine. Dans la recherche et la
fiche, la meteo atmospherique reste attribuee a son fournisseur. Une mesure
de mer ne remplace jamais une temperature de lac ou de riviere.

Pour les sources, le rapprochement au site, les droits et la fraicheur, voir
[qualite sanitaire et restrictions](QUALITE-BAIGNADE.md) et
[equipements locaux](EQUIPEMENTS.md). Les archives saisonnieres ne prouvent
pas une autorisation actuelle. Les restrictions officielles actives restent
visibles sans note marine. Un poste de secours reference n'atteste pas la
surveillance en service. Aucun flux local valide de temperature d'eau douce,
de debit, de vitesse de courant ni de cyanobacteries n'est connecte en pre-V1.
