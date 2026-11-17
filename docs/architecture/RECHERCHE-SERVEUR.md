# Recherche serveur

Decision SEARCH-01 (#19), contrat HTTP 0.7.0.

## Parcours

`POST /api/search/beaches` devient le point d'entree de la page recherche.
Le corps contient les criteres, jamais les coordonnees dans une URL partageable.
La reponse est `Cache-Control: no-store`.

1. Validation stricte du contrat : types, bornes, min/max, perimetres incompatibles.
2. Lecture de `beach_catalogue`, deja limite a la France metropolitaine.
3. Filtrage SQL : rectangle de facade, contour communal exact ou rayon explicite,
   texte, milieu et equipements effectivement references.
4. Lecture groupee des conditions datees dans Redis et des contributions verifiees.
5. Filtrage des temperatures, du score choisi et du consensus communautaire.
6. Classement par nom, distance ou score, puis UUID pour departager les egalites.
7. Pagination de 1 a 200 elements avec total exact et curseur lie aux criteres.

Aucune limite de 30, 180 ou 500 candidats n'est appliquee avant les filtres.
La recherche ne declenche ni import OSM ni requete meteo par plage.
Le contour communal vient de `PlacesService.get`, sans passer par la decouverte.
La proximite du site utilise un rayon annonce de 50 km ; l'API accepte jusqu'a
200 km. Sans origine geographique, le site utilise le tri par nom a la place
d'une distance inventee. Les autres tris conservent le perimetre choisi.

## Conditions et inconnues

Le calcul existant d'une fiche publie un instantane `search:conditions:v1:<uuid>`
dans Redis, avec position, milieu, scores, temperatures et provenance datee.
Une mesure est eligible si son fournisseur indique une prevision disponible ou
partielle, collectee il y a moins de 15 minutes, valide a moins d'une heure du
moment de recherche. Un deplacement de plage ou un changement de milieu invalide
l'instantane. Les donnees anciennes, absentes, non datees ou futures ne sont
pas converties en zero. Les bornes numeriques sont inclusives.

Les inconnues restent dans une recherche sans filtre numerique et sont classees
apres les scores connus. Un filtre numerique exige une valeur recente connue.
`coverage` indique la disponibilite sur les candidats geographiques et statiques,
avant application des filtres dynamiques. Le site affiche cette couverture pour
le filtre de temperature de l'eau.

Le filtre drapeau porte uniquement sur le consensus communautaire de #22.
Un score favorable n'est jamais transforme en drapeau vert. Un signalement isole,
un desaccord, une contribution en attente ou une donnee de demonstration ne
constitue pas un consensus. `flagSource=community` et `recentRedAt` sont conserves.
Les consignes officielles restent une source distincte, non branchee (#49).

## Pagination et interface

Une recherche de plusieurs pages conserve son resultat ordonne dans Redis pendant
120 secondes. Les pages partagent `asOf`, `expiresAt`, le total et les memes
valeurs, meme si une metrique ou un signalement change entre deux requetes.
Un nouveau filtre relance une recherche ; un curseur expire produit un 409.
Un curseur reutilise avec d'autres criteres produit un 400. Si Redis ne peut pas
conserver plusieurs pages, l'API renvoie 503 plutot qu'une liste incomplete.

Le client charge les pages de ce meme resultat pour alimenter ensemble la carte,
le compteur et la liste existants. Le bouton « Voir plus » reste une fenetre de
20 elements de ce resultat complet, sans nouveau filtrage ou classement local.
Un total incoherent, un doublon ou un echec de page ne publie pas de liste partielle.
Les requetes precedentes sont annulees lors d'un changement de criteres ; les
retours de fiche et l'etat prive de proximite de #20 sont conserves.

## Verification et limites

- Requetes parametrees ; index GiST `beaches_geom_idx` reutilise pour rectangle
  et rayon. Les anciennes lignes sans `geom` utilisent leurs coordonnees.
- Test d'integration avec 604 lignes dont une hors France : resultat pertinent
  apres la 600e entree, filtre communal non rectangulaire, trois milieux,
  equipements, zero, valeurs absentes, consensus et pagination sans doublon.
- `EXPLAIN ANALYZE` mesure le chemin de recherche ; test de disponibilite de
  l'index spatial. Verification des lignes historiques avant/apres.
- Aucun changement de schema, aucune migration, aucun ajout au catalogue local.

La collecte planifiee des conditions de toutes les plages appartient a #15 :
avant sa livraison, les conditions de recherche correspondent aux fiches deja
consultees, pas a une couverture meteo complete du territoire. Le classement en
memoire porte sur tous les candidats qualifies ; pour un catalogue national
beaucoup plus volumineux, l'ingestion persistante et les couches paginees de #24
devront permettre de pousser ces jointures et le classement dans PostgreSQL.
L'ancien endpoint `/recommendations` reste deprecie pour compatibilite ; la page
recherche ne l'appelle plus. Aucune capacite de production complete n'est annoncee.
