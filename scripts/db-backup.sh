#!/usr/bin/env bash
# scripts/db-backup — Create a safe backup of the SQLite database
#
# Runs on the host, not in the container: the image has neither bash nor sqlite3.
#
# Usage:
#   bash scripts/db-backup.sh [db-path] [backup-dir] [retention-days]
#
# Examples:
#   bash scripts/db-backup.sh                                     # defaults
#   bash scripts/db-backup.sh ./data/situs.sqlite ./backups 14   # custom
#
# Defaults:
#   db-path:        ./data/situs.sqlite, where docker-compose.yml mounts /app/data (or $DATABASE_FILE)
#   backup-dir:     ./backups
#   retention-days: 7

set -euo pipefail

DB_PATH="${1:-${DATABASE_FILE:-./data/situs.sqlite}}"
BACKUP_DIR="${2:-./backups}"
RETENTION_DAYS="${3:-7}"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/situs-${TIMESTAMP}.sqlite"

# Validate source database exists
if [ ! -f "${DB_PATH}" ]; then
  echo "Error: Database file not found at ${DB_PATH}"
  echo "Set DATABASE_FILE env var or pass the path as first argument."
  exit 1
fi

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Check for sqlite3
if command -v sqlite3 &> /dev/null; then
  echo "Creating hot backup using sqlite3 .backup command..."
  sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"
else
  echo "Warning: sqlite3 not found. Falling back to file copy."
  echo "This is only safe if the application is stopped or using WAL mode."
  cp "${DB_PATH}" "${BACKUP_FILE}"
fi

# Verify backup
if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file was not created."
  exit 1
fi

BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "unknown")
echo "Backup created: ${BACKUP_FILE} (${BACKUP_SIZE} bytes)"

# Compute checksum
if command -v sha256sum &> /dev/null; then
  CHECKSUM=$(sha256sum "${BACKUP_FILE}" | cut -d' ' -f1)
  echo "SHA256: ${CHECKSUM}"
  echo "${CHECKSUM}  ${BACKUP_FILE}" >> "${BACKUP_DIR}/checksums.txt"
elif command -v shasum &> /dev/null; then
  CHECKSUM=$(shasum -a 256 "${BACKUP_FILE}" | cut -d' ' -f1)
  echo "SHA256: ${CHECKSUM}"
  echo "${CHECKSUM}  ${BACKUP_FILE}" >> "${BACKUP_DIR}/checksums.txt"
fi

# Prune old backups
if [ "${RETENTION_DAYS}" -gt 0 ]; then
  PRUNED=$(find "${BACKUP_DIR}" -name "situs-*.sqlite" -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l || echo 0)
  if [ "${PRUNED}" -gt 0 ]; then
    echo "Pruned ${PRUNED} backup(s) older than ${RETENTION_DAYS} days."
  fi
fi

echo "Done."
