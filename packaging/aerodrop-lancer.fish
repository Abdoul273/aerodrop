#!/usr/bin/env fish
# Lance AeroDrop depuis le menu avec un dossier de partage prêt à l'emploi.

set -l dossier_partage "$HOME/Partage-AeroDrop"
mkdir -p "$dossier_partage"

if test -x "$HOME/.local/bin/aerodrop-desktop"
    exec "$HOME/.local/bin/aerodrop-desktop" "$dossier_partage" --name (hostname)
end

exec aerodrop-desktop "$dossier_partage" --name (hostname)
