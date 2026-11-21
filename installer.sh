#!/usr/bin/env bash
# Installation locale d'AeroDrop et de son lanceur de menu.

set -euo pipefail

projet="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
bin_dir="$HOME/.local/bin"
apps_dir="$HOME/.local/share/applications"
dossier_partage="$HOME/Partage-AeroDrop"

echo "Installation d'AeroDrop…"
python3 -m pip install --user -e "${projet}[desktop]" --break-system-packages

mkdir -p "$bin_dir" "$apps_dir" "$dossier_partage"
install -m 755 "$projet/packaging/aerodrop-lancer" "$bin_dir/aerodrop-lancer"
install -m 644 "$projet/packaging/aerodrop.desktop" "$apps_dir/aerodrop.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
fi

echo "AeroDrop est installé. Il est maintenant disponible dans les applications."
echo "Dossier partagé par défaut : $dossier_partage"
