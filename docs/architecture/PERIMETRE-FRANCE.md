# Perimetre public du catalogue

La V1 couvre la France metropolitaine, Corse et iles comprises. La migration
`0006_metropolitan_territory.sql` filtre la vue publique `beach_catalogue` sans
supprimer ni modifier les plages, signalements, equipements ou classifications.
Les limites rectangulaires des facades ne determinent pas le pays d'une plage.

## Reference geographique

Le filtre utilise la relation administrative France
[OpenStreetMap 2202162](https://www.openstreetmap.org/relation/2202162), extraite
le 17 novembre 2026 depuis Nominatim. Ses deux composantes metropolitaines
comprennent les eaux cotieres : un repere sur l'estran n'est pas exclu parce
qu'il est au-dela du seul contour terrestre. Les trous et frontieres sont
conserves, notamment Monaco et l'enclave de Llivia. Aucun tampon de proximite,
nom de commune ou libelle de region n'est utilise pour attribuer un pays.

L'enveloppe `[-6,41,10,52]` sert seulement a extraire les composantes du pays
metropolitain. L'appartenance est ensuite testee contre les vrais polygones,
sans simplification. La geometrie est subdivisee et indexee dans PostGIS.
`ST_Covers` inclut la limite du referentiel. Une coordonnee deplacee est evaluee
immediatement ; aucune classification territoriale obsolete n'est reutilisee.

La comparaison avec ADMIN EXPRESS IGN a montre que le contour terrestre seul
omet des reperes de plages situes sur l'estran. Les espaces maritimes SHOM
consultes ne comprennent pas les eaux interieures, donc ne suffisent pas seuls.
Le contour OSM est un referentiel de catalogue, pas une delimitation juridique,
une preuve d'existence de plage ou une autorisation de baignade. Les erreurs de
position restent possibles et doivent etre corrigees sur preuve.

Attribution : OpenStreetMap contributors. La geometrie derivee dans la migration
reste sous [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), independamment
de la licence du code. Source et empreinte SHA-256 de la reponse d'origine sont
conservees dans `catalogue_territory_sources`. Aucun appel externe au demarrage,
en migration ou dans une recherche publique.

## Acces et conservation

- Listes, pagination, commune et recommandations lisent la meme vue filtree.
- Detail et equipements d'un identifiant exclu repondent 404 avant tout fournisseur.
- Signalements et echantillons sanitaires exclus ne sont pas exposes ; aucune
  nouvelle contribution publique ne peut viser ces identifiants.
- Les imports opt-in rejettent les coordonnees hors perimetre avant insertion.
  Les anciennes identites OSM sont conservees, sans ecrasement ni reimport force.
- `beach_territory_review` permet a l'exploitation de consulter toutes les lignes,
  leur inclusion et le referentiel. `beach_catalogue_unfiltered` conserve la lecture
  complete pour l'exploitation, sans route HTTP publique.

Les 630 lignes du catalogue controle sont conservees. Le referentiel en rend
562 publiques et en exclut 68 ; ce chiffre n'est pas une promesse d'exhaustivite.
Les exports de controle et sauvegardes restent dans `.local/`, jamais dans Git.

## Reproduction et evolution

La reponse Nominatim originale utilise les parametres `country=France`,
`countrycodes=fr`, `featureType=country`, `polygon_geojson=1`, `format=jsonv2`.
Le generateur refuse une autre relation, une composante traversant l'enveloppe,
des coordonnees invalides et l'ecrasement d'un fichier existant :

```sh
node apps/api/scripts/prepare-territory.cjs .local/territory/osm-france.json /tmp/territory-reproduced.sql
cmp /tmp/territory-reproduced.sql apps/api/migrations/0006_metropolitan_territory.sql
```

Une mise a jour de source exige un nouveau millesime, une nouvelle migration et
la comparaison des exclusions sur une copie restauree. Ne jamais regenerer une
migration deja appliquee avec une reponse recente de Nominatim. Le generateur
et son gabarit decrivent exclusivement cet instantane du 17 novembre 2026.
Avant bascule, verifier les empreintes des tables historiques et preparer une
image de retour arriere compatible avec le manifeste complet de migrations.
