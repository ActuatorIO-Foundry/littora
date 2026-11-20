# Indices de confort par usage (#21)

`confort-3` est un modèle éditorial expérimental de comparaison des **plages de mer**, pas une probabilité, un indice réglementaire, un drapeau ni un outil de navigation. Le barème complet de `confort-2` est conservé. Les coefficients ne sont pas validés cliniquement ou par un organisme de secours. Les [prévisions marines de Météo-France](https://meteofrance.com/meteo-a-z/meteo-france-et-la-mer) motivent la prise en compte du vent et de l'état de mer ; l'[indice UV de l'OMS](https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-%28UV%29-INDEX) motive la prise en compte de l'exposition à partir de 3. Aucune de ces références ne valide les points Littora.

## Règle reproductible

Base 100. Chaque cellule est une déduction par unité canonique, arrondie séparément au point entier le plus proche (demi-point vers le haut). Vagues : hauteur significative prévue, pas hauteur au bord de la plage. Température : distance en degrés à la plage éditoriale 20–25 °C ; UV : partie au-dessus de 2. Un tiret signifie non utilisé.

| Usage | Vent km/h | Rafales km/h | Vagues m | Courant m/s | UV | Eau °C |
|---|---:|---:|---:|---:|---:|---:|
| Baignade | 1 | 0,5 | 20 | 40 | 2 | 3 |
| Famille | 1 | 0,6 | 28 | 50 | 3 | 4 |
| Paddle de loisir | 2 | 1 | 28 | 55 | – | – |
| Bateau de plaisance | 1 | 0,6 | 22 | 35 | – | – |

Le profil famille accorde plus de poids aux vagues, aux UV, à la température et au courant ; le profil paddle au vent. Aucun bonus de parking, de sauveteur supposé présent ou de qualité sanitaire « bonne ». Un prélèvement récent défavorable enlève 35 points aux profils baignade/famille. Les pénalités communautaires sont plafonnées par catégorie : pollution 22 et méduses 12 pour baignade/famille ; courant 10/10/14/7 ; affluence 6 pour famille. Le plafond est pondéré par le nombre et la confiance des observations retenues. Le total ne descend pas en dessous de zéro.

## Couverture et restrictions

Les 6 mesures (baignade/famille) ou 4 (paddle/bateau) doivent toutes être utilisables pour un indice comparable. Avec au moins une mesure utilisable mais pas toutes, le modèle calcule un **indice partiel** : 100 moins les seules déductions établies, borné à zéro. Comme les déductions sont toujours positives ou nulles, le résultat est un plafond à données connues constantes, pas une estimation des mesures écartées. L'API l'expose dans `explanations[usage].partialScore` avec le statut `partial` et la couverture ; `scores[usage]` reste nul afin de ne pas classer, filtrer ou estimer un drapeau avec un plafond. Un zéro mesuré est utilisable ; un plafond calculé de zéro est affiché. Sans mesure utilisable, aucun score ni plafond.

Une valeur visible issue d'une prévision périmée figure dans `stale`, pas dans `missing`. Une unité, une valeur ou une datation non exploitable figure dans `invalid`. Les champs sans valeur figurent dans `missing`. Lac, rivière et milieu inconnu : modèle non applicable. Aucun courant d'atlas SHOM, température marine ou coefficient de marée ne remplace une mesure locale manquante.

Une interdiction officielle active neutralise baignade et famille (0, statut `closed`), quel que soit le milieu, sans fabriquer de drapeau. Après levée, une projection datant de la fermeture est écartée. Surveillance sur place, dangers localisés, vigilance, compétences et embarcation ne sont pas validés par le modèle.

La liste, les recommandations et la fiche relisent les contributions actives en base, indépendamment des projections météo (15 min). Une liste est datée et figée pendant au plus deux minutes ; si une fermeture ou l’état communautaire change entre deux pages, son curseur est refusé (409). Une contribution retirée ou expirée ne peut donc pas continuer à pénaliser une nouvelle recherche. Aucun calcul ne déclenche d’appel météo par résultat.

Les recommandations excluent les indices inconnus, non applicables, nuls et les usages interdits. La recherche sans filtre conserve ces plages pour consultation.

## Scénarios de régression

Vent 8, rafales 10, vagues 0,3, courant 0,05, UV 3, eau 22 : **77 / 72 / 63 / 77** (ordre du tableau). Mêmes entrées avec vagues 4 et courant 1 : **0 / 0 / 0 / 0**. Avec eau manquante seulement : **≤ 77 (5/6) / ≤ 72 (5/6) / 63 / 77**. Avec prélèvement récent défavorable et signalement pollution au plafond : **20 / 15 / 63 / 77**. Le gel des scénarios vérifie le calcul, pas sa capacité prédictive. Ne pas généraliser aux eaux intérieures sans données et calibration propres.

## Disciplines sur la fiche

Les profils expérimentaux `voile-loisir-1` (catamaran et planche à voile)
complètent le paddle sur la fiche uniquement. Les classements existants et les
drapeaux ne les utilisent pas. Le vent moyen est exprimé en km/h : le modèle
retire 4 points par km/h en dehors de la bande éditoriale 12–22 (catamaran)
ou 15–25 (planche), et 2 points par km/h de rafale au-dessus de la borne haute.
Les vagues et le courant restent défavorables ; les règles de couverture et
de fraîcheur ne changent pas. Ces bandes sont des préférences de loisir, pas
des limites de sécurité validées pour une personne, un gréement ou un site.
La direction est la provenance météorologique, pas une estimation de vent de
terre ou de mer : elle ne modifie pas la note.

## Suivi opérationnel (#69)

Toutes les 15 minutes, le worker lit le catalogue public, les derniers passages
des zones météo et les projections présentes dans Redis. Il appelle le même
modèle que la recherche pour les six activités. Il ne visite aucune fiche,
ne contacte pas les fournisseurs, ne conserve ni notes individuelles ni
signalements. Un succès de collecte rend les plages de la zone éligibles dès
le prochain travail de projection (chaque minute, lot borné à 100). Le
renouvellement ordinaire et les recherches déjà paginées restent inchangés.

```sh
docker compose -f docker-compose.local.yml exec -T worker node scripts/score-coverage.cjs sample
docker compose -f docker-compose.local.yml exec -T worker node scripts/score-coverage.cjs history 24
```

`sample` observe sans écrire. `history 24` lit les six dernières heures ;
un créneau sans observation vaut `null`, jamais zéro. Le premier relevé de
chaque quart d'heure est conservé sept jours dans le cache et peut disparaître
en cas d'éviction ou de perte de Redis. Comparer les séries de même `scope`
(identifiants, positions et milieux). Il ne s'agit pas d'un historique garanti
ni d'un nouvel objectif de disponibilité.

Les statuts de chaque activité sont exclusifs. Les motifs d'une note incomplète
peuvent se recouper : projection inutilisable, prévision périmée, mesure absente
ou invalide. Sans projection utilisable, ne pas attribuer les valeurs manquantes
au fournisseur. `awaitingProjection` compte les sites dont la base connaît un
succès météo postérieur à la projection encore utilisable. Les deux lectures
(base puis cache) sont rapprochées, pas une transaction distribuée.
`sources` fournit aussi les erreurs, dates des dernières tentatives et zones
en attente. `dispatch` distingue une temporisation du fournisseur, un retard
avec des tentatives récentes, ou sans tentative récente sur les deux sources.
Un trou d'observation ou une absence de tentative ne prouve pas à lui seul
une panne du fournisseur ou une mise en veille de l'hôte.
