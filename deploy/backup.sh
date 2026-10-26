#!/bin/sh
# Daily database backup with 14 days kept. Run it from cron on the server, e.g.:
#   15 2 * * * /opt/psg-survey/deploy/backup.sh >> /var/log/psg-backup.log 2>&1
# Keep the connection out of the command line, where `ps` shows it to every user:
# put DATABASE_URL in a file only the backup user can read (chmod 600) and point
# BACKUP_ENV_FILE at it, or use a 0600 ~/.pgpass. A daily dump can lose up to a
# day of answers: use the managed database's point-in-time recovery when there is
# one (runbook section 7). Copy BACKUP_DIR off the server too (another disk or
# bucket): a backup on the same disk does not survive losing the disk. Prove
# restores with `npm run restore-drill`.
set -eu
# Backups hold every customer's details and answers: only the owner may read them.
umask 077
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/psg-survey/backup.env}"
if [ -z "${DATABASE_URL:-}" ] && [ -r "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$BACKUP_ENV_FILE"
fi
: "${DATABASE_URL:?set DATABASE_URL in BACKUP_ENV_FILE}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/psg-survey}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/psg_survey-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file="$file.part" "$DATABASE_URL"
mv "$file.part" "$file"
find "$BACKUP_DIR" -name 'psg_survey-*.dump' -mtime +"$KEEP_DAYS" -delete
# Partial files left by a failed run.
find "$BACKUP_DIR" -name 'psg_survey-*.dump.part' -mmin +60 -delete
echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$file" | cut -f1))"
