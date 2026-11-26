# Reprise PostgreSQL (#30)

**Objectifs de recette, non garantis en production :** au plus 24 h de données
perdues (RPO) et 2 h pour rétablir la consultation (RTO). Mesurer le premier
depuis le dernier export disponible hors hôte, le second depuis le début de
l’incident jusqu’à la vérification de l’API sur la base restaurée. La réussite
d’un export sur le disque du serveur ne prouve ni l’un ni l’autre.

## Préparer la sauvegarde

Le serveur a besoin de Docker, Bash et [age](https://github.com/FiloSottile/age).
Sur une machine de récupération distincte, créer une identité avec
`age-keygen -o restore.agekey`. Confier la clé privée au responsable de reprise
dans un coffre sauvegardé ; ne transférer sur le serveur que le destinataire
**public** obtenu avec `age-keygen -y restore.agekey`. Tester la récupération
avant de changer de clé et garder les anciennes tant que leurs archives existent.

1. Préparer un répertoire dédié hors dépôt, appartenant au compte d’exploitation,
   mode 0700. Le support doit autoriser les liens physiques. Prévoir une copie
   hors hôte à accès restreint, avec rétention indépendante et provenance vérifiée.
2. Définir `BACKUP_DIR`, `AGE_RECIPIENT` et éventuellement
   `BACKUP_RETENTION_DAYS` (14 par défaut, de 2 à 90). La commande
   `bash scripts/backup-postgres.sh` sélectionne l’unique service PostgreSQL
   du projet Compose `littora-prod`. En recette seulement, sélectionner
   explicitement un conteneur jetable avec `POSTGRES_CONTAINER`.
3. Un nom d’archive et un code 0 indiquent le succès. L’export logique est
   chiffré en flux, sans dump en clair. Une erreur de lecture ou de chiffrement
   ne publie rien et ne déclenche pas la rétention. Après succès, seuls les
   fichiers réguliers au format de nom du programme ayant atteint la durée
   de rétention sont supprimés d’après leur date de modification.
4. Sur une cible Linux avec systemd, les modèles dans `infra/backup/` prévoient
   le dépôt sous `/opt/littora`, la destination sous `/var/backups/littora/postgres`
   et `/etc/littora/backup.env` contenant le destinataire public et la rétention.
   Après un essai manuel réussi, installer les deux unités dans
   `/etc/systemd/system/`, recharger systemd et activer `littora-backup.timer`.
   Exécution prévue à 02:00 UTC, avec rattrapage après arrêt. Aucun lanceur
   applicatif n’active ces unités. L’accès au démon Docker est privilégié.

## Restaurer en isolement

L’opérateur de reprise utilise **une copie d’origine vérifiée** de l’archive
et récupère la clé privée hors du serveur applicatif. Utiliser un cluster
PostGIS neuf et compatible, sans port public, sans volume applicatif et sans
worker. Recréer les rôles propriétaires et de modération utilisés sur la
source ; les rôles globaux et leurs secrets ne font pas partie de `pg_dump`.
Créer une base **vide** depuis `template0`, puis, depuis Bash :

```bash
set -euo pipefail
: "${RESTORE_CONTAINER:?cible jetable}" "${RESTORE_USER:?}" "${RESTORE_DATABASE:?base vide}"
age -d -i "$RESTORE_IDENTITY" "$ARCHIVE" |
  docker exec -i "$RESTORE_CONTAINER" pg_restore --single-transaction --exit-on-error \
    -U "$RESTORE_USER" --dbname="$RESTORE_DATABASE"
```

En cas d’erreur d’une des deux commandes, écarter **la cible jetable** même
si elle contient des tables. Garder la source intacte. Avant toute bascule,
contrôler migrations, plages, géométries, analyses sanitaires, signalements,
droits de modération et lecture d’une fiche par l’API. La CI compare les
empreintes de cinq tables de recette sur deux serveurs distincts ; elle ne
chronomètre pas une reprise de l’hébergement réel.

## Exploitation

L’exploitant vérifie le succès de la tâche et de la copie hors hôte chaque jour.
Si la dernière copie récupérable dépasse 24 h, ouvrir un incident, contrôler
l’espace disponible, les permissions, Docker et le destinataire, relancer puis
tester la restauration. Ne jamais purger les copies pour faire passer un contrôle.
Conserver seulement le résultat, la date et les durées dans le suivi d’incident,
pas les données, clés ou chemins privés.

Avant ouverture (#113/#31) : avec le responsable d'exploitation désigné, configurer
le stockage hors hôte et les notifications, valider la durée de conservation
et exercer une reprise chronométrée. Cet export ne couvre ni les identifiants
d’exploitation, ni Redis/BullMQ, ni les certificats Caddy.
