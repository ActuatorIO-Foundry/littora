# Vigilance vagues-submersion

**Produit V1 :** carte nationale de Vigilance Météo-France, phénomène 9, sur les
25 littoraux départementaux métropolitains, Corse comprise. Ce niveau n'est ni
un drapeau de baignade, ni un score, ni un bulletin de navigation.

## Accès et fonctionnement

- [API Bulletin Vigilance](https://www.data.gouv.fr/dataservices/api-bulletin-vigilance) :
  compte et souscription au produit sur le portail Météo-France ; quota annoncé
  de 60 appels/minute. Configurer la clé applicative dans `METEOFRANCE_API_KEY`
  côté serveur (API et worker), jamais dans Angular. Une clé ne prouve pas le droit au produit.
- Le worker interroge `GET https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours`
  avec l'en-tête `apikey`, sans redirection. Un appel national toutes les cinq
  minutes (288/jour au plus en régime nominal), pas un appel par visiteur. Ce
  délai de vérification n'est pas la cadence de production du bulletin.
- La réponse conserve la production et la collecte UTC. Le [format du producteur](https://donneespubliques.meteofrance.fr/client/document/descriptiftechnique_vigilancemetropole_donneespubliques_v4_20230911_307.pdf)
  distingue les créneaux du maximum quotidien. Seul un créneau unique en cours
  est présenté ; 1 = vert explicite, 2 = jaune, 3 = orange, 4 = rouge. La fin
  est exclusive. Ne pas déduire le vert d'une liste absente.
- Redis partage le dernier état national, pendant dix minutes au maximum :
  il ne constitue pas un historique. La validité du créneau peut être plus
  courte. Pas de cache HTTP public. Clé manquante/refusée, produit invalide,
  panne, quota ou donnée périmée : état inconnu, sans repli sur des archives
  ou une prévision. Une limitation 429 respecte Retry-After (5 min à 24 h).
- `GET /api/alerts?department=06` cible le littoral du département ;
  `GET /api/alerts?beachId=<uuid>` résout les coordonnées du catalogue public.
  Le rattachement exige un site classé mer et un seul département couvert
  par les contours terrestres ou maritimes. Aucun rattachement par libellé,
  proximité arbitraire ou score. Lac, rivière, site non classé, lacune ou
  chevauchement entre départements : pas de vigilance marine attribuée.
- Le [bulletin officiel consultable](https://vigilance.meteofrance.fr/fr/vagues-submersion)
  reste accessible même en cas de panne. Les modèles AROME/MFWAM en direct
  et les bulletins météo spéciaux (BMS) ne sont **pas** intégrés : leurs accès,
  formats et zones de validité devront être qualifiés séparément. La météo et la
  mer du collecteur existant restent attribuées à Open-Meteo.

## Données de référence et recette

- Météo-France, [archive publique et licence ouverte 2.0](https://www.data.gouv.fr/datasets/vigilance-meteorologique-archivee).
  [Carte horodatée du 18 novembre 2026](https://files.data.gouv.fr/meteofrance/data/vigilance/metropole/2026/11/18/050019/CDP_CARTE_EXTERNE.json) :
  SHA-256 `c42ac38cca8184b8e13adcbfc4ac6e2c59aefa3ad65515022902c0925ffc9bab`.
  La fixture de contrat conserve les identifiants et créneaux de trois littoraux
  (06, 29, 40) pour J. Les Landes passent du vert au jaune à 19 h UTC.
- Géométries dérivées des [domaines VVS départementaux de Météo-France](https://static.data.gouv.fr/resources/vigilance-meteorologique-archivee/20260402-152745/donnees-expertisees-vvs-departementales-20250625.geojson)
  et des [contours administratifs Etalab/IGN, millésime 2025, 100 m](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/departements-100m.geojson)
  ([notice des contours](https://github.com/etalab/contours-administratifs)).
  Référentiels sous Licence Ouverte, distincts de la licence du code.
  Reconstruction hors ligne : `node apps/api/scripts/build-vigilance-domains.cjs <domaines-vvs.geojson> <departements.geojson>`.
  Les empreintes sont vérifiées ; coordonnées et anneaux conservés sans interpolation.
- Recette authentifiée : renseigner la clé abonnée dans l'environnement de
  recette, redémarrer les services concernés et attendre une collecte.
  Vérifier `status`, `department`, `issuedAt`, `validFrom`, `validUntil`
  et la couleur face au bulletin officiel. Ne consigner que les identifiants
  publics, le résultat et les heures, jamais la clé ni les en-têtes.
  Le test sur archive ne remplace pas cette recette.
