# Marées et courants du Shom en V1

Les hauteurs astronomiques, les horaires prédits, une observation marégraphique
et le courant de surface sont quatre données distinctes. Aucune des références
ci-dessous ne sert au calcul des scores, au drapeau, à la navigation ou à la
déduction du courant actuel. La prévision marine du collecteur météo garde son
attribution Open-Meteo Marine.

| Produit | Donnée et usage retenus |
| --- | --- |
| [Références altimétriques maritimes (RAM)](https://www.data.gouv.fr/datasets/references-altimetriques-maritimes) | Shom, Licence Ouverte 2.0. PHMA et PBMA sont les plus haute et plus basse mers astronomiques du port, en mètres par rapport à son zéro hydrographique. Ce ne sont ni une profondeur ni les extrema du jour. Ne pas soustraire une seconde fois le décalage IGN. |
| [Courants de surface VMAX](https://www.data.gouv.fr/datasets/vitesses-maximales-du-courant-de-maree-de-surface-en-vive-eau-moyenne-manche-atlantique) | Shom, Licence Ouverte 2.0. Attribut cartographique VMAX en nœuds, vive-eau moyenne (coefficient 95), Manche et Atlantique. Pas d'heure, de direction, ni de conversion en courant instantané. Zéro est une classe publiée et non une absence de danger. |
| [Horaires officiels au port](https://diffusion.shom.fr/marees/portail-horaires-des-marees.html) | Lien permanent vers le port sur maree.shom.fr, sans figer une date de consultation. Ni extraction des pages/vignettes ni persistance des horaires. Les [API de prédiction SUP/SAPM](https://services.data.shom.fr/support/fr/services/spm) nécessitent une souscription ; pas de commande, de coût ni de rediffusion dans cette version. |
| [Observations REFMAR](https://refmar.shom.fr/politique-d-acces-aux-donnees) | L'accès gratuit aux mesures ne constitue pas une autorisation de rediffusion à des tiers. Pas de collecte ni de publication de ces observations dans Littora. |

## Couverture et contrat

Huit ports pilotes : Calais, Saint-Malo, Brest, La Rochelle - La Pallice,
Arcachon (Eyrac), Marseille (Corniche), Toulon et Ajaccio. Ce sont des
références de ports, pas des plages ajoutées au catalogue. Une fiche mer
n'affiche un port que dans un rayon de 5 km et sans ambiguïté. Le nom et la
distance restent visibles ; aucune hauteur du port n'est transposée à la plage.
Le paramètre optionnel `harbor` de `GET /api/tides?lat=…&lon=…` ne permet pas
de forcer un port éloigné. Les fiches lac, rivière ou non classées n'interrogent
pas ce service.

`status`, `reliability` et `events` concernent les horaires dans Littora :
inconnus et liste vide, même si une clé SHOM est configurée. `portReference`
donne le lien externe ; `heightReference` et `currentReference` décrivent des
produits indépendants ou valent null. Aucun résultat de remplacement.

## Collecte et contrôles

Le worker interroge le [WFS public](https://services.data.shom.fr/INSPIRE/wfs)
sans clé ni coordonnées utilisateur. Il examine un port par minute en rotation,
vérifie les références une fois par jour en régime normal, au plus deux appels
par port et par passage. Aucun quota ou SLA fournisseur n'est présumé.
L'API lit uniquement Redis. Échéance de publication locale : 7 jours après
lecture, distincte de la date de production du référentiel. Panne, refus,
données ambiguës ou périmées : valeur manquante ; 429/503 : temporisation commune.

- RAM : `RAM_BDD_WLD_WGS84G_WFS:ram_3857`, identifiant, nom et point CRS84 vérifiés.
- VMAX : `COURANTS2D_WFS_VMAX:vmax2d_surf`, intersection du point RAM exact ;
  un seul polygone admis. Aucun déplacement du point vers le large.
- Recette du 18 novembre 2026 : RAM conforme sur les huit ports ; VMAX présent
  à Calais et Saint-Malo, non attribué aux six autres. La fixture de Calais est
  un extrait des réponses Shom RAM/VMAX de 08:56 UTC, sous Licence Ouverte 2.0.
- Les tests couvrent l'ordre des axes, les zéros, un mauvais port, le changement
  de jour, la fin de validité, l'accès refusé et la conservation du catalogue.
