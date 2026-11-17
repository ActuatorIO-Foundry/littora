# Donnees publiques et indisponibilite

Suivi : #11. Correctif de fiabilite anticipe avant le contrat exhaustif #7.
Le format historique reste compatible, avec scores nullables et metadonnees
additives `dataStatus` ; OpenAPI et client genere restent dans #7.

## Politique appliquee

- Aucune temperature, salinite, maree ou probabilite de meduses fabriquee en secours.
- Open-Meteo est identifie comme fournisseur de previsions, pas comme observation.
  Configurer une cle Meteo-France ou SHOM ne signifie pas qu'un adaptateur est connecte.
- Cache reel separe des anciennes estimations : reutilisation 15 minutes.
  Apres panne, conservation du dernier resultat reel moins de 24 heures avec statut
  `stale`, heure de collecte, validite initiale et age. Aucun renouvellement de sa date.
  Apres 24 heures, ou sans resultat reel, statut `unknown` et valeurs nulles.
- Une reponse vide ou malformee ne remplace pas le dernier resultat reel.
- Les valeurs absentes restent nulles ; un zero numerique reel est conserve.
- Un score exige toutes ses entrees meteo/marines et des donnees non perimees.
  Sinon il est null, jamais zero par defaut. Les courbes viennent uniquement du fournisseur.
- Les echantillons `is_demo`, `local-seed`, `demo-seed` ou `raw.demo=true` sont
  exclus avant selection du dernier echantillon sanitaire, sans suppression en base.
- L'accueil ne presente plus de cartes meteo chiffrees de demonstration depuis la
  refonte visuelle. Les fixtures sont reservees aux tests ou a la base `_demo` explicite.

## Compatibilite et limites

Le schema #8 est requis. Aucun import, seed ou changement de volume dans ce lot.
L'interface affiche la provenance et les etats anciens/partiels/indisponibles
dans le detail et l'apercu. L'ancien frontend doit etre mis a jour avant publication
de scores nullables ; il ne doit pas convertir null en zero.

Les autres chantiers sont distincts : normalisation des unites (#12, ci-dessous),
provenance et couverture des equipements
(#14), connecteurs officiels (#16 a #19), drapeaux (#20), ponderation et explication
complete des scores (#21). Ce correctif ne vaut pas validation de securite nautique.

## Normalisation #12

- Courants en m/s, vent et rafales en km/h, temperatures en degres Celsius,
  hauteurs en metres, periodes en secondes, directions en degres.
- Conversion selon `hourly_units`, pas selon une unite supposee. Unite absente ou
  inconnue, valeur non numerique/non finie ou hors bornes physiques larges : null.
  Les bornes sont des controles de coherence, pas des seuils de danger.
- Metadonnees `units` canoniques et `sourceUnits` conservees ; cache v2 distinct
  des anciennes valeurs non normalisees pour eviter une double conversion.
- Requete fournisseur en GMT/Unix, conversion ISO UTC explicite. Localisation
  uniquement a l'affichage. `fetchedAt` est la collecte, `validAt` l'echeance ;
  `producedAt` reste null car cette reponse ne donne pas l'heure du run du modele.
  `generationtime_ms` est un temps de calcul de requete, pas une date de production.
- Meme courant normalise pour l'API, la courbe et le score. Les points manquants
  gardent leur echeance ; la courbe est interrompue, sans zero ni interpolation.
- Tests UTC/Europe-Paris : ete, hiver, changements d'heure et passage de jour.
  Le contrat OpenAPI exhaustif #7 reste a produire, sans nouvelle API parallele.

## Recette

- Panne totale, reponse partielle, reponse malformee, cache ancien et expiration.
- Source effective conservee avec une configuration Meteo-France non connectee.
- SHOM sans adaptateur : aucun evenement de maree, avec ou sans cle configuree.
- PostgreSQL jetable : demonstration ignoree, echantillon reel anterieur retrouve,
  aucun bonus artificiel, aucune ligne supprimee.
- Interface responsive : aucun score /100 ni courbe inventee en cas de panne ;
  ancienne prevision affichee avec son age, zero reel visible.

References fournisseur : [previsions Open-Meteo](https://open-meteo.com/en/docs),
[API marine](https://open-meteo.com/en/docs/marine-weather-api).
