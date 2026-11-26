# Intervention et astreinte (#30)

**État pré-V1 :** exploitation confiée à un responsable unique. Aucun horaire
de garde n'est annoncé et aucun
envoi réel ni délai d’intervention ne sont garantis par la CI. Les coordonnées,
horaires de garde, accès et comptes rendus nominatifs restent hors Git.

## Qui prend la main ?

| Rôle | Décision attendue |
|---|---|
| Responsable d'exploitation | Accuse réception en privé, qualifie l'impact et décide des mesures conservatoires. |
| Reprise et publication (même responsable) | Contrôle la copie hors machine, restaure sur une cible isolée, vérifie les écritures et décide d'une réouverture. |

Avant ouverture, consigner dans l'annuaire **privé** le canal principal, le canal
de secours indépendant du serveur et les plages effectivement couvertes.
Pendant ces plages, viser un accusé humain sous 15 minutes pour un site illisible,
une suspicion de fuite ou des données à risque. Sans réponse, utiliser le canal
de secours, garder l'incident ouvert et suspendre la publication ou la bascule.
Il n'y a pas de seconde personne d'astreinte présumée. Les futures automatisations
et le tableau de bord ne remplacent ni un accusé humain ni une décision de reprise.
Le [contrôle préalable à l'ouverture #113](https://github.com/ActuatorIO-Foundry/littora/issues/113)
exige une alerte effectivement reçue et une restauration depuis une copie hors machine.

## Qualifier, intervenir, vérifier

| Signal | Premier geste | Preuve de reprise |
|---|---|---|
| Site illisible, HTTP en erreur | Depuis une connexion extérieure, tester le site, une fiche et une lecture du catalogue. Vérifier proxy, santé de l’API puis base. Geler les déploiements. | La fiche et l’API renvoient les données attendues via HTTPS depuis l’extérieur. |
| Fournisseur en erreur, données périmées | Lire en privé les [codes de la sonde](COLLECTE-METEO.md#alertes-de-collecte-30). Identifier source et étendue. Respecter le délai fournisseur ; ne pas forcer les collectes. | Une nouvelle collecte réussit et sa fraîcheur est visible sur une fiche concernée. |
| Worker silencieux, file en pause ou saturée | Vérifier le worker, la base, les deux Redis et la cause d’une pause. Ne pas purger les jobs ni redémarrer une importation à l’aveugle. | Le battement revient, la file progresse et un traitement aboutit. |
| Contrôle impossible | Vérifier le minuteur, Docker, la présence d’un seul worker de production et les dépendances de la sonde. Une absence d’alerte ne suffit pas. | La sonde répond de nouveau et le canal privé fonctionne. |
| Copie hors hôte absente ou âgée de plus de 24 h | Avertir le responsable de reprise, préserver les copies, suivre la [restauration isolée](SAUVEGARDES.md). | Depuis l’hôte de secours, archive déchiffrée, données comparées et fiche lisible ; mesurer perte de données et durée de reprise. |
| Exposition suspectée | Restreindre l’accès, informer le responsable, révoquer les secrets concernés et préserver les preuves dans le circuit privé selon la [politique des journaux](JOURNAUX.md). | Accès vérifiés, secrets remplacés lorsque nécessaire et décision de réouverture consignée. |

**Retour de version.** Relever la dernière révision validée, ses images exactes,
la version du schéma et les écritures intervenues depuis. Tester la lecture **et
les écritures** de cette version sur une copie restaurée avant décision. Sans
compatibilité prouvée, suspendre la bascule et appliquer le [guide des
migrations](MIGRATIONS.md). Ne pas réaffecter un ancien volume actif ni effacer
les contributions reçues entre-temps. Pour les images de stockage, suivre le
[retour arrière dédié](INFRASTRUCTURE.md#retour-arriere). Noter en privé l’heure
UTC de détection, de prise en charge et de reprise, les fonctions touchées, la
décision et le résultat de vérification. Pas de log brut dans une issue.

## Relais privé de la collecte

Sur une **cible Linux autorisée**, préparer Node dans la version du projet,
Docker, systemd et une messagerie locale compatible avec
`/usr/sbin/sendmail -oi`. L’alias local fixe `littora-astreinte` doit être
routé par l’exploitant. Le dépôt sous `/opt/littora`, les exécutables du PATH
et les unités doivent être administrés par root, non modifiables par les
services web. L’accès au démon Docker est privilégié. Aucune unité n’est
installée par Compose ou par le lancement du site.

1. Sans démarrer la surveillance, faire un essai depuis le serveur :
   `node /opt/littora/scripts/notify-collection.mjs --test-channel`. Le sujet
   se termine par `test` ; la commande ne lit aucun conteneur ni état d’incident.
   Faire confirmer la **réception par le destinataire**, puis tester le canal de secours.
   Un code zéro indique seulement l’acceptation par la messagerie locale.
2. Installer les deux unités de `infra/monitoring/` dans `/etc/systemd/system/`,
   faire `systemctl daemon-reload`, puis `systemctl start littora-collection-watch.service`.
   Vérifier le résultat, puis activer `systemctl enable --now littora-collection-watch.timer`.
   Contrôler la prochaine échéance avec `systemctl list-timers littora-collection-watch.timer`.
   Ne pas lancer le script de surveillance à la main en parallèle du service.
3. Chaque minute, le service lit la sonde du worker de `littora-prod` sans
   appeler les fournisseurs. Il signale un changement des catégories d’incident,
   rappelle une situation inchangée après une heure et notifie le retour à
   `ok`. `check_unavailable` signifie « état inconnu », jamais « reprise ».
   Aucun nom, texte d’erreur, sortie Docker ou identifiant de conteneur n’entre
   dans le contenu applicatif du courrier ; la messagerie gère ses propres
   en-têtes et destinataires.
4. Un refus d’envoi fait échouer le service ; l’événement reste en attente pour
   le passage suivant. En cas de coupure pendant la remise, un doublon est
   possible. L’état privé sous `/var/lib/littora-astreinte` n’est pas un journal
   exhaustif. Si le service échoue, vérifier aussi le relais, le disque, l’heure
   et les permissions avant de conclure à une panne de collecte.
5. Pour retirer le relais : `systemctl disable --now littora-collection-watch.timer`,
   laisser finir le passage éventuel et confirmer la prise en charge par un
   autre canal. Cette opération n’arrête ni le worker ni l’API.

**Critère avant ouverture :** le contrôle sur le serveur ne peut pas alerter si
celui-ci est arrêté. Vérifier séparément depuis l’extérieur la disponibilité du
site, la réception effective des avis et la fraîcheur de la copie hors hôte.
Tester sur la cible l’accès aux journaux, leur rétention et une reprise
chronométrée. Conserver les attestations datées dans le circuit privé ; dans
#30, ne publier que les résultats agrégés et les réserves.
