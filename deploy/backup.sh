#!/bin/sh
# Daily database backup with 14 days kept. Run it from cron on the server, e.g.:
#   15 2 * * * DATABASE_URL=postgres://... /opt/psg-survey/deploy/backup.sh >> /var/log/psg-backup.log 2>&1
# Copy BACKUP_DIR off the server too (another disk or bucket): a backup on the same
# disk does not survive losing the disk. Prove restores with `npm run restore-drill`.
set -eu
: "${DATABASE_URL:?set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/psg-survey}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/psg_survey-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file="$file.part" "$DATABASE_URL"
mv "$file.part" "$file"
find "$BACKUP_DIR" -name 'psg_survey-*.dump' -mtime +"$KEEP_DAYS" -delete
# Partial files left by a failed run.
find "$BACKUP_DIR" -name 'psg_survey-*.dump.part' -mmin +60 -delete
echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$file" | cut -f1))"
