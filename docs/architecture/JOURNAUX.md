# Journaux d’exploitation (#30)

Les diagnostics indiquent **ce qui a échoué**, pas ce que le visiteur a envoyé.
Pour retrouver une erreur HTTP, utiliser le `x-request-id` généré par l’API ;
un identifiant fourni par le client n’est pas repris. Ne pas demander le jeton,
les cookies, la position, le texte d’un signalement ou une copie du journal.

| Service | Informations conservées dans les diagnostics |
|---|---|
| API | Événement, statut HTTP, identifiant serveur ; pour un contrat invalide, nom de l’opération défini dans le contrat. Ni corps, ni détail de validation, requête SQL ou exception brute. |
| Collecte et imports | Événements, produits, motifs bornés et compteurs. Un échec de démarrage, de connexion ou d’import n’imprime pas l’exception. |
| Caddy et Nginx | Disponibilité, avertissement du proxy, erreur de configuration ou code HTTP du serveur web. Aucun URI, en-tête, référent ou adresse du visiteur. |
| PostgreSQL | Disponibilité et gravité des incidents. Les paramètres SQL ne sont pas journalisés et les messages natifs ne sont pas reproduits sur les sorties Docker. |
| Redis (cache et jobs) | Disponibilité et avertissement. Les journaux internes `SLOWLOG` et `ACL LOG`, susceptibles de mémoriser arguments, clés et adresses, sont désactivés ; les compteurs et la sonde de collecte restent disponibles. |

**Fonctionnement.** Les services natifs sous Compose utilisent un filtre à
sorties prédéfinies. Le flux transite en mémoire par un tube nommé privé,
retiré dès son ouverture ; le démon conserve son rôle de processus principal.
Le modèle web de production n’enregistre que le statut d’accès. Le serveur web
de développement affiche des états de compilation et de proxy ; pour le détail
des erreurs de compilation, lancer le build sans trafic visiteur.

**Vérification.** La recette HTTPS utilise des conteneurs et des clés jetables.
Elle contrôle en mémoire les deux sorties des processus après une requête
valide, une erreur API, une conversion SQL refusée et un amont indisponible.
Les assertions exigent la présence des diagnostics attendus autant que l’absence
des marqueurs privés. Aucun journal ni instantané de requête n’est archivé.

Pour trier localement les sorties existantes sans les afficher :
`node scripts/check-private-logs.mjs NOM_DU_PROJET_COMPOSE`. Le contrôle
lit au plus 2 000 lignes par conteneur Littora en cours sur les dernières 24 h,
en mémoire. Il retourne uniquement des compteurs : 0 sans indicateur détecté,
2 si examen privé nécessaire, 1 si incomplet. Une adresse technique ou une
valeur masquée peut être signalée ; le texte libre et les formats inconnus
peuvent passer inaperçus. Ne pas en déduire une certification de l’historique.

**Limites.** Les commandes explicites d’export et de revue renvoient des
données métier à l’opérateur : ne pas rediriger leurs résultats vers un journal
partagé. Les traces d’un hébergeur, d’un CDN, d’un collecteur externe, les
vidages mémoire, les modes de débogage forcés et les images de stockage lancées
à la main hors des modèles fournis ne sont pas couverts par cette recette.
Ne pas activer de journal d’accès brut ni de traçage SQL en production.

Les protections s’appliquent aux nouvelles exécutions après mise à niveau.
Elles ne nettoient ni les anciens journaux ni les sauvegardes. Avant ouverture,
l’exploitation doit contrôler les accès et la rétention sur la cible (#30/#31).
En cas d’exposition suspectée : restreindre les accès, révoquer le secret
concerné et traiter les preuves dans le circuit d’incident privé ; ne pas
joindre la trace à GitHub et ne pas la supprimer sans décision d’exploitation.
