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

## Reperes et equipements

Sur la carte de recherche, un nombre regroupe les plages proches parmi les
resultats charges. Un clic ou la touche Entree ouvre le groupe ; les reperes
superposes peuvent etre ecartes sans changer leurs coordonnees en base.
Choisir une plage ouvre son apercu dans la liste, pas sa fiche detaillee.
Le regroupement utilise [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster/tree/v1.5.3).

Sur une fiche, la plage reste un repere distinct. Le filtre de la carte permet
de masquer chaque categorie d'equipement referencee ; son compteur porte sur
les points retournes pour cette fiche, pas sur tous les equipements de la
commune. Le clic sur un point affiche son nom, sa categorie et sa source.
Deux parkings homonymes restent deux objets distincts. Les couches ne
modifient ni la liste accessible « Acces & equipements », ni les filtres de
recherche, ni le catalogue. La liste indique la date du releve et si celui-ci
est ancien ; le referencement ne garantit pas l'ouverture ou la surveillance.

## Recherche geographique

La recherche de commune (#34) utilise l'API Geo du service public, ses codes
INSEE et ses contours administratifs. Les homonymes sont proposes avec leur
departement. La carte affiche le vrai polygone et ajuste sa vue. Le code INSEE
est conserve dans l'URL (`/recherche?commune=83009`).

- `GET /api/places/communes?q=Bandol` : suggestions, cache 24 heures.
- `GET /api/places/communes/83009/beaches` : contour officiel (cache 7 jours) et toutes les fiches locales retenues par `ST_Covers`, limites incluses. La couverture est partielle : une absence ne signifie pas que la commune ne compte aucune plage.
- `GET /api/beaches/discover?bbox=...` : compatibilite en lecture seule. Suivre `nextCursor` dans le parametre `after` jusqu'a `null`. Aucun filtre ni affichage public ne lance un import.
- La [classification des milieux](architecture/CLASSIFICATION-EAU.md) est independante de cette collecte. Une plage dans OSM n'est pas une autorisation de baignade.

## Collecte privee par commune

Depuis la racine, avec les dependances installees et l'API compilee (`npm run build:api`), Node 24. Un repertoire par campagne, un fichier local par code INSEE ; ne pas le partager ni le versionner. Exemple pour Bandol :

```sh
node apps/api/scripts/catalogue-zone.cjs collect .local/zones/campagne-1 83009
node apps/api/scripts/catalogue-zone.cjs status .local/zones/campagne-1 83009
node apps/api/scripts/catalogue-zone.cjs review .local/zones/campagne-1 83009
```

`collect` fige le contour et la date OSM, interroge les mailles successivement et s'arrete a la premiere erreur. Relancer la meme commande reprend les mailles inachevees. Une reponse sans decompte final valide, trop volumineuse ou en erreur ne valide jamais une maille. `status` donne la date, le nombre de mailles validees/attendues, les erreurs, candidats et exclusions. `complete: true` signifie uniquement que toutes les mailles OSM de cet instantane ont ete validees, pas que toutes les plages reelles sont recensees ni que des fiches ont ete publiees. Pour une autre date, utiliser un nouveau repertoire.

Source : (c) contributeurs OpenStreetMap, [ODbL](https://www.openstreetmap.org/copyright). Les objets nommes `natural=beach` sont representes par un point (centre d'emprise pour les chemins et relations), pas le contour de la plage. Un centre peut se trouver hors du rivage : il n'est pas deplace pour forcer un rapprochement. Exclure les acces restreints, equipements seuls et objets mal localises. Respecter les [limites du service public](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) ; pour la production, provisionner un service historique dedie via `OVERPASS_API_URL`. Aucune collecte automatique nationale.

Pour une zone complete, configurer `DATABASE_URL` vers une **copie restauree et migree** et examiner la simulation :

```sh
node apps/api/scripts/catalogue-zone.cjs preview .local/zones/campagne-1 83009
```

`preview` ne modifie ni la base ni le journal. Les limites de la commune et du territoire sont verifiees dans PostGIS. Une identite OSM connue est conservee ; un changement de position de plus de 5 m ou de nom passe en revue. Deux identites a moins de 25 m (250 m si meme nom) restent en revue, sans fusion automatique. Les objets exclus et les conflits ne sont pas publies. Aucune mise a jour ni suppression d'une fiche existante.

Seulement apres verification de la cible, sauvegarde et decision explicite d'enrichir le catalogue, remplacer `preview` par `apply`. Les decisions sont recalculees dans une transaction ; `status` et `review` exposent ensuite les resultats et identifiants a revoir. Apres une interruption entre la validation PostgreSQL et la sauvegarde locale du bilan, relancer `apply` : les insertions deja validees seront reconnues comme existantes.
