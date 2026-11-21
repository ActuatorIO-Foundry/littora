# Accès des chiens de compagnie (#88)

Le registre révisé de l’API référence les objets de plage du catalogue par
identifiant OSM (type et numéro). Il ne crée pas de plage et ne déduit rien
du nom, d’un avis de visiteur, d’un équipement ou de la proximité d’une autre
plage. La recherche, le catalogue et la fiche utilisent le même état. La règle
ne donne ni score de confort, ni avis de baignade, ni information sur les
droits spécifiques des chiens d’assistance.

Première revue : 13 sites de quatre communes, pas un inventaire national.

| Source vérifiée le 21 novembre 2026 | Correspondance retenue |
|---|---|
| [Ville de Nice](https://www.nice.fr/avoir-un-chien-en-ville/) | Plage canine de Lenval uniquement ; pas la plage voisine. |
| [Golfe de Saint-Tropez Tourisme](https://www.golfe-saint-tropez-information.com/fr/loisirs/autres-loisirs/ramatuelle/plage-de-l-escalet-4600952) | À l’Escalet, la laisse est obligatoire. |
| [Dinard Émeraude Tourisme](https://www.dinardemeraudetourisme.com/experiences/en-amoureux/plages-autorisees-aux-chiens-sur-la-cote-demeraude/) | Écluse, Prieuré et Saint-Énogat : accès hors saison, interdiction en été. |
| [Bandol Tourisme](https://www.bandoltourisme.fr/bandol/la-destination/les-plages/) | Huit plages interdites aux chiens de compagnie ; la Dog Beach autorisée n’est pas dans le catalogue. |

Pour réviser une entrée de `apps/api/src/modules/beaches/dog-access.ts`,
contrôler le périmètre exact sur la carte et le texte du gestionnaire. Saisir
le lien, la date de lecture, l’échéance de la prochaine revue et la fin de
validité si connue. Décrire toute condition de secteur, de laisse ou d’heure
sans affirmer que la plage est ouverte « maintenant ». Pour une interdiction
saisonnière, les dates sont inclusives, au fuseau Europe/Paris. Une période
échue, une revue en retard ou des règles actives concurrentes ne doivent pas
produire de badge positif. Un signalement communautaire peut motiver une
nouvelle revue, pas modifier la règle publiée.
