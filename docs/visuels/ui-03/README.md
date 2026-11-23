# Références des parcours de consultation

| Écran | Téléphone (360 px) | Tablette (768 px) | Ordinateur (1440 px) |
| --- | --- | --- | --- |
| Accueil | [Voir](360/accueil.jpg) | [Voir](768/accueil.jpg) | [Voir](1440/accueil.jpg) |
| Recherche | [Voir](360/recherche.jpg) | [Voir](768/recherche.jpg) | [Voir](1440/recherche.jpg) |
| Fiche plage | [Voir](360/fiche.jpg) | [Voir](768/fiche.jpg) | [Voir](1440/fiche.jpg) |
| Contact | [Voir](360/contact.jpg) | [Voir](768/contact.jpg) | [Voir](1440/contact.jpg) |

Ces images servent à comparer la mise en page, pas à renseigner les conditions d'une plage.
Les plages et les mesures sont fictives, la date est fixe et les animations sont réduites.
Le scénario coupe les tuiles externes : sur ordinateur, la recherche présente le fond de secours
et son avertissement. Le contact est vierge et aucun message n'est envoyé.

Depuis la racine : `npm run test:ui --workspace apps/web -- --grep 'Références UI-03'`.
Les JPEG sont produits dans les dossiers du test sous `apps/web/test-results/`.
Après revue visuelle, remplacer uniquement les quatre images de chaque format retenu
(`small-mobile`, `tablet`, `desktop`). Les traces et rapports restent locaux.

Les essais de parcours vérifient séparément le filtre communautaire, la priorité des
fermetures officielles, l'accès à l'aperçu sans quitter la liste et le retour depuis la fiche.
