# Equipements references

Le lot #14 supprime les points geolocalises inventes et les positions deduites
des anciens booleens. Les tables historiques de plages et de signalements ne
sont pas modifiees. Le catalogue de plages reste ferme aux imports implicites.

## Donnees et presence

Les objets OpenStreetMap sont identifies par `node/ID`, `way/ID` ou `relation/ID`.
Deux parkings de meme nom restent distincts. La categorie vient des attributs
structures, jamais du nom : un magasin de sport ou une zone de surf ne devient
pas une location de materiel. Les acces prives/interdits et objets desaffectes
explicitement marques sont exclus.

La migration 0004 ajoute les collections et leurs points, puis une vue partagee
par les listes, les fiches et les filtres. Les distances finales sont calculees
par PostGIS sur l'ellipsoide. Les points au-dela de 2 500 metres du repere de la
plage sont exclus. Pour une emprise OSM, le repere est son centre, pas une entree
ni un itineraire pieton. La liste renvoie tous les points retenus et leur total.

Une collection vide ou une panne signifie inconnu, pas absence. Les anciens
booleens du catalogue ne sont pas des preuves. `has_lifeguard` reste inconnu :
un poste reference dans `facilities.rescueStation` ne confirme pas une surveillance
en service. Parking et toilettes sont des equipements proches, pas necessairement
sur la plage ; ouverture, accessibilite et places disponibles ne sont pas deduites.

## Collecte et limites

Source par defaut : `https://overpass-api.de/api/interpreter`, configurable par
`OVERPASS_API_URL`. L'ancienne instance `overpass.osm.ch` est reservee a la Suisse
et refusee pour ce traitement. Aucun secours Nominatim pour enumerer les POI :
sa [politique d'usage](https://operations.osmfoundation.org/policies/nominatim/)
interdit ces recherches systematiques. Attribution : contributeurs OpenStreetMap,
donnees sous ODbL, couverture collaborative non exhaustive.

Une collecte par plage est mutualisee dans le processus. Les appels sont
sequentiels, au moins deux secondes entre departs, quatre demandes en attente
maximum, delai de vingt secondes, reponse de huit Mio maximum. Une reponse
partielle signalee par Overpass ou depassant 5 000 objets est rejetee, pas tronquee.
Le traitement asynchrone et les quotas partages entre processus restent dans #15.

La collection valide est reutilisee six heures. Apres echec, elle reste attribuee
a sa date initiale pendant sept jours au maximum, avec statut ancien. Une pause
de quinze minutes evite les repetitions en cas de panne. Une reponse malformee
ne remplace pas les points existants. Les dates d'edition OSM et de collecte sont
separees. Aucun extrait brut ni identifiant d'editeur OSM n'est persiste.

## Exploitation

Avant la migration : sauvegarde et restauration isolee. Le remplacement d'une
collection est transactionnel et refuse une plage dont la position a change.
L'ancienne image necessite le manifeste de migrations incluant 0004 pour un
retour arriere compatible ; ne pas effacer l'historique des migrations.

Les journaux d'execution, rapports de recette, extraits et sauvegardes restent
dans `.local/` ou un repertoire temporaire hors Git. Seules les syntheses de
diagnostic nettoyees sont publiees dans les issues. La CI refuse un journal,
une sauvegarde de base ou une trace de navigateur suivi par Git.
