# Avis picomatch : exception retiree (#45)

Le 18 novembre 2026 a 15:38 UTC, GitHub a [retire l'avis GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Le registre npm ne le signale plus : audit racine strict, developpement inclus, sans exception, sans changement de dependance. Il s'agit d'un retrait d'avis, pas de la livraison d'un correctif logiciel.

L'exception de recette, limitee aux versions 2.3.2 et 4.0.4 jusqu'au 24 novembre, a ete supprimee de la politique active. Le test de non-regression soumet l'ancien rapport a la politique effective : s'il reapparait, le controle refuse le paquet et ses dependants. Les configurations de glob restent des entrees de build de confiance ; elles ne doivent pas provenir des visiteurs. Aucune occurrence de picomatch dans les dependances d'execution actuelles.

`npm run audit:strict` controle le registre sans exception et `npm run audit` applique la politique du depot. Une nouvelle alerte, un rapport incomplet ou une erreur reseau ne valent pas validation. Les rapports bruts restent hors Git. Le retrait des exceptions npm et Caddy ne vaut pas autorisation de diffusion : le lanceur conserve le verrou de sortie (#43).
