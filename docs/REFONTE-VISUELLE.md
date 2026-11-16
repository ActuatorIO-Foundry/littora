# Refonte visuelle Littora

Branche : `refactor`. Suivi : #2, #4 et #5.
Statut : refonte visuelle validee le 16 novembre 2026, fusion dans `main` autorisee.

## Direction

- Accueil Lagune : illustration de crique, eau animee avec Three.js, bouee en 3D,
  typographie Plus Jakarta Sans et accents corail.
- Consultation Atlas : fond clair, carte geographique, hierarchie compacte,
  typographie DM Sans, tableaux de conditions et metadonnees de source.
- Palette : encre `#163b40`, mer `#007e88`, corail `#d94d3b`, blanc,
  accents ambre reserves aux avertissements.
- Composants communs : navigation, icones Lucide, boutons, champs, segments,
  metriques, chargement, erreurs et etats sans donnees.

## Perimetre livre

- Accueil, recherche, fiche plage et contact responsive.
- Cartographie Leaflet avec fond vectoriel Natural Earth auto-heberge sur
  accueil/recherche et fond OpenStreetMap sur les fiches.
- Selection des facades par traits de cote et liste alternative accessible.
- Carte/liste sur mobile, filtres repliables, apercu sans navigation et lien
  Details distinct. Conservation des criteres dans l'URL.
- Graphiques alimentes uniquement par les series retournees par l'API.
- Drapeau officiel distingue des conditions calculees et observations locales.
- Points fictifs `local-hint` exclus de la carte et des listes d'equipements.
- Contact sans faux envoi : copie locale du message en attendant le service.

L'illustration littorale est originale et fictive. Elle ne represente pas une
plage identifiee. Les geometries de facade servent a l'exploration, pas a la
navigation maritime ni a une delimitation administrative.

## Animation et accessibilite

La scene Three.js est chargee dynamiquement sur l'accueil. Une image fixe reste
visible avant initialisation et en absence de WebGL. La scene combine une
texture de cote, une refraction animee sur l'eau et une bouee geometrique 3D ;
ce n'est pas une simulation physique de la houle.

Le rendu est suspendu hors ecran ou lorsque l'onglet est masque. La densite de
pixels est plafonnee a 1,5. Un bouton pause est disponible ; la preference
`prefers-reduced-motion` conserve une image fixe au chargement.

Les transitions Motion sont ponctuelles. Navigation clavier, lien d'evitement,
labels de formulaire, messages de statut et alternative tabulaire aux graphes
sont prevus. Les couleurs ne sont pas les seuls porteurs d'information.

Les chargements utilisent une vague pleine largeur en Canvas 2D : texture d'eau reprise
de l'accueil, refraction et ecume animees a 30 images par seconde. Aucun nouveau
moteur graphique n'est charge pour cet indicateur. Le rendu s'arrete hors ecran,
dans un onglet masque et avec la preference de mouvement reduit, y compris
lorsqu'elle change pendant le chargement. Les reponses API ne sont pas retardees
pour prolonger artificiellement l'animation.
Le bandeau mesure 200 pixels de haut et porte le message blanc en surimpression,
avec un voile de contraste. La resolution du canvas suit les dimensions du
conteneur lors des redimensionnements.

Les survols ajoutent un relief de 2 a 3 pixels aux commandes, une translation
des fleches et une mise en evidence des elements interactifs. Les dimensions
de mise en page restent stables. Les mouvements de survol sont reserves aux
pointeurs precis et desactives en mode mouvement reduit.

## Recette locale

Depuis la racine :

```sh
docker compose -f docker-compose.local.yml up -d postgres redis api
npm --prefix apps/web ci
npm --prefix apps/web run start:local
```

Le front utilise `http://127.0.0.1:4200` et transmet `/api` vers le port 3000.
Si ce port est utilise, adapter l'override Compose et `apps/web/proxy.local.json`
sans interrompre une application independante. Le proxy Docker reste distinct.

```sh
npm run build:web
npm exec --prefix apps/web -- playwright install chromium
npm --prefix apps/web run test:ui
```

Chrome deja installe peut etre utilise avec `PLAYWRIGHT_CHANNEL=chrome`.
Les tests interceptent les API pour les etats controles et n'ecrivent pas dans
la base. Captures et traces sont produites dans `apps/web/test-results`, ignore
par Git. Viewports : 360, 390, 768, 1440 et 1920 pixels.

Recette du 16 novembre 2026 : compilation production reussie, 55 tests de
parcours et d'animation reussis sur les cinq formats et selection geographique rejouee
trois fois par format. Controle du canvas non vide, anime et stable en pause
sur mobile et desktop. Parcours catalogue/fiche controle avec l'API locale,
sans erreur JavaScript ni creation de signalement. Les tests automatises
ne remplacent pas la validation visuelle avant fusion.

La compilation conserve un avertissement CommonJS pour Leaflet. Les
dependances historiques et leurs alertes de securite restent a traiter dans
le chantier de securisation, sans mise a niveau globale dans cette branche.

## Limites conservees

La refonte ne finalise pas les integrations meteo, les scores, la moderation,
les contrats de donnees ni les filtres serveur. Le catalogue et la classification
restent ceux de l'API existante, avec leurs limites auditees. Les valeurs locales
de secours encore retournees par l'API sont identifiees par leur source.
Les drapeaux et temperatures ne sont filtrables que lorsqu'ils sont renseignes
dans le resultat de recherche. Les comptes et favoris ne sont pas ajoutes.

Les corrections metier et la securisation de production restent suivies dans
la feuille de route #1. Aucun passage public ou merge automatique n'est prevu
par cette branche.

## Validation visuelle

- [x] Direction Lagune/Atlas et niveau d'animation valides.
- [x] Lecture et confort de navigation valides sur mobile et ordinateur.
- [x] Hierarchie des fiches, sources et etats inconnus validee.
- [x] Retouches visuelles finales traitees.
- [x] Accord de fusion dans `main`.

## Retouches de consultation

Ajouts sur `architecture`, le 16 novembre 2026 :

- Fond de crique sur recherche, fiche plage et contact uniquement, a 12 %
  d'opacite et avec saturation attenuee. L'accueil conserve sa scene actuelle.
- Derive CSS lente de 36 secondes, pause disponible dans le pied de page,
  suspension dans un onglet masque et arret avec `prefers-reduced-motion`.
- Texte secondaire legerement renforce sur ces pages pour conserver le contraste.
  Les cartes, champs et commandes restent independants du decor non interactif.
- Voile central de la vague de chargement ramene de 66 % a 60 % : eau un peu
  plus claire, texte blanc et dimensions de 200 pixels conserves.
- Cinq tests responsive supplementaires couvrent le decor, sa pause et son
  absence sur l'accueil. Les tests du chargement verifient le voile eclairci.

Ces retouches sont separees du commit de correction des dependances ; aucune
fusion dans `main` n'est incluse.
