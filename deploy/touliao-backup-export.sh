#!/usr/bin/env bash
set -euo pipefail
umask 077
# Invoked only by a restricted backup SSH key. No caller-supplied paths or commands.
export TOULIAO_ROOT=/home/ubuntu/gh-mirror/touliao
export PATH=/usr/local/bin:/usr/bin:/bin
unset DB_PATH UPLOADS_ROOT ALERT_BOT_TOKEN ALERT_CHAT_ID
exec 8>/run/lock/touliao-backup-export.lock
flock -n 8 || exit 1
STAGING=$(mktemp -d /var/backup/touliao/.export-XXXXXX)
trap 'rm -rf "$STAGING"' EXIT
export BACKUP_DIR="$STAGING/snapshot"
/usr/local/bin/touliao-backup >&2
mv "$BACKUP_DIR"/touliao-*.db.gz "$STAGING/database.db.gz"
mv "$BACKUP_DIR"/uploads-*.tar.gz "$STAGING/uploads.tar.gz"
python3 /usr/local/lib/touliao/migration-bundle.py collect /etc/touliao-backup/migration-policy.json "$STAGING/migration.tar.gz" >&2
install -m 600 /home/ubuntu/.touliao-migration/ci-credentials.age "$STAGING/ci-credentials.age"
node /usr/local/lib/touliao/backup-manifest.cjs create "$STAGING" >&2
tar -cf - -C "$STAGING" database.db.gz uploads.tar.gz migration.tar.gz ci-credentials.age manifest.json |
  age -R /etc/touliao-backup/recipient.txt
