# Drapeaux de baignade : sources et couverture

## Pilote : plage de la Piste, Capbreton

Les nageurs sauveteurs renseignent le drapeau à l'ouverture du poste ; il peut changer en journée.
Le [SMGBL oriente les usagers vers Plages Landes](https://www.smgbl.fr/Medias/Periodes-et-horaires-de-surveillance-2025).
[Landes Attractivité propose explicitement un widget gratuit pour les sites tiers](https://www.plages-landes.info/obtenir-un-widget-pour-votre-site/).
Le site annonce une mise à jour quotidienne en haute saison, pas un délai garanti.

Le 23 novembre 2026, le générateur public et la [fiche de la plage](https://www.plages-landes.info/plages/plage-de-la-piste/)
ont été vérifiés pour le widget `560`, rattaché au site Littora `node/2417680230` (mer).
Ni les autres plages de Capbreton ni les homonymes n'héritent de ce rattachement.
Il faut vérifier la zone, l'identifiant de catalogue, la position et l'identifiant du bulletin pour étendre la liste.

L'API expose la référence facultative `officialFlagBulletin` sur la plage, indépendamment du score.
Sa date `linkVerifiedOn` concerne le rattachement de la source, **pas le drapeau**.
Le navigateur charge le document de l'éditeur uniquement sur demande, sans référent.
Il le retire après cinq minutes de consultation ou au passage en arrière-plan ; ce délai n'est pas une validité annoncée par les sauveteurs.
Le lien direct reste disponible si l'affichage intégré échoue. Aucun contenu du bulletin n'est extrait ni conservé.

## Ce qui reste distinct

- **Drapeau officiel structuré** : `safety.officialFlag` reste inconnu, même avec un bulletin consultable. Aucune licence de redistribution des valeurs et aucune échéance d'observation exploitable n'ont été établies pour ce pilote.
- **Fermeture officielle** : une décision de fermeture active prime sur le bulletin et les votes ; elle n'est pas traduite en couleur.
- **Communauté** : la majorité, l'historique et le filtre de recherche restent communautaires. Ni une majorité verte ni un rouge isolé ne renseignent le champ officiel.
- **Météo et qualité sanitaire** : ces sources ne constatent pas le drapeau hissé. Les prévisions, classements ARS et horaires de surveillance ne sont pas convertis en drapeau.

## Autres pistes examinées

| Source | Ce qui est vérifiable | Condition avant intégration structurée |
| --- | --- | --- |
| [MaPlage.info : API GraphQL](https://dev.maplage.info/docs/) et [collecte au poste](https://www.iris-interactive.fr/expertises-solutions-metiers/solutions-metiers-edites-par-iris-interactive/maplage-info/) | Couleur par plage ; accès partenaire par jeton. Le champ de couleur documenté ne porte pas sa propre échéance. | Obtenir l'accès et le périmètre des collectivités, les droits sur les données et les dates d'observation et de fin de validité. La licence de la documentation ne suffit pas. |
| [Kalilo, Communauté d'agglomération Pays Basque](https://www.communaute-paysbasque.fr/eau-environnement-energies/la-qualite-des-eaux-de-baignade) | Consultation locale, distincte des résultats de qualité d'eau. | Identifier un flux documenté et autorisé pour les zones du catalogue. |
| [Marseille Infoplages, SERAMM](https://www.suez.com/fr/france/actualites/application-marseille-infoplages) et [convention de la Métropole](https://deliberations.ampmetropole.fr/documents/ct1/deliberations/2015/07/03/RAPPORTDELACOMMISSION/C0ABB.pdf) | Les partenaires diffusent la couleur du jour pour les plages suivies. | Vérifier les conditions de diffusion à un tiers et obtenir un exemple horodaté par zone. L'accès public à l'application n'est pas traité comme un accès au flux. |

Pour terminer le [ticket #49](https://github.com/ActuatorIO-Foundry/littora/issues/49), obtenir d'un producteur habilité un exemple réutilisable comportant identifiant de zone, couleur, observation, début et fin de validité avec fuseau, révocation et éventuelle fermeture distincte. Tester le véritable import sur copie isolée : rouge officiel contre majorité verte, retrait anticipé, expiration, doublon, contradictions entre deux sources habilitées et panne fournisseur. Ne pas publier une couleur historique comme actuelle.
