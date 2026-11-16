# Ressources visuelles Littora

## Illustration

`images/lagune.jpg` : illustration littorale originale du projet Littora,
soumise a la licence du projet. Crique fictive, sans attribution geographique.

## Geometries

`data/europe.geojson` et `data/coasts.geojson` : extraits et transformations de
Natural Earth, domaine public. Preparation : `scripts/prepare-map-data.mjs`.

- https://www.naturalearthdata.com/about/terms-of-use/
- https://github.com/nvkelso/natural-earth-vector/tree/master/geojson

Les limites utilisees pour regrouper les cotes sont des zones d'exploration
Littora, non des limites administratives. Les geometries sont generalisees.

## Cartes externes

Les fiches utilisent les tuiles OpenStreetMap. L'attribution reste visible.
Le navigateur respecte leur cache HTTP ; aucun telechargement de zone hors
ligne n'est implemente. Une offre de tuiles adaptee au trafic est a choisir
avant un deploiement public.

- https://www.openstreetmap.org/copyright
- https://operations.osmfoundation.org/policies/tiles/

## Bibliotheques et polices

Les textes des licences distribuees sont conserves dans `licenses/`.

- Three.js : MIT, https://github.com/mrdoob/three.js
- Motion : MIT, https://github.com/motiondivision/motion
- Lucide Angular : ISC, https://lucide.dev/license
- Leaflet : BSD-2-Clause, https://leafletjs.com/
- Plus Jakarta Sans Variable et DM Sans Variable : SIL OFL 1.1,
  auto-hebergees via Fontsource. https://fontsource.org/

Les exemples et ressources premium de Motion ne sont pas utilises. Aucun
modele Kenney, Poly Haven ou ambientCG n'est distribue dans cette version.
La licence privative du projet ne remplace pas les droits des ressources tierces.
