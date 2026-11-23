# V1 : choisir un lieu de baignade en France métropolitaine

**Décision de cadrage (#3).** La consultation doit être gratuite, sans compte,
en France métropolitaine entière, Corse et îles comprises. Le public prioritaire
est la personne qui prépare une sortie à la plage, seule ou en famille. Le second
usage est la comparaison de conditions pour un loisir nautique. La V1 n'est ni
un service de secours ni un outil de navigation. Un site référencé n'est pas une
baignade autorisée ; un score élevé n'est pas un drapeau vert.

Cette matrice définit ce qui sera testé, pas ce qui fonctionne déjà. Le produit
arbitre le périmètre, le responsable indiqué apporte la preuve, et la recette
[#32](https://github.com/ActuatorIO-Foundry/littora/issues/32) décide du passage
en V1. La préversion (#43) peut consigner un seuil manqué, jamais le masquer.

| Parcours | Décision V1 et preuve attendue | Après V1 ou indisponible | Responsable / ticket |
|---|---|---|---|
| Recherche et carte | Commune, façade, proximité facultative, filtres et détail utilisables sans compte. Résultats identiques d'une page à la suivante pour le même instantané. | Pas de promesse de recenser toutes les plages d'une commune ; aucune extension du catalogue par ce lot. | Catalogue / #13, carte / #24, QA / #19 |
| Mer, lac, rivière | Milieu justifié, sinon « inconnu ». Les sites d'eau douce restent recherchables ; parcours distincts à livrer. Aucun courant ou température de modèle **marin** pour un lac ou une rivière. | Mesures d'eau douce sans source locale valide : inconnues. Pas de déduction à partir du nom du site. | Données / #13, produit / #35 |
| Air et mer | Prévisions horaires attribuées ; distinguer collecte, validité et cadence du modèle. En panne : périmé ou indisponible, jamais simulé. | Pas de « temps réel » garanti. Choix manuel seulement si plusieurs produits compatibles sont réellement connectés ; moyenne intermodèles différée. | Intégrations / #15, #25 |
| Famille, baignade, paddle, bateau | Score expliqué par usage **ou** données insuffisantes. [Références SHOM](architecture/SHOM.md) au port identifié : hauteurs astronomiques et classe de courant de vive-eau, distinctes des conditions actuelles. | Horaires consultables chez le producteur ; pas de SUP/SAPM, rediffusion REFMAR, routage ou aide à la navigation. Les références du port ne déterminent pas le score de la plage. | Données / #17, #21 |
| Vigilance et qualité de l'eau | [Vigilance vagues-submersion Météo-France](architecture/METEOFRANCE.md) sur les littoraux métropolitains : uniquement sur créneau officiel actif, avec accès abonné vérifié ; sinon indisponible. [Prélèvements historiques](architecture/QUALITE-BAIGNADE.md) sans bonus sanitaire ; rapportage annuel Santé/ARS distinct des décisions municipales vérifiées, sans couverture temps réel garantie. | BMS et modèles directs AROME/MFWAM différés ; prévisions Open-Meteo attribuées à l'intermédiaire. Prédictions de pollution et historiques Eaufrance différés. Une absence d'alerte collectée n'est pas un avis favorable. | Intégrations / #16, #18 |
| Équipements, drapeaux, observations | Distinguer équipement référencé et service ouvert. Séparer signalement communautaire horodaté, indicateur calculé et autorité locale. Tester conflit, expiration et modération. | Drapeau officiel indisponible sans flux autoritatif ; connexion suivie après V1 (#49). | Communauté / #14, #22, #23, #27, #49 |
| Comptes et accès | Consultation et dépôt sans inscription. Compte membre facultatif dès la V1 : connexion Google, 2FA au choix du membre, gestion des sessions et suppression de compte. Accès humains de modération et d’administration nominatifs avec MFA obligatoire. Voir les critères ci-dessous. | Fournisseurs supplémentaires, favoris synchronisés, points et badges ne sont pas des prérequis V1. | Identité / #26 ; accès privilégiés / #97 ; communauté / #98 |
| Contact | Résultat réel ou erreur explicite, sans imposer de compte. | Pas de commande promettant un envoi fictif. | Contact / #28 |
| Ouverture publique | Recette mobile/desktop, restauration vérifiée, budget et droits validés, blocages de publication levés. | Pas de déploiement public ou d'abonnement fournisseur autorisé par cette décision. | Exploitation / #29, #30, #31 ; qualité / #32, #43 |

## Comptes : critères avant ouverture

**Décision du 23 novembre 2026 (#26).** Cette révision avance les comptes membres en V1.
Il s'agit d'un objectif de livraison, pas de l'annonce d'une connexion déjà disponible.

- **Connexion.** Préférer un service d'identité éprouvé compatible [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
  NestJS termine le flux code avec PKCE, vérifie le retour et ouvre une session Littora révocable par cookie sécurisé, inaccessible au JavaScript.
  Ne pas fusionner deux identités sur la seule égalité d'un e-mail. Une panne d'identité ne bloque pas les plages ni les dépôts sans compte.
- **Deuxième facteur.** Un membre qui l'active ne peut plus accéder à son compte par Google seul. Avant tout accès privilégié humain, exiger une passkey ou une clé de sécurité avec vérification de l'utilisateur.
  Vérifier aussi la voie opérateur privée et le retrait des droits. Tester perte de clé, récupération sans contournement, notification et révocation des sessions. Ne pas confondre ces comptes avec les identifiants des tâches automatiques.
- **Données.** Ne demander que les attributs nécessaires. Ne pas relier les dépôts historiques sans compte à une identité.
  Recommandation initiale : identité gérée séparément, identifiant applicatif opaque et rôles PostgreSQL distincts ; l'accès du catalogue ne doit pas pouvoir lire les identités ou les favoris privés.
  Deux bases sur le même serveur ne protègent pas d'un administrateur de serveur compromis. Séparer les instances si une frontière d'administration ou de restauration indépendante est nécessaire.
- **Recette.** Vérifier avec deux membres, un modérateur, un administrateur et un visiteur : confidentialité entre comptes, refus d'élévation de droits, déconnexion/révocation, récupération et suppression. Aucun jeton ni code de secours dans les journaux.
  Documenter les durées de conservation, le devenir des sauvegardes, la réponse aux incidents et le coût du fournisseur (#30, #31). Pas de déploiement public ni de souscription autorisés par ce cadrage.

Les [points et badges](https://github.com/ActuatorIO-Foundry/littora/issues/98) restent distincts du hub modéré : ils ne doivent donner ni droits, ni poids supplémentaire à un signalement, ni valeur officielle à une observation.

## Couverture minimale pour la recette

Mesurer **les sites publics consultables**, non les lignes historiques, les
mailles fournisseur, ou le nombre total supposé de plages françaises. Les emprises
des six façades de la carte servent à tester la présence (elles peuvent se
chevaucher) ; elles ne définissent pas la frontière nationale. Celle-ci relève du
[référentiel géographique](architecture/PERIMETRE-FRANCE.md).

| Contrôle à un instant donné | Seuil de recette |
|---|---|
| Territoire et milieux | Au moins un site mer dans chacune des six façades, un site lac et un site rivière en métropole ; ≥ 90 % des sites publics classés mer/lac/rivière. |
| Température de l'air | Valeur fraîche et attribuée pour ≥ 90 % de **tous** les sites publics, inconnus inclus. |
| Température de l'eau en mer | Valeur fraîche et attribuée pour ≥ 80 % des sites **classés mer**. L'eau douce n'entre pas dans ce dénominateur. |
| Séparation des milieux | Zéro projection marine sur les milieux lac, rivière ou inconnu. Une température nulle au sens « manquante » ne compte pas ; 0 °C est une valeur. |

Après remplissage initial du worker, depuis la racine avec le Node du projet :

```sh
npm run check:v1-coverage -- http://127.0.0.1:4200
```

Le contrôle utilise la recherche publique, sans fiche, import ni clé fournisseur.
Sortie agrégée : horodatage de l'instantané, dénominateurs, numérateurs et résultat
par critère. Code 0 : couverture atteinte ; 2 : mesurée mais insuffisante ;
1 : mesure impossible (ex. curseur expiré). Une prévision utilisable est
disponible ou partielle, collectée depuis moins de six heures, avec une échéance
à moins d'une heure de l'instantané. Aucune mesure sanitaire ou de drapeau n'est
déduite de ce contrôle. Pour #32, consigner deux mesures espacées d'au moins un
cycle de collecte et un essai en panne fournisseur. Un instantané vert n'autorise
pas à lui seul la publication.

## Sources et enveloppe de fonctionnement

| Source / couverture | Droit, limite ou coût à prendre en compte | Décision |
|---|---|---|
| Open-Meteo Forecast et Marine | [Accès non commercial, données CC BY 4.0](https://open-meteo.com/en/terms) ; [plafonds](https://open-meteo.com/en/pricing) : 600/min, 5 000/h, 10 000/j, 300 000/mois. | Prévisions, pas observations. Collecte mutualisée ; compter les unités du fournisseur, pas les pages vues. |
| Catalogue, POI, fond OSM | Attribution des contributeurs, ODbL pour les données. [Tuiles](https://operations.osmfoundation.org/policies/tiles/) sans SLA ni téléchargement massif. [Overpass public](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) : capacité partagée, pas une garantie de service. [Nominatim public](https://operations.osmfoundation.org/policies/nominatim/) interdit la collecte systématique. | Catalogue local prioritaire. Ne pas utiliser les serveurs publics comme infrastructure garantie à grande échelle. |
| Communes, milieux et trait de côte | [API Géo](https://www.data.gouv.fr/dataservices/api-decoupage-administratif-api-geo) : accès ouvert, 50 appels/s/IP ; vérifier les droits de chaque jeu. IGN pour la [classification](architecture/CLASSIFICATION-EAU.md) ; [limite terre-mer Shom/IGN](https://diffusion.shom.fr/limite-terre-mer.html), Licence Ouverte 2.0. | Cache communal, preuve de classification conservée ; la licence du trait de côte n'accorde pas l'accès aux marées. |
| Météo-France, SHOM marées, [baignades Santé](https://baignades.sante.gouv.fr/baignades/), [Eaufrance](https://www.eaufrance.fr/) | Droits, quota, coût, couverture et cadence à vérifier **par produit** ; aucune enveloppe payante réservée. | #16/#17/#18 : réponse officielle, site/port, date et unité vérifiés avant toute annonce de connexion. |

**Budget de préversion : 0 € de nouvel abonnement fournisseur.** Avec 509 zones
air et 454 mer observées lors de l'activation de #15, quatre cycles par jour
représentent 3 852 requêtes nominales hors reprises, pas une facture ni un quota
garanti. La [collecte](architecture/COLLECTE-METEO.md) limite les appels et
respecte les pauses fournisseur. En cas de dépassement : dégrader la couverture
et le signaler ; ne pas accélérer ni souscrire automatiquement. Hébergement,
trafic, sauvegardes, courriel et droits de diffusion restent à chiffrer et
approuver dans #31 **avant** ouverture ; aucun budget de production n'est engagé.

**Accès au service et droits sur le code sont distincts.** La consultation
publique visée est gratuite. Le code reste sous [licence propriétaire](../LICENSE).
Cette décision ne relicencie ni les sources de données ni le code et ne remplace
pas la validation des mentions légales, des attributions et de la confidentialité.
