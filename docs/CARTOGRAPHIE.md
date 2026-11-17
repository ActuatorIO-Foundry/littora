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

Le recentrage sur les contours communaux et l'enrichissement du catalogue local
sont suivis dans #34, distincts du correctif de rendu #24. Le nombre de plages
referencees ne doit jamais etre presente comme un inventaire officiel exhaustif.
