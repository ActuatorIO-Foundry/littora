# Registre de diffusion pré-V1

Revue du 27 novembre 2026, France métropolitaine. Distinguer le droit sur les
données, les règles du serveur qui les distribue et le budget de Littora. Un
quota non publié n’est pas illimité. Aucun engagement payant n’est pris. Les
crédits destinés aux visiteurs sont accessibles sur `/sources`.

| Produit et emploi dans Littora | Attribution et droits à conserver | Accès, plafond et coût du pilote |
|---|---|---|
| Prévisions horaires : Open-Meteo Forecast / Marine | [Open-Meteo, CC BY 4.0](https://open-meteo.com/en/terms), crédit et lien près des données ; valeurs normalisées et indices distingués des modèles. | [Offre gratuite non commerciale](https://open-meteo.com/en/pricing) : 600 unités/min, 5 000/h, 10 000/j, 300 000/mois. Tenir compte des unités pondérées. Pas de SLA gratuit. Vérifier la qualification du projet lors de tout changement de financement ou d’usage. |
| OSM : catalogue, équipements, extraits régionaux | © contributeurs [OpenStreetMap, ODbL](https://www.openstreetmap.org/copyright). Conserver les identifiants et la provenance. Évaluer les obligations de partage à l’identique de la base dérivée, indépendamment de la licence du code. | [Geofabrik](https://download.geofabrik.de/) / [OSM France](https://download.openstreetmap.fr/extracts/europe/france/) : extraits, pas de souscription pilote. Les plafonds de téléchargement du [collecteur](EQUIPEMENTS.md) ne sont pas des quotas garantis. [Overpass public](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) partagé, pas de collecte nationale visiteur par visiteur. Pas d’énumération par Nominatim. |
| Tuiles OSM et fond local Natural Earth | Attribution OSM visible sur la carte ; [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) : domaine public, crédit conservé. | [Politique des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/) : cache HTTP, référent du site, pas de préchargement massif ni SLA. Aucun nouvel abonnement ; hébergement alternatif à chiffrer si la charge dépasse le service partagé. Le fond local ne consomme pas d’appel. |
| Communes et contours administratifs | [API Géo, DINUM et sources de chaque référentiel](https://www.data.gouv.fr/dataservices/api-decoupage-administratif-api-geo). Pour les limites embarquées, conserver [le millésime et les attributions](METEOFRANCE.md#données-de-référence-et-recette). | API ouverte, recherche et contour de commune mis en cache ; pas d’abonnement ni de capacité réservée. |
| Classification du milieu et côtes | [IGN BD TOPO, LO 2.0](https://www.data.gouv.fr/datasets/bd-topo-r) ; [trait de côte Shom-IGN 2021, LO 2.0](https://diffusion.shom.fr/limite-terre-mer.html). La classe d’un site est un calcul Littora. | [WFS Géoplateforme : 30 req/s/IP](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/). Le WMS du Shom est un autre service : aucun quota transféré ni SLA supposé. Pas de redevance sur ces jeux ouverts. |
| Vigilance vagues-submersion | Météo-France, distinguer bulletin courant de l’[archive ouverte](https://www.data.gouv.fr/datasets/vigilance-meteorologique-archivee). Date d’émission et échéance du créneau. | [DPVigilance](https://www.data.gouv.fr/dataservices/api-bulletin-vigilance) : compte et accès au produit, 60 req/min ; collecte nationale, aucun appel sur visite. Pas d’achat ; accès authentifié à vérifier (#16). Aucun remplacement par une archive. |
| Ports et courants de référence | Shom : [RAM](https://www.data.gouv.fr/datasets/references-altimetriques-maritimes) et [VMAX](https://www.data.gouv.fr/datasets/vitesses-maximales-du-courant-de-maree-de-surface-en-vive-eau-moyenne-manche-atlantique), LO 2.0 ; unités, port et source conservés. | WFS ouvert, cache du [collecteur](SHOM.md), pas de débit réservé. Horaires : renvoi au portail officiel. [Prédictions par abonnement](https://services.data.shom.fr/support/fr/services/spm) non souscrites ; [REFMAR](https://refmar.shom.fr/politique-d-acces-aux-donnees) non rediffusé. |
| Analyses sanitaires annuelles | [Ministère de la Santé / ARS, Licence Ouverte](https://www.data.gouv.fr/datasets/donnees-de-rapportage-de-la-saison-balneaire-1). Afficher saison, date, origine et distinction entre analyse, archive et décision officielle. | Quatre fichiers d’une édition vérifiée, sans appel par visite et sans abonnement. [Procédure](QUALITE-BAIGNADE.md). Pas de mesures Hub’Eau/Eaufrance présentées comme analyses de baignade. |
| Drapeaux, fermetures, accueil des chiens et naturisme | Collectivité ou éditeur nommé et document daté sur les fiches concernées ; pas de licence générique pour recopier leurs contenus. [Landes Attractivité](https://www.plages-landes.info/obtenir-un-widget-pour-votre-site/) autorise son widget gratuit, pas la republication démontrée d’un flux brut. | Liens et références ponctuelles, pas de collecte des pages ni d’achat. [Drapeaux officiels](../DRAPEAUX-OFFICIELS.md) : flux structuré bloqué (#49), inconnu ailleurs sans preuve. Les contributions des visiteurs restent séparées. |

## Décision restant à prendre

Le budget de nouveaux abonnements du pilote est nul, **pas** le coût de
production. Avant ouverture, renseigner un prix, une capacité et un responsable
dans le dossier privé pour l’hébergement, le stockage, le transfert des extraits,
les copies hors machine, le domaine et les notifications. Ajouter le fournisseur
de tuiles ou de météo payant uniquement si un changement explicite est approuvé.
Le projet Google de test est un fournisseur d’identité, pas une source de
données de plage (#106). Sans capacité ou droit confirmé, dégrader le service
concerné et ne pas annoncer sa couverture. Le budget de production, l’identité
de l’éditeur, les mentions légales, les durées de conservation effectivement
appliquées et la validation finale du #31 restent ouverts.
