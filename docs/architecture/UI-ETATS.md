# Lecture des conditions

L’aperçu de recherche et la fiche utilisent la même mesure (`app-metric-reading`).
Le composant reçoit la valeur numérique, son unité et l’état de **sa propre source**.

| Situation | Restitution |
| --- | --- |
| Première ouverture | Vague avec libellé annoncé ; image fixe si mouvements réduits. |
| Actualisation | Le contenu déjà affiché reste en place. Pas de nouveau chargement plein écran. |
| Échec de requête | Message textuel annoncé comme alerte ; bouton de nouvelle tentative lorsqu’il est disponible. |
| Valeur numérique finie | Valeur française et unité, y compris zéro. |
| Mesure absente | « Non renseigné », sans unité ni substitution par zéro. |
| Prévision ancienne | Dernière valeur et mention « Prévision périmée ». |
| Valeur sans état de source | Dernière valeur et « Fraîcheur non renseignée ». |

La palette partagée se trouve dans `apps/web/src/styles.css`. Sur fond clair,
`--ink` porte les titres, `--muted` les précisions, `--sea` les actions et
le contour de focus, `--danger` les erreurs. Une couleur de température ou
de vent ne remplace ni la valeur et son unité ni un bulletin de baignade.
Les boutons, liens et commandes de divulgation conservent leur sémantique native.

Les scénarios UI-02 vérifient zéro, inconnu et péremption sur les deux vues,
le focus clavier, le contraste des paires de couleurs et la redistribution
du contenu (fenêtre de 1440 pixels physiques, 720 pixels CSS à facteur 2).
Les scénarios de mouvement vérifient la préférence système et la pause du décor.
