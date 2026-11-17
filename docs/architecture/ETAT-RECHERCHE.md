# Etat de recherche et navigation

Le lot #20 conserve les composants et styles existants. Le client genere reste
centralise dans `LittoraApiService`. Les abonnements RxJS de liste, commune et
apercu sont annules quand le contexte change. Les changements des parametres
de route sont observes, y compris quand Angular reutilise le composant.
La signature des parametres ecrits localement evite une seconde requete provoquee
par la synchronisation de l'URL elle-meme.

## Geolocalisation

Chaque tentative GPS possede une generation. Une selection manuelle de facade,
commune, texte, apercu ou une reinitialisation invalide les callbacks precedents.
La destruction du composant les invalide egalement. Refus, timeout, API absente
et coordonnees invalides ne declenchent aucune recommandation de substitution.

Le mode de proximite utilise `near=1` dans l'URL. Les coordonnees restent dans
l'etat de navigation du navigateur, jamais dans les liens de recherche ou de
detail, ni dans un stockage partage entre utilisateurs. Cet etat est transmis
au detail puis au retour, et restaure au rechargement quand le navigateur le
conserve. Un lien ouvert sans cet etat affiche explicitement son absence et
le catalogue general ; il ne simule pas de localisation. Les appels API de
proximite utilisent toujours les coordonnees necessaires a la requete.

Filtres, usage, facade/commune et tri restent partageables dans l'URL. Une
nouvelle tentative conserve le perimetre qui a echoue, au lieu de revenir
silencieusement a un catalogue national. Les reponses devenues obsoletes
ne doivent pas remplacer le dernier choix.

## Apercu et detail

Le clic sur une plage ou un marqueur ouvre l'apercu. Seul le lien Details
navigue vers la fiche. Une nouvelle selection efface les conditions precedentes.
Le client refuse une reponse de score dont l'identifiant de plage ne correspond
pas a la demande, dans la liste comme dans le detail. Un filtre qui retire
la plage selectionnee ferme son apercu.

La fiche observe aussi les changements d'identifiant sur une route reutilisee.
Les requetes de la plage precedente sont annulees : score, equipements,
signalements et soumission en cours. Une nouvelle tentative de score efface
l'ancien resultat avant chargement et ne le laisse pas visible apres erreur.

## Limites distinctes

La recherche serveur complete, les filtres meteo sur tout le catalogue,
le rayon et la limite des recommandations restent suivis dans #19. La gestion
d'etat ne rend pas ces filtres deja exhaustifs et n'ajoute aucune donnee meteo.
La duree de conservation de l'historique prive depend du navigateur ; aucun
partage de position personnelle n'est ajoute implicitement a un lien public.
