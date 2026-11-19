# Drapeaux et alertes

Regles de #22, separees de la confiance et des quotas de #23.

## Trois informations independantes

1. Le drapeau officiel reste inconnu tant qu'aucune source autoritative n'est
   connectee. Aucun vote ne remplit ni ne modifie ce champ.
2. Les conditions calculees dependent des mesures disponibles et des risques.
   La couleur legacy `safety.flag` reste une estimation de ces conditions,
   jamais une conversion du vote communautaire en drapeau officiel.
3. L'observation communautaire majoritaire est une information distincte.
   Elle ne retire aucune alerte de vent, vague, courant, UV ou pollution.

## Majorite communautaire

- Seules les observations verifiees, non demo, non futures et non expirees
  sont examinees. La date d'observation prime sur la date de reception.
- Fenetre de vote : trois heures. Une seule observation, la plus recente,
  par session de contribution et par condensat reseau.
- Au moins trois contributions distinctes et deux tiers des votes sont requis.
  Egalite ou desaccord : pas de couleur majoritaire. Un vert seul reste sans
  majorite, meme si c'est le seul vote disponible.
- Les anciennes contributions sans identite technique peuvent rester dans
  l'historique si elles ont ete verifiees, mais ne produisent aucun vote.
- Au-dela de 1 000 observations candidates, le calcul est marque `capped`
  et n'annonce pas de majorite sur une tranche incomplete.

Ces sessions et reseaux ne prouvent pas l'independance de personnes physiques.
La deduplication est conservatrice, notamment pour les reseaux partages.
Le champ legacy `confidence` est deprecie : sa part de votes eventuelle n'est
jamais une probabilite de securite. L'interface n'affiche aucun pourcentage.

## Historique et danger

L'historique couvre douze heures, avec les douze observations les plus recentes
et le dernier rouge s'il est plus ancien. La date du dernier rouge reste visible
hors du volet replie. Exemple teste : un rouge a 12 h puis cinq verts distincts
a 13 h peut produire une observation majoritaire verte ; le rouge de 12 h reste
date, non officiel, et toutes les alertes calculees sont conservees.

Une mer de quatre metres, une mauvaise qualite d'eau ou des conditions inconnues
ne deviennent pas favorables a cause de votes verts. Le drapeau affiche sur place
et les consignes des autorites restent prioritaires.

## Verification

Tests : absence de donnees, vote unique, doublons de session/reseau, dernier vote,
egalites, dates futures, expiration, demonstration, attente de moderation,
historique rouge, volume plafonne, absence d'identifiants dans la sortie et
separation des alertes dans les scores. Recette responsive avec historique ouvert
sur cinq formats, sans changement de palette ni de mise en page generale.

La connexion d'une source de drapeaux officiels reste a realiser. Les tests
garantissent l'etat officiel inconnu en son absence, pas une ingestion officielle
qui n'existe pas encore. La [modération privée](CONTRIBUTIONS.md) assure la
publication, le retrait et le réexamen des signalements (#27).
