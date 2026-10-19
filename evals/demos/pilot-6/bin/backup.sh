#!/bin/sh
# Copy a directory into ./backups/<name>-<date>.tar.gz
set -e
src="$1"
mkdir -p backups
tar -czf "backups/$(basename "$src")-$(date +%Y%m%d).tar.gz" "$src"
echo "backed up $src"
