# Qualite sanitaire : dernier prelevement et situation actuelle (#18)

Decision avant V1 : un resultat de laboratoire n'est ni une autorisation de baignade, ni une decision de fermeture ou de reouverture. Le [ministere charge de la Sante](https://baignades.sante.gouv.fr/baignades/editorial/fr/controle/regles_calculs.html) distingue le classement de fin de saison des prelevements individuels. Verifier les consignes locales.

## Contrat actuel

- Les routes qualite et score exposent le meme `lastSample` (date civile en France metropolitaine, source, resultat historique) ou `null`. Les lignes sans date, futures, sans source, de demonstration ou hors catalogue public ne fournissent pas de preuve.
- Meme un prelevement favorable du jour ne rend pas l'etat sanitaire favorable et n'augmente pas le score. Sans preuve actuelle, `status: unknown` et fiabilite inconnue ; le score meteo-marin n'est pas un feu vert sanitaire.
- Si le dernier prelevement est defavorable (`poor`) et date du jour ou de la veille, conserver une mise en garde et une penalite. A date egale, priorite a l'observation defavorable. Cette fenetre est une regle de prudence **propre a Littora**, pas une duree reglementaire. A son terme l'etat redevient inconnu, pas favorable. Le resultat historique reste disponible.
- Aucune migration, purge ou reclassification de l'historique. Les caches des scores et des recherches sont versionnes pour ne pas reutiliser d'anciens bonus.
- Les mesures environnementales Eaufrance / Hub'Eau sont **differees apres la V1** : elles ne sont ni des prelevements sanitaires du site ni des consignes de baignade. Aucun effet sur les scores ou une reouverture.

## Reste a livrer avant cloture

Valider une ressource officielle reutilisable sur des prelevements reels, son format, sa cadence, ses droits et ses identifiants de sites. Distinguer trois produits : classement annuel (saison), prelevement (date et interpretation du producteur) et restriction officielle (autorite, perimetre, debut et levee explicite). Ni un prelevement, ni son anciennete ne peuvent lever une restriction. La consultation du [portail officiel](https://baignades.sante.gouv.fr/baignades/homeMap.do) ne prouve pas qu'un flux de fermetures est branche.

L'import devra etre idempotent, conserver les revisions et les rejets, envoyer les sites ambigus en revue et etre teste sur copie isolee avant activation. Le traitement courant ne publie ni fermeture officielle, ni classement annuel. La recette couvre les donnees publiques et le score sur PostgreSQL temporaire (`npm run test:integration`).
