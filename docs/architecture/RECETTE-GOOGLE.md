# Connexion Google : recette privée (#26)

Le site public n’affiche pas de bouton de connexion. Le service de recette se
lance à part ; le catalogue, les workers et l’API publique n’ont besoin d’aucun
secret Google. Une réponse simulée valide la mécanique du retour ; elle ne
valide ni le consentement sur Google ni la configuration réelle du client.

## Préparer la recette

Le [ticket #106](https://github.com/ActuatorIO-Foundry/littora/issues/106)
suit le provisionnement et le consentement réel, séparément des tests simulés.

1. Réserver une origine HTTPS **privée**, distincte du site public. Créer un
   client OAuth Google de type **Application Web** dédié aux tests ; limiter
   l’écran de consentement aux utilisateurs de test. Déclarer exactement
   `https://<hôte-de-recette>/connexion/google/retour` comme URI de retour.
2. Préparer une instance de [stockage membres](SESSIONS-MEMBRES.md) dédiée aux
   essais. Le login du service de connexion reçoit uniquement le rôle
   `littora_session_issuer`. Le lecteur des sessions de l’API garde son propre
   login. Hors machine locale, chiffrer la liaison avec vérification du serveur.
3. Injecter **uniquement dans le service de connexion** les variables ci-dessous.
   Ne pas les placer dans le Compose commun, un historique de commandes ou un
   ticket. Le sujet de test est le `sub` du compte dans une identité Google déjà
   vérifiée par un outil interne de confiance ; ce n’est pas une adresse e-mail.
   Si ce sujet est inconnu, ne pas ouvrir l’admission à tous pour le récupérer.

| Variable | Valeur attendue |
|---|---|
| `MEMBER_GOOGLE_MODE` | `recette`, sans activation par défaut |
| `MEMBER_PUBLIC_ORIGIN` | Origine HTTPS exacte du site de recette, sans chemin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Client de test et secret serveur |
| `GOOGLE_TEST_SUBJECT` | Un seul sujet de test autorisé |
| `MEMBER_ISSUER_DATABASE_URL` | Connexion privée de l’émetteur, jamais celle du catalogue |
| `MEMBER_LOGIN_PORT` | Facultatif, 3101 par défaut |

Depuis `apps/api` après compilation, lancer `node dist/member-login.js`.
Le service écoute sur `127.0.0.1` ; placer le proxy de recette dans le même
espace réseau. Router uniquement `/connexion/google` et `/connexion/google/*`
vers ce service. Sur **la même origine**, garder `/api/member/session` sur
l’API configurée avec son lecteur. Exclure ces routes des caches, des
statistiques et des journaux d’accès contenant URL, en-têtes ou corps.
Ne pas changer le routage en production. La racine renvoie au site de recette.

## Ce que vérifie le parcours

La page de recette démarre la connexion par un formulaire de même origine.
La demande est limitée au scope `openid`. Le code est échangé côté serveur
avec PKCE S256 ; le serveur vérifie signature RS256, émetteur, audience,
expiration, nonce et état. Les points d’accès HTTPS sont fixes ; les clés
publiques sont obtenues via le JWKS officiel. Aucun jeton Google, profil,
e-mail ou code d’autorisation n’est enregistré dans Littora.

Une tentative appartient au navigateur qui l’a lancée, expire après cinq
minutes et ne peut être consommée qu’une fois. Le pilote est mono-instance :
un redémarrage impose de recommencer la connexion en cours. Une limite de
256 demandes en attente borne la mémoire ; restreindre l’entrée du pilote
au réseau de recette. Une annulation ou une panne ne crée pas de session et
ne déconnecte pas la session précédente.

## Recette réelle avant ouverture

- Sur l’origine privée, ouvrir `/connexion/google`, puis accepter avec le
  compte autorisé. Vérifier le retour sur le site et la réponse 200 de
  `GET /api/member/session`. Après déconnexion la même route doit répondre 401.
- Refaire le parcours en annulant chez Google. Confirmer le message d’annulation,
  l’absence de nouvelle session et le maintien de la consultation anonyme.
- Avec un autre utilisateur de test Google, vérifier le refus sans création
  de compte. Tester aussi l’indisponibilité du fournisseur ou du stockage.
- Consigner dans #26 uniquement la date, les cas vérifiés et leur résultat.
  Pas de capture du compte, de cookie, de requête de retour ni de jeton.
- Pour arrêter le pilote, retirer les routes de recette et arrêter le processus.
  Révoquer les sessions d’essai dans la base privée et les identifiants du
  client de test lorsque la recette est terminée.

Les tests automatisés utilisent un transport simulé avec clés éphémères,
le vrai client OIDC et PostgreSQL jetable. Le contrôle d’intégration CI lance
aussi Chrome entre deux origines HTTPS locales : formulaire, consentement
simulé, portée des cookies et déconnexion. Pour le rejouer dans la suite
d’intégration locale, installer les dépendances du dépôt et Chrome, puis
définir `TEST_MEMBER_BROWSER=1` et `PLAYWRIGHT_CHANNEL=chrome`.
L’ouverture V1 reste conditionnée
au consentement réel, à la 2FA membre, à la récupération et à l’effacement.
Le pilote ne donne aucun accès de modération ou d’administration (#97).

Références : [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[configuration officielle](https://accounts.google.com/.well-known/openid-configuration),
[vérification des signatures dans openid-client](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md).
