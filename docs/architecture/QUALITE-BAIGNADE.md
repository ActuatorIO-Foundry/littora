# Qualite sanitaire : dernier prelevement et situation actuelle (#18)

Decision avant V1 : un resultat de laboratoire n'est ni une autorisation de baignade, ni une decision de fermeture ou de reouverture. Le [ministere charge de la Sante](https://baignades.sante.gouv.fr/baignades/editorial/fr/controle/regles_calculs.html) distingue le classement de fin de saison des prelevements individuels. Verifier les consignes locales.

## Contrat actuel

- Les routes qualite et score exposent le meme `lastSample` (date civile en France metropolitaine, source, resultat historique) ou `null`. Les lignes sans date, futures, sans source, de demonstration ou hors catalogue public ne fournissent pas de preuve.
- Meme un prelevement favorable du jour ne rend pas l'etat sanitaire favorable et n'augmente pas le score. Sans preuve actuelle, `status: unknown` et fiabilite inconnue ; le score meteo-marin n'est pas un feu vert sanitaire.
- Si le dernier prelevement est defavorable (`poor`) et date du jour ou de la veille, conserver une mise en garde et une penalite. A date egale, priorite a l'observation defavorable. Cette fenetre est une regle de prudence **propre a Littora**, pas une duree reglementaire. A son terme l'etat redevient inconnu, pas favorable. Le resultat historique reste disponible.
- Aucune migration, purge ou reclassification de l'historique. Les caches des scores et des recherches sont versionnes pour ne pas reutiliser d'anciens bonus.
- Les mesures environnementales Eaufrance / Hub'Eau sont **differees apres la V1** : elles ne sont ni des prelevements sanitaires du site ni des consignes de baignade. Aucun effet sur les scores ou une reouverture.

## Import annuel et provenance

Source : [rapportage national, ministere de la Sante / ARS](https://www.data.gouv.fr/datasets/donnees-de-rapportage-de-la-saison-balneaire-1), Licence Ouverte. La saison validee est 2025. Les quatre ressources (sites **de la meme saison**, analyses, classements et evenements) sont identifiees par UUID, URL et SHA-256 dans `ars-source.ts`. Une nouvelle publication est une nouvelle edition a verifier ; il ne s'agit pas d'un flux sanitaire en temps reel. Le classement est conserve avec le code du producteur, sans qualificatif invente.

L'import refuse un fichier tronque ou modifie. Il archive les concentrations pour 100 ml et leur qualificatif : valeur confirmee, limite de detection ou manquante. Un zero accompagne de « valeur manquante » ne devient pas une mesure de zero. Les dates invalides et collisions incompatibles sont rejetees. Centres des sites et noms de commune sont ceux du producteur ; seuls les sites metropolitains sont retenus. L'edition, les sites, observations, erreurs et compteurs sont ecrits dans une meme transaction. Un second import de la meme edition est sans effet. Une nouvelle edition conserve la precedente ; les rapprochements ne modifient jamais les fiches Littora.

Publication d'un rapprochement automatique : nom normalise concordant (hors articles/generiques), meme commune, milieu connu concordant, distance <= 200 m et relation unique dans les deux sens. Les candidats dans un rayon de 500 m restent consultables, sans publication si la preuve est insuffisante. Une fiche deplacee, renommee ou dont le milieu change perd le lien publie. Les correspondances restent celles de l'edition et du catalogue verifie ; reevaluer les sites en revue avant toute extension du catalogue.

### Exploitation

Apres restauration dans une **base isolee**, pointer `DATABASE_URL` sur la copie, compiler l'API et appliquer les migrations (0008 additive). Pour la production, sauvegarde, recette et activation separees. Ne pas appliquer au demarrage de l'API. Depuis la racine :

```sh
npm run build:api
node apps/api/scripts/database.cjs migrate
node apps/api/scripts/ars.cjs import
node apps/api/scripts/ars.cjs status
node apps/api/scripts/ars.cjs review 83009
node apps/api/scripts/ars.cjs rejects IDENTIFIANT_EDITION
```

Pour une reproduction hors ligne, `import REPERTOIRE_PRIVE` attend les memes octets dans `sites.csv`, `samples.csv`, `classes.csv`, `events.csv` et verifie les memes empreintes. Ne versionner ni fichiers bruts ni sorties. Dans Docker, le script est disponible sous `scripts/ars.cjs` depuis le repertoire de travail API. Repli : conserver l'ancienne application et son volume ; pour revenir a cette version, restaurer dans un volume distinct le dump correspondant a son manifeste. Ne jamais supprimer une migration appliquee.

Alternative : activer `ARS_IMPORT_ENABLED=true` explicitement sur API **et** worker, puis utiliser la route interne authentifiee `POST /api/ingestion/water-quality`. Declenchement operateur a la publication annuelle, file BullMQ distincte `littora-ars`, sans URL libre, import automatique national au demarrage ni nouveau job par visite. Le recu atteste la mise en file, pas la fin ; verifier le statut de l'edition et les echecs de la file.

### Restrictions, sans assimilation sanitaire

- Le rapportage annuel distingue les intervalles officiels d'interdiction sanitaire/non sanitaire des pollutions et des recontroles. Ils restent des **archives**, meme si la fin du champ est absente. Une absence de dossier ne signifie pas que la baignade est autorisee.
- Le registre operationnel est distinct. Un operateur habilite verifie l'acte de l'autorite, son perimetre, sa date civile en France metropolitaine et chaque plage concernee. Aucune extraction automatique d'arrete depuis un bulletin ou un resultat de laboratoire. La preuve doit etre une URL HTTPS du domaine approuve pour le code INSEE lie ; `www.bandol.fr` pour 83009 est fourni. Pour d'autres autorites, configurer `ARS_APPROVED_AUTHORITIES` en JSON, liste de `{host,insee,authority}` verifiee hors ligne. Ne pas utiliser un lien generique ou une date presumee.
- Appliquer `node apps/api/scripts/ars.cjs decision close UUID_PLAGE REF_DOSSIER AAAA-MM-JJ URL_ACTE`, puis **uniquement sur levee explicite** `decision lift` avec la meme plage et reference et le lien de la levee. Plusieurs decisions peuvent coexister. Pas de date d'expiration implicite ; une levee documentee conserve l'historique et ne garantit jamais une autorisation generale. Ce registre ne revendique pas une surveillance temps reel exhaustive.
- L'API de qualite et le score exposent le dernier prelevement, le site, la saison, les mesures et dates de l'archive, les periodes de pollution et d'interdiction historiques, et **separement** la restriction actuelle et les actes. Une interdiction active neutralise les scores baignade/famille, y compris dans les recherches en cache, sans simuler le drapeau officiel des sauveteurs. Les periodes de fermeture des archives ne sont pas des interdictions actuelles.

Recette de reference : la saison 2025 comporte 9 sites a Bandol ; verifier les correspondances avec les fiches locales, les mesures manquantes et le maintien des identites. Pour un cas de fermeture/reouverture distinct des analyses, l'[arrete municipal 755](https://www.bandol.fr/wp-content/uploads/2025/06/AM_755_Bandol_autorisation_baignade_ttes_plages.pdf) rappelle l'interdiction 754 du 24 juin 2025 et acte la reouverture le 26 juin. Utiliser uniquement une copie pour rejouer cet historique.
