# Cartographie

## Fond et littoral

Le fond detaille utilise OpenStreetMap avec les noms, routes et lieux disponibles
au niveau de zoom courant. Le trait colore provient du service WMS officiel
Shom-IGN, couche `LIMTM_3857_WMSV`. Aucun segment n'est recalcule a partir du fond
Natural Earth et aucune ligne droite ne relie artificiellement deux fragments.
La facade selectionnee colore la meme couche dans son emprise geographique,
sans afficher de rectangle. Ces facades restent des zones de navigation du
catalogue, pas des limites administratives.

La limite terre-mer est la limite haute du rivage, pas le bord instantane de
l'eau ni le contour de chaque plage. Elle inclut les ouvrages et estuaires.
Attribution : (c) Shom-IGN, 2021, https://dx.doi.org/10.17183/LIMTM.
[Licence Ouverte 2.0 et descriptif](https://diffusion.shom.fr/limite-terre-mer.html).

La configuration des services est dans `apps/web/public/data/map-config.json`.
Les tuiles sont chargees selon la vue courante, sans prechargement massif ni
contournement du cache HTTP. Respecter la [politique OSM](https://operations.osmfoundation.org/policies/tiles/)
et prevoir un fournisseur de tuiles dimensionne au trafic avant lancement public.
Aucune promesse de disponibilite de ces services publics.

Natural Earth reste un fond local simplifie de secours. Une indisponibilite
du fond ou du trait officiel est affichee ; aucun trait fictif ne le remplace.
Les attributions restent visibles. La CI utilise des images de test locales,
sans solliciter OSM/Shom. La recette visuelle controle aussi les vraies tuiles.

## Recherche geographique

La recherche de commune (#34) utilise l'API Geo du service public, ses codes
INSEE et ses contours administratifs. Les homonymes sont proposes avec leur
departement. La carte affiche le vrai polygone et ajuste sa vue. Le code INSEE
est conserve dans l'URL (`/recherche?commune=83009`).

- `GET /api/places/communes?q=Bandol` : suggestions, cache 24 heures.
- `GET /api/places/communes/83009/beaches` : contour (cache 7 jours), catalogue
  local et enrichissement ponctuel OpenStreetMap (cache 24 heures).
- `ST_Covers` selectionne les points dans le polygone reel, pas seulement dans
  son rectangle englobant. Les points sur la limite sont inclus.
- Les sites nouveaux conservent leur identifiant OSM. Les equipements non
  renseignes sont `null`, sans modifier ceux des fiches existantes.

La recherche OSM est bornee a une commune et 40 resultats. Elle n'est ni un
recensement exhaustif ni un service d'autocompletion. La reponse expose
`coverage: partial`, `capped`, `source` et `collectedAt`. Une panne de collecte
conserve les resultats locaux avec avertissement. L'absence de contour valide
empeche la selection communale au lieu d'inventer une emprise.

Nominatim utilise `NOMINATIM_API_URL` et une file commune a tous ses appels dans
le processus API : requetes serialisees, intervalle minimum 1,1 seconde,
4 requetes en attente maximum, delai reseau 10 secondes. Respecter sa
[politique d'utilisation](https://operations.osmfoundation.org/policies/nominatim/).
Avant de multiplier les instances ou d'importer toute la France, utiliser un
fournisseur adapte ou un import OSM dedie avec les jobs centralises (#13/#15).
Ce connecteur ponctuel ne remplace pas ce chantier de catalogue.

La classification historique mer/lac/riviere reste a remplacer par les donnees
source (#13). Les sections separees et les indicateurs propres a l'eau douce
sont suivis dans #35. Aucun classement sanitaire ne decoule de la presence
d'un lieu dans OpenStreetMap.
