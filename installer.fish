#!/usr/bin/env fish
# Installation locale d'AeroDrop et de son lanceur de menu.

set -l projet (cd (dirname (status filename)); and pwd)
if test -z "$projet"
    echo "Impossible de trouver le dossier d'AeroDrop."
    exit 1
end

echo "Installation d'AeroDrop…"
python3 -m pip install --user -e "$projet"'[desktop]' --break-system-packages
or exit 1

set -l bin_dir "$HOME/.local/bin"
set -l apps_dir "$HOME/.local/share/applications"
mkdir -p "$bin_dir" "$apps_dir" "$HOME/Partage-AeroDrop"
cp "$projet/packaging/aerodrop-lancer.fish" "$bin_dir/aerodrop-lancer"
chmod +x "$bin_dir/aerodrop-lancer"
cp "$projet/packaging/aerodrop.desktop" "$apps_dir/aerodrop.desktop"

if not contains "$bin_dir" $PATH
    fish_add_path -U "$bin_dir"
end

if command -q update-desktop-database
    update-desktop-database "$apps_dir" >/dev/null 2>&1
end

echo "AeroDrop est installé. Il est maintenant disponible dans les applications."
echo "Dossier partagé par défaut : $HOME/Partage-AeroDrop"
